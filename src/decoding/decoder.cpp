#include "decoding/decoder.h"
#include "bitstream/nal_unit.h"
#include "bitstream/bitstream_reader.h"
#include "filters/deblocking.h"
#include "filters/sao.h"
#include "common/debug.h"

#include <cstring>
#include <cstdio>

namespace hevc {

DecodeStatus Decoder::decode(const uint8_t* data, size_t size) {
    NalParser parser;
    auto nals = parser.parse(data, size);

    HEVC_LOG(PARSE, "Decoded %zu NAL units", nals.size());

    // Process NALs: parameter sets first, then decode each picture
    size_t i = 0;
    while (i < nals.size()) {
        auto type = nals[i].header.nal_unit_type;

        if (type == NalUnitType::VPS_NUT ||
            type == NalUnitType::SPS_NUT ||
            type == NalUnitType::PPS_NUT) {
            ps_mgr_.process_nal(nals[i]);
            i++;
        } else if (is_vcl(type)) {
            // Collect all VCL NALs belonging to the same picture
            size_t first_vcl = i;
            i++;
            while (i < nals.size() && is_vcl(nals[i].header.nal_unit_type)) {
                BitstreamReader bs(nals[i].rbsp.data(), nals[i].rbsp.size());
                bool first_slice = bs.read_flag();
                if (first_slice) break; // New picture starts here
                i++;
            }
            size_t vcl_count = i - first_vcl;

            auto status = decode_picture(nals, first_vcl, vcl_count);
            if (status != DecodeStatus::OK) return status;
        } else if (type == NalUnitType::EOS_NUT || type == NalUnitType::EOB_NUT) {
            // §8.1: the first picture after it is an IRAP with NoRaslOutputFlag = 1
            dpb_.end_of_sequence();
            i++;
        } else {
            // Non-VCL, non-parameter-set NAL (SEI, AUD, etc.) — skip
            i++;
        }
    }

    return DecodeStatus::OK;
}

DecodeStatus Decoder::decode_picture(const std::vector<NalUnit>& nals,
                                      size_t first_vcl_idx, size_t vcl_count) {
    const auto& nal = nals[first_vcl_idx];

    // Parse first slice header (always independent)
    SliceHeader first_sh;
    if (!ps_mgr_.parse_slice_header(first_sh, nal)) {
        fprintf(stderr, "Error: failed to parse slice header\n");
        return DecodeStatus::ERROR;
    }

    const SPS* sps = ps_mgr_.active_sps();
    const PPS* pps = ps_mgr_.active_pps();
    if (!sps || !pps) {
        fprintf(stderr, "Error: no active SPS/PPS\n");
        return DecodeStatus::ERROR;
    }

    HEVC_LOG(PARSE, "Decoding picture: %dx%d type=%d QP=%d slices=%zu",
             sps->pic_width_in_luma_samples, sps->pic_height_in_luma_samples,
             static_cast<int>(first_sh.slice_type), first_sh.SliceQpY, vcl_count);

    // §8.3.1 — POC derivation (from first slice only)
    int32_t poc = dpb_.derive_poc(first_sh, *sps, nal.header.nal_unit_type,
                                   nal.header.TemporalId());

    // §C.5.2.2: pictures emptied without output are reported like those with
    // PicOutputFlag = 0 — each one is a demuxed sample that produces no frame.
    if (dpb_.no_output_of_prior_pics()) {
        for (Picture* dropped : dpb_.discard_prior_output()) {
            suppressed_.push_back({dropped->cvs_id, dropped->poc});
        }
    } else if (is_irap(nal.header.nal_unit_type) && dpb_.no_rasl_output_flag()) {
        dpb_.output_all_prior();
    }

    // Allocate picture in DPB
    ChromaFormat fmt = static_cast<ChromaFormat>(sps->chroma_format_idc);
    Picture* pic = dpb_.alloc_picture(
        static_cast<int>(sps->pic_width_in_luma_samples),
        static_cast<int>(sps->pic_height_in_luma_samples),
        fmt, sps->BitDepthY, sps->BitDepthC);
    pic->poc = poc;

    // §8.1 derives PicOutputFlag from the slice header, then overrides it: a RASL
    // picture of an IRAP with NoRaslOutputFlag = 1 is set to 0. Such a picture
    // references pictures preceding its IRAP in decode order, which were never
    // decoded — it cannot be reconstructed, so it is decoded but never shown.
    // Derived once: the suppression below reads the same value, and a picture
    // held back without being reported would shift the timestamps of every later
    // frame of the segment.
    bool PicOutputFlag = first_sh.pic_output_flag;
    if (is_rasl(nal.header.nal_unit_type) && dpb_.no_rasl_output_flag()) {
        PicOutputFlag = false;
    }
    pic->needed_for_output = PicOutputFlag;

    // §8.1: IRAP with NoRaslOutputFlag starts a new CVS — an IDR, a BLA, or a
    // CRA that opens the bitstream or follows an end-of-sequence NAL. POC
    // restarts with it, so pictures of two sequences must not share an id.
    if (is_irap(nal.header.nal_unit_type) && dpb_.no_rasl_output_flag()) {
        cvs_id_++;
    }
    pic->cvs_id = cvs_id_;

    // Set conformance window
    if (sps->conformance_window_flag) {
        pic->conf_win_left = sps->conf_win_left_offset * sps->SubWidthC;
        pic->conf_win_right = sps->conf_win_right_offset * sps->SubWidthC;
        pic->conf_win_top = sps->conf_win_top_offset * sps->SubHeightC;
        pic->conf_win_bottom = sps->conf_win_bottom_offset * sps->SubHeightC;
    }

    // §8.3.2 — RPS derivation and picture marking
    dpb_.derive_rps(first_sh, *sps, nal.header.nal_unit_type, poc);
    dpb_.simulate_bumping_before_decode(*sps);

    // Allocate CU info grid (min-CB granularity)
    int cuGridW = sps->PicWidthInMinCbsY;
    int cuGridH = sps->PicHeightInMinCbsY;
    cu_info_buf_.resize(cuGridW * cuGridH);
    std::fill(cu_info_buf_.begin(), cu_info_buf_.end(), CUInfo{});

    // Intra mode grid uses min-TB granularity (4x4) to support NxN sub-PU
    int modeGridW = sps->pic_width_in_luma_samples / kGridSize;
    int modeGridH = sps->pic_height_in_luma_samples / kGridSize;
    intra_mode_buf_.resize(modeGridW * modeGridH);
    std::fill(intra_mode_buf_.begin(), intra_mode_buf_.end(), 1); // DC default
    chroma_mode_buf_.resize(modeGridW * modeGridH);
    std::fill(chroma_mode_buf_.begin(), chroma_mode_buf_.end(), 0); // Planar default

    // Motion info grid at min-PU (4x4) granularity for inter MV storage
    motion_info_buf_.resize(modeGridW * modeGridH);
    std::fill(motion_info_buf_.begin(), motion_info_buf_.end(), PUMotionInfo{});
    // The Picture's own copy, for TMVP by future frames, is taken once the
    // picture is decoded
    pic->motion_info_stride = modeGridW;

    // Phase 6: filter grids at min-TB (4x4) granularity
    cbf_luma_buf_.resize(modeGridW * modeGridH, 0);
    std::fill(cbf_luma_buf_.begin(), cbf_luma_buf_.end(), 0);
    log2_tu_size_buf_.resize(modeGridW * modeGridH, sps->CtbLog2SizeY);
    std::fill(log2_tu_size_buf_.begin(), log2_tu_size_buf_.end(),
              static_cast<uint8_t>(sps->CtbLog2SizeY));
    edge_flags_v_buf_.resize(modeGridW * modeGridH, 0);
    std::fill(edge_flags_v_buf_.begin(), edge_flags_v_buf_.end(), 0);
    edge_flags_h_buf_.resize(modeGridW * modeGridH, 0);
    std::fill(edge_flags_h_buf_.begin(), edge_flags_h_buf_.end(), 0);

    // Phase 6: SAO params per CTU
    int ctbGridSize = sps->PicWidthInCtbsY * sps->PicHeightInCtbsY;
    sao_params_buf_.resize(ctbGridSize);
    std::fill(sao_params_buf_.begin(), sao_params_buf_.end(), DecodingContext::SaoParams{});

    // Phase 10: slice index per CTU
    slice_idx_buf_.resize(ctbGridSize);
    std::fill(slice_idx_buf_.begin(), slice_idx_buf_.end(), 0);

    // Setup decoding context (shared across all slices)
    // Note: CabacEngine is re-initialized per-slice via init_contexts + init_decoder
    CabacEngine cabac;
    DecodingContext ctx;
    ctx.wpp_contexts_available = false;
    ctx.thread_pool = &thread_pool_;
    ctx.sps = sps;
    ctx.pps = pps;
    ctx.cabac = &cabac;
    ctx.pic = pic;
    ctx.dpb = &dpb_;
    ctx.cu_info = cu_info_buf_.data();
    ctx.cu_info_stride = cuGridW;
    ctx.intra_pred_mode_y = intra_mode_buf_.data();
    ctx.intra_pred_mode_c = chroma_mode_buf_.data();
    ctx.intra_pred_mode_stride = modeGridW;
    ctx.motion_info = motion_info_buf_.data();
    ctx.motion_info_stride = modeGridW;
    ctx.cbf_luma_grid = cbf_luma_buf_.data();
    ctx.log2_tu_size_grid = log2_tu_size_buf_.data();
    ctx.edge_flags_v = edge_flags_v_buf_.data();
    ctx.edge_flags_h = edge_flags_h_buf_.data();
    ctx.filter_grid_stride = modeGridW;
    ctx.sao_params = sao_params_buf_.data();
    ctx.sao_params_stride = sps->PicWidthInCtbsY;
    ctx.sao_backup = sao_backup_;
    ctx.slice_idx = slice_idx_buf_.data();

    // Decode each slice segment — store headers for per-CTU filter parameter lookup
    std::vector<SliceHeader> slice_headers(vcl_count);
    std::vector<const SliceHeader*> slice_header_ptrs(vcl_count);
    // Slice (not slice segment) of each segment: the index of the independent
    // segment that opens it. §6.4.1 availability, WPP sync and the loop filters
    // work per slice, so a dependent segment shares its slice's index.
    std::vector<int> slice_of_segment(vcl_count, 0);
    int last_independent_idx = 0;
    for (size_t s = 0; s < vcl_count; s++) {
        const auto& slice_nal = nals[first_vcl_idx + s];

        // Parse slice header
        if (s == 0) {
            slice_headers[s] = first_sh;
        } else {
            if (!ps_mgr_.parse_slice_header(slice_headers[s], slice_nal)) {
                fprintf(stderr, "Error: failed to parse slice header for slice %zu\n", s);
                return DecodeStatus::ERROR;
            }
            // §7.4.7.1: dependent slices inherit fields from the independent slice
            // The entry points belong to the segment, not to the slice.
            if (slice_headers[s].dependent_slice_segment_flag) {
                SliceHeader own = std::move(slice_headers[s]);
                slice_headers[s] = slice_headers[last_independent_idx];
                slice_headers[s].slice_segment_address = own.slice_segment_address;
                slice_headers[s].dependent_slice_segment_flag = own.dependent_slice_segment_flag;
                slice_headers[s].first_slice_segment_in_pic_flag = own.first_slice_segment_in_pic_flag;
                slice_headers[s].num_entry_point_offsets = own.num_entry_point_offsets;
                slice_headers[s].entry_point_offset_minus1 = std::move(own.entry_point_offset_minus1);
            } else {
                last_independent_idx = static_cast<int>(s);
            }
        }
        slice_header_ptrs[s] = &slice_headers[s];
        slice_of_segment[s] = last_independent_idx;
    }

    ctx.slice_headers = slice_header_ptrs.data();
    ctx.num_slices = static_cast<int>(vcl_count);

    pic->slice_ref_poc.assign(vcl_count, {});

    for (size_t s = 0; s < vcl_count; s++) {
        const auto& slice_nal = nals[first_vcl_idx + s];

        ctx.sh = &slice_headers[s];
        ctx.current_slice_idx = slice_of_segment[s];

        // §8.3.4, §8.3.5 — Reference picture lists and collocated picture, per
        // slice: each has its own num_ref_idx_active, list modification and
        // collocated_ref_idx. Built on I slices too, where it just clears the
        // lists: skipping it left the previous slice's entries in place, and
        // they dangle as soon as alloc_picture() evicts one of them — which is
        // what an IRAP does to the sequence that just ended.
        dpb_.construct_ref_pic_lists(slice_headers[s], *sps, *pps);
        dpb_.derive_colpic(slice_headers[s]);
        auto& ref_pocs = pic->slice_ref_poc[s];
        for (int i = 0; i < dpb_.num_ref_list0(); i++) {
            auto* ref = dpb_.ref_pic_list0(i);
            ref_pocs.list[0].push_back(ref ? ref->poc : Picture::kNoRefPoc);
            ref_pocs.is_long_term[0].push_back(ref && ref->used_for_long_term_ref);
        }
        for (int i = 0; i < dpb_.num_ref_list1(); i++) {
            auto* ref = dpb_.ref_pic_list1(i);
            ref_pocs.list[1].push_back(ref ? ref->poc : Picture::kNoRefPoc);
            ref_pocs.is_long_term[1].push_back(ref && ref->used_for_long_term_ref);
        }

        HEVC_LOG(PARSE, "Slice %zu: addr=%d type=%d QP=%d dependent=%d",
                 s, slice_headers[s].slice_segment_address,
                 static_cast<int>(slice_headers[s].slice_type),
                 slice_headers[s].SliceQpY, slice_headers[s].dependent_slice_segment_flag);

        // Create bitstream reader for this slice's RBSP
        BitstreamReader bs(slice_nal.rbsp.data(), slice_nal.rbsp.size());

        // Skip slice header (re-parse to advance the bitstream position)
        {
            SliceHeader sh_skip;
            sh_skip.parse(bs, *sps, *pps, slice_nal.header.nal_unit_type,
                           slice_nal.header.TemporalId());
        }

        // Byte align after slice header
        if (!bs.byte_aligned())
            bs.byte_alignment();
        // Compute slice header coded size for EP byte conversion.
        // The RBSP starts after the 2-byte NAL header. bs.byte_position() is
        // the RBSP offset of slice data start. The coded offset includes EP bytes.
        size_t slice_data_rbsp_pos = bs.byte_position();
        size_t slice_header_coded_size = slice_data_rbsp_pos;
        // Add back EP bytes that fall within the slice header portion
        for (size_t ep : slice_nal.epb_positions) {
            if (ep < slice_header_coded_size + 2) // +2 for NAL header offset in EP positions
                slice_header_coded_size++;
        }

        HEVC_LOG(PARSE, "Slice %zu data starts at bit %zu, remaining=%zu bits",
                 s, bs.bits_read(), bs.bits_remaining());

        // Decode slice data
        if (!decode_slice_segment_data(ctx, bs, slice_nal.epb_positions,
                                        slice_header_coded_size)) {
            fprintf(stderr, "Error: failed to decode slice %zu data\n", s);
            return DecodeStatus::ERROR;
        }
    }

    // §8.7: In-loop filters — deblocking then SAO (once, after all slices)
    ctx.sh = &slice_headers[last_independent_idx];

    apply_deblocking(ctx);
    apply_sao(ctx);

    // Store motion info in the Picture for TMVP access by future frames
    pic->motion_info_buf = motion_info_buf_;
    // Slice of each CTB, for TMVP to find the lists a collocated ref_idx indexes
    pic->ctb_slice_idx = slice_idx_buf_;

    // §8.1 step 4: mark current picture as short-term reference
    dpb_.mark_current_as_short_term_ref();
    dpb_.simulate_bumping_after_decode(*sps);

    // §C.3.1: the picture is marked "needed for output" iff PicOutputFlag is
    // 1 — derived at allocation time above. A picture with
    // PicOutputFlag = 0 is decoded, and may serve as a reference, but is
    // never bumped out. Report its POC: a caller that assigns timestamps by
    // output position has no other way to tell that one demuxed sample
    // produced no frame, and would shift every later frame of the segment
    // onto the wrong timestamp.
    if (!PicOutputFlag) {
        suppressed_.push_back({pic->cvs_id, poc});
    }

    return DecodeStatus::OK;
}

DecodeStatus Decoder::feed(const uint8_t* data, size_t size) {
    return decode(data, size);
}

std::vector<Picture*> Decoder::drain() {
    const SPS* sps = ps_mgr_.active_sps();
    if (!sps) return {};
    return dpb_.drain(*sps);
}

std::vector<Picture*> Decoder::flush() {
    return dpb_.flush();
}

std::vector<SuppressedPicture> Decoder::take_suppressed_pictures() {
    std::vector<SuppressedPicture> out;
    out.swap(suppressed_);
    return out;
}

std::vector<Picture*> Decoder::output_pictures() {
    // Collect the pictures the DPB still holds for output, sort by CVS then
    // POC. Pictures with PicOutputFlag = 0 are skipped, as the incremental
    // path skips them: the two must agree on what a bitstream outputs.
    std::vector<Picture*> out;
    for (auto& pic : dpb_.pictures()) {
        if (!pic->needed_for_output) continue;
        out.push_back(pic.get());
    }
    std::sort(out.begin(), out.end(),
              [](const Picture* a, const Picture* b) {
                  if (a->cvs_id != b->cvs_id) return a->cvs_id < b->cvs_id;
                  return a->poc < b->poc;
              });
    return out;
}

} // namespace hevc
