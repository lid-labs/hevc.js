#include "decoding/transform.h"
#include "decoding/coding_tree.h"
#include "decoding/cabac_tables.h"
#include "common/types.h"
#include "common/debug.h"
#include "common/simd.h"

#include <cstring>
#include <algorithm>

namespace hevc {

// ============================================================
// DST-VII 4x4 inverse (Table 8-12)
// ============================================================

// DST-VII matrix (for reference — used directly in idst4 below)

// ============================================================
// Partial butterfly inverse transforms
// ============================================================

// The column loops take four columns at once: every transform size is a
// multiple of 4. S(k) loads row k of those columns, D(k, v) clips v >> shift to
// int16 (Clip3(-32768, 32767, ...)) and stores it in row k.
#define S(k) simd::load4(src + (k) * line + j)
#define D(k, v) simd::store4(dst + (k) * line + j, \
    simd::max(simd::splat(-32768), simd::min(simd::splat(32767), (v) >> shift)))

static void idst4(const int16_t* src, int16_t* dst, int shift, int line) {
    using namespace simd;
    int add = 1 << (shift - 1);
    for (int j = 0; j < line; j += 4) {
        i32x4 c0 = S(0);
        i32x4 c1 = S(1);
        i32x4 c2 = S(2);
        i32x4 c3 = S(3);

        // DST-VII inverse uses M^T (columns of forward matrix as rows)
        // Forward matrix rows: {29,55,74,84}, {74,74,0,-74}, {84,-29,-74,55}, {55,-84,74,-29}
        // Transpose (columns become rows): {29,74,84,55}, {55,74,-29,-84}, {74,0,-74,74}, {84,-74,55,-29}
        i32x4 s0 = 29 * c0 + 74 * c1 + 84 * c2 + 55 * c3;
        i32x4 s1 = 55 * c0 + 74 * c1 - 29 * c2 - 84 * c3;
        i32x4 s2 = 74 * c0 +  0 * c1 - 74 * c2 + 74 * c3;
        i32x4 s3 = 84 * c0 - 74 * c1 + 55 * c2 - 29 * c3;

        D(0, s0 + add);
        D(1, s1 + add);
        D(2, s2 + add);
        D(3, s3 + add);
    }
}

static void idct4(const int16_t* src, int16_t* dst, int shift, int line) {
    using namespace simd;
    int add = 1 << (shift - 1);
    for (int j = 0; j < line; j += 4) {
        i32x4 E0 = 64 * S(0) + 64 * S(2);
        i32x4 E1 = 64 * S(0) - 64 * S(2);
        i32x4 O0 = 83 * S(1) + 36 * S(3);
        i32x4 O1 = 36 * S(1) - 83 * S(3);

        D(0, E0 + O0 + add);
        D(1, E1 + O1 + add);
        D(2, E1 - O1 + add);
        D(3, E0 - O0 + add);
    }
}

