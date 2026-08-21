// Deblocking filter — Spec §8.7.2
// Transcription directe de la spec ITU-T H.265 v8 (08/2021)

#include "filters/deblocking.h"
#include "decoding/dpb.h"
#include "common/types.h"

#include <cstdlib>
#include <algorithm>
#include <cstring>

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
// Helper: is position (x,y) at a picture/tile/slice boundary?
// Returns true if filtering should NOT cross this boundary.
// ============================================================
static bool is_boundary_excluded(const DecodingContext& ctx,
                                  int x, int y, EdgeType edgeType) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    int picW = sps.pic_width_in_luma_samples;
    int picH = sps.pic_height_in_luma_samples;

    // Picture boundary
    if (edgeType == EDGE_VER && x == 0) return true;
    if (edgeType == EDGE_HOR && y == 0) return true;
    if (edgeType == EDGE_VER && x >= picW) return true;
    if (edgeType == EDGE_HOR && y >= picH) return true;

    // §8.7.2.1: slice_deblocking_filter_disabled_flag for the slice containing Q-side
    // Grid indices: coordinates are non-negative here (picture-boundary edges
    // returned above), so shifting matches the original division.
    const int ctbLog2 = sps.CtbLog2SizeY;
    int addr_q = (y >> ctbLog2) * sps.PicWidthInCtbsY + (x >> ctbLog2);
    auto& sh_q = ctx.sh_at_ctb(addr_q);
    if (sh_q.slice_deblocking_filter_disabled_flag) return true;

    // Tile boundary
    if (!pps.loop_filter_across_tiles_enabled_flag && !pps.TileId.empty()) {
        if (edgeType == EDGE_VER) {
            int rx_q = x >> ctbLog2;
            int rx_p = (x - 1) >> ctbLog2;
            int ry = y >> ctbLog2;
            int addr_q = ry * sps.PicWidthInCtbsY + rx_q;
            int addr_p = ry * sps.PicWidthInCtbsY + rx_p;
            if (addr_q < (int)pps.TileId.size() && addr_p < (int)pps.TileId.size()) {
                int ts_q = pps.CtbAddrRsToTs[addr_q];
                int ts_p = pps.CtbAddrRsToTs[addr_p];
                if (pps.TileId[ts_q] != pps.TileId[ts_p]) return true;
            }
        } else {
            int ry_q = y >> ctbLog2;
            int ry_p = (y - 1) >> ctbLog2;
            int rx = x >> ctbLog2;
            int addr_q = ry_q * sps.PicWidthInCtbsY + rx;
            int addr_p = ry_p * sps.PicWidthInCtbsY + rx;
            if (addr_q < (int)pps.TileId.size() && addr_p < (int)pps.TileId.size()) {
                int ts_q = pps.CtbAddrRsToTs[addr_q];
                int ts_p = pps.CtbAddrRsToTs[addr_p];
                if (pps.TileId[ts_q] != pps.TileId[ts_p]) return true;
            }
        }
    }

    // Slice boundary — §8.7.2.1: exclude edges at slice boundaries
    // when slice_loop_filter_across_slices_enabled_flag == 0
    if (ctx.slice_idx) {
        int addr_p;
        if (edgeType == EDGE_VER) {
            addr_p = (y >> ctbLog2) * sps.PicWidthInCtbsY + ((x - 1) >> ctbLog2);
        } else {
            addr_p = ((y - 1) >> ctbLog2) * sps.PicWidthInCtbsY + (x >> ctbLog2);
        }
        if (ctx.slice_idx[addr_q] != ctx.slice_idx[addr_p]) {
            // §8.7.2.1: "left/top boundary of the slice and
            // slice_loop_filter_across_slices_enabled_flag is equal to 0"
            // This applies to the Q-side slice
            if (!sh_q.slice_loop_filter_across_slices_enabled_flag)
                return true;
        }
    }

    // §8.7.2.1: Also check P-side — if the P-side slice has deblocking disabled,
    // the edge should still be excluded
    // (The filterLeftCbEdgeFlag/filterTopCbEdgeFlag is per-CU, driven by Q-side slice only)

    return false;
}

