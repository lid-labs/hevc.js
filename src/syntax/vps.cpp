#include "syntax/vps.h"
#include "bitstream/bitstream_reader.h"
#include "common/debug.h"

namespace hevc {

// Spec §7.3.2.1 — video_parameter_set_rbsp()
bool VPS::parse(BitstreamReader& bs) {
    vps_video_parameter_set_id = bs.read_bits(4);
    vps_base_layer_internal_flag = bs.read_flag();
    vps_base_layer_available_flag = bs.read_flag();
    vps_max_layers_minus1 = bs.read_bits(6);
    vps_max_sub_layers_minus1 = bs.read_bits(3);
    vps_temporal_id_nesting_flag = bs.read_flag();

    // vps_reserved_0xffff_16bits
    bs.read_bits(16);

    // profile_tier_level(1, vps_max_sub_layers_minus1)
    profile_tier_level.parse(bs, true, vps_max_sub_layers_minus1);

    // Sub-layer ordering info
    vps_sub_layer_ordering_info_present_flag = bs.read_flag();
    int start = vps_sub_layer_ordering_info_present_flag ? 0 : vps_max_sub_layers_minus1;
    for (int i = start; i <= vps_max_sub_layers_minus1; i++) {
        sub_layer_ordering[i].max_dec_pic_buffering_minus1 = bs.read_ue();
        sub_layer_ordering[i].max_num_reorder_pics = bs.read_ue();
        sub_layer_ordering[i].max_latency_increase_plus1 = bs.read_ue();
    }

    vps_max_layer_id = bs.read_bits(6);
    vps_num_layer_sets_minus1 = bs.read_ue();

    // layer_id_included_flag — skip (single-layer decoder)
    for (int i = 1; i <= vps_num_layer_sets_minus1; i++) {
        for (int j = 0; j <= vps_max_layer_id; j++) {
            bs.read_flag();  // layer_id_included_flag[i][j]
        }
    }

    // Timing info
    vps_timing_info_present_flag = bs.read_flag();
    if (vps_timing_info_present_flag) {
        vps_num_units_in_tick = bs.read_bits(32);
        vps_time_scale = bs.read_bits(32);
        bool vps_poc_proportional_to_timing_flag = bs.read_flag();
        if (vps_poc_proportional_to_timing_flag) {
            bs.read_ue();  // vps_num_ticks_poc_diff_one_minus1
        }
        uint32_t vps_num_hrd_parameters = bs.read_ue();
        for (uint32_t i = 0; i < vps_num_hrd_parameters; i++) {
            bs.read_ue();  // hrd_layer_set_idx[i]
            // Skip hrd_parameters() — complex, not needed for decoding
            // For now, if HRD params are present, we just stop parsing VPS here
            // This is safe because VPS extension data is not critical
            HEVC_LOG(PARSE, "VPS: HRD parameters present, skipping rest of VPS%s", "");
            break;
        }
    }

    // vps_extension_flag — skip remaining data
    // (extensions not needed for Main profile decoding)

    HEVC_LOG(PARSE, "VPS: id=%d max_layers=%d max_sub_layers=%d",
             vps_video_parameter_set_id,
             vps_max_layers_minus1 + 1,
             vps_max_sub_layers_minus1 + 1);

    return true;
}

} // namespace hevc