// 32-point DCT matrix (§8.6.4.2, eq 8-319). Row n of the N-point matrix is row
// n * 32 / N of this one, restricted to its first N columns.
static const int16_t tm32[32][32] = {
    { 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64},
    { 90, 90, 88, 85, 82, 78, 73, 67, 61, 54, 46, 38, 31, 22, 13,  4, -4,-13,-22,-31,-38,-46,-54,-61,-67,-73,-78,-82,-85,-88,-90,-90},
    { 90, 87, 80, 70, 57, 43, 25,  9, -9,-25,-43,-57,-70,-80,-87,-90,-90,-87,-80,-70,-57,-43,-25, -9,  9, 25, 43, 57, 70, 80, 87, 90},
    { 90, 82, 67, 46, 22, -4,-31,-54,-73,-85,-90,-88,-78,-61,-38,-13, 13, 38, 61, 78, 88, 90, 85, 73, 54, 31,  4,-22,-46,-67,-82,-90},
    { 89, 75, 50, 18,-18,-50,-75,-89,-89,-75,-50,-18, 18, 50, 75, 89, 89, 75, 50, 18,-18,-50,-75,-89,-89,-75,-50,-18, 18, 50, 75, 89},
    { 88, 67, 31,-13,-54,-82,-90,-78,-46, -4, 38, 73, 90, 85, 61, 22,-22,-61,-85,-90,-73,-38,  4, 46, 78, 90, 82, 54, 13,-31,-67,-88},
    { 87, 57,  9,-43,-80,-90,-70,-25, 25, 70, 90, 80, 43, -9,-57,-87,-87,-57, -9, 43, 80, 90, 70, 25,-25,-70,-90,-80,-43,  9, 57, 87},
    { 85, 46,-13,-67,-90,-73,-22, 38, 82, 88, 54, -4,-61,-90,-78,-31, 31, 78, 90, 61,  4,-54,-88,-82,-38, 22, 73, 90, 67, 13,-46,-85},
    { 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83},
    { 82, 22,-54,-90,-61, 13, 78, 85, 31,-46,-90,-67,  4, 73, 88, 38,-38,-88,-73, -4, 67, 90, 46,-31,-85,-78,-13, 61, 90, 54,-22,-82},
    { 80,  9,-70,-87,-25, 57, 90, 43,-43,-90,-57, 25, 87, 70, -9,-80,-80, -9, 70, 87, 25,-57,-90,-43, 43, 90, 57,-25,-87,-70,  9, 80},
    { 78, -4,-82,-73, 13, 85, 67,-22,-88,-61, 31, 90, 54,-38,-90,-46, 46, 90, 38,-54,-90,-31, 61, 88, 22,-67,-85,-13, 73, 82,  4,-78},
    { 75,-18,-89,-50, 50, 89, 18,-75,-75, 18, 89, 50,-50,-89,-18, 75, 75,-18,-89,-50, 50, 89, 18,-75,-75, 18, 89, 50,-50,-89,-18, 75},
    { 73,-31,-90,-22, 78, 67,-38,-90,-13, 82, 61,-46,-88, -4, 85, 54,-54,-85,  4, 88, 46,-61,-82, 13, 90, 38,-67,-78, 22, 90, 31,-73},
    { 70,-43,-87,  9, 90, 25,-80,-57, 57, 80,-25,-90, -9, 87, 43,-70,-70, 43, 87, -9,-90,-25, 80, 57,-57,-80, 25, 90,  9,-87,-43, 70},
    { 67,-54,-78, 38, 85,-22,-90,  4, 90, 13,-88,-31, 82, 46,-73,-61, 61, 73,-46,-82, 31, 88,-13,-90, -4, 90, 22,-85,-38, 78, 54,-67},
    { 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64},
    { 61,-73,-46, 82, 31,-88,-13, 90, -4,-90, 22, 85,-38,-78, 54, 67,-67,-54, 78, 38,-85,-22, 90,  4,-90, 13, 88,-31,-82, 46, 73,-61},
    { 57,-80,-25, 90, -9,-87, 43, 70,-70,-43, 87,  9,-90, 25, 80,-57,-57, 80, 25,-90,  9, 87,-43,-70, 70, 43,-87, -9, 90,-25,-80, 57},
    { 54,-85, -4, 88,-46,-61, 82, 13,-90, 38, 67,-78,-22, 90,-31,-73, 73, 31,-90, 22, 78,-67,-38, 90,-13,-82, 61, 46,-88,  4, 85,-54},
    { 50,-89, 18, 75,-75,-18, 89,-50,-50, 89,-18,-75, 75, 18,-89, 50, 50,-89, 18, 75,-75,-18, 89,-50,-50, 89,-18,-75, 75, 18,-89, 50},
    { 46,-90, 38, 54,-90, 31, 61,-88, 22, 67,-85, 13, 73,-82,  4, 78,-78, -4, 82,-73,-13, 85,-67,-22, 88,-61,-31, 90,-54,-38, 90,-46},
    { 43,-90, 57, 25,-87, 70,  9,-80, 80, -9,-70, 87,-25,-57, 90,-43,-43, 90,-57,-25, 87,-70, -9, 80,-80,  9, 70,-87, 25, 57,-90, 43},
    { 38,-88, 73, -4,-67, 90,-46,-31, 85,-78, 13, 61,-90, 54, 22,-82, 82,-22,-54, 90,-61,-13, 78,-85, 31, 46,-90, 67,  4,-73, 88,-38},
    { 36,-83, 83,-36,-36, 83,-83, 36, 36,-83, 83,-36,-36, 83,-83, 36, 36,-83, 83,-36,-36, 83,-83, 36, 36,-83, 83,-36,-36, 83,-83, 36},
    { 31,-78, 90,-61,  4, 54,-88, 82,-38,-22, 73,-90, 67,-13,-46, 85,-85, 46, 13,-67, 90,-73, 22, 38,-82, 88,-54, -4, 61,-90, 78,-31},
    { 25,-70, 90,-80, 43,  9,-57, 87,-87, 57, -9,-43, 80,-90, 70,-25,-25, 70,-90, 80,-43, -9, 57,-87, 87,-57,  9, 43,-80, 90,-70, 25},
    { 22,-61, 85,-90, 73,-38, -4, 46,-78, 90,-82, 54,-13,-31, 67,-88, 88,-67, 31, 13,-54, 82,-90, 78,-46,  4, 38,-73, 90,-85, 61,-22},
    { 18,-50, 75,-89, 89,-75, 50,-18,-18, 50,-75, 89,-89, 75,-50, 18, 18,-50, 75,-89, 89,-75, 50,-18,-18, 50,-75, 89,-89, 75,-50, 18},
    { 13,-38, 61,-78, 88,-90, 85,-73, 54,-31,  4, 22,-46, 67,-82, 90,-90, 82,-67, 46,-22, -4, 31,-54, 73,-85, 90,-88, 78,-61, 38,-13},
    {  9,-25, 43,-57, 70,-80, 87,-90, 90,-87, 80,-70, 57,-43, 25, -9, -9, 25,-43, 57,-70, 80,-87, 90,-90, 87,-80, 70,-57, 43,-25,  9},
    {  4,-13, 22,-31, 38,-46, 54,-61, 67,-73, 78,-82, 85,-88, 90,-90, 90,-90, 88,-85, 82,-78, 73,-67, 61,-54, 46,-38, 31,-22, 13, -4},
};

