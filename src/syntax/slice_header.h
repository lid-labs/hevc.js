#pragma once

#include <cstdint>
#include <array>
#include <vector>

#include "common/types.h"
#include "syntax/sps.h"

namespace hevc {

class BitstreamReader;
struct PPS;

// Prediction Weight Table — spec §7.3.6.3
struct PredWeightTable {
    uint32_t luma_log2_weight_denom = 0;
    int32_t delta_chroma_log2_weight_denom = 0;

    // Per reference index (max 16 refs per list)
    struct RefWeight {
        bool luma_weight_flag = false;
        bool chroma_weight_flag = false;
        int16_t luma_weight = 0;
        int16_t luma_offset = 0;
        int16_t chroma_weight[2] = {};  // Cb, Cr
        int16_t chroma_offset[2] = {};
    };

    std::array<RefWeight, 16> l0;
    std::array<RefWeight, 16> l1;
};

// Slice Segment Header — spec §7.3.6, §7.4.7
struct SliceHeader {
    bool first_slice_segment_in_pic_flag = false;

    // Present only in IRAP
    bool no_output_of_prior_pics_flag = false;

    uint32_t slice_pic_parameter_set_id = 0;       // ue(v)

    bool dependent_slice_segment_flag = false;
    uint32_t slice_segment_address = 0;

    SliceType slice_type = SliceType::I;

    // Not present for dependent slices — inherited from independent
    bool pic_output_flag = true;
    uint8_t colour_plane_id = 0;

    // POC
    uint32_t slice_pic_order_cnt_lsb = 0;

    // Short-term RPS
    bool short_term_ref_pic_set_sps_flag = false;
    uint32_t short_term_ref_pic_set_idx = 0;
    ShortTermRefPicSet st_rps;  // inline RPS (when not from SPS)

    // Long-term refs
    uint32_t num_long_term_sps = 0;
    uint32_t num_long_term_pics = 0;
    std::array<uint32_t, 32> lt_idx_sps = {};
    std::array<uint32_t, 32> poc_lsb_lt = {};
    std::array<bool, 32> used_by_curr_pic_lt_flag = {};
    std::array<bool, 32> delta_poc_msb_present_flag = {};
    std::array<uint32_t, 32> delta_poc_msb_cycle_lt = {};
    // §7.4.7.1: derived, accumulating across each run of long-term entries
    std::array<uint32_t, 32> DeltaPocMsbCycleLt = {};

    bool slice_temporal_mvp_enabled_flag = false;

    // SAO
    bool slice_sao_luma_flag = false;
    bool slice_sao_chroma_flag = false;

    // Reference lists
    bool num_ref_idx_active_override_flag = false;
    uint32_t num_ref_idx_l0_active_minus1 = 0;
    uint32_t num_ref_idx_l1_active_minus1 = 0;

    // ref_pic_list_modification
    bool ref_pic_list_modification_flag_l0 = false;
    bool ref_pic_list_modification_flag_l1 = false;
    std::array<uint32_t, 16> list_entry_l0 = {};
    std::array<uint32_t, 16> list_entry_l1 = {};

    bool mvd_l1_zero_flag = false;
    bool cabac_init_flag = false;

    bool collocated_from_l0_flag = true;
    uint32_t collocated_ref_idx = 0;

    // Pred weight table
    PredWeightTable pred_weight_table;

    uint32_t five_minus_max_num_merge_cand = 0;

    int32_t slice_qp_delta = 0;
    int32_t slice_cb_qp_offset = 0;
    int32_t slice_cr_qp_offset = 0;

    bool cu_chroma_qp_offset_enabled_flag = false;

    bool deblocking_filter_override_flag = false;
    bool slice_deblocking_filter_disabled_flag = false;
    int32_t slice_beta_offset_div2 = 0;
    int32_t slice_tc_offset_div2 = 0;

    bool slice_loop_filter_across_slices_enabled_flag = false;

    // Entry points
    uint32_t num_entry_point_offsets = 0;
    std::vector<uint32_t> entry_point_offset_minus1;

    // ---- Derived values ----
    int SliceQpY = 0;
    int MaxNumMergeCand = 5;

    // Active RPS for this slice (pointer to SPS set or inline set)
    const ShortTermRefPicSet* active_rps = nullptr;

    // Parse from bitstream (needs active SPS and PPS)
    bool parse(BitstreamReader& bs, const SPS& sps, const PPS& pps,
               NalUnitType nal_type, uint8_t nuh_temporal_id);
};

} // namespace hevc
