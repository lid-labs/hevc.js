#include "decoding/interpolation.h"
#include "decoding/coding_tree.h"
#include "decoding/dpb.h"
#include "common/debug.h"

#include <algorithm>
#include <cstring>

namespace hevc {

// ============================================================
// Luma interpolation filter coefficients — Table 8-1
// ============================================================

// §8.5.3.3.3: 8-tap filter, 4 fractional positions (1/4 pel)
// Index 0 = integer (not used in filtering, just copy)
static const int16_t luma_filter[4][8] = {
    {  0,  0,  0, 64,  0,  0,  0,  0 },  // frac=0 (integer)
    { -1,  4,-10, 58, 17, -5,  1,  0 },  // frac=1 (1/4)
    { -1,  4,-11, 40, 40,-11,  4, -1 },  // frac=2 (1/2)
    {  0,  1, -5, 17, 58,-10,  4, -1 },  // frac=3 (3/4)
};

// ============================================================
// Chroma interpolation filter coefficients — Table 8-2
// ============================================================

// §8.5.3.3.3: 4-tap filter, 8 fractional positions (1/8 pel)
static const int16_t chroma_filter[8][4] = {
    {  0, 64,  0,  0 },  // frac=0 (integer)
    { -2, 58, 10, -2 },  // frac=1
    { -4, 54, 16, -2 },  // frac=2
    { -6, 46, 28, -4 },  // frac=3
    { -4, 36, 36, -4 },  // frac=4
    { -4, 28, 46, -6 },  // frac=5
    { -2, 16, 54, -4 },  // frac=6
    { -2, 10, 58, -2 },  // frac=7
};

// ============================================================
// Luma interpolation — §8.5.3.3.3
// Output in extended precision (not clipped to [0, 2^BitDepth-1])
// ============================================================

static void interpolate_luma(const Picture& refPic,
                              int xInt, int yInt, int xFrac, int yFrac,
                              int nPbW, int nPbH, int bitDepth,
                              int16_t* pred) {
    // §8.5.3.3.3: shift1 = Min(4, BitDepthY - 8), shift2 = 6, shift3 = Max(2, 14 - BitDepthY)
    int shift1 = std::min(4, bitDepth - 8);
    int shift2 = 6;
    int shift3 = std::max(2, 14 - bitDepth);
    int picW = refPic.width[0];
    int picH = refPic.height[0];
    int stride0 = refPic.stride[0];
    const uint16_t* plane0 = refPic.planes[0].data();

    // Fast direct access (no bounds check) — used for interior PUs
    auto refDirect = [&](int x, int y) -> int {
        return plane0[y * stride0 + x];
    };

    // Safe clamped access — used for edge PUs
    auto refClamp = [&](int x, int y) -> int {
        x = std::max(0, std::min(x, picW - 1));
        y = std::max(0, std::min(y, picH - 1));
        return plane0[y * stride0 + x];
    };

    // Check if all reference accesses are within bounds (including filter margin)
    bool interior = (xInt - 3 >= 0) && (yInt - 3 >= 0) &&
                    (xInt + nPbW + 4 <= picW) && (yInt + nPbH + 4 <= picH);

    // Use a macro to avoid duplicating the filter code for interior vs edge
    #define LUMA_INTERP(REF) do { \
        if (xFrac == 0 && yFrac == 0) { \
            for (int y = 0; y < nPbH; y++) \
                for (int x = 0; x < nPbW; x++) \
                    pred[y * nPbW + x] = static_cast<int16_t>(REF(xInt + x, yInt + y) << shift3); \
        } else if (yFrac == 0) { \
            const int16_t* f = luma_filter[xFrac]; \
            for (int y = 0; y < nPbH; y++) \
                for (int x = 0; x < nPbW; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 8; k++) \
                        sum += f[k] * REF(xInt + x + k - 3, yInt + y); \
                    pred[y * nPbW + x] = static_cast<int16_t>(sum >> shift1); \
                } \
        } else if (xFrac == 0) { \
            const int16_t* f = luma_filter[yFrac]; \
            for (int y = 0; y < nPbH; y++) \
                for (int x = 0; x < nPbW; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 8; k++) \
                        sum += f[k] * REF(xInt + x, yInt + y + k - 3); \
                    pred[y * nPbW + x] = static_cast<int16_t>(sum >> shift1); \
                } \
        } else { \
            int tmpH = nPbH + 7; \
            int16_t tmp[64 * 71]; \
            const int16_t* fH = luma_filter[xFrac]; \
            for (int y = 0; y < tmpH; y++) \
                for (int x = 0; x < nPbW; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 8; k++) \
                        sum += fH[k] * REF(xInt + x + k - 3, yInt + y - 3); \
                    tmp[y * nPbW + x] = static_cast<int16_t>(sum >> shift1); \
                } \
            const int16_t* fV = luma_filter[yFrac]; \
            for (int y = 0; y < nPbH; y++) \
                for (int x = 0; x < nPbW; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 8; k++) \
                        sum += fV[k] * tmp[(y + k) * nPbW + x]; \
                    pred[y * nPbW + x] = static_cast<int16_t>(sum >> shift2); \
                } \
        } \
    } while(0)

    if (interior) {
        LUMA_INTERP(refDirect);
    } else {
        LUMA_INTERP(refClamp);
    }

    #undef LUMA_INTERP
}

