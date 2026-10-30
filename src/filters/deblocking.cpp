// Deblocking filter — Spec §8.7.2
// Transcription directe de la spec ITU-T H.265 v8 (08/2021)

#include "filters/deblocking.h"
#include "decoding/dpb.h"
#include "common/types.h"
#include "common/simd.h"

#include <cstdlib>
#include <algorithm>
#include <cstring>
#include <vector>

namespace hevc {

// Table 8-12: beta' and tC' from Q
// Spec §8.7.2.5.3
static const int beta_table[52] = {
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  6,  7,  8,  9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 20,
    22, 24, 26, 28, 30, 32, 34, 36, 38, 40,
    42, 44, 46, 48, 50, 52, 54, 56, 58, 60,
    62, 64
};

static const int tc_table[54] = {
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  1,  1,
     1,  1,  1,  1,  1,  1,  1,  2,  2,  2,
     2,  3,  3,  3,  3,  4,  4,  4,  5,  5,
     6,  6,  7,  8,  9, 10, 11, 13, 14, 16,
    18, 20, 22, 24
};

// Table 8-10: QpC from qPi (chroma QP mapping, spec §8.6.1)
static const int qpc_table[58] = {
     0,  1,  2,  3,  4,  5,  6,  7,  8,  9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    29, 30, 31, 32, 33, 33, 34, 34, 35, 35,
    36, 36, 37, 37, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 50, 51
};

enum EdgeType { EDGE_VER = 0, EDGE_HOR = 1 };

// ============================================================
// Boundary exclusions (§8.7.2.1)
// Returns true if filtering should NOT cross this boundary.
// ============================================================
// The part of the exclusions that only applies across a CTB boundary: P and
// Q in one CTB share its slice and tile. addr_q / addr_p: the CTBs of Q and P.
static bool excluded_across_ctbs(const DecodingContext& ctx, const SliceHeader& sh_q,
                                 int addr_q, int addr_p) {
    auto& pps = *ctx.pps;
    // Tile boundary
    if (!pps.loop_filter_across_tiles_enabled_flag && !pps.TileId.empty()) {
        if (addr_q < (int)pps.TileId.size() && addr_p < (int)pps.TileId.size()) {
            int ts_q = pps.CtbAddrRsToTs[addr_q];
            int ts_p = pps.CtbAddrRsToTs[addr_p];
            if (pps.TileId[ts_q] != pps.TileId[ts_p]) return true;
        }
    }
    // Slice boundary — §8.7.2.1, Q-side slice's
    // slice_loop_filter_across_slices_enabled_flag
    if (ctx.slice_idx && ctx.slice_idx[addr_q] != ctx.slice_idx[addr_p] &&
        !sh_q.slice_loop_filter_across_slices_enabled_flag)
        return true;
    return false;
}

// ============================================================
// Boundary Strength derivation — §8.7.2.4
// ============================================================
static int derive_bs(const DecodingContext& ctx, int xP, int yP, int xQ, int yQ,
                     const CUInfo& cuP, const CUInfo& cuQ) {
    auto& sps = *ctx.sps;

    // Bs=2 if either side is intra (or PCM treated as intra)
    if (cuP.pred_mode == PredMode::MODE_INTRA || cuQ.pred_mode == PredMode::MODE_INTRA)
        return 2;

    // Check if edge is also a TU boundary with nonzero coefficients
    // Coordinates are inside the picture (the caller skips picture edges), so
    // shifts and masks stand for the divisions and modulos.
    int stride = ctx.filter_grid_stride;
    int gxP = xP >> 2, gyP = yP >> 2;
    int gxQ = xQ >> 2, gyQ = yQ >> 2;
    bool cbfP = ctx.cbf_luma_grid[gyP * stride + gxP] != 0;
    bool cbfQ = ctx.cbf_luma_grid[gyQ * stride + gxQ] != 0;

    // §8.7.2.4: "the block edge is also a transform block edge and the sample p0 or q0
    //  is in a luma transform block which contains one or more non-zero transform coefficient levels"
    // Check if this edge is actually a TU boundary
    uint8_t tuLogP = ctx.log2_tu_size_grid[gyP * stride + gxP];
    uint8_t tuLogQ = ctx.log2_tu_size_grid[gyQ * stride + gxQ];
    int tuSizeP = 1 << tuLogP;
    int tuSizeQ = 1 << tuLogQ;

    // Is this edge a TU boundary?
    // Vertical edge at xQ: TU boundary if xQ is aligned to TU size of Q side
    // Horizontal edge at yQ: similar
    bool isTuEdge = false;
    if (xP != xQ) {
        // Vertical edge
        isTuEdge = (xQ & (tuSizeQ - 1)) == 0 || (((xP + 1) & (tuSizeP - 1)) == 0 && (xP + 1) == xQ);
    } else {
        // Horizontal edge
        isTuEdge = (yQ & (tuSizeQ - 1)) == 0 || (((yP + 1) & (tuSizeP - 1)) == 0 && (yP + 1) == yQ);
    }

    if (isTuEdge && (cbfP || cbfQ))
        return 1;

    // Inter prediction comparison
    int miStride = ctx.motion_info_stride;
    auto& miP = ctx.motion_info[(yP >> kGridLog2) * miStride + (xP >> kGridLog2)];
    auto& miQ = ctx.motion_info[(yQ >> kGridLog2) * miStride + (xQ >> kGridLog2)];

    // Same motion, field for field, in the same slice: same reference pictures
    // and no motion vector difference, so every test below gives 0. Inside a
    // PU, and between skipped blocks that share their motion, this is most edges.
    // Fields the prediction does not use may differ; the full test then runs.
    static_assert(sizeof(PUMotionInfo) == 12, "PUMotionInfo has no padding to compare");
    if (std::memcmp(&miP, &miQ, sizeof(PUMotionInfo)) == 0) {
        const int log2CtbS = sps.CtbLog2SizeY;
        if (!ctx.slice_idx ||
            ctx.slice_idx[(yP >> log2CtbS) * sps.PicWidthInCtbsY + (xP >> log2CtbS)] ==
            ctx.slice_idx[(yQ >> log2CtbS) * sps.PicWidthInCtbsY + (xQ >> log2CtbS)])
            return 0;
    }

    int nRefP = (miP.pred_flag[0] ? 1 : 0) + (miP.pred_flag[1] ? 1 : 0);
    int nRefQ = (miQ.pred_flag[0] ? 1 : 0) + (miQ.pred_flag[1] ? 1 : 0);

    if (nRefP != nRefQ) return 1;

    // Get reference picture POCs for comparison (not index-based, picture-based).
    // Each side's ref_idx indexes the lists of its own slice: P and Q can sit in
    // two slices with different lists.
    int log2Ctb = sps.CtbLog2SizeY;
    auto slice_ref_pocs = [&](int x, int y) -> const Picture::SliceRefPocs* {
        size_t si = ctx.slice_idx
            ? ctx.slice_idx[(y >> log2Ctb) * sps.PicWidthInCtbsY + (x >> log2Ctb)] : 0;
        return si < ctx.pic->slice_ref_poc.size() ? &ctx.pic->slice_ref_poc[si] : nullptr;
    };
    const Picture::SliceRefPocs* refPocsP = slice_ref_pocs(xP, yP);
    const Picture::SliceRefPocs* refPocsQ = slice_ref_pocs(xQ, yQ);
    auto get_ref_poc = [&](const PUMotionInfo& mi, const Picture::SliceRefPocs* refPocs,
                           int list) -> int32_t {
        if (!refPocs || !mi.pred_flag[list] || mi.ref_idx[list] < 0) return Picture::kNoRefPoc;
        const auto& pocs = refPocs->list[list];
        return mi.ref_idx[list] < static_cast<int>(pocs.size())
            ? pocs[mi.ref_idx[list]] : Picture::kNoRefPoc;
    };

    if (nRefP == 1) {
        // Uni-prediction
        int listP = miP.pred_flag[0] ? 0 : 1;
        int listQ = miQ.pred_flag[0] ? 0 : 1;
        int32_t pocP = get_ref_poc(miP, refPocsP, listP);
        int32_t pocQ = get_ref_poc(miQ, refPocsQ, listQ);
        if (pocP != pocQ) return 1;
        MV mvP = miP.mv[listP], mvQ = miQ.mv[listQ];
        if (std::abs(mvP.x - mvQ.x) >= 4 || std::abs(mvP.y - mvQ.y) >= 4)
            return 1;
    } else if (nRefP == 2) {
        // Bi-prediction — §8.7.2.4.5: check both orderings
        int32_t pocPL0 = get_ref_poc(miP, refPocsP, 0);
        int32_t pocPL1 = get_ref_poc(miP, refPocsP, 1);
        int32_t pocQL0 = get_ref_poc(miQ, refPocsQ, 0);
        int32_t pocQL1 = get_ref_poc(miQ, refPocsQ, 1);

        bool sameOrder = (pocPL0 == pocQL0 && pocPL1 == pocQL1);
        bool swapped   = (pocPL0 == pocQL1 && pocPL1 == pocQL0);

        if (!sameOrder && !swapped) return 1;

        if (sameOrder && !swapped) {
            if (std::abs(miP.mv[0].x - miQ.mv[0].x) >= 4 ||
                std::abs(miP.mv[0].y - miQ.mv[0].y) >= 4 ||
                std::abs(miP.mv[1].x - miQ.mv[1].x) >= 4 ||
                std::abs(miP.mv[1].y - miQ.mv[1].y) >= 4)
                return 1;
        } else if (!sameOrder && swapped) {
            if (std::abs(miP.mv[0].x - miQ.mv[1].x) >= 4 ||
                std::abs(miP.mv[0].y - miQ.mv[1].y) >= 4 ||
                std::abs(miP.mv[1].x - miQ.mv[0].x) >= 4 ||
                std::abs(miP.mv[1].y - miQ.mv[0].y) >= 4)
                return 1;
        } else {
            // Both orderings match — Bs=0 only if at least one ordering gives small diff
            bool order1_ok =
                std::abs(miP.mv[0].x - miQ.mv[0].x) < 4 &&
                std::abs(miP.mv[0].y - miQ.mv[0].y) < 4 &&
                std::abs(miP.mv[1].x - miQ.mv[1].x) < 4 &&
                std::abs(miP.mv[1].y - miQ.mv[1].y) < 4;
            bool order2_ok =
                std::abs(miP.mv[0].x - miQ.mv[1].x) < 4 &&
                std::abs(miP.mv[0].y - miQ.mv[1].y) < 4 &&
                std::abs(miP.mv[1].x - miQ.mv[0].x) < 4 &&
                std::abs(miP.mv[1].y - miQ.mv[0].y) < 4;
            if (!order1_ok && !order2_ok) return 1;
        }
    }

    return 0;
}

// ============================================================
// Edge detection: check stored edge flags (set during decoding)
// §8.7.2.2 (TU boundaries) + §8.7.2.3 (PU boundaries)
// ============================================================
/**
 * Edge flags of eight grid columns, as one word.
 *
 * The grid holds one byte per 4x4 block, while the filter walks edges on the
 * 8x8 grid: of the 130k segment positions a 1080p picture offers, most carry no
 * edge at all, and for a vertical edge only every other byte is on the grid the
 * filter walks — the others mark 4-pixel-aligned transform boundaries, which
 * §8.7.2 does not filter. One word therefore answers "is any of the next few
 * positions worth visiting" for eight columns at a time.
 *
 * The mask is built from a byte array rather than written as a literal, so it
 * selects bytes 0, 2, 4 and 6 of the word whatever the host's byte order.
 */
static uint64_t even_column_mask() {
    static const uint64_t mask = [] {
        const uint8_t bytes[8] = { 0xFF, 0, 0xFF, 0, 0xFF, 0, 0xFF, 0 };
        uint64_t m;
        std::memcpy(&m, bytes, sizeof(m));
        return m;
    }();
    return mask;
}

// ============================================================
// Decision process for a luma sample — §8.7.2.5.6
// ============================================================
static int decision_luma_sample(int p0, int p3, int q0, int q3,
                                 int dpq, int beta, int tC) {
    // §8.7.2.5.6: dSam = 1 if all three conditions met
    if (dpq < (beta >> 2) &&
        std::abs(p3 - p0) + std::abs(q0 - q3) < (beta >> 3) &&
        std::abs(p0 - q0) < ((5 * tC + 1) >> 1))
        return 1;
    return 0;
}

// ============================================================
// Luma filtering of a whole edge segment — §8.7.2.5.7
// Lane k is line k of the segment: the arithmetic of filter_luma_sample on 4
// lines at once. p[i] and q[i] hold p_i and q_i, and are updated in place where
// filter_luma_sample would write (nDp, nDq); keepP / keepQ leave a side as is
// (PCM with pcm_loop_filter_disabled_flag, or transquant bypass).
// ============================================================
static inline void filter_luma_lines(simd::i32x4 p[4], simd::i32x4 q[4],
                                     int dE, int dEp, int dEq, int tC, int maxVal,
                                     bool keepP, bool keepQ) {
    using namespace simd;
    const i32x4 p0 = p[0], p1 = p[1], p2 = p[2], p3 = p[3];
    const i32x4 q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3];
    if (dE == 2) {
        // Strong filter — eq 8-389 to 8-394
        const i32x4 t2 = splat(2 * tC);
        if (!keepP) {
            p[0] = clip3(p0 - t2, p0 + t2, (p2 + 2*p1 + 2*p0 + 2*q0 + q1 + 4) >> 3);
            p[1] = clip3(p1 - t2, p1 + t2, (p2 + p1 + p0 + q0 + 2) >> 2);
            p[2] = clip3(p2 - t2, p2 + t2, (2*p3 + 3*p2 + p1 + p0 + q0 + 4) >> 3);
        }
        if (!keepQ) {
            q[0] = clip3(q0 - t2, q0 + t2, (p1 + 2*p0 + 2*q0 + 2*q1 + q2 + 4) >> 3);
            q[1] = clip3(q1 - t2, q1 + t2, (p0 + q0 + q1 + q2 + 2) >> 2);
            q[2] = clip3(q2 - t2, q2 + t2, (p0 + q0 + q1 + 3*q2 + 2*q3 + 4) >> 3);
        }
        return;
    }
    // Weak filter — eq 8-395 to 8-402; a line with |delta| >= 10 tC is left alone
    const i32x4 zero = splat(0), vmax = splat(maxVal);
    const i32x4 tc = splat(tC), tc2 = splat(tC >> 1);
    i32x4 delta = (9 * (q0 - p0) - 3 * (q1 - p1) + 8) >> 4;
    const i32x4 on = abs(delta) < splat(tC * 10);
    delta = clip3(-tc, tc, delta);
    if (!keepP) {
        p[0] = select(on, clip3(zero, vmax, p0 + delta), p0);
        if (dEp == 1) {
            i32x4 dP = clip3(-tc2, tc2, (((p2 + p0 + 1) >> 1) - p1 + delta) >> 1);
            p[1] = select(on, clip3(zero, vmax, p1 + dP), p1);
        }
    }
    if (!keepQ) {
        q[0] = select(on, clip3(zero, vmax, q0 - delta), q0);
        if (dEq == 1) {
            i32x4 dQ = clip3(-tc2, tc2, (((q2 + q0 + 1) >> 1) - q1 - delta) >> 1);
            q[1] = select(on, clip3(zero, vmax, q1 + dQ), q1);
        }
    }
}

