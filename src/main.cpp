#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <fstream>
#include <vector>

#include "bitstream/nal_unit.h"
#include "common/types.h"
#include "syntax/parameter_sets.h"
#include "decoding/decoder.h"

static void print_usage(const char* prog) {
    fprintf(stderr, "Usage: %s [options] input.265\n", prog);
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  --dump-nals      List all NAL units\n");
    fprintf(stderr, "  --dump-headers   Dump parameter sets and slice headers\n");
    fprintf(stderr, "  -o output.yuv    Decode and write YUV output\n");
    fprintf(stderr, "  -h, --help       Show this help\n");
}

static std::vector<uint8_t> read_file(const char* path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        fprintf(stderr, "Error: cannot open '%s'\n", path);
        exit(1);
    }
    auto size = file.tellg();
    file.seekg(0, std::ios::beg);
    std::vector<uint8_t> data(static_cast<size_t>(size));
    file.read(reinterpret_cast<char*>(data.data()), size);
    return data;
}

static void dump_vps(const hevc::VPS& vps) {
    printf("\n=== VPS (id=%d) ===\n", vps.vps_video_parameter_set_id);
    printf("  max_layers_minus1          = %d\n", vps.vps_max_layers_minus1);
    printf("  max_sub_layers_minus1      = %d\n", vps.vps_max_sub_layers_minus1);
    printf("  temporal_id_nesting_flag   = %d\n", vps.vps_temporal_id_nesting_flag ? 1 : 0);
    printf("  profile_idc               = %d\n", vps.profile_tier_level.general_profile_idc);
    printf("  level_idc                  = %d (%d.%d)\n",
           vps.profile_tier_level.general_level_idc,
           vps.profile_tier_level.general_level_idc / 30,
           (vps.profile_tier_level.general_level_idc % 30) / 3);
    printf("  tier_flag                  = %d\n", vps.profile_tier_level.general_tier_flag ? 1 : 0);
    if (vps.vps_timing_info_present_flag) {
        printf("  num_units_in_tick          = %u\n", vps.vps_num_units_in_tick);
        printf("  time_scale                 = %u\n", vps.vps_time_scale);
    }
}

static void dump_sps(const hevc::SPS& sps) {
    printf("\n=== SPS (id=%d, vps=%d) ===\n", sps.sps_seq_parameter_set_id, sps.sps_video_parameter_set_id);
    printf("  profile_idc               = %d\n", sps.profile_tier_level.general_profile_idc);
    printf("  level_idc                  = %d (%d.%d)\n",
           sps.profile_tier_level.general_level_idc,
           sps.profile_tier_level.general_level_idc / 30,
           (sps.profile_tier_level.general_level_idc % 30) / 3);
    printf("  chroma_format_idc          = %d\n", sps.chroma_format_idc);
    printf("  pic_width                  = %d\n", sps.pic_width_in_luma_samples);
    printf("  pic_height                 = %d\n", sps.pic_height_in_luma_samples);
    printf("  bit_depth_luma             = %d\n", sps.BitDepthY);
    printf("  bit_depth_chroma           = %d\n", sps.BitDepthC);
    if (sps.conformance_window_flag) {
        printf("  conf_win                   = L%d R%d T%d B%d\n",
               sps.conf_win_left_offset, sps.conf_win_right_offset,
               sps.conf_win_top_offset, sps.conf_win_bottom_offset);
    }
    printf("  log2_max_poc_lsb           = %d\n", sps.log2_max_pic_order_cnt_lsb_minus4 + 4);
    printf("  CtbSizeY                   = %d\n", sps.CtbSizeY);
    printf("  MinCbSizeY                 = %d\n", sps.MinCbSizeY);
    printf("  PicSize in CTBs            = %dx%d (%d total)\n",
           sps.PicWidthInCtbsY, sps.PicHeightInCtbsY, sps.PicSizeInCtbsY);
    printf("  MinTbSizeY                 = %d\n", sps.MinTbSizeY);
    printf("  MaxTbSizeY                 = %d\n", sps.MaxTbSizeY);
    printf("  max_trafo_depth_intra      = %d\n", sps.max_transform_hierarchy_depth_intra);
    printf("  max_trafo_depth_inter      = %d\n", sps.max_transform_hierarchy_depth_inter);
    printf("  scaling_list_enabled        = %d\n", sps.scaling_list_enabled_flag ? 1 : 0);
    printf("  amp_enabled                = %d\n", sps.amp_enabled_flag ? 1 : 0);
    printf("  sao_enabled                = %d\n", sps.sample_adaptive_offset_enabled_flag ? 1 : 0);
    printf("  pcm_enabled                = %d\n", sps.pcm_enabled_flag ? 1 : 0);
    printf("  temporal_mvp_enabled       = %d\n", sps.sps_temporal_mvp_enabled_flag ? 1 : 0);
    printf("  strong_intra_smoothing     = %d\n", sps.strong_intra_smoothing_enabled_flag ? 1 : 0);
    printf("  num_short_term_ref_pic_sets = %d\n", sps.num_short_term_ref_pic_sets);
    for (uint32_t i = 0; i < sps.num_short_term_ref_pic_sets; i++) {
        const auto& rps = sps.st_ref_pic_sets[i];
        printf("    st_rps[%d]: neg=%d pos=%d\n", i, rps.NumNegativePics, rps.NumPositivePics);
    }
    printf("  long_term_ref_pics_present = %d\n", sps.long_term_ref_pics_present_flag ? 1 : 0);
    if (sps.long_term_ref_pics_present_flag) {
        printf("  num_long_term_ref_pics_sps = %d\n", sps.num_long_term_ref_pics_sps);
    }
}