// N-point inverse DCT of four columns (N = 1 .. 32, a power of two), by the
// even/odd decomposition: in[n] is input row n, rows n >= limit are zero and
// are not read. Exact integer arithmetic, so the result matches the full
// partial butterfly whatever limit is.
template <int N>
static inline void idct_cols(const simd::i32x4* in, int limit, simd::i32x4* out) {
    using namespace simd;
    if constexpr (N == 1) {
        out[0] = limit > 0 ? 64 * in[0] : splat(0);
    } else {
        constexpr int step = 32 / N;
        // Zero-initialised for GCC's -Wmaybe-uninitialized: only rows below
        // the limit are read
        i32x4 even[N / 2] = {}, E[N / 2];
        const int evenLimit = (limit + 1) / 2;
        for (int n = 0; n < evenLimit; n++) even[n] = in[2 * n];
        idct_cols<N / 2>(even, evenLimit, E);
        for (int k = 0; k < N / 2; k++) {
            i32x4 O = splat(0);
            for (int n = 1; n < limit; n += 2)
                O += int(tm32[n * step][k]) * in[n];
            out[k] = E[k] + O;
            out[N - 1 - k] = E[k] - O;
        }
    }
}

// One pass of the N-point inverse DCT over columns j < cols of src (a multiple
// of 4), rows n >= limit zero: dst[k * line + j], clipped to int16.
template <int N>
static void idct_pass(const int16_t* src, int16_t* dst, int shift, int line,
                      int cols, int limit) {
    using namespace simd;
    int add = 1 << (shift - 1);
    for (int j = 0; j < cols; j += 4) {
        i32x4 in[N] = {}, out[N];
        for (int n = 0; n < limit; n++) in[n] = S(n);
        idct_cols<N>(in, limit, out);
        for (int k = 0; k < N; k++) D(k, out[k] + add);
    }
}

