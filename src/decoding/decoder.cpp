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

    // Allocate picture in DPB
    ChromaFormat fmt = static_cast<ChromaFormat>(sps->chroma_format_idc);
    Picture* pic = dpb_.alloc_picture(
        static_cast<int>(sps->pic_width_in_luma_samples),
        static_cast<int>(sps->pic_height_in_luma_samples),
        fmt, sps->BitDepthY, sps->BitDepthC);
    pic->poc = poc;
    pic->needed_for_output = first_sh.pic_output_flag;

    // §8.1: IRAP with NoRaslOutputFlag starts a new CVS
    if (is_irap(nal.header.nal_unit_type)) {
        bool isIDR = (nal.header.nal_unit_type == NalUnitType::IDR_W_RADL ||
                      nal.header.nal_unit_type == NalUnitType::IDR_N_LP);
        bool isBLA = (nal.header.nal_unit_type == NalUnitType::BLA_W_LP ||
                      nal.header.nal_unit_type == NalUnitType::BLA_W_RADL ||
                      nal.header.nal_unit_type == NalUnitType::BLA_N_LP);
        if (isIDR || isBLA)
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

    // §8.3.4 — Reference picture list construction (P and B slices)
    if (first_sh.slice_type != SliceType::I) {
        dpb_.construct_ref_pic_lists(first_sh, *sps, *pps);
        // §8.3.5 — Collocated picture derivation
        dpb_.derive_colpic(first_sh);
    }

    // Allocate CU info grid (min-CB granularity)
    int cuGridW = sps->PicWidthInMinCbsY;
    int cuGridH = sps->PicHeightInMinCbsY;
    cu_info_buf_.resize(cuGridW * cuGridH);
    std::fill(cu_info_buf_.begin(), cu_info_buf_.end(), CUInfo{});

    // Intra mode grid uses min-TB granularity (4x4) to support NxN sub-PU
    int modeGridW = sps->pic_width_in_luma_samples / sps->MinTbSizeY;
    int modeGridH = sps->pic_height_in_luma_samples / sps->MinTbSizeY;
    intra_mode_buf_.resize(modeGridW * modeGridH);
    std::fill(intra_mode_buf_.begin(), intra_mode_buf_.end(), 1); // DC default
    chroma_mode_buf_.resize(modeGridW * modeGridH);
    std::fill(chroma_mode_buf_.begin(), chroma_mode_buf_.end(), 0); // Planar default

    // Motion info grid at min-PU (4x4) granularity for inter MV storage
    motion_info_buf_.resize(modeGridW * modeGridH);
    std::fill(motion_info_buf_.begin(), motion_info_buf_.end(), PUMotionInfo{});
    // Allocate compact motion info in the Picture itself (for TMVP by future frames)
    pic->motion_info_buf.resize(modeGridW * modeGridH);
    std::fill(pic->motion_info_buf.begin(), pic->motion_info_buf.end(), Picture::PUMotionInfoCompact{});
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
            if (slice_headers[s].dependent_slice_segment_flag) {
                uint32_t saved_address = slice_headers[s].slice_segment_address;
                bool saved_dependent = slice_headers[s].dependent_slice_segment_flag;
                bool saved_first = slice_headers[s].first_slice_segment_in_pic_flag;
                slice_headers[s] = slice_headers[last_independent_idx];
                slice_headers[s].slice_segment_address = saved_address;
                slice_headers[s].dependent_slice_segment_flag = saved_dependent;
                slice_headers[s].first_slice_segment_in_pic_flag = saved_first;
            } else {
                last_independent_idx = static_cast<int>(s);
            }
        }
        slice_header_ptrs[s] = &slice_headers[s];
    }

    ctx.slice_headers = slice_header_ptrs.data();
    ctx.num_slices = static_cast<int>(vcl_count);

    for (size_t s = 0; s < vcl_count; s++) {
        const auto& slice_nal = nals[first_vcl_idx + s];

        ctx.sh = &slice_headers[s];
        ctx.current_slice_idx = static_cast<int>(s);

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
    for (int i = 0; i < modeGridW * modeGridH; i++) {
        auto& src = motion_info_buf_[i];
        auto& dst = pic->motion_info_buf[i];
        dst.mv_x[0] = src.mv[0].x; dst.mv_y[0] = src.mv[0].y;
        dst.mv_x[1] = src.mv[1].x; dst.mv_y[1] = src.mv[1].y;
        dst.ref_idx[0] = src.ref_idx[0]; dst.ref_idx[1] = src.ref_idx[1];
        dst.pred_flag[0] = src.pred_flag[0]; dst.pred_flag[1] = src.pred_flag[1];
    }
    // Store ref POC lists for TMVP MV scaling
    pic->ref_poc[0].clear();
    pic->ref_poc[1].clear();
    for (int i = 0; i < dpb_.num_ref_list0(); i++) {
        auto* ref = dpb_.ref_pic_list0(i);
        pic->ref_poc[0].push_back(ref ? ref->poc : 0);
    }
    for (int i = 0; i < dpb_.num_ref_list1(); i++) {
        auto* ref = dpb_.ref_pic_list1(i);
        pic->ref_poc[1].push_back(ref ? ref->poc : 0);
    }

    // §8.1 step 4: mark current picture as short-term reference
    dpb_.mark_current_as_short_term_ref();

    // §C.5.2.3 already marked the picture "needed for output" at allocation
    // time, from PicOutputFlag. Do not force it to true here: that would
    // output pictures the bitstream asked to discard (pic_output_flag = 0)
    // and keep their storage buffer alive until a bump that never comes.

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

std::vector<Picture*> Decoder::output_pictures() {
    // Collect all pictures from the DPB, sort by CVS then POC
    std::vector<Picture*> out;
    for (auto& pic : dpb_.pictures()) {
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