// ============================================================
// Chroma filtering — §8.7.2.5.8
// ============================================================
static void filter_chroma_sample(int p[2], int q[2], int tC, int bitDepth,
                                  bool pcmP, bool pcmQ,
                                  bool bypassP, bool bypassQ,
                                  bool pcmFilterDisabled,
                                  int* p0Out, int* q0Out) {
    int maxVal = (1 << bitDepth) - 1;
    // eq 8-403
    int delta = Clip3(-tC, tC, ((((q[0] - p[0]) << 2) + p[1] - q[1] + 4) >> 3));
    *p0Out = Clip3(0, maxVal, p[0] + delta);
    *q0Out = Clip3(0, maxVal, q[0] - delta);

    // §8.7.2.5.8: suppress for PCM or transquant_bypass
    if ((pcmFilterDisabled && pcmP) || bypassP) *p0Out = p[0];
    if ((pcmFilterDisabled && pcmQ) || bypassQ) *q0Out = q[0];
}

// ============================================================
// Main deblocking entry point — §8.7.2.1
// ============================================================
// The edges of one direction E, Pixel: the picture's sample type, uint8_t or
// uint16_t. Edges of one direction are 8 samples apart and a filter changes at
// most 3 on each side, so they are independent and the scan order is free.
template <typename Pixel, EdgeType edgeType>
static void deblock_edges(DecodingContext& ctx) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    auto* pic = ctx.pic;

    int picW = sps.pic_width_in_luma_samples;
    int picH = sps.pic_height_in_luma_samples;
    int bitDepthY = sps.BitDepthY;
    int bitDepthC = sps.BitDepthC;
    bool pcmFilterDisabled = sps.pcm_loop_filter_disabled_flag;
    int subW = sps.SubWidthC;
    int subH = sps.SubHeightC;

    // Pre-compute plane pointers and strides for direct access
    Pixel* lumaPlane = pic->template plane<Pixel>(0);
    int lumaStride = pic->stride[0];
    Pixel* chromaPlane[3] = { nullptr,
                           pic->template plane<Pixel>(1),
                           pic->template plane<Pixel>(2) };
    int chromaStride[3] = { 0, pic->stride[1], pic->stride[2] };


    // 4-sample segments of the edges on the 8x8 grid, the picture edge excluded:
    // vertical edges at x = 8, 16, ..., horizontal ones at y = 8, 16, ...
    constexpr bool ver = (edgeType == EDGE_VER);
    const uint8_t* const edgeFlags = ver ? ctx.edge_flags_v : ctx.edge_flags_h;
    const int gridStride = ctx.filter_grid_stride;
    const int xStep = ver ? 8 : 4;
    const uint64_t evenMask = even_column_mask();
    for (int y = ver ? 0 : 8; y < picH; y += ver ? 4 : 8) {
        const uint8_t* const flagRow = edgeFlags + (y >> 2) * gridStride;
        for (int x = ver ? 8 : 0; x < picW; x += xStep) {
            // Skip a run of empty positions a word at a time (see
            // even_column_mask). Eight grid columns span 32 pixels, and x is a
            // multiple of xStep, which divides 32, so the stride stays aligned.
            if ((x >> 2) + 8 <= gridStride) {
                uint64_t flagWord;
                std::memcpy(&flagWord, flagRow + (x >> 2), sizeof(flagWord));
                if (ver) flagWord &= evenMask;
                if (flagWord == 0) {
                    x += 32 - xStep;
                    continue;
                }
            }
            if (flagRow[x >> 2] == 0) continue;

            // Boundary exclusions (§8.7.2.1): a slice with deblocking
            // disabled, and tile and slice edges, which can only lie on a
            // CTB boundary (the loops leave out the picture edge)
            int xP, yP, xQ, yQ;
            if (edgeType == EDGE_VER) {
                xP = x - 1; yP = y; xQ = x; yQ = y;
            } else {
                xP = x; yP = y - 1; xQ = x; yQ = y;
            }
            const int ctbLog2F = sps.CtbLog2SizeY;
            int addrQ = (yQ >> ctbLog2F) * sps.PicWidthInCtbsY + (xQ >> ctbLog2F);
            auto& sh_filt = ctx.sh_at_ctb(addrQ);
            if (sh_filt.slice_deblocking_filter_disabled_flag) continue;
            int addrP = (yP >> ctbLog2F) * sps.PicWidthInCtbsY + (xP >> ctbLog2F);
            if (addrP != addrQ && excluded_across_ctbs(ctx, sh_filt, addrQ, addrP))
                continue;

            // Derive Bs
            auto& cuP = ctx.cu_at(xP, yP);
            auto& cuQ = ctx.cu_at(xQ, yQ);
            int bS = derive_bs(ctx, xP, yP, xQ, yQ, cuP, cuQ);
            if (bS == 0) continue;

            // Get QP for both sides
            bool pcmP = cuP.is_pcm;
            bool pcmQ = cuQ.is_pcm;
            bool bypassP = cuP.cu_transquant_bypass;
            bool bypassQ = cuQ.cu_transquant_bypass;

            // §8.7.2.5.3: slice parameters for the slice containing q0,0 — sh_filt


            // ---- LUMA ----
            {
                int QpP = cuP.qp_y;
                int QpQ = cuQ.qp_y;
                int qPL = ((QpQ + QpP + 1) >> 1); // eq 8-347

                int Q_beta = Clip3(0, 51, qPL + (sh_filt.slice_beta_offset_div2 << 1));
                int betaPrime = beta_table[Q_beta];
                int beta = betaPrime * (1 << (bitDepthY - 8)); // eq 8-349

                int Q_tc = Clip3(0, 53, qPL + 2*(bS - 1) + (sh_filt.slice_tc_offset_div2 << 1));
                int tcPrime = tc_table[Q_tc];
                int tC = tcPrime * (1 << (bitDepthY - 8)); // eq 8-351


                // Decision process — §8.7.2.5.3. P[i] / Q[i] hold p_i / q_i of
                // the 4 lines, lane k for line k.
                using namespace simd;
                i32x4 P[4], Q[4];
                // The transpose loads int16 lanes: samples below 2^15
                const bool transpose = bitDepthY <= 15;
                if (edgeType == EDGE_VER && !transpose) {
                    const Pixel* r0 = lumaPlane + yQ * lumaStride + xQ;
                    const Pixel* r1 = r0 + lumaStride;
                    const Pixel* r2 = r1 + lumaStride;
                    const Pixel* r3 = r2 + lumaStride;
                    for (int i = 0; i < 4; i++) {
                        Q[i] = i32x4{r0[i], r1[i], r2[i], r3[i]};
                        P[i] = i32x4{r0[-i - 1], r1[-i - 1], r2[-i - 1], r3[-i - 1]};
                    }
                } else if (edgeType == EDGE_VER) {
                    // Rows of p3..q3, transposed into columns: 16-bit then
                    // 32-bit interleaves
                    const Pixel* r0 = lumaPlane + yQ * lumaStride + xQ - 4;
                    const i16x8 a0 = load8(r0), a1 = load8(r0 + lumaStride);
                    const i16x8 a2 = load8(r0 + 2 * lumaStride);
                    const i16x8 a3 = load8(r0 + 3 * lumaStride);
                    const i16x8 b0 = HEVC_SHUFFLE16(a0, a1, 0, 8, 1, 9, 2, 10, 3, 11);
                    const i16x8 b1 = HEVC_SHUFFLE16(a0, a1, 4, 12, 5, 13, 6, 14, 7, 15);
                    const i16x8 b2 = HEVC_SHUFFLE16(a2, a3, 0, 8, 1, 9, 2, 10, 3, 11);
                    const i16x8 b3 = HEVC_SHUFFLE16(a2, a3, 4, 12, 5, 13, 6, 14, 7, 15);
                    // Two columns each, lines 0-3: (p3, p2) (p1, p0) (q0, q1) (q2, q3)
                    const i16x8 c0 = HEVC_SHUFFLE16(b0, b2, 0, 1, 8, 9, 2, 3, 10, 11);
                    const i16x8 c1 = HEVC_SHUFFLE16(b0, b2, 4, 5, 12, 13, 6, 7, 14, 15);
                    const i16x8 c2 = HEVC_SHUFFLE16(b1, b3, 0, 1, 8, 9, 2, 3, 10, 11);
                    const i16x8 c3 = HEVC_SHUFFLE16(b1, b3, 4, 5, 12, 13, 6, 7, 14, 15);
                    P[3] = widen_lo(c0); P[2] = widen_hi(c0);
                    P[1] = widen_lo(c1); P[0] = widen_hi(c1);
                    Q[0] = widen_lo(c2); Q[1] = widen_hi(c2);
                    Q[2] = widen_lo(c3); Q[3] = widen_hi(c3);
                } else {
                    const Pixel* c = lumaPlane + yQ * lumaStride + xQ;
                    for (int i = 0; i < 4; i++) {
                        Q[i] = load4(c + i * lumaStride);
                        P[i] = load4(c - (i + 1) * lumaStride);
                    }
                }

                // dp, dq, d (eq 8-352 to 8-360 / 8-361 to 8-369), lines 0 and 3
                const i32x4 dpv = abs(P[2] - 2 * P[1] + P[0]);
                const i32x4 dqv = abs(Q[2] - 2 * Q[1] + Q[0]);
                int dp0 = dpv[0], dp3 = dpv[3];
                int dq0 = dqv[0], dq3 = dqv[3];
                int dpq0 = dp0 + dq0;
                int dpq3 = dp3 + dq3;
                int dp = dp0 + dp3;
                int dq = dq0 + dq3;
                int d = dpq0 + dpq3;

                int dE = 0, dEp = 0, dEq = 0;
                if (d < beta) {
                    // §8.7.2.5.6 for line 0
                    int dSam0 = decision_luma_sample(
                        P[0][0], P[3][0], Q[0][0], Q[3][0], 2 * dpq0, beta, tC);
                    // §8.7.2.5.6 for line 3
                    int dSam3 = decision_luma_sample(
                        P[0][3], P[3][3], Q[0][3], Q[3][3], 2 * dpq3, beta, tC);

                    dE = 1;
                    if (dSam0 == 1 && dSam3 == 1) dE = 2;
                    if (dp < ((beta + (beta >> 1)) >> 3)) dEp = 1;
                    if (dq < ((beta + (beta >> 1)) >> 3)) dEq = 1;
                }

                // §8.7.2.5.4: Filter all 4 luma lines (only if dE > 0)
                const bool keepP = (pcmFilterDisabled && pcmP) || bypassP;
                const bool keepQ = (pcmFilterDisabled && pcmQ) || bypassQ;
                if (dE > 0 && !(keepP && keepQ)) {
                    filter_luma_lines(P, Q, dE, dEp, dEq, tC, (1 << bitDepthY) - 1,
                                      keepP, keepQ);
                    // Write back p0..p2, q0..q2: lanes left unfiltered still hold
                    // their own sample.
                    if (edgeType == EDGE_VER && !transpose) {
                        Pixel* row = lumaPlane + yQ * lumaStride + xQ;
                        for (int k = 0; k < 4; k++, row += lumaStride)
                            for (int i = 0; i < 3; i++) {
                                row[-i - 1] = static_cast<Pixel>(P[i][k]);
                                row[i] = static_cast<Pixel>(Q[i][k]);
                            }
                    } else if (edgeType == EDGE_VER) {
                        // Columns back into rows, p3 and q3 unchanged
                        const i16x8 e = pack(P[3], P[2]), f = pack(P[1], P[0]);
                        const i16x8 g = pack(Q[0], Q[1]), h = pack(Q[2], Q[3]);
                        // Lines 0 and 1, then 2 and 3, four columns of each
                        const i16x8 ef01 = HEVC_SHUFFLE16(e, f, 0, 4, 8, 12, 1, 5, 9, 13);
                        const i16x8 gh01 = HEVC_SHUFFLE16(g, h, 0, 4, 8, 12, 1, 5, 9, 13);
                        const i16x8 ef23 = HEVC_SHUFFLE16(e, f, 2, 6, 10, 14, 3, 7, 11, 15);
                        const i16x8 gh23 = HEVC_SHUFFLE16(g, h, 2, 6, 10, 14, 3, 7, 11, 15);
                        Pixel* row = lumaPlane + yQ * lumaStride + xQ - 4;
                        store8(row, HEVC_SHUFFLE16(ef01, gh01, 0, 1, 2, 3, 8, 9, 10, 11));
                        store8(row + lumaStride,
                               HEVC_SHUFFLE16(ef01, gh01, 4, 5, 6, 7, 12, 13, 14, 15));
                        store8(row + 2 * lumaStride,
                               HEVC_SHUFFLE16(ef23, gh23, 0, 1, 2, 3, 8, 9, 10, 11));
                        store8(row + 3 * lumaStride,
                               HEVC_SHUFFLE16(ef23, gh23, 4, 5, 6, 7, 12, 13, 14, 15));
                    } else {
                        Pixel* c = lumaPlane + yQ * lumaStride + xQ;
                        for (int i = 0; i < 3; i++) {
                            store4(c - (i + 1) * lumaStride, P[i]);
                            store4(c + i * lumaStride, Q[i]);
                        }
                    }
                }
            }

            // ---- CHROMA ----
            // §8.7.2.5.1/5.2: chroma filtered only when Bs == 2 and edge is on 8-sample chroma grid
            if (bS == 2 && sps.ChromaArrayType != 0) {
                // Check 8-sample grid alignment in chroma space
                int chromaX = (edgeType == EDGE_VER) ? x / subW : x / subW;
                int chromaY = (edgeType == EDGE_HOR) ? y / subH : y / subH;
                bool chromaAligned;
                if (edgeType == EDGE_VER)
                    chromaAligned = ((chromaX >> 3) << 3) == chromaX;
                else
                    chromaAligned = ((chromaY >> 3) << 3) == chromaY;

                if (chromaAligned) {
                    int QpP = cuP.qp_y;
                    int QpQ = cuQ.qp_y;

                    for (int cIdx = 1; cIdx <= 2; cIdx++) {
                        int cQpPicOffset = (cIdx == 1) ? pps.pps_cb_qp_offset
                                                       : pps.pps_cr_qp_offset;
                        int qPi = ((QpQ + QpP + 1) >> 1) + cQpPicOffset;

                        // §8.7.2.5.5: QpC from Table 8-10
                        int QpC;
                        if (sps.ChromaArrayType == 1) {
                            QpC = qpc_table[Clip3(0, 57, qPi)];
                        } else {
                            QpC = std::min(qPi, 51);
                        }

                        int Q_tc = Clip3(0, 53, QpC + 2 + (sh_filt.slice_tc_offset_div2 << 1));
                        int tcPrime = tc_table[Q_tc];
                        int tC = tcPrime * (1 << (bitDepthC - 8));

                        // Filter 4 chroma lines along the edge
                        int chromaSegs = (edgeType == EDGE_VER) ? (4 / subH) : (4 / subW);
                        Pixel* cPlane = chromaPlane[cIdx];
                        int cStride = chromaStride[cIdx];
                        for (int k = 0; k < chromaSegs; k++) {
                            int pC[2], qC[2];
                            int cx, cy;
                            if (edgeType == EDGE_VER) {
                                cx = x / subW;
                                cy = y / subH + k;
                                Pixel* crow = cPlane + cy * cStride;
                                qC[0] = crow[cx]; qC[1] = crow[cx + 1];
                                pC[0] = crow[cx - 1]; pC[1] = crow[cx - 2];
                            } else {
                                cx = x / subW + k;
                                cy = y / subH;
                                qC[0] = cPlane[cy * cStride + cx];
                                qC[1] = cPlane[(cy + 1) * cStride + cx];
                                pC[0] = cPlane[(cy - 1) * cStride + cx];
                                pC[1] = cPlane[(cy - 2) * cStride + cx];
                            }

                            int p0Out, q0Out;
                            filter_chroma_sample(pC, qC, tC, bitDepthC,
                                                 cuP.is_pcm, cuQ.is_pcm,
                                                 bypassP, bypassQ,
                                                 pcmFilterDisabled,
                                                 &p0Out, &q0Out);

                            if (edgeType == EDGE_VER) {
                                Pixel* crow = cPlane + cy * cStride;
                                crow[cx - 1] = static_cast<Pixel>(p0Out);
                                crow[cx]     = static_cast<Pixel>(q0Out);
                            } else {
                                cPlane[(cy - 1) * cStride + cx] = static_cast<Pixel>(p0Out);
                                cPlane[cy * cStride + cx]       = static_cast<Pixel>(q0Out);
                            }
                        }
                    }
                }
            }
        }
    }
}

// §8.7.2.1: vertical edges of the whole picture first, then horizontal ones
template <typename Pixel>
static void deblock_picture(DecodingContext& ctx) {
    deblock_edges<Pixel, EDGE_VER>(ctx);
    deblock_edges<Pixel, EDGE_HOR>(ctx);
}

void apply_deblocking(DecodingContext& ctx) {
    if (ctx.pic->eight_bit) deblock_picture<uint8_t>(ctx);
    else deblock_picture<uint16_t>(ctx);
}

} // namespace hevc