// ============================================================
// Chroma interpolation — §8.5.3.3.3 (chroma part)
// ============================================================

static void interpolate_chroma(const Picture& refPic, int cIdx,
                                int xInt, int yInt, int xFrac, int yFrac,
                                int nPbWC, int nPbHC, int bitDepth,
                                int16_t* pred) {
    int shift1 = std::min(4, bitDepth - 8);
    int shift2 = 6;
    int shift3 = std::max(2, 14 - bitDepth);
    int picW = refPic.width[cIdx];
    int picH = refPic.height[cIdx];
    int strideC = refPic.stride[cIdx];
    const uint16_t* planeC = refPic.planes[cIdx].data();

    auto refDirect = [&](int x, int y) -> int {
        return planeC[y * strideC + x];
    };
    auto refClamp = [&](int x, int y) -> int {
        x = std::max(0, std::min(x, picW - 1));
        y = std::max(0, std::min(y, picH - 1));
        return planeC[y * strideC + x];
    };

    // Chroma filter margin is 1 (4-tap: positions -1..+2)
    bool interior = (xInt - 1 >= 0) && (yInt - 1 >= 0) &&
                    (xInt + nPbWC + 2 <= picW) && (yInt + nPbHC + 2 <= picH);

    #define CHROMA_INTERP(REF) do { \
        if (xFrac == 0 && yFrac == 0) { \
            for (int y = 0; y < nPbHC; y++) \
                for (int x = 0; x < nPbWC; x++) \
                    pred[y * nPbWC + x] = static_cast<int16_t>(REF(xInt + x, yInt + y) << shift3); \
        } else if (yFrac == 0) { \
            const int16_t* f = chroma_filter[xFrac]; \
            for (int y = 0; y < nPbHC; y++) \
                for (int x = 0; x < nPbWC; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 4; k++) \
                        sum += f[k] * REF(xInt + x + k - 1, yInt + y); \
                    pred[y * nPbWC + x] = static_cast<int16_t>(sum >> shift1); \
                } \
        } else if (xFrac == 0) { \
            const int16_t* f = chroma_filter[yFrac]; \
            for (int y = 0; y < nPbHC; y++) \
                for (int x = 0; x < nPbWC; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 4; k++) \
                        sum += f[k] * REF(xInt + x, yInt + y + k - 1); \
                    pred[y * nPbWC + x] = static_cast<int16_t>(sum >> shift1); \
                } \
        } else { \
            int tmpH = nPbHC + 3; \
            int16_t tmp[32 * 35]; \
            const int16_t* fH = chroma_filter[xFrac]; \
            for (int y = 0; y < tmpH; y++) \
                for (int x = 0; x < nPbWC; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 4; k++) \
                        sum += fH[k] * REF(xInt + x + k - 1, yInt + y - 1); \
                    tmp[y * nPbWC + x] = static_cast<int16_t>(sum >> shift1); \
                } \
            const int16_t* fV = chroma_filter[yFrac]; \
            for (int y = 0; y < nPbHC; y++) \
                for (int x = 0; x < nPbWC; x++) { \
                    int sum = 0; \
                    for (int k = 0; k < 4; k++) \
                        sum += fV[k] * tmp[(y + k) * nPbWC + x]; \
                    pred[y * nPbWC + x] = static_cast<int16_t>(sum >> shift2); \
                } \
        } \
    } while(0)

    if (interior) {
        CHROMA_INTERP(refDirect);
    } else {
        CHROMA_INTERP(refClamp);
    }
    #undef CHROMA_INTERP
}

