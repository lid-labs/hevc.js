#include "decoding/interpolation.h"
#include "decoding/coding_tree.h"
#include "decoding/dpb.h"
#include "common/debug.h"
#include "common/simd.h"

#include <algorithm>
#include <cstddef>
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
// Separable N-tap interpolation — §8.5.3.3.3 (luma N = 8, chroma N = 4)
// Output in extended precision (not clipped to [0, 2^BitDepth-1])
// ============================================================

// Largest block plus the filter margins: 64 + 8 - 1 rows of 64 + 8 - 1 samples.
static constexpr int kMaxPadded = 71;

// One filter pass over a w x h block:
//   out[y * w + x] = (sum over k of f[k] * s[y * sstride + x + k * step]) >> shift
// with step 1 for a horizontal pass and step = sstride for a vertical one; s
// points at the first tap of the first output sample. The coefficients are
// broadcast once per block, and the rows loop inside, since most blocks are 8
// samples wide or less.

// Columns from x on, four outputs per int32 vector, then a scalar tail (chroma
// widths 2 and 6 only).
template <int N, typename T>
static inline void row_tail(const T* s, ptrdiff_t step, int x, int w,
                            const simd::i32x4* c, const int16_t* f, int shift,
                            int16_t* out) {
    using namespace simd;
    for (; x + 4 <= w; x += 4) {
        i32x4 acc = c[0] * load4(s + x);
        for (int k = 1; k < N; k++) acc += c[k] * load4(s + x + k * step);
        store4(out + x, acc >> shift);
    }
    for (; x < w; x++) {
        int sum = 0;
        for (int k = 0; k < N; k++) sum += f[k] * s[x + k * step];
        out[x] = static_cast<int16_t>(sum >> shift);
    }
}

// Any input and bit depth: int32 lanes.
template <int N, typename T>
static void filter_pass(const T* s, ptrdiff_t sstride, ptrdiff_t step, int w, int h,
                        const int16_t* f, int shift, int16_t* out) {
    simd::i32x4 c[N];
    for (int k = 0; k < N; k++) c[k] = simd::splat(f[k]);
    for (int y = 0; y < h; y++, s += sstride, out += w)
        row_tail<N>(s, step, 0, w, c, f, shift, out);
}

// A pass over 8-bit samples on 8 lanes of int16: its sums fit int16 (luma at
// most 88 * 255, at least -24 * 255), so wrapping partial sums still end
// exact. shift1 is 0 at that depth.
template <int N>
static void filter_pass_8bit(const uint16_t* s, ptrdiff_t sstride, ptrdiff_t step,
                             int w, int h, const int16_t* f, int16_t* out) {
    using namespace simd;
    i16x8 c[N];
    i32x4 c4[N];
    for (int k = 0; k < N; k++) {
        c[k] = splat8(f[k]);
        c4[k] = splat(f[k]);
    }
    for (int y = 0; y < h; y++, s += sstride, out += w) {
        int x = 0;
        for (; x + 8 <= w; x += 8) {
            i16x8 acc = c[0] * load8(s + x);
            for (int k = 1; k < N; k++) acc += c[k] * load8(s + x + k * step);
            store8(out + x, acc);
        }
        if (x < w) row_tail<N>(s, step, x, w, c4, f, 0, out);
    }
}

// The vertical pass of a 2D filter, over its int16 intermediate: int16 loads,
// 8 outputs per iteration, products and sums in int32.
template <int N>
static void filter_pass_tmp(const int16_t* s, int w, int h, const int16_t* f,
                            int shift, int16_t* out) {
    using namespace simd;
    i32x8 c[N];
    i32x4 c4[N];
    for (int k = 0; k < N; k++) {
        c[k] = splat8w(f[k]);
        c4[k] = splat(f[k]);
    }
    for (int y = 0; y < h; y++, s += w, out += w) {
        int x = 0;
        for (; x + 8 <= w; x += 8) {
            i32x8 acc = c[0] * widen(load8(s + x));
            for (int k = 1; k < N; k++) acc += c[k] * widen(load8(s + x + k * w));
            store8(out + x, acc >> shift);
        }
        if (x < w) row_tail<N>(s, w, x, w, c4, f, shift, out);
    }
}