// ============================================================
// Boundary Strength derivation — §8.7.2.4
// ============================================================
static int derive_bs(const DecodingContext& ctx, int xP, int yP, int xQ, int yQ) {
    auto& sps = *ctx.sps;
    int picW = sps.pic_width_in_luma_samples;
    int picH = sps.pic_height_in_luma_samples;

    // Out of bounds check
    if (xP < 0 || yP < 0 || xP >= picW || yP >= picH) return 0;
    if (xQ < 0 || yQ < 0 || xQ >= picW || yQ >= picH) return 0;

    auto& cuP = ctx.cu_at(xP, yP);
    auto& cuQ = ctx.cu_at(xQ, yQ);

    // Bs=2 if either side is intra (or PCM treated as intra)
    if (cuP.pred_mode == PredMode::MODE_INTRA || cuQ.pred_mode == PredMode::MODE_INTRA)
        return 2;

    // Check if edge is also a TU boundary with nonzero coefficients
    int stride = ctx.filter_grid_stride;
    int gxP = xP / 4, gyP = yP / 4;
    int gxQ = xQ / 4, gyQ = yQ / 4;
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
        isTuEdge = (xQ % tuSizeQ == 0) || ((xP + 1) % tuSizeP == 0 && (xP + 1) == xQ);
    } else {
        // Horizontal edge
        isTuEdge = (yQ % tuSizeQ == 0) || ((yP + 1) % tuSizeP == 0 && (yP + 1) == yQ);
    }

    if (isTuEdge && (cbfP || cbfQ))
        return 1;

    // Inter prediction comparison
    int minTb = sps.MinTbSizeY;
    int miStride = ctx.motion_info_stride;
    auto& miP = ctx.motion_info[(yP / minTb) * miStride + (xP / minTb)];
    auto& miQ = ctx.motion_info[(yQ / minTb) * miStride + (xQ / minTb)];

    int nRefP = (miP.pred_flag[0] ? 1 : 0) + (miP.pred_flag[1] ? 1 : 0);
    int nRefQ = (miQ.pred_flag[0] ? 1 : 0) + (miQ.pred_flag[1] ? 1 : 0);

    if (nRefP != nRefQ) return 1;

    // Get reference picture POCs for comparison (not index-based, picture-based)
    auto get_ref_poc = [&](const PUMotionInfo& mi, int list) -> int32_t {
        if (!mi.pred_flag[list] || mi.ref_idx[list] < 0) return -999999;
        if (list == 0 && mi.ref_idx[0] < ctx.dpb->num_ref_list0()) {
            auto* rp = ctx.dpb->ref_pic_list0(mi.ref_idx[0]);
            return rp ? rp->poc : -999999;
        }
        if (list == 1 && mi.ref_idx[1] < ctx.dpb->num_ref_list1()) {
            auto* rp = ctx.dpb->ref_pic_list1(mi.ref_idx[1]);
            return rp ? rp->poc : -999999;
        }
        return -999999;
    };

    if (nRefP == 1) {
        // Uni-prediction
        int listP = miP.pred_flag[0] ? 0 : 1;
        int listQ = miQ.pred_flag[0] ? 0 : 1;
        int32_t pocP = get_ref_poc(miP, listP);
        int32_t pocQ = get_ref_poc(miQ, listQ);
        if (pocP != pocQ) return 1;
        MV mvP = miP.mv[listP], mvQ = miQ.mv[listQ];
        if (std::abs(mvP.x - mvQ.x) >= 4 || std::abs(mvP.y - mvQ.y) >= 4)
            return 1;
    } else if (nRefP == 2) {
        // Bi-prediction — §8.7.2.4.5: check both orderings
        int32_t pocPL0 = get_ref_poc(miP, 0);
        int32_t pocPL1 = get_ref_poc(miP, 1);
        int32_t pocQL0 = get_ref_poc(miQ, 0);
        int32_t pocQL1 = get_ref_poc(miQ, 1);

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
static bool has_edge(const DecodingContext& ctx, int x, int y, EdgeType edgeType) {
    int stride = ctx.filter_grid_stride;
    int gx = x / 4, gy = y / 4;
    if (edgeType == EDGE_VER) {
        return ctx.edge_flags_v[gy * stride + gx] != 0;
    } else {
        return ctx.edge_flags_h[gy * stride + gx] != 0;
    }
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
// Luma filtering — §8.7.2.5.7
// ============================================================
static void filter_luma_sample(int p[4], int q[4],
                                int dE, int dEp, int dEq, int tC,
                                int bitDepth,
                                bool pcmP, bool pcmQ,
                                bool bypassP, bool bypassQ,
                                bool pcmFilterDisabled,
                                int* nDp, int* nDq,
                                int pOut[3], int qOut[3]) {
    int maxVal = (1 << bitDepth) - 1;
    *nDp = 0;
    *nDq = 0;

    if (dE == 2) {
        // Strong filter — eq 8-389 to 8-394
        *nDp = 3;
        *nDq = 3;
        pOut[0] = Clip3(p[0] - 2*tC, p[0] + 2*tC,
                        (p[2] + 2*p[1] + 2*p[0] + 2*q[0] + q[1] + 4) >> 3);
        pOut[1] = Clip3(p[1] - 2*tC, p[1] + 2*tC,
                        (p[2] + p[1] + p[0] + q[0] + 2) >> 2);
        pOut[2] = Clip3(p[2] - 2*tC, p[2] + 2*tC,
                        (2*p[3] + 3*p[2] + p[1] + p[0] + q[0] + 4) >> 3);
        qOut[0] = Clip3(q[0] - 2*tC, q[0] + 2*tC,
                        (p[1] + 2*p[0] + 2*q[0] + 2*q[1] + q[2] + 4) >> 3);
        qOut[1] = Clip3(q[1] - 2*tC, q[1] + 2*tC,
                        (p[0] + q[0] + q[1] + q[2] + 2) >> 2);
        qOut[2] = Clip3(q[2] - 2*tC, q[2] + 2*tC,
                        (p[0] + q[0] + q[1] + 3*q[2] + 2*q[3] + 4) >> 3);
    } else {
        // Weak filter — eq 8-395 to 8-402
        int delta = (9 * (q[0] - p[0]) - 3 * (q[1] - p[1]) + 8) >> 4;
        if (std::abs(delta) < tC * 10) {
            delta = Clip3(-tC, tC, delta);
            pOut[0] = Clip3(0, maxVal, p[0] + delta);
            qOut[0] = Clip3(0, maxVal, q[0] - delta);

            if (dEp == 1) {
                int deltaP = Clip3(-(tC >> 1), tC >> 1,
                                    (((p[2] + p[0] + 1) >> 1) - p[1] + delta) >> 1);
                pOut[1] = Clip3(0, maxVal, p[1] + deltaP);
            }
            if (dEq == 1) {
                int deltaQ = Clip3(-(tC >> 1), tC >> 1,
                                    (((q[2] + q[0] + 1) >> 1) - q[1] - delta) >> 1);
                qOut[1] = Clip3(0, maxVal, q[1] + deltaQ);
            }
            *nDp = dEp + 1;
            *nDq = dEq + 1;
        }
    }

    // §8.7.2.5.7: PCM or transquant_bypass suppresses filtering on that side
    if (*nDp > 0 && ((pcmFilterDisabled && pcmP) || bypassP)) *nDp = 0;
    if (*nDq > 0 && ((pcmFilterDisabled && pcmQ) || bypassQ)) *nDq = 0;
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
void apply_deblocking(DecodingContext& ctx) {
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
    uint16_t* lumaPlane = pic->planes[0].data();
    int lumaStride = pic->stride[0];
    uint16_t* chromaPlane[3] = { nullptr,
                                  pic->planes[1].data(),
                                  pic->planes[2].data() };
    int chromaStride[3] = { 0, pic->stride[1], pic->stride[2] };

    // §8.7.2.1: Process vertical edges first, then horizontal
    for (int pass = 0; pass < 2; pass++) {
        EdgeType edgeType = (pass == 0) ? EDGE_VER : EDGE_HOR;

        // Iterate over all 8-pixel-aligned edge positions
        for (int yE = 0; yE < picH; yE += 8) {
            for (int xE = 0; xE < picW; xE += 8) {
                // For each 8-pixel edge position, process 4-sample segments
                // Vertical: edge at x=xE, segments at y = yE, yE+4
                // Horizontal: edge at y=yE, segments at x = xE, xE+4
                for (int seg = 0; seg < 2; seg++) {
                    int x, y;
                    if (edgeType == EDGE_VER) {
                        x = xE;
                        y = yE + seg * 4;
                    } else {
                        x = xE + seg * 4;
                        y = yE;
                    }

                    if (x >= picW || y >= picH) continue;

                    // Check if there's an edge here
                    bool hasE = has_edge(ctx, x, y, edgeType);
                    if (!hasE) continue;

                    // Check boundary exclusions
                    bool excl = is_boundary_excluded(ctx, x, y, edgeType);
                    if (excl) continue;

                    // Derive Bs
                    int xP, yP, xQ, yQ;
                    if (edgeType == EDGE_VER) {
                        xP = x - 1; yP = y; xQ = x; yQ = y;
                    } else {
                        xP = x; yP = y - 1; xQ = x; yQ = y;
                    }
                    int bS = derive_bs(ctx, xP, yP, xQ, yQ);
                    if (bS == 0) continue;

                    // Get QP for both sides
                    auto& cuP = ctx.cu_at(xP, yP);
                    auto& cuQ = ctx.cu_at(xQ, yQ);
                    bool pcmP = cuP.is_pcm;
                    bool pcmQ = cuQ.is_pcm;
                    bool bypassP = cuP.cu_transquant_bypass;
                    bool bypassQ = cuQ.cu_transquant_bypass;

                    // §8.7.2.5.3: slice parameters for the slice containing q0,0
                    const int ctbLog2F = sps.CtbLog2SizeY;
                    int addrQ = (yQ >> ctbLog2F) * sps.PicWidthInCtbsY + (xQ >> ctbLog2F);
                    auto& sh_filt = ctx.sh_at_ctb(addrQ);


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


                        // Decision process — §8.7.2.5.3
                        // Read p0..p3 and q0..q3 for lines k=0 and k=3
                        int pSamp[4][2], qSamp[4][2]; // [i][k] k=0,1 maps to line 0 and 3

                        for (int kk = 0; kk < 2; kk++) {
                            int k = kk * 3; // k = 0 and 3
                            if (edgeType == EDGE_VER) {
                                uint16_t* rowQ = lumaPlane + (yQ + k) * lumaStride;
                                for (int i = 0; i < 4; i++) {
                                    qSamp[i][kk] = rowQ[xQ + i];
                                    pSamp[i][kk] = rowQ[xQ - i - 1];
                                }
                            } else {
                                for (int i = 0; i < 4; i++) {
                                    qSamp[i][kk] = lumaPlane[(yQ + i) * lumaStride + xQ + k];
                                    pSamp[i][kk] = lumaPlane[(yQ - i - 1) * lumaStride + xQ + k];
                                }
                            }
                        }

                        // dp, dq, d (eq 8-352 to 8-360 / 8-361 to 8-369)
                        int dp0 = std::abs(pSamp[2][0] - 2*pSamp[1][0] + pSamp[0][0]);
                        int dp3 = std::abs(pSamp[2][1] - 2*pSamp[1][1] + pSamp[0][1]);
                        int dq0 = std::abs(qSamp[2][0] - 2*qSamp[1][0] + qSamp[0][0]);
                        int dq3 = std::abs(qSamp[2][1] - 2*qSamp[1][1] + qSamp[0][1]);
                        int dpq0 = dp0 + dq0;
                        int dpq3 = dp3 + dq3;
                        int dp = dp0 + dp3;
                        int dq = dq0 + dq3;
                        int d = dpq0 + dpq3;

                        int dE = 0, dEp = 0, dEq = 0;
                        if (d < beta) {
                            // §8.7.2.5.6 for line 0
                            int dSam0 = decision_luma_sample(
                                pSamp[0][0], pSamp[3][0], qSamp[0][0], qSamp[3][0],
                                2 * dpq0, beta, tC);
                            // §8.7.2.5.6 for line 3
                            int dSam3 = decision_luma_sample(
                                pSamp[0][1], pSamp[3][1], qSamp[0][1], qSamp[3][1],
                                2 * dpq3, beta, tC);

                            dE = 1;
                            if (dSam0 == 1 && dSam3 == 1) dE = 2;
                            if (dp < ((beta + (beta >> 1)) >> 3)) dEp = 1;
                            if (dq < ((beta + (beta >> 1)) >> 3)) dEq = 1;
                        }

                        // §8.7.2.5.4: Filter all 4 luma lines (only if dE > 0)
                        if (dE > 0)
                        for (int k = 0; k < 4; k++) {
                            int pLine[4], qLine[4];
                            if (edgeType == EDGE_VER) {
                                uint16_t* row = lumaPlane + (yQ + k) * lumaStride;
                                for (int i = 0; i < 4; i++) {
                                    qLine[i] = row[xQ + i];
                                    pLine[i] = row[xQ - i - 1];
                                }
                            } else {
                                for (int i = 0; i < 4; i++) {
                                    qLine[i] = lumaPlane[(yQ + i) * lumaStride + xQ + k];
                                    pLine[i] = lumaPlane[(yQ - i - 1) * lumaStride + xQ + k];
                                }
                            }

                            int nDp, nDq;
                            int pOut[3] = {pLine[0], pLine[1], pLine[2]};
                            int qOut[3] = {qLine[0], qLine[1], qLine[2]};
                            filter_luma_sample(pLine, qLine, dE, dEp, dEq, tC, bitDepthY,
                                               pcmP, pcmQ, bypassP, bypassQ,
                                               pcmFilterDisabled,
                                               &nDp, &nDq, pOut, qOut);

                            // Write back filtered samples
                            if (edgeType == EDGE_VER) {
                                uint16_t* row = lumaPlane + (yQ + k) * lumaStride;
                                for (int i = 0; i < nDp; i++)
                                    row[xQ - i - 1] = static_cast<uint16_t>(pOut[i]);
                                for (int j = 0; j < nDq; j++)
                                    row[xQ + j] = static_cast<uint16_t>(qOut[j]);
                            } else {
                                for (int i = 0; i < nDp; i++)
                                    lumaPlane[(yQ - i - 1) * lumaStride + xQ + k] = static_cast<uint16_t>(pOut[i]);
                                for (int j = 0; j < nDq; j++)
                                    lumaPlane[(yQ + j) * lumaStride + xQ + k] = static_cast<uint16_t>(qOut[j]);
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
                            int QpP = ctx.cu_at(xP, yP).qp_y;
                            int QpQ = ctx.cu_at(xQ, yQ).qp_y;

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
                                uint16_t* cPlane = chromaPlane[cIdx];
                                int cStride = chromaStride[cIdx];
                                for (int k = 0; k < chromaSegs; k++) {
                                    int pC[2], qC[2];
                                    int cx, cy;
                                    if (edgeType == EDGE_VER) {
                                        cx = x / subW;
                                        cy = y / subH + k;
                                        uint16_t* crow = cPlane + cy * cStride;
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
                                        uint16_t* crow = cPlane + cy * cStride;
                                        crow[cx - 1] = static_cast<uint16_t>(p0Out);
                                        crow[cx]     = static_cast<uint16_t>(q0Out);
                                    } else {
                                        cPlane[(cy - 1) * cStride + cx] = static_cast<uint16_t>(p0Out);
                                        cPlane[cy * cStride + cx]       = static_cast<uint16_t>(q0Out);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

} // namespace hevc