// ============================================================
// §8.5.3.3.4.2 — Default weighted sample prediction
// ============================================================

static void weighted_pred_default(int16_t* predL0, int16_t* predL1,
                                   bool flagL0, bool flagL1,
                                   int nSamples, int bitDepth,
                                   int16_t* output) {
    // §8.5.3.3.4.2
    int shift1 = std::max(2, 14 - bitDepth);
    int offset1 = 1 << (shift1 - 1);
    int shift2 = std::max(3, 15 - bitDepth);
    int offset2 = 1 << (shift2 - 1);
    int maxVal = (1 << bitDepth) - 1;

    if (flagL0 && !flagL1) {
        // §8.5.3.3.4.2 eq 8-262: uni-pred L0
        for (int i = 0; i < nSamples; i++)
            output[i] = static_cast<int16_t>(Clip3(0, maxVal, (predL0[i] + offset1) >> shift1));
    } else if (!flagL0 && flagL1) {
        // eq 8-263: uni-pred L1
        for (int i = 0; i < nSamples; i++)
            output[i] = static_cast<int16_t>(Clip3(0, maxVal, (predL1[i] + offset1) >> shift1));
    } else {
        // eq 8-264: bi-pred
        for (int i = 0; i < nSamples; i++)
            output[i] = static_cast<int16_t>(Clip3(0, maxVal,
                (predL0[i] + predL1[i] + offset2) >> shift2));
    }
}

// ============================================================
// §8.5.3.3.4.3 — Explicit weighted sample prediction
// ============================================================