#undef S
#undef D

// ============================================================
// 2D inverse transform (§8.6.4.2)
// Vertical pass -> clip -> horizontal pass
// ============================================================

// dst[y * n + x] = src[x * n + y] for rows y < rows of dst, in 4x4 tiles: two
// 4x4 rows per vector, interleaved into columns. n and rows are multiples of 4.
static void transpose(const int16_t* src, int16_t* dst, int n, int rows) {
    using namespace simd;
    for (int x = 0; x < n; x += 4)
        for (int y = 0; y < rows; y += 4) {
            // Rows x..x+3 of src, columns y..y+3
            i16x8 r01, r23;
            memcpy(&r01, src + x * n + y, 8);
            memcpy(reinterpret_cast<char*>(&r01) + 8, src + (x + 1) * n + y, 8);
            memcpy(&r23, src + (x + 2) * n + y, 8);
            memcpy(reinterpret_cast<char*>(&r23) + 8, src + (x + 3) * n + y, 8);
            const i16x8 c01 = HEVC_SHUFFLE16(r01, r23, 0, 4, 8, 12, 1, 5, 9, 13);
            const i16x8 c23 = HEVC_SHUFFLE16(r01, r23, 2, 6, 10, 14, 3, 7, 11, 15);
            memcpy(dst + y * n + x, &c01, 8);
            memcpy(dst + (y + 1) * n + x, reinterpret_cast<const char*>(&c01) + 8, 8);
            memcpy(dst + (y + 2) * n + x, &c23, 8);
            memcpy(dst + (y + 3) * n + x, reinterpret_cast<const char*>(&c23) + 8, 8);
        }
}

static void inverse_transform_2d(int log2TrafoSize, bool use_dst,
                                  int bit_depth, const CoeffExtent& ext,
                                  const int16_t* coeff, int16_t* residual) {
    int trSize = 1 << log2TrafoSize;
    int16_t tmp[64 * 64];
    int16_t tmp2[64 * 64];

    // Vertical pass: shift1 = 7
    int shift1 = 7;
    // Horizontal pass: shift2 = 20 - BitDepth
    int shift2 = 20 - bit_depth;

    if (log2TrafoSize == 2) {
        // Pass 1: vertical (columns), transpose, pass 2 on the rows, transpose back
        if (use_dst) idst4(coeff, tmp, shift1, 4);
        else idct4(coeff, tmp, shift1, 4);
        for (int y = 0; y < 4; y++)
            for (int x = 0; x < 4; x++)
                tmp2[y * 4 + x] = tmp[x * 4 + y];
        if (use_dst) idst4(tmp2, tmp, shift2, 4);
        else idct4(tmp2, tmp, shift2, 4);
        for (int y = 0; y < 4; y++)
            for (int x = 0; x < 4; x++)
                residual[y * 4 + x] = tmp[x * 4 + y];
        return;
    }

    // DC only: both passes give every sample the same value.
    if (ext.max_x == 0 && ext.max_y == 0) {
        int v = Clip3(-32768, 32767, (64 * coeff[0] + (1 << (shift1 - 1))) >> shift1);
        v = Clip3(-32768, 32767, (64 * v + (1 << (shift2 - 1))) >> shift2);
        std::fill_n(residual, trSize * trSize, static_cast<int16_t>(v));
        return;
    }

    // Pass 1 transforms the columns that hold a coefficient, reading the rows
    // that do; a zero column transforms to zero. Pass 2 then reads, as rows of
    // the transposed block, only the columns pass 1 produced.
    const int cols = (ext.max_x + 4) & ~3;
    const int rows = ext.max_y + 1;
    auto pass = [&](const int16_t* src, int16_t* dst, int shift, int nCols, int limit) {
        switch (log2TrafoSize) {
            case 3: idct_pass<8>(src, dst, shift, trSize, nCols, limit); break;
            case 4: idct_pass<16>(src, dst, shift, trSize, nCols, limit); break;
            // log2TrafoSize is 2..5 (§7.4.9.6) and 2 returned above, so what is
            // left is the 32-point transform. Spelt as the default rather than
            // `case 5`: a switch that falls through writes nothing, and the
            // transpose below would then read tmp uninitialised.
            default: idct_pass<32>(src, dst, shift, trSize, nCols, limit); break;
        }
    };
    pass(coeff, tmp, shift1, cols, rows);

    // Transpose the columns pass 1 wrote, so pass 2 transforms rows
    transpose(tmp, tmp2, trSize, cols);

    pass(tmp2, tmp, shift2, trSize, ext.max_x + 1);

    // Transpose back to get final residual in row-major order
    transpose(tmp, residual, trSize, trSize);
}