static void dump_pps(const hevc::PPS& pps) {
    printf("\n=== PPS (id=%d, sps=%d) ===\n", pps.pps_pic_parameter_set_id, pps.pps_seq_parameter_set_id);
    printf("  dependent_slices           = %d\n", pps.dependent_slice_segments_enabled_flag ? 1 : 0);
    printf("  num_ref_idx_l0_default     = %d\n", pps.num_ref_idx_l0_default_active_minus1 + 1);
    printf("  num_ref_idx_l1_default     = %d\n", pps.num_ref_idx_l1_default_active_minus1 + 1);
    printf("  init_qp                    = %d\n", 26 + pps.init_qp_minus26);
    printf("  constrained_intra_pred     = %d\n", pps.constrained_intra_pred_flag ? 1 : 0);
    printf("  transform_skip_enabled     = %d\n", pps.transform_skip_enabled_flag ? 1 : 0);
    printf("  cu_qp_delta_enabled        = %d\n", pps.cu_qp_delta_enabled_flag ? 1 : 0);
    if (pps.cu_qp_delta_enabled_flag) {
        printf("  diff_cu_qp_delta_depth     = %d\n", pps.diff_cu_qp_delta_depth);
        printf("  Log2MinCuQpDeltaSize       = %d\n", pps.Log2MinCuQpDeltaSize);
    }
    printf("  cb_qp_offset               = %d\n", pps.pps_cb_qp_offset);
    printf("  cr_qp_offset               = %d\n", pps.pps_cr_qp_offset);
    printf("  weighted_pred              = %d\n", pps.weighted_pred_flag ? 1 : 0);
    printf("  weighted_bipred            = %d\n", pps.weighted_bipred_flag ? 1 : 0);
    printf("  tiles                      = %d (%dx%d)\n",
           pps.tiles_enabled_flag ? 1 : 0,
           pps.num_tile_columns_minus1 + 1,
           pps.num_tile_rows_minus1 + 1);
    printf("  entropy_coding_sync        = %d\n", pps.entropy_coding_sync_enabled_flag ? 1 : 0);
    printf("  deblocking_filter_disabled = %d\n", pps.pps_deblocking_filter_disabled_flag ? 1 : 0);
    printf("  loop_filter_across_slices  = %d\n", pps.pps_loop_filter_across_slices_enabled_flag ? 1 : 0);
    if (pps.cu_qp_delta_enabled_flag) {
        printf("  diff_cu_qp_delta_depth     = %d\n", pps.diff_cu_qp_delta_depth);
        printf("  Log2MinCuQpDeltaSize       = %d\n", pps.Log2MinCuQpDeltaSize);
    }
    printf("  sign_data_hiding           = %d\n", pps.sign_data_hiding_enabled_flag ? 1 : 0);
    printf("  cabac_init_present         = %d\n", pps.cabac_init_present_flag ? 1 : 0);
    printf("  lists_modification_present = %d\n", pps.lists_modification_present_flag ? 1 : 0);
}