static void weighted_pred_explicit(int16_t* predL0, int16_t* predL1,
                                    bool flagL0, bool flagL1,
                                    int refIdxL0, int refIdxL1,
                                    int cIdx, int nSamples, int bitDepth,
                                    const PredWeightTable& pwt,
                                    int16_t* output) {
    // §8.5.3.3.4.3
    int shift1 = std::max(2, 14 - bitDepth);
    int maxVal = (1 << bitDepth) - 1;

    int log2Wd, w0, w1, o0, o1;

    if (cIdx == 0) {
        // Luma — eq 8-265..8-269
        log2Wd = static_cast<int>(pwt.luma_log2_weight_denom) + shift1;
        w0 = pwt.l0[refIdxL0 >= 0 ? refIdxL0 : 0].luma_weight;
        w1 = pwt.l1[refIdxL1 >= 0 ? refIdxL1 : 0].luma_weight;
        // WpOffsetBdShiftY = BitDepthY - 8
        int wpShiftY = bitDepth - 8;
        o0 = pwt.l0[refIdxL0 >= 0 ? refIdxL0 : 0].luma_offset << wpShiftY;
        o1 = pwt.l1[refIdxL1 >= 0 ? refIdxL1 : 0].luma_offset << wpShiftY;
    } else {
        // Chroma — eq 8-270..8-274
        int chromaLog2WeightDenom = static_cast<int>(pwt.luma_log2_weight_denom) +
                                    pwt.delta_chroma_log2_weight_denom;
        log2Wd = chromaLog2WeightDenom + shift1;
        int ci = cIdx - 1;  // 0=Cb, 1=Cr
        w0 = pwt.l0[refIdxL0 >= 0 ? refIdxL0 : 0].chroma_weight[ci];
        w1 = pwt.l1[refIdxL1 >= 0 ? refIdxL1 : 0].chroma_weight[ci];
        // WpOffsetBdShiftC = BitDepthC - 8
        int wpShiftC = bitDepth - 8;
        o0 = pwt.l0[refIdxL0 >= 0 ? refIdxL0 : 0].chroma_offset[ci] << wpShiftC;
        o1 = pwt.l1[refIdxL1 >= 0 ? refIdxL1 : 0].chroma_offset[ci] << wpShiftC;
    }

    if (flagL0 && !flagL1) {
        // eq 8-275: uni-pred L0
        int round = 1 << (log2Wd - 1);
        for (int i = 0; i < nSamples; i++)
            output[i] = static_cast<int16_t>(Clip3(0, maxVal,
                ((predL0[i] * w0 + round) >> log2Wd) + o0));
    } else if (!flagL0 && flagL1) {
        // eq 8-276: uni-pred L1
        int round = 1 << (log2Wd - 1);
        for (int i = 0; i < nSamples; i++)
            output[i] = static_cast<int16_t>(Clip3(0, maxVal,
                ((predL1[i] * w1 + round) >> log2Wd) + o1));
    } else {
        // eq 8-277: bi-pred
        for (int i = 0; i < nSamples; i++)
            output[i] = static_cast<int16_t>(Clip3(0, maxVal,
                (predL0[i] * w0 + predL1[i] * w1 +
                 ((o0 + o1 + 1) << log2Wd)) >> (log2Wd + 1)));
    }
}

// ============================================================
// §8.5.3.3 — Top-level inter prediction for one PU
// ============================================================

