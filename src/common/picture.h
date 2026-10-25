#pragma once

#include <cstdint>
#include <vector>

#include "common/types.h"

namespace hevc {

// Picture buffer — planar YUV layout (AD-002)
// Spec ref: §6.1 (source, coded, decoded picture formats)
struct Picture {
    // Plane data
    std::vector<uint16_t> planes[3];  // 0=Y, 1=Cb, 2=Cr
    int width[3]  = {};               // width per plane (in samples)
    int height[3] = {};               // height per plane (in samples)
    int stride[3] = {};               // stride per plane (in samples)

    // Picture properties
    int pic_width_in_luma = 0;
    int pic_height_in_luma = 0;
    int bit_depth_luma = 8;
    int bit_depth_chroma = 8;
    ChromaFormat chroma_format = ChromaFormat::YUV420;

    // Conformance window (in luma samples, spec §7.4.3.2.1)
    int conf_win_left = 0;
    int conf_win_right = 0;
    int conf_win_top = 0;
    int conf_win_bottom = 0;

    // Picture Order Count
    int32_t poc = 0;
    // Coded Video Sequence ID (incremented at each IRAP with NoRaslOutputFlag)
    int32_t cvs_id = 0;

    // Reference status
    bool used_for_short_term_ref = false;
    bool used_for_long_term_ref = false;
    bool needed_for_output = false;

    // Inter: per-PU motion info for TMVP (stored after decoding)
    struct PUMotionInfoCompact {
        int16_t mv_x[2] = {};
        int16_t mv_y[2] = {};
        int8_t ref_idx[2] = {-1, -1};
        bool pred_flag[2] = {};
    };
    std::vector<PUMotionInfoCompact> motion_info_buf;  // owned by this Picture
    int motion_info_stride = 0;
    // Convenience accessors
    PUMotionInfoCompact* motion_info_data() { return motion_info_buf.data(); }
    const PUMotionInfoCompact* motion_info_data() const { return motion_info_buf.data(); }

    // POCs of the reference picture lists of each slice segment, which §8.3.4
    // builds per slice, read by TMVP MV scaling and by deblocking. Indexed by
    // ctb_slice_idx; kNoRefPoc marks an entry with no picture.
    static constexpr int32_t kNoRefPoc = -999999;
    struct SliceRefPocs {
        std::vector<int32_t> list[2];
    };
    std::vector<SliceRefPocs> slice_ref_poc;
    std::vector<uint8_t> ctb_slice_idx;  // slice segment index of each CTB, raster order

    // Allocate planes based on dimensions and chroma format
    void allocate(int width, int height, ChromaFormat fmt, int bd_luma, int bd_chroma);

    // Get sample at position (x, y) in plane c
    uint16_t& sample(int c, int x, int y) {
        return planes[c][y * stride[c] + x];
    }
    uint16_t sample(int c, int x, int y) const {
        return planes[c][y * stride[c] + x];
    }

    // Write to raw YUV file (crops to conformance window if set)
    bool write_yuv(const char* path) const;

    // Is this picture a reference?
    bool is_reference() const {
        return used_for_short_term_ref || used_for_long_term_ref;
    }
};

} // namespace hevc