static void dump_slice(const hevc::SliceHeader& sh) {
    const char* type_str = (sh.slice_type == hevc::SliceType::I) ? "I" :
                           (sh.slice_type == hevc::SliceType::P) ? "P" : "B";
    printf("\n--- Slice Header ---\n");
    printf("  first_slice_in_pic         = %d\n", sh.first_slice_segment_in_pic_flag ? 1 : 0);
    printf("  dependent_slice            = %d\n", sh.dependent_slice_segment_flag ? 1 : 0);
    if (!sh.dependent_slice_segment_flag) {
        printf("  slice_type                 = %s\n", type_str);
        printf("  pic_order_cnt_lsb          = %d\n", sh.slice_pic_order_cnt_lsb);
        printf("  slice_qp_y                 = %d\n", sh.SliceQpY);
        printf("  sao_luma                   = %d\n", sh.slice_sao_luma_flag ? 1 : 0);
        printf("  sao_chroma                 = %d\n", sh.slice_sao_chroma_flag ? 1 : 0);
        printf("  deblocking_disabled        = %d\n", sh.slice_deblocking_filter_disabled_flag ? 1 : 0);
        printf("  loop_filter_across_slices  = %d\n", sh.slice_loop_filter_across_slices_enabled_flag ? 1 : 0);
        if (sh.slice_type != hevc::SliceType::I) {
            printf("  num_ref_idx_l0_active      = %d\n", sh.num_ref_idx_l0_active_minus1 + 1);
            if (sh.slice_type == hevc::SliceType::B) {
                printf("  num_ref_idx_l1_active      = %d\n", sh.num_ref_idx_l1_active_minus1 + 1);
            }
            printf("  max_num_merge_cand         = %d\n", sh.MaxNumMergeCand);
            printf("  temporal_mvp_enabled       = %d\n", sh.slice_temporal_mvp_enabled_flag ? 1 : 0);
        }
        if (sh.num_entry_point_offsets > 0) {
            printf("  num_entry_point_offsets    = %d\n", sh.num_entry_point_offsets);
        }
    }
    if (sh.slice_segment_address > 0) {
        printf("  slice_segment_address      = %d\n", sh.slice_segment_address);
    }
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    const char* input_path = nullptr;
    const char* output_path = nullptr;
    bool dump_nals = false;
    bool dump_headers = false;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--dump-nals") == 0) {
            dump_nals = true;
        } else if (strcmp(argv[i], "--dump-headers") == 0) {
            dump_headers = true;
        } else if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
            output_path = argv[++i];
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            print_usage(argv[0]);
            return 0;
        } else {
            input_path = argv[i];
        }
    }

    if (!input_path) {
        fprintf(stderr, "Error: no input file specified\n");
        return 1;
    }

    auto data = read_file(input_path);
    printf("Read %zu bytes from %s\n", data.size(), input_path);

    // Phase 2: NAL unit parsing
    hevc::NalParser parser;
    auto nals = parser.parse(data.data(), data.size());

    if (dump_nals) {
        printf("\n%-6s  %-8s  %-14s  %-6s  %-8s  %s\n",
               "Index", "Offset", "Type", "Size", "TempId", "TypeName");
        printf("------  --------  --------------  ------  --------  --------\n");

        for (size_t i = 0; i < nals.size(); i++) {
            const auto& nal = nals[i];
            printf("%-6zu  %-8zu  %-14d  %-6zu  %-8d  %s\n",
                   i,
                   nal.offset,
                   static_cast<int>(nal.header.nal_unit_type),
                   nal.size,
                   nal.header.TemporalId(),
                   hevc::nal_type_name(nal.header.nal_unit_type));
        }

        // Group into Access Units and show summary
        auto nals_copy = nals;  // copy before move (nals used above)
        auto aus = parser.group_access_units(std::move(nals_copy));
        printf("\n%zu NAL units in %zu Access Units (frames)\n", nals.size(), aus.size());
        for (size_t i = 0; i < aus.size(); i++) {
            printf("  AU %zu: %zu NALs [", i, aus[i].nal_units.size());
            for (size_t j = 0; j < aus[i].nal_units.size(); j++) {
                if (j > 0) printf(", ");
                printf("%s", hevc::nal_type_name(aus[i].nal_units[j].header.nal_unit_type));
            }
            printf("]\n");
        }
    }

    if (dump_headers) {
        hevc::ParameterSetManager ps_mgr;

        for (const auto& nal : nals) {
            auto type = nal.header.nal_unit_type;

            if (type == hevc::NalUnitType::VPS_NUT ||
                type == hevc::NalUnitType::SPS_NUT ||
                type == hevc::NalUnitType::PPS_NUT) {
                ps_mgr.process_nal(nal);

                if (type == hevc::NalUnitType::VPS_NUT) {
                    const auto* vps = ps_mgr.get_vps(0);  // usually id=0
                    if (vps) dump_vps(*vps);
                } else if (type == hevc::NalUnitType::SPS_NUT) {
                    const auto* sps = ps_mgr.get_sps(0);
                    if (sps) dump_sps(*sps);
                } else if (type == hevc::NalUnitType::PPS_NUT) {
                    const auto* pps = ps_mgr.get_pps(0);
                    if (pps) dump_pps(*pps);
                }
            } else if (hevc::is_vcl(type)) {
                hevc::SliceHeader sh;
                if (ps_mgr.parse_slice_header(sh, nal)) {
                    dump_slice(sh);
                }
            }
        }
    }

    // Decode pipeline (Phase 4)
    if (output_path) {
        auto t0 = std::chrono::high_resolution_clock::now();
        hevc::Decoder decoder;
        auto status = decoder.decode(data.data(), data.size());
        auto t1 = std::chrono::high_resolution_clock::now();
        double decode_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        if (status != hevc::DecodeStatus::OK) {
            fprintf(stderr, "Error: decode failed\n");
            return 1;
        }

        // Write all decoded pictures to output YUV file (in POC order)
        auto pics = decoder.output_pictures();
        if (pics.empty()) {
            fprintf(stderr, "Error: no pictures decoded\n");
            return 1;
        }

        printf("Decoded %zu pictures in %.1fms (%.1f fps, %.1f ms/frame)\n",
               pics.size(), decode_ms,
               pics.size() * 1000.0 / decode_ms,
               decode_ms / pics.size());

        // Write first picture (or all for multi-frame)
        if (pics.size() == 1) {
            if (!pics[0]->write_yuv(output_path)) {
                fprintf(stderr, "Error: failed to write %s\n", output_path);
                return 1;
            }
        } else {
            // Append all frames to output file (in POC/display order)
            FILE* f = fopen(output_path, "wb");
            if (!f) {
                fprintf(stderr, "Error: cannot open %s\n", output_path);
                return 1;
            }
            for (auto* pic : pics) {
                int sub_w = hevc::SubWidthC(pic->chroma_format);
                int sub_h = hevc::SubHeightC(pic->chroma_format);
                int bd[3] = { pic->bit_depth_luma, pic->bit_depth_chroma, pic->bit_depth_chroma };

                for (int c = 0; c < 3; c++) {
                    if (pic->width[c] == 0 || pic->height[c] == 0) continue;

                    int cSubW = (c == 0) ? 1 : sub_w;
                    int cSubH = (c == 0) ? 1 : sub_h;
                    int cropLeft   = pic->conf_win_left   / cSubW;
                    int cropRight  = pic->conf_win_right  / cSubW;
                    int cropTop    = pic->conf_win_top    / cSubH;
                    int cropBottom = pic->conf_win_bottom  / cSubH;

                    for (int y = cropTop; y < pic->height[c] - cropBottom; y++) {
                        int outW = pic->width[c] - cropLeft - cropRight;
                        if (pic->eight_bit) {
                            fwrite(pic->plane<uint8_t>(c) + y * pic->stride[c] + cropLeft, 1, outW, f);
                            continue;
                        }
                        const uint16_t* row = pic->plane<uint16_t>(c) + y * pic->stride[c];

                        if (bd[c] <= 8) {
                            for (int x = 0; x < outW; x++) {
                                uint8_t val = static_cast<uint8_t>(row[cropLeft + x]);
                                fwrite(&val, 1, 1, f);
                            }
                        } else {
                            fwrite(row + cropLeft, sizeof(uint16_t), outW, f);
                        }
                    }
                }
            }
            fclose(f);
        }
    }

    return 0;
}