void perform_inter_prediction(DecodingContext& ctx,
                               int xPb, int yPb, int nPbW, int nPbH,
                               int cIdx,
                               const MV& mvL0, const MV& mvL1,
                               int refIdxL0, int refIdxL1,
                               bool predFlagL0, bool predFlagL1,
                               int16_t* pred_samples) {
    auto& sps = *ctx.sps;
    int bitDepth = (cIdx == 0) ? sps.BitDepthY : sps.BitDepthC;

    // Component dimensions and MV conversion
    int subW = (cIdx > 0) ? sps.SubWidthC : 1;
    int subH = (cIdx > 0) ? sps.SubHeightC : 1;
    int compW = nPbW / subW;
    int compH = nPbH / subH;
    int nSamples = compW * compH;

    int16_t predL0_buf[64 * 64];  // max PU 64x64
    int16_t predL1_buf[64 * 64];
    int16_t* predL0 = predL0_buf;
    int16_t* predL1 = predL1_buf;

    // L0 prediction
    if (predFlagL0) {
        Picture* refPic = (refIdxL0 >= 0) ? ctx.dpb->ref_pic_list0(refIdxL0) : nullptr;
        if (refPic) {
            if (cIdx == 0) {
                // Luma: MV in 1/4 pel
                int xInt = xPb + (mvL0.x >> 2);
                int yInt = yPb + (mvL0.y >> 2);
                int xFrac = mvL0.x & 3;
                int yFrac = mvL0.y & 3;
                interpolate_luma(*refPic, xInt, yInt, xFrac, yFrac,
                                  compW, compH, bitDepth, predL0);
            } else {
                // §8.5.3.3.2: chroma MV derivation from luma MV
                // mvC = (mvL * SubWidth/Height + 2) >> 2... actually:
                // xFracC and yFracC in 1/8 pel
                int mvCx = mvL0.x;
                int mvCy = mvL0.y;
                // §8.5.3.3: chroma MV = luma MV for 4:2:0, but at 1/8 pel precision
                // xIntC = (xPb/SubWidthC) + (mvCx >> (1 + cShiftX))
                // Wait, for 4:2:0: the chroma MV is just luma MV / 2 in full units,
                // and the fractional part is at 1/8 pel
                int xPbC = xPb / subW;
                int yPbC = yPb / subH;
                // Chroma MV derivation: spec §8.5.3.3.2
                // For 4:2:0: mvC_x = mvL_x, mvC_y = mvL_y (same quarter-pel values)
                // But chroma positions: xIntC = xPbC + (mvCx >> 3), xFracC = mvCx & 7
                // because for 4:2:0, the luma MV at 1/4 pel maps to chroma at 1/8 pel
                // (2x downsampling means 1/4 luma pel = 1/8 chroma pel)
                int xInt = xPbC + (mvCx >> 3);
                int yInt = yPbC + (mvCy >> 3);
                int xFrac = mvCx & 7;
                int yFrac = mvCy & 7;
                interpolate_chroma(*refPic, cIdx, xInt, yInt, xFrac, yFrac,
                                    compW, compH, bitDepth, predL0);
            }
        } else {
            // Nothing wrote predL0: §8.5.3.3.4.2's uni/bi selection has to follow
            // what the list actually holds, not what the PU asked for.
            predFlagL0 = false;
        }
    }

    // L1 prediction
    if (predFlagL1) {
        Picture* refPic = (refIdxL1 >= 0) ? ctx.dpb->ref_pic_list1(refIdxL1) : nullptr;
        if (refPic) {
            if (cIdx == 0) {
                int xInt = xPb + (mvL1.x >> 2);
                int yInt = yPb + (mvL1.y >> 2);
                int xFrac = mvL1.x & 3;
                int yFrac = mvL1.y & 3;
                interpolate_luma(*refPic, xInt, yInt, xFrac, yFrac,
                                  compW, compH, bitDepth, predL1);
            } else {
                int xPbC = xPb / subW;
                int yPbC = yPb / subH;
                int xInt = xPbC + (mvL1.x >> 3);
                int yInt = yPbC + (mvL1.y >> 3);
                int xFrac = mvL1.x & 7;
                int yFrac = mvL1.y & 7;
                interpolate_chroma(*refPic, cIdx, xInt, yInt, xFrac, yFrac,
                                    compW, compH, bitDepth, predL1);
            }
        } else {
            predFlagL1 = false;
        }
    }

    // Both lists came up empty — a mid-stream start referencing pictures the DPB
    // never received. Conceal with neutral grey instead of reading the buffers.
    if (!predFlagL0 && !predFlagL1) {
        HEVC_LOG(INTER, "PU concealed: no reference at (%d,%d) cIdx=%d refIdx=%d/%d",
                 xPb, yPb, cIdx, refIdxL0, refIdxL1);
        // The SPS allows bitDepth 16, where 1 << 15 overflows the int16_t buffer.
        const int grey = std::min(1 << (bitDepth - 1), 32767);
        std::fill_n(pred_samples, nSamples, static_cast<int16_t>(grey));
        return;
    }

    // §8.5.3.3.4.1: Determine weightedPredFlag
    bool weightedPredFlag = false;
    if (ctx.sh->slice_type == SliceType::P)
        weightedPredFlag = ctx.pps->weighted_pred_flag;
    else if (ctx.sh->slice_type == SliceType::B)
        weightedPredFlag = ctx.pps->weighted_bipred_flag;

    if (weightedPredFlag) {
        // §8.5.3.3.4.3: Explicit weighted sample prediction
        weighted_pred_explicit(predL0, predL1,
                               predFlagL0, predFlagL1,
                               refIdxL0, refIdxL1,
                               cIdx, nSamples, bitDepth,
                               ctx.sh->pred_weight_table, pred_samples);
    } else {
        // §8.5.3.3.4.2: Default weighted sample prediction
        weighted_pred_default(predL0, predL1,
                               predFlagL0, predFlagL1,
                               nSamples, bitDepth, pred_samples);
    }
}

} // namespace hevc