// Interpolates a w x h block whose top-left integer sample is src. Reads
// N/2 - 1 samples before the block and N/2 after it on each filtered axis.
template <int N>
static void interpolate_block(const uint16_t* src, ptrdiff_t stride, int w, int h,
                              const int16_t* fH, const int16_t* fV,
                              int bitDepth, int16_t* pred) {
    // §8.5.3.3.3: shift1 = Min(4, BitDepth - 8), shift2 = 6, shift3 = Max(2, 14 - BitDepth)
    const int shift1 = std::min(4, bitDepth - 8);
    const int shift2 = 6;
    const int shift3 = std::max(2, 14 - bitDepth);
    constexpr int before = N / 2 - 1;
    // A pass over the samples themselves, h rows from s.
    auto sample_pass = [&](const uint16_t* s, ptrdiff_t step, int rows,
                           const int16_t* f, int16_t* out) {
        if (bitDepth == 8)
            filter_pass_8bit<N>(s, stride, step, w, rows, f, out);
        else
            filter_pass<N>(s, stride, step, w, rows, f, shift1, out);
    };

    if (!fH && !fV) {
        for (int y = 0; y < h; y++) {
            const uint16_t* s = src + y * stride;
            int16_t* out = pred + y * w;
            int x = 0;
            for (; x + 4 <= w; x += 4)
                simd::store4(out + x, simd::load4(s + x) << shift3);
            for (; x < w; x++)
                out[x] = static_cast<int16_t>(s[x] << shift3);
        }
    } else if (!fV) {
        sample_pass(src - before, 1, h, fH, pred);
    } else if (!fH) {
        sample_pass(src - before * stride, stride, h, fV, pred);
    } else {
        int16_t tmp[64 * kMaxPadded];
        sample_pass(src - before * stride - before, 1, h + N - 1, fH, tmp);
        filter_pass_tmp<N>(tmp, w, h, fV, shift2, pred);
    }
}

// Reference block at (xInt, yInt) in plane cIdx; frac 0 on an axis skips its pass.
// A block whose filter taps would leave the picture is first copied with its
// margins into a buffer, coordinates clamped to the picture (§8.5.3.3.3.1).
template <int N>
static void interpolate(const Picture& refPic, int cIdx,
                        int xInt, int yInt, const int16_t* fH, const int16_t* fV,
                        int w, int h, int bitDepth, int16_t* pred) {
    constexpr int before = N / 2 - 1;
    constexpr int after = N / 2;
    const int picW = refPic.width[cIdx];
    const int picH = refPic.height[cIdx];
    const ptrdiff_t stride = refPic.stride[cIdx];
    const uint16_t* plane = refPic.planes[cIdx].data();

    bool interior = (xInt - before >= 0) && (yInt - before >= 0) &&
                    (xInt + w + after <= picW) && (yInt + h + after <= picH);
    if (interior) {
        interpolate_block<N>(plane + yInt * stride + xInt, stride, w, h, fH, fV,
                             bitDepth, pred);
        return;
    }

    uint16_t buf[kMaxPadded * kMaxPadded];
    const int bw = w + N - 1;
    for (int y = 0; y < h + N - 1; y++) {
        int sy = std::max(0, std::min(yInt + y - before, picH - 1));
        const uint16_t* row = plane + sy * stride;
        for (int x = 0; x < bw; x++)
            buf[y * bw + x] = row[std::max(0, std::min(xInt + x - before, picW - 1))];
    }
    interpolate_block<N>(buf + before * bw + before, bw, w, h, fH, fV, bitDepth, pred);
}

static void interpolate_luma(const Picture& refPic,
                              int xInt, int yInt, int xFrac, int yFrac,
                              int nPbW, int nPbH, int bitDepth,
                              int16_t* pred) {
    interpolate<8>(refPic, 0, xInt, yInt,
                   xFrac ? luma_filter[xFrac] : nullptr,
                   yFrac ? luma_filter[yFrac] : nullptr,
                   nPbW, nPbH, bitDepth, pred);
}

static void interpolate_chroma(const Picture& refPic, int cIdx,
                                int xInt, int yInt, int xFrac, int yFrac,
                                int nPbWC, int nPbHC, int bitDepth,
                                int16_t* pred) {
    interpolate<4>(refPic, cIdx, xInt, yInt,
                   xFrac ? chroma_filter[xFrac] : nullptr,
                   yFrac ? chroma_filter[yFrac] : nullptr,
                   nPbWC, nPbHC, bitDepth, pred);
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
