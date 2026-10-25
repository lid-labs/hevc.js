#pragma once

#include <cstdint>
#include <vector>

#include "common/types.h"

namespace hevc {

// Picture buffer — planar YUV layout (AD-002)
// Spec ref: §6.1 (source, coded, decoded picture formats)
struct Picture {
    // Plane data, 0=Y, 1=Cb, 2=Cr. A picture whose luma and chroma are both
    // 8-bit stores one byte per sample, in planes8; any other in planes16. The
    // other array stays empty. Half the memory traffic of 16-bit storage for
    // the common 8-bit streams, which is what motion compensation and the loop
    // filters are bound by.
    std::vector<uint8_t> planes8[3];
    std::vector<uint16_t> planes16[3];
    bool eight_bit = false;           // planes8 in use
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
    // §C.5.2: whether the output process of the spec would already have output
    // this picture, and its PicLatencyCount. Output itself is left to the
    // caller (drain/flush); these only decide which pictures an IRAP with
    // NoOutputOfPriorPicsFlag empties without output.
    bool spec_output = false;
    uint32_t pic_latency_count = 0;

    // Inter: per-PU motion info for TMVP (stored after decoding)
    std::vector<PUMotionInfo> motion_info_buf;  // owned by this Picture
    int motion_info_stride = 0;
    // Convenience accessors
    PUMotionInfo* motion_info_data() { return motion_info_buf.data(); }
    const PUMotionInfo* motion_info_data() const { return motion_info_buf.data(); }

    // POCs of the reference picture lists of each slice segment, which §8.3.4
    // builds per slice, read by TMVP MV scaling and by deblocking. Indexed by
    // ctb_slice_idx; kNoRefPoc marks an entry with no picture.
    static constexpr int32_t kNoRefPoc = -999999;
    struct SliceRefPocs {
        std::vector<int32_t> list[2];
        // Whether each entry was a long-term reference when this picture was
        // decoded: TMVP reads it as LongTermRefPic(colPic, ...) (§8.5.3.2.8)
        std::vector<uint8_t> is_long_term[2];
    };
    std::vector<SliceRefPocs> slice_ref_poc;
    std::vector<uint16_t> ctb_slice_idx;  // slice segment index of each CTB, raster order

    // Allocate planes based on dimensions and chroma format
    void allocate(int width, int height, ChromaFormat fmt, int bd_luma, int bd_chroma);

    // Plane c as P = uint8_t (eight_bit) or uint16_t (otherwise)
    template <typename P> P* plane(int c);
    template <typename P> const P* plane(int c) const;

    // Sample at (x, y) in plane c, for code off the hot paths
    int get(int c, int x, int y) const {
        const size_t i = static_cast<size_t>(y) * stride[c] + x;
        return eight_bit ? planes8[c][i] : planes16[c][i];
    }
    void set(int c, int x, int y, int v) {
        const size_t i = static_cast<size_t>(y) * stride[c] + x;
        if (eight_bit) planes8[c][i] = static_cast<uint8_t>(v);
        else planes16[c][i] = static_cast<uint16_t>(v);
    }
    // Number of samples in plane c
    size_t plane_size(int c) const {
        return eight_bit ? planes8[c].size() : planes16[c].size();
    }

    // Write to raw YUV file (crops to conformance window if set)
    bool write_yuv(const char* path) const;

    // Is this picture a reference?
    bool is_reference() const {
        return used_for_short_term_ref || used_for_long_term_ref;
    }
};

template <> inline uint8_t* Picture::plane<uint8_t>(int c) { return planes8[c].data(); }
template <> inline uint16_t* Picture::plane<uint16_t>(int c) { return planes16[c].data(); }
template <> inline const uint8_t* Picture::plane<uint8_t>(int c) const { return planes8[c].data(); }
template <> inline const uint16_t* Picture::plane<uint16_t>(int c) const { return planes16[c].data(); }

} // namespace hevc
