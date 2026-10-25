#pragma once

#include <cstdint>
#include <algorithm>

namespace hevc {

// Clip3 — spec §5.9
template<typename T>
inline T Clip3(T min_val, T max_val, T x) {
    return std::min(std::max(x, min_val), max_val);
}

// Pixel type — 16-bit for 8/10-bit support (AD-002)
using Pixel = uint16_t;

// Motion vector (1/4 pel precision)
struct MV {
    int16_t x = 0;
    int16_t y = 0;

    bool operator==(const MV& other) const { return x == other.x && y == other.y; }
    bool operator!=(const MV& other) const { return !(*this == other); }
};

// Per-PU motion information, stored at min-PU (4x4) granularity
// Spec: MvLX[x][y], RefIdxLX[x][y], PredFlagLX[x][y] — §8.5.3
struct PUMotionInfo {
    MV mv[2] = {};          // mvL0, mvL1 (1/4 pel)
    int8_t ref_idx[2] = {-1, -1};  // refIdxL0, refIdxL1
    bool pred_flag[2] = {};  // predFlagL0, predFlagL1
};

// Chroma format
enum class ChromaFormat : uint8_t {
    MONOCHROME = 0,
    YUV420     = 1,
    YUV422     = 2,
    YUV444     = 3,
};

// Derived chroma subsampling
inline int SubWidthC(ChromaFormat fmt) {
    return (fmt == ChromaFormat::YUV444) ? 1 : 2;
}

inline int SubHeightC(ChromaFormat fmt) {
    return (fmt == ChromaFormat::YUV420) ? 2 : 1;
}

// NAL unit type — spec §7.4.2.2, Table 7-1
enum class NalUnitType : uint8_t {
    TRAIL_N    =  0,
    TRAIL_R    =  1,
    TSA_N      =  2,
    TSA_R      =  3,
    STSA_N     =  4,
    STSA_R     =  5,
    RADL_N     =  6,
    RADL_R     =  7,
    RASL_N     =  8,
    RASL_R     =  9,
    RSV_VCL_N10 = 10,
    RSV_VCL_R11 = 11,
    RSV_VCL_N12 = 12,
    RSV_VCL_R13 = 13,
    RSV_VCL_N14 = 14,
    RSV_VCL_R15 = 15,
    BLA_W_LP   = 16,
    BLA_W_RADL = 17,
    BLA_N_LP   = 18,
    IDR_W_RADL = 19,
    IDR_N_LP   = 20,
    CRA_NUT    = 21,
    RSV_IRAP_22 = 22,
    RSV_IRAP_23 = 23,
    VPS_NUT    = 32,
    SPS_NUT    = 33,
    PPS_NUT    = 34,
    AUD_NUT    = 35,
    EOS_NUT    = 36,
    EOB_NUT    = 37,
    FD_NUT     = 38,
    PREFIX_SEI = 39,
    SUFFIX_SEI = 40,
};

// NAL type helpers
inline bool is_vcl(NalUnitType t) { return static_cast<uint8_t>(t) <= 31; }
inline bool is_irap(NalUnitType t) {
    auto v = static_cast<uint8_t>(t);
    return v >= 16 && v <= 23;
}
inline bool is_idr(NalUnitType t) {
    return t == NalUnitType::IDR_W_RADL || t == NalUnitType::IDR_N_LP;
}
inline bool is_cra(NalUnitType t) { return t == NalUnitType::CRA_NUT; }
inline bool is_bla(NalUnitType t) {
    auto v = static_cast<uint8_t>(t);
    return v >= 16 && v <= 18;
}
inline bool is_rasl(NalUnitType t) {
    return t == NalUnitType::RASL_N || t == NalUnitType::RASL_R;
}
inline bool is_radl(NalUnitType t) {
    return t == NalUnitType::RADL_N || t == NalUnitType::RADL_R;
}

// Slice type
enum class SliceType : uint8_t {
    B = 0,
    P = 1,
    I = 2,
};

// Prediction mode
enum class PredMode : uint8_t {
    MODE_INTER = 0,
    MODE_INTRA = 1,
    MODE_SKIP  = 2,
};

// Partition mode
enum class PartMode : uint8_t {
    PART_2Nx2N = 0,
    PART_2NxN  = 1,
    PART_Nx2N  = 2,
    PART_NxN   = 3,
    PART_2NxnU = 4,
    PART_2NxnD = 5,
    PART_nLx2N = 6,
    PART_nRx2N = 7,
};

// NAL unit header
struct NalUnitHeader {
    NalUnitType nal_unit_type;
    uint8_t nuh_layer_id;
    uint8_t nuh_temporal_id_plus1;

    uint8_t TemporalId() const { return nuh_temporal_id_plus1 - 1; }
};

} // namespace hevc