// ============================================================
// Dequantization (§8.6.3)
// ============================================================

void perform_dequant(DecodingContext& ctx, int x0, int y0,
                     int log2TrafoSize, int cIdx, int qp, const CoeffExtent& ext,
                     const int16_t* coefficients, int16_t* scaled) {
    int trSize = 1 << log2TrafoSize;
    // Only the extent is scaled, columns rounded up to 4 for the transform's
    // column groups: a zero coefficient scales to zero, and the inverse
    // transform reads nothing else (transform skip and 4x4 TUs pass a full one).
    const int rowsEnd = ext.max_y + 1;
    const int colsEnd = std::min(trSize, (ext.max_x + 4) & ~3);

    // §8.6.3 — bdShift = BitDepth + Log2(nTbS) + 10 - log2TransformRange
    // log2TransformRange = 15 for Main profile
    int bitDepth = (cIdx == 0) ? ctx.sps->BitDepthY : ctx.sps->BitDepthC;
    int bdShift = bitDepth + log2TrafoSize + 10 - 15;
    int add = (bdShift > 0) ? (1 << (bdShift - 1)) : 0;

    int qpPer = qp / 6;
    int qpRem = qp % 6;
    int scale = levelScale[qpRem];

    // §8.6.3 collapses to 32-bit arithmetic whenever qpPer <= bdShift.
    // coeff * m * scale always fits in int32 (|32768 * 255 * 72| < 2^31); only the
    // << qpPer overflows, and dividing numerator and denominator by 2^qpPer turns
    // ((X << qpPer) + (1 << (bdShift-1))) >> bdShift into (X + (1 << (s-1))) >> s.
    // At s == 0 the rounding term vanishes and the result is X. i64 ops cost
    // noticeably more than i32 in WebAssembly, and this is a hot path.
    const int shiftDown = bdShift - qpPer;
    const bool narrow = (bdShift > 0) && (shiftDown >= 0);
    const int narrowAdd = (shiftDown >= 1) ? (1 << (shiftDown - 1)) : 0;

    // Check scaling lists
    bool useScalingList = ctx.sps->scaling_list_enabled_flag;

    if (!useScalingList && narrow) {
        // m = 16 everywhere: four coefficients per vector. 0 stays 0.
        using namespace simd;
        const int k = 16 * scale;
        for (int y = 0; y < rowsEnd; y++) {
            const int16_t* c = coefficients + y * trSize;
            int16_t* d = scaled + y * trSize;
            for (int x = 0; x < colsEnd; x += 4) {
                i32x4 prod = load4(c + x) * k;
                if (shiftDown >= 1) prod = (prod + narrowAdd) >> shiftDown;
                store4(d + x, max(splat(-32768), min(splat(32767), prod)));
            }
        }
        return;
    }

    for (int y = 0; y < rowsEnd; y++) {
        for (int x = 0; x < colsEnd; x++) {
            int coeff = coefficients[y * trSize + x];
            if (coeff == 0) {
                scaled[y * trSize + x] = 0;
                continue;
            }

            int m = 16; // flat scaling (no scaling list)
            if (useScalingList) {
                // Get scaling list matrix value
                // For sizeId >= 2, upscale from 8x8
                int sizeId;
                if (log2TrafoSize == 2) sizeId = 0;
                else if (log2TrafoSize == 3) sizeId = 1;
                else if (log2TrafoSize == 4) sizeId = 2;
                else sizeId = 3;

                int matrixId;
                if (sizeId < 3) {
                    matrixId = (cIdx == 0) ? 0 : (cIdx == 1 ? 1 : 2);
                    // §8.6.3: CuPredMode[xTbY][yTbY] — use current CU, not (0,0)
                    if (ctx.cu_at(x0, y0).pred_mode != PredMode::MODE_INTRA)
                        matrixId += 3;
                } else {
                    matrixId = (ctx.cu_at(x0, y0).pred_mode == PredMode::MODE_INTRA) ? 0 : 3;
                }

                const auto& sl = ctx.pps->pps_scaling_list_data_present_flag ?
                    ctx.pps->scaling_list_data : ctx.sps->scaling_list_data;

                if (sizeId == 0) {
                    m = sl.scaling_list[sizeId][matrixId][y * trSize + x];
                } else {
                    // Upscale from 8x8 matrix
                    int ratio = trSize / 8;
                    if (ratio < 1) ratio = 1;
                    int idx = (y / ratio) * 8 + (x / ratio);
                    if (idx > 63) idx = 63;
                    m = sl.scaling_list[sizeId][matrixId % 6][idx];

                    // DC coeff override for 16x16 and 32x32
                    if ((sizeId == 2 || sizeId == 3) && x == 0 && y == 0) {
                        m = sl.scaling_list_dc[sizeId - 2][matrixId % 6];
                        if (m == 0) m = 16;
                    }
                }
            }

            // §8.6.3: d[x][y] = Clip3(coeffMin, coeffMax,
            //   ((coeff * m * levelScale[qP%6] << (qP/6)) + (1<<(bdShift-1))) >> bdShift)
            int val32;
            if (narrow) {
                const int prod = coeff * m * scale;
                val32 = (shiftDown >= 1) ? ((prod + narrowAdd) >> shiftDown) : prod;
            } else {
                int64_t val = static_cast<int64_t>(coeff) * m * scale;
                val = (val << qpPer) + add;
                val >>= bdShift;
                val32 = static_cast<int>(val);
            }
            scaled[y * trSize + x] = static_cast<int16_t>(Clip3(-32768, 32767, val32));
        }
    }
}

// ============================================================
// Transform inverse entry point
// ============================================================

void perform_transform_inverse(int log2TrafoSize, int cIdx,
                                bool is_intra, bool transform_skip,
                                int bit_depth, const CoeffExtent& ext,
                                const int16_t* scaled, int16_t* residual) {
    int trSize = 1 << log2TrafoSize;

    if (transform_skip) {
        // Transform skip — §8.6.4.2 scales by tsShift = 5 + log2(nTbS), then §8.6.2
        // shifts down by bdShift = 20 - BitDepth: one shift of 15 - BitDepth - log2(nTbS).
        int shift = std::max(0, 15 - bit_depth - log2TrafoSize);
        int add = (shift > 0) ? (1 << (shift - 1)) : 0;
        for (int i = 0; i < trSize * trSize; i++) {
            residual[i] = static_cast<int16_t>((scaled[i] + add) >> shift);
        }
        return;
    }

    // Use DST for 4x4 luma intra
    bool use_dst = (is_intra && cIdx == 0 && log2TrafoSize == 2);

    inverse_transform_2d(log2TrafoSize, use_dst, bit_depth, ext, scaled, residual);
}

} // namespace hevc
