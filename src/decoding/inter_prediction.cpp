#include "decoding/inter_prediction.h"
#include "decoding/coding_tree.h"
#include "decoding/dpb.h"
#include "decoding/syntax_elements.h"
#include "common/debug.h"

#include <algorithm>
#include <cstring>
#include <cstdlib>

namespace hevc {

// ============================================================
// PU motion grid access
// ============================================================

void store_pu_motion(DecodingContext& ctx, int xPb, int yPb,
                     int nPbW, int nPbH, const PUMotionInfo& mi) {
    int minPuSize = kGridSize;
    int stride = ctx.motion_info_stride;
    for (int y = 0; y < nPbH; y += minPuSize) {
        for (int x = 0; x < nPbW; x += minPuSize) {
            int idx = ((yPb + y) / minPuSize) * stride + ((xPb + x) / minPuSize);
            ctx.motion_info[idx] = mi;
        }
    }
}

PUMotionInfo get_pu_motion(const DecodingContext& ctx, int x, int y) {
    int minPuSize = kGridSize;
    int stride = ctx.motion_info_stride;
    int idx = (y / minPuSize) * stride + (x / minPuSize);
    return ctx.motion_info[idx];
}

// ============================================================
// §6.4.2 — Prediction block availability (simplified for inter)
// ============================================================

static bool is_pu_available(const DecodingContext& ctx,
                             int xCb, int yCb, int nCbS,
                             int xPb, int yPb, int nPbW, int nPbH,
                             int xNb, int yNb, int partIdx) {
    int picW = static_cast<int>(ctx.sps->pic_width_in_luma_samples);
    int picH = static_cast<int>(ctx.sps->pic_height_in_luma_samples);
    if (xNb < 0 || yNb < 0 || xNb >= picW || yNb >= picH)
        return false;

    // §6.4.2: Check if neighbor is in the same coding block
    bool sameCb = (xNb >= xCb && xNb < xCb + nCbS &&
                   yNb >= yCb && yNb < yCb + nCbS);

    bool availableN;
    if (!sameCb) {
        // §6.4.2: invoke §6.4.1 z-scan availability
        int ctbSize = static_cast<int>(ctx.sps->CtbSizeY);
        int curCtbX = xPb / ctbSize, curCtbY = yPb / ctbSize;
        int nbCtbX = xNb / ctbSize, nbCtbY = yNb / ctbSize;
        if (nbCtbX != curCtbX || nbCtbY != curCtbY) {
            int nbAddr = nbCtbY * ctx.sps->PicWidthInCtbsY + nbCtbX;
            int curAddr = curCtbY * ctx.sps->PicWidthInCtbsY + curCtbX;
            if (nbAddr > curAddr) return false;
            // §6.4.1: SliceAddrRs must match
            if (ctx.slice_idx && ctx.slice_idx[nbAddr] != ctx.slice_idx[curAddr])
                return false;
            // §6.4.1: TileId must match
            auto& pps = *ctx.pps;
            if (!pps.TileId.empty() &&
                pps.TileId[pps.CtbAddrRsToTs[nbAddr]] != pps.TileId[pps.CtbAddrRsToTs[curAddr]])
                return false;
            availableN = true;
        } else {
            // Same CTU — z-scan check
            int minTb = kGridSize;
            // Z-scan (Morton code): interleave bits of bx and by
            auto zscan = [](int bx, int by) -> uint32_t {
                auto spread = [](uint32_t v) -> uint32_t {
                    v &= 0xFF;
                    v = (v | (v << 8)) & 0x00FF00FF;
                    v = (v | (v << 4)) & 0x0F0F0F0F;
                    v = (v | (v << 2)) & 0x33333333;
                    v = (v | (v << 1)) & 0x55555555;
                    return v;
                };
                return spread(static_cast<uint32_t>(bx)) |
                       (spread(static_cast<uint32_t>(by)) << 1);
            };
            int ctbOrgX = curCtbX * ctbSize, ctbOrgY = curCtbY * ctbSize;
            uint32_t curZ = zscan((xPb - ctbOrgX) / minTb, (yPb - ctbOrgY) / minTb);
            uint32_t nbZ = zscan((xNb - ctbOrgX) / minTb, (yNb - ctbOrgY) / minTb);
            if (nbZ > curZ) return false;
            availableN = true;
        }
    } else {
        // §6.4.2: Same coding block — available unless NxN partition special case
        bool isNxN = (nPbW * 2 == nCbS && nPbH * 2 == nCbS);
        if (isNxN && partIdx == 1 && yNb >= yCb + nPbH && xNb < xCb + nPbW) {
            availableN = false;
        } else {
            availableN = true;
        }
    }

    if (!availableN) return false;

    // §6.4.2: Must not be intra
    if (ctx.cu_at(xNb, yNb).pred_mode == PredMode::MODE_INTRA) return false;
    return true;
}

// ============================================================
// §8.5.3.2.12 — MV scaling (by POC distance)
// ============================================================

static MV scale_mv(MV mv, int currPOC, int currRefPOC, int colPOC, int colRefPOC) {
    // Spec §8.5.3.2.12 eq 8-218 to 8-221
    int td = Clip3(-128, 127, colPOC - colRefPOC);
    int tb = Clip3(-128, 127, currPOC - currRefPOC);

    if (td == 0 || td == tb) return mv;

    // §8.5.3.2.12 eq 8-219: tx = (16384 + (Abs(td) >> 1)) / td
    int tx = (16384 + (std::abs(td) >> 1)) / td;
    // §8.5.3.2.12 eq 8-220: distScaleFactor = Clip3(-4096, 4095, (tb * tx + 32) >> 6)
    int distScaleFactor = Clip3(-4096, 4095, (tb * tx + 32) >> 6);

    MV scaled;
    // §8.5.3.2.9 eq 8-207: Sign(p) * ((Abs(p) + 127) >> 8)
    auto scale_comp = [](int dist, int16_t comp) -> int16_t {
        int product = dist * comp;
        int sign = (product >= 0) ? 1 : -1;
        return static_cast<int16_t>(Clip3(-32768, 32767,
            sign * ((std::abs(product) + 127) >> 8)));
    };
    scaled.x = scale_comp(distScaleFactor, mv.x);
    scaled.y = scale_comp(distScaleFactor, mv.y);
    return scaled;
}

// ============================================================
// §8.5.3.2.8 — Temporal MV prediction (TMVP)
// ============================================================

// §8.5.3.2.9: derive collocated MV from a specific position in colPic
static bool derive_collocated_mv_at(const DecodingContext& ctx,
                                     Picture* colPic, int xCol, int yCol,
                                     int refIdxLX, int listX,
                                     MV& mvLXCol) {
    int minPuSize = kGridSize;
    int xColQ = (xCol >> 4) << 4;
    int yColQ = (yCol >> 4) << 4;
    int miIdx = (yColQ / minPuSize) * colPic->motion_info_stride + (xColQ / minPuSize);
    if (miIdx < 0 || miIdx >= static_cast<int>(colPic->motion_info_buf.size())) return false;
    const auto& colMi = colPic->motion_info_buf[miIdx];

    // §8.5.3.2.9: if colPb is intra → not available
    if (!colMi.pred_flag[0] && !colMi.pred_flag[1]) {
        HEVC_LOG(INTER, "TMVP colQ=(%d,%d) is INTRA", xColQ, yColQ);
        return false;
    }

    // Determine which list to use from collocated PU
    int colList = -1;
    if (colMi.pred_flag[0] && !colMi.pred_flag[1]) {
        colList = 0;
    } else if (!colMi.pred_flag[0] && colMi.pred_flag[1]) {
        colList = 1;
    } else {
        // Both available: §8.5.3.2.9
        bool noBackward = ctx.dpb->no_backward_pred_flag();
        if (noBackward) {
            colList = listX;
        } else {
            colList = ctx.sh->collocated_from_l0_flag;
        }
    }

    if (colList < 0 || !colMi.pred_flag[colList] || colMi.ref_idx[colList] < 0)
        return false;

    // §8.5.3.2.9: refIdxCol indexes the lists of the slice that contains colPb
    int log2Ctb = ctx.sps->CtbLog2SizeY;
    size_t colCtb = static_cast<size_t>((yColQ >> log2Ctb) * ctx.sps->PicWidthInCtbsY +
                                        (xColQ >> log2Ctb));
    if (colCtb >= colPic->ctb_slice_idx.size()) return false;
    size_t colSlice = colPic->ctb_slice_idx[colCtb];
    if (colSlice >= colPic->slice_ref_poc.size()) return false;
    const auto& colSliceRefs = colPic->slice_ref_poc[colSlice];
    const auto& colRefPocs = colSliceRefs.list[colList];
    if (colMi.ref_idx[colList] >= static_cast<int>(colRefPocs.size())) return false;
    const bool colRefIsLongTerm = colSliceRefs.is_long_term[colList][colMi.ref_idx[colList]] != 0;

    MV colMV;
    colMV.x = colMi.mv_x[colList];
    colMV.y = colMi.mv_y[colList];
    int colRefPOC = colRefPocs[colMi.ref_idx[colList]];
    if (colRefPOC == Picture::kNoRefPoc) return false;

    // Scale MV by POC distance
    int currPOC = ctx.pic->poc;
    Picture* currRef = (listX == 0) ? ctx.dpb->ref_pic_list0(refIdxLX)
                                     : ctx.dpb->ref_pic_list1(refIdxLX);
    if (!currRef) return false;
    int currRefPOC = currRef->poc;

    // §8.5.3.2.8: unavailable when exactly one of the two references is
    // long-term; a long-term reference is never scaled
    if (currRef->used_for_long_term_ref != colRefIsLongTerm) return false;
    if (currRef->used_for_long_term_ref) {
        mvLXCol = colMV;
    } else {
        mvLXCol = scale_mv(colMV, currPOC, currRefPOC, colPic->poc, colRefPOC);
    }
    HEVC_LOG(INTER, "TMVP colQ=(%d,%d) colMV=(%d,%d) scaled=(%d,%d) colRefPOC=%d currPOC=%d currRefPOC=%d colPOC=%d",
             xColQ, yColQ, colMV.x, colMV.y, mvLXCol.x, mvLXCol.y, colRefPOC, ctx.pic->poc, currRefPOC, colPic->poc);
    return true;
}

static bool derive_temporal_mv(const DecodingContext& ctx,
                                int xPb, int yPb, int nPbW, int nPbH,
                                int refIdxLX, int listX,
                                MV& mvLXCol) {
    // §8.5.3.2.8: temporal luma motion vector prediction
    if (!ctx.dpb || !ctx.dpb->col_pic()) return false;

    Picture* colPic = ctx.dpb->col_pic();
    int picW = static_cast<int>(ctx.sps->pic_width_in_luma_samples);
    int picH = static_cast<int>(ctx.sps->pic_height_in_luma_samples);
    if (colPic->motion_info_buf.empty() || colPic->motion_info_stride == 0) return false;

    // Step 1: try bottom-right position
    int xColBr = xPb + nPbW;  // eq 8-198
    int yColBr = yPb + nPbH;  // eq 8-199

    bool brValid = (xColBr < picW && yColBr < picH &&
                    (yColBr >> ctx.sps->CtbLog2SizeY) == (yPb >> ctx.sps->CtbLog2SizeY));

    if (brValid) {
        if (derive_collocated_mv_at(ctx, colPic, xColBr, yColBr, refIdxLX, listX, mvLXCol))
            return true;
    }

    // Step 2: if bottom-right unavailable or intra, try center (eq 8-200, 8-201)
    int xColCtr = xPb + (nPbW >> 1);
    int yColCtr = yPb + (nPbH >> 1);
    return derive_collocated_mv_at(ctx, colPic, xColCtr, yColCtr, refIdxLX, listX, mvLXCol);
}

// ============================================================
// §8.5.3.2.3 — Spatial merge candidates
// ============================================================

static void derive_spatial_merge_candidates(
    const DecodingContext& ctx,
    int xCb, int yCb, int nCbS,
    int xPb, int yPb, int nPbW, int nPbH, int partIdx,
    MergeCandidate cands[5], bool avail[5]) {

    // §8.5.3.2.3: Candidate positions
    // A1: (xPb - 1, yPb + nPbH - 1)
    // B1: (xPb + nPbW - 1, yPb - 1)
    // B0: (xPb + nPbW, yPb - 1)
    // A0: (xPb - 1, yPb + nPbH)
    // B2: (xPb - 1, yPb - 1)
    struct { int x, y; } nbPos[5] = {
        { xPb - 1,     yPb + nPbH - 1 },  // A1
        { xPb + nPbW - 1, yPb - 1 },       // B1
        { xPb + nPbW,     yPb - 1 },       // B0
        { xPb - 1,        yPb + nPbH },    // A0
        { xPb - 1,        yPb - 1 },       // B2
    };

    int Log2ParMrgLevel = ctx.pps->log2_parallel_merge_level_minus2 + 2;

    for (int i = 0; i < 5; i++) {
        avail[i] = false;
        cands[i] = {};
    }

    // §8.5.3.2.3: For each candidate, we need BOTH the raw block availability
    // (availableX) and the motion info at that position, because pruning conditions
    // use raw availability, not the filtered availableFlagX.
    bool rawAvail[5] = {};
    PUMotionInfo rawMotion[5] = {};

    // First pass: compute raw availability and motion for all 5 positions
    auto pm = ctx.cu_at(xPb, yPb).part_mode;
    for (int i = 0; i < 5; i++) {
        int xNb = nbPos[i].x;
        int yNb = nbPos[i].y;

        bool available = is_pu_available(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH, xNb, yNb, partIdx);
        if (!available) continue;

        // §8.5.3.2.3: parallel merge level constraint
        if ((xPb >> Log2ParMrgLevel) == (xNb >> Log2ParMrgLevel) &&
            (yPb >> Log2ParMrgLevel) == (yNb >> Log2ParMrgLevel))
            continue;

        // §8.5.3.2.3: partition-specific exclusions
        if (i == 0 && partIdx == 1) { // A1
            if (pm == PartMode::PART_Nx2N || pm == PartMode::PART_nLx2N ||
                pm == PartMode::PART_nRx2N)
                continue;
        }
        if (i == 1 && partIdx == 1) { // B1
            if (pm == PartMode::PART_2NxN || pm == PartMode::PART_2NxnU ||
                pm == PartMode::PART_2NxnD)
                continue;
        }

        rawAvail[i] = true;
        rawMotion[i] = get_pu_motion(ctx, xNb, yNb);
    }

    // Second pass: apply pruning per spec, using rawAvail for conditions
    // Only the lists in use carry motion: the 8x4/4x8 bi-to-uni restriction
    // (§8.5.3.2.2) clears predFlagL1 but leaves a stale mvL1 behind.
    auto same_motion_raw = [](const PUMotionInfo& a, const PUMotionInfo& b) {
        for (int l = 0; l < 2; l++) {
            if (a.pred_flag[l] != b.pred_flag[l]) return false;
            if (a.pred_flag[l] &&
                (a.mv[l].x != b.mv[l].x || a.mv[l].y != b.mv[l].y ||
                 a.ref_idx[l] != b.ref_idx[l]))
                return false;
        }
        return true;
    };

    for (int i = 0; i < 5; i++) {
        if (!rawAvail[i]) continue;

        bool prune = false;
        // §8.5.3.2.3: B1 pruned if availableA1 AND same motion as A1
        if (i == 1 && rawAvail[0]) prune = same_motion_raw(rawMotion[1], rawMotion[0]);
        // §8.5.3.2.3: B0 pruned if availableB1 AND same motion as B1
        if (i == 2 && rawAvail[1]) prune = same_motion_raw(rawMotion[2], rawMotion[1]);
        // §8.5.3.2.3: A0 pruned if availableA1 AND same motion as A1
        if (i == 3 && rawAvail[0]) prune = same_motion_raw(rawMotion[3], rawMotion[0]);
        // §8.5.3.2.3: B2 pruned if availableA1 AND same motion as A1,
        //             OR availableB1 AND same motion as B1
        if (i == 4) {
            // B2 only checked if < 4 candidates so far
            int cnt = 0;
            for (int k = 0; k < 4; k++) if (avail[k]) cnt++;
            if (cnt >= 4) { continue; }
            if (rawAvail[0]) prune = same_motion_raw(rawMotion[4], rawMotion[0]);
            if (!prune && rawAvail[1]) prune = same_motion_raw(rawMotion[4], rawMotion[1]);
        }

        if (prune) continue;

        avail[i] = true;
        cands[i].mv[0] = rawMotion[i].mv[0];
        cands[i].mv[1] = rawMotion[i].mv[1];
        cands[i].ref_idx[0] = rawMotion[i].ref_idx[0];
        cands[i].ref_idx[1] = rawMotion[i].ref_idx[1];
        cands[i].pred_flag[0] = rawMotion[i].pred_flag[0];
        cands[i].pred_flag[1] = rawMotion[i].pred_flag[1];
    }
}

// ============================================================
// §8.5.3.2.2 — Merge mode: build candidate list + select
// ============================================================

static PUMotionInfo derive_merge_mode(DecodingContext& ctx,
                                       int xCb, int yCb, int nCbS,
                                       int xPb, int yPb, int nPbW, int nPbH,
                                       int partIdx, int mergeIdx) {
    auto& sh = *ctx.sh;
    // §8.5.3.2.2: the 8x4/4x8 restriction below reads the PU's own size,
    // nOrigPbW and nOrigPbH, not the shared 8x8 one set just after
    const int nOrigPbW = nPbW, nOrigPbH = nPbH;
    // §8.5.3.2.2 eq 8-110..8-113: Log2ParMrgLevel override for 8x8 CU
    int Log2ParMrgLevel = ctx.pps->log2_parallel_merge_level_minus2 + 2;
    if (Log2ParMrgLevel > 2 && nCbS == 8) {
        xPb = xCb;
        yPb = yCb;
        nPbW = nCbS;
        nPbH = nCbS;
        partIdx = 0;
    }
    int MaxNumMergeCand = sh.MaxNumMergeCand;

    // Build merge candidate list — fixed-size array (max 5 candidates per spec)
    MergeCandidate mergeCandList[5];
    int numCands = 0;

    // Step 1: Spatial candidates (§8.5.3.2.3)
    MergeCandidate spatialCands[5];
    bool spatialAvail[5];
    derive_spatial_merge_candidates(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH,
                                     partIdx, spatialCands, spatialAvail);

    // §8.5.3.2.2 eq 8-119: add in order A1, B1, B0, A0, B2
    for (int i = 0; i < 5 && numCands < MaxNumMergeCand; i++) {
        if (spatialAvail[i])
            mergeCandList[numCands++] = spatialCands[i];
    }

    // Step 2-4: Temporal candidate (§8.5.3.2.8)
    if (numCands < MaxNumMergeCand && sh.slice_temporal_mvp_enabled_flag) {
        MergeCandidate colCand = {};
        MV mvL0Col = {};
        bool availL0 = derive_temporal_mv(ctx, xPb, yPb, nPbW, nPbH, 0, 0, mvL0Col);
        if (availL0) {
            colCand.mv[0] = mvL0Col;
            colCand.ref_idx[0] = 0;
            colCand.pred_flag[0] = true;
        }
        if (sh.slice_type == SliceType::B) {
            MV mvL1Col = {};
            bool availL1 = derive_temporal_mv(ctx, xPb, yPb, nPbW, nPbH, 0, 1, mvL1Col);
            if (availL1) {
                colCand.mv[1] = mvL1Col;
                colCand.ref_idx[1] = 0;
                colCand.pred_flag[1] = true;
            }
        }
        if (colCand.pred_flag[0] || colCand.pred_flag[1])
            mergeCandList[numCands++] = colCand;
    }

    // Step 7: Combined bi-pred candidates (§8.5.3.2.4) — B slices only
    if (sh.slice_type == SliceType::B) {
        int numOrigMergeCand = numCands;
        if (numOrigMergeCand > 1 && numOrigMergeCand < MaxNumMergeCand) {
            // Table 8-7
            static const int l0Idx[] = {0,1,0,2,1,2,0,3,1,3,2,3};
            static const int l1Idx[] = {1,0,2,0,2,1,3,0,3,1,3,2};
            for (int combIdx = 0;
                 combIdx < numOrigMergeCand * (numOrigMergeCand - 1) &&
                 numCands < MaxNumMergeCand;
                 combIdx++) {
                int l0 = l0Idx[combIdx];
                int l1 = l1Idx[combIdx];
                if (l0 >= numOrigMergeCand || l1 >= numOrigMergeCand) continue;
                auto& c0 = mergeCandList[l0];
                auto& c1 = mergeCandList[l1];
                if (c0.pred_flag[0] && c1.pred_flag[1]) {
                    // §8.5.3.2.4: check different ref or different MV
                    Picture* ref0 = ctx.dpb->ref_pic_list0(c0.ref_idx[0]);
                    Picture* ref1 = ctx.dpb->ref_pic_list1(c1.ref_idx[1]);
                    if (ref0 != ref1 ||
                        c0.mv[0].x != c1.mv[1].x || c0.mv[0].y != c1.mv[1].y) {
                        MergeCandidate& comb = mergeCandList[numCands++];
                        comb = {};
                        comb.mv[0] = c0.mv[0];
                        comb.ref_idx[0] = c0.ref_idx[0];
                        comb.pred_flag[0] = true;
                        comb.mv[1] = c1.mv[1];
                        comb.ref_idx[1] = c1.ref_idx[1];
                        comb.pred_flag[1] = true;
                    }
                }
            }
        }
    }

    // Step 8: Zero motion vector candidates (§8.5.3.2.5)
    {
        int numRefIdx;
        if (sh.slice_type == SliceType::P)
            numRefIdx = sh.num_ref_idx_l0_active_minus1 + 1;
        else
            numRefIdx = std::min(static_cast<int>(sh.num_ref_idx_l0_active_minus1 + 1),
                                  static_cast<int>(sh.num_ref_idx_l1_active_minus1 + 1));
        int zeroIdx = 0;
        while (numCands < MaxNumMergeCand) {
            MergeCandidate& zero = mergeCandList[numCands++];
            zero = {};
            zero.ref_idx[0] = (zeroIdx < numRefIdx) ? zeroIdx : 0;
            zero.pred_flag[0] = true;
            zero.mv[0] = {0, 0};
            if (sh.slice_type == SliceType::B) {
                zero.ref_idx[1] = (zeroIdx < numRefIdx) ? zeroIdx : 0;
                zero.pred_flag[1] = true;
                zero.mv[1] = {0, 0};
            }
            zeroIdx++;
        }
    }

    // Step 9: Select the merge candidate (§8.5.3.2.2 eq 8-120 to 8-125)
    auto& sel = mergeCandList[mergeIdx];
    PUMotionInfo result;
    result.mv[0] = sel.mv[0];
    result.mv[1] = sel.mv[1];
    result.ref_idx[0] = sel.ref_idx[0];
    result.ref_idx[1] = sel.ref_idx[1];
    result.pred_flag[0] = sel.pred_flag[0];
    result.pred_flag[1] = sel.pred_flag[1];

    // §8.5.3.2.2 step 10: bi-pred restriction for small PUs
    if (result.pred_flag[0] && result.pred_flag[1] && (nOrigPbW + nOrigPbH) == 12) {
        result.ref_idx[1] = -1;
        result.pred_flag[1] = false;
    }

    return result;
}

// ============================================================
// §8.5.3.2.6 — AMVP mode (MV prediction + MVD)
// ============================================================

// §6.4.2 availability check for AMVP neighbor positions
// §6.4.2 — Availability derivation process for a prediction block
static bool is_amvp_nb_available(const DecodingContext& ctx,
                                  int xCb, int yCb, int nCbS,
                                  int xPb, int yPb, int nPbW, int nPbH,
                                  int xNb, int yNb, int partIdx) {
    int picW = static_cast<int>(ctx.sps->pic_width_in_luma_samples);
    int picH = static_cast<int>(ctx.sps->pic_height_in_luma_samples);
    if (xNb < 0 || yNb < 0 || xNb >= picW || yNb >= picH) return false;

    // §6.4.2: Check if neighbor is in the same coding block
    bool sameCb = (xNb >= xCb && xNb < xCb + nCbS &&
                   yNb >= yCb && yNb < yCb + nCbS);

    bool availableN;
    if (!sameCb) {
        // §6.4.1 z-scan availability
        int ctbSize = static_cast<int>(ctx.sps->CtbSizeY);
        int curCtbX = xPb / ctbSize, curCtbY = yPb / ctbSize;
        int nbCtbX = xNb / ctbSize, nbCtbY = yNb / ctbSize;
        if (nbCtbX != curCtbX || nbCtbY != curCtbY) {
            int nbAddr = nbCtbY * ctx.sps->PicWidthInCtbsY + nbCtbX;
            int curAddr = curCtbY * ctx.sps->PicWidthInCtbsY + curCtbX;
            if (nbAddr > curAddr) return false;
            // §6.4.1: SliceAddrRs must match
            if (ctx.slice_idx && ctx.slice_idx[nbAddr] != ctx.slice_idx[curAddr])
                return false;
            // §6.4.1: TileId must match
            auto& pps = *ctx.pps;
            if (!pps.TileId.empty() &&
                pps.TileId[pps.CtbAddrRsToTs[nbAddr]] != pps.TileId[pps.CtbAddrRsToTs[curAddr]])
                return false;
            availableN = true;
        } else {
            // Same CTU — z-scan check
            int minTb = kGridSize;
            // Z-scan (Morton code): interleave bits of bx and by
            auto zscan = [](int bx, int by) -> uint32_t {
                auto spread = [](uint32_t v) -> uint32_t {
                    v &= 0xFF;
                    v = (v | (v << 8)) & 0x00FF00FF;
                    v = (v | (v << 4)) & 0x0F0F0F0F;
                    v = (v | (v << 2)) & 0x33333333;
                    v = (v | (v << 1)) & 0x55555555;
                    return v;
                };
                return spread(static_cast<uint32_t>(bx)) |
                       (spread(static_cast<uint32_t>(by)) << 1);
            };
            int ctbOrgX = curCtbX * ctbSize, ctbOrgY = curCtbY * ctbSize;
            uint32_t curZ = zscan((xPb - ctbOrgX) / minTb, (yPb - ctbOrgY) / minTb);
            uint32_t nbZ = zscan((xNb - ctbOrgX) / minTb, (yNb - ctbOrgY) / minTb);
            if (nbZ > curZ) return false;
            availableN = true;
        }
    } else {
        // §6.4.2: Same coding block — available unless NxN partition special case
        // When partIdx==1 in NxN partition, the second PU cannot reference the
        // motion data of the third PU (which is below-left in z-scan)
        bool isNxN = (nPbW * 2 == nCbS && nPbH * 2 == nCbS);
        if (isNxN && partIdx == 1 && yNb >= yCb + nPbH && xNb < xCb + nPbW) {
            availableN = false;
        } else {
            availableN = true;
        }
    }

    if (!availableN) return false;

    // Must not be intra
    if (ctx.cu_at(xNb, yNb).pred_mode == PredMode::MODE_INTRA) return false;
    return true;
}

// §8.5.3.2.7 — Derivation process for motion vector predictor candidates
static MV derive_amvp_predictor(const DecodingContext& ctx,
                                 int xCb, int yCb, int nCbS,
                                 int xPb, int yPb, int nPbW, int nPbH,
                                 int refIdxLX, int listX, int partIdx,
                                 int mvpFlag) {
    int X = listX;
    int Y = 1 - X;
    Picture* currRef = (X == 0) ? ctx.dpb->ref_pic_list0(refIdxLX)
                                 : ctx.dpb->ref_pic_list1(refIdxLX);
    int currRefPOC = currRef ? currRef->poc : 0;
    int currPOC = ctx.pic->poc;

    // §8.5.3.2.7 step 1: positions
    int xNbA0 = xPb - 1,         yNbA0 = yPb + nPbH;
    int xNbA1 = xPb - 1,         yNbA1 = yPb + nPbH - 1;
    int xNbB0 = xPb + nPbW,      yNbB0 = yPb - 1;
    int xNbB1 = xPb + nPbW - 1,  yNbB1 = yPb - 1;
    int xNbB2 = xPb - 1,         yNbB2 = yPb - 1;

    // §8.5.3.2.7 step 2: init
    MV mvLXA = {}, mvLXB = {};
    bool availFlagA = false, availFlagB = false;
    bool isScaledFlagLX = false;

    // §8.5.3.2.7 steps 3-4: check A0, A1 availability
    bool availableA0 = is_amvp_nb_available(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH, xNbA0, yNbA0, partIdx);
    bool availableA1 = is_amvp_nb_available(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH, xNbA1, yNbA1, partIdx);

    // §8.5.3.2.7 step 5: isScaledFlagLX
    if (availableA0 || availableA1)
        isScaledFlagLX = true;

    // §8.5.3.2.7 step 6: A group — same POC match (no scaling)
    int aPos[][2] = {{xNbA0, yNbA0}, {xNbA1, yNbA1}};
    bool aAvail[] = {availableA0, availableA1};
    for (int k = 0; k < 2 && !availFlagA; k++) {
        if (!aAvail[k]) continue;
        PUMotionInfo mi = get_pu_motion(ctx, aPos[k][0], aPos[k][1]);
        // Try same list X first, then other list Y
        if (mi.pred_flag[X]) {
            Picture* nbRef = (X == 0) ? ctx.dpb->ref_pic_list0(mi.ref_idx[X])
                                       : ctx.dpb->ref_pic_list1(mi.ref_idx[X]);
            if (nbRef && nbRef->poc == currRefPOC) {
                mvLXA = mi.mv[X];   // eq 8-171
                availFlagA = true;
                continue;
            }
        }
        if (mi.pred_flag[Y]) {
            Picture* nbRef = (Y == 0) ? ctx.dpb->ref_pic_list0(mi.ref_idx[Y])
                                       : ctx.dpb->ref_pic_list1(mi.ref_idx[Y]);
            if (nbRef && nbRef->poc == currRefPOC) {
                mvLXA = mi.mv[Y];   // eq 8-172
                availFlagA = true;
            }
        }
    }

    // §8.5.3.2.7 step 7: A group — scaling pass (only if step 6 failed)
    if (!availFlagA) {
        for (int k = 0; k < 2 && !availFlagA; k++) {
            if (!aAvail[k]) continue;
            PUMotionInfo mi = get_pu_motion(ctx, aPos[k][0], aPos[k][1]);
            for (int l = 0; l < 2 && !availFlagA; l++) {
                int tryL = (l == 0) ? X : Y;
                if (!mi.pred_flag[tryL]) continue;
                Picture* nbRef = (tryL == 0) ? ctx.dpb->ref_pic_list0(mi.ref_idx[tryL])
                                              : ctx.dpb->ref_pic_list1(mi.ref_idx[tryL]);
                if (!nbRef) continue;
                if (nbRef->used_for_long_term_ref != (currRef && currRef->used_for_long_term_ref))
                    continue;
                availFlagA = true;
                if (nbRef->poc != currRefPOC && nbRef->used_for_short_term_ref &&
                    currRef && currRef->used_for_short_term_ref) {
                    mvLXA = scale_mv(mi.mv[tryL], currPOC, currRefPOC,
                                      currPOC, nbRef->poc);
                } else {
                    mvLXA = mi.mv[tryL];
                }
            }
        }
    }

    // §8.5.3.2.7 B group step 3: B0, B1, B2 — same POC match (no scaling)
    int bPos[][2] = {{xNbB0, yNbB0}, {xNbB1, yNbB1}, {xNbB2, yNbB2}};
    bool bAvailArr[3];
    for (int k = 0; k < 3; k++)
        bAvailArr[k] = is_amvp_nb_available(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH, bPos[k][0], bPos[k][1], partIdx);

    for (int k = 0; k < 3 && !availFlagB; k++) {
        if (!bAvailArr[k]) continue;
        PUMotionInfo mi = get_pu_motion(ctx, bPos[k][0], bPos[k][1]);
        if (mi.pred_flag[X]) {
            Picture* nbRef = (X == 0) ? ctx.dpb->ref_pic_list0(mi.ref_idx[X])
                                       : ctx.dpb->ref_pic_list1(mi.ref_idx[X]);
            if (nbRef && nbRef->poc == currRefPOC) {
                mvLXB = mi.mv[X];   // eq 8-184
                availFlagB = true;
                continue;
            }
        }
        if (mi.pred_flag[Y]) {
            Picture* nbRef = (Y == 0) ? ctx.dpb->ref_pic_list0(mi.ref_idx[Y])
                                       : ctx.dpb->ref_pic_list1(mi.ref_idx[Y]);
            if (nbRef && nbRef->poc == currRefPOC) {
                mvLXB = mi.mv[Y];   // eq 8-185
                availFlagB = true;
            }
        }
    }

    // §8.5.3.2.7 step 4: when isScaledFlagLX == 0 and B found, copy B→A
    if (!isScaledFlagLX && availFlagB) {
        availFlagA = true;
        mvLXA = mvLXB;  // eq 8-186
    }

    // §8.5.3.2.7 step 5: B group scaling — ONLY when isScaledFlagLX == 0
    if (!isScaledFlagLX) {
        availFlagB = false;
        for (int k = 0; k < 3 && !availFlagB; k++) {
            if (!bAvailArr[k]) continue;
            PUMotionInfo mi = get_pu_motion(ctx, bPos[k][0], bPos[k][1]);
            for (int l = 0; l < 2 && !availFlagB; l++) {
                int tryL = (l == 0) ? X : Y;
                if (!mi.pred_flag[tryL]) continue;
                Picture* nbRef = (tryL == 0) ? ctx.dpb->ref_pic_list0(mi.ref_idx[tryL])
                                              : ctx.dpb->ref_pic_list1(mi.ref_idx[tryL]);
                if (!nbRef) continue;
                if (nbRef->used_for_long_term_ref != (currRef && currRef->used_for_long_term_ref))
                    continue;
                availFlagB = true;
                if (nbRef->poc != currRefPOC && nbRef->used_for_short_term_ref &&
                    currRef && currRef->used_for_short_term_ref) {
                    mvLXB = scale_mv(mi.mv[tryL], currPOC, currRefPOC,
                                      currPOC, nbRef->poc);
                } else {
                    mvLXB = mi.mv[tryL];
                }
            }
        }
    }

    // §8.5.3.2.6 step 2: temporal candidate
    bool availFlagCol = false;
    // §8.5.3.2.6 step 2: temporal MV derivation
    // Skip temporal ONLY when both A and B are available AND they differ.
    // When A==B or either is unavailable, temporal IS derived.
    MV mvCol = {};
    if (availFlagA && availFlagB && (mvLXA.x != mvLXB.x || mvLXA.y != mvLXB.y)) {
        availFlagCol = false;
    } else {
        if (ctx.sh->slice_temporal_mvp_enabled_flag)
            availFlagCol = derive_temporal_mv(ctx, xPb, yPb, nPbW, nPbH, refIdxLX, listX, mvCol);
    }

    // §8.5.3.2.6 step 3: Build AMVP list (eq 8-170)
    MV mvpList[2] = {};
    int numMvp = 0;

    if (availFlagA) {
        mvpList[numMvp++] = mvLXA;
        if (availFlagB && (mvLXA.x != mvLXB.x || mvLXA.y != mvLXB.y))
            mvpList[numMvp++] = mvLXB;
    } else if (availFlagB) {
        mvpList[numMvp++] = mvLXB;
    }
    if (numMvp < 2 && availFlagCol)
        mvpList[numMvp++] = mvCol;
    while (numMvp < 2) {
        mvpList[numMvp] = {0, 0};
        numMvp++;
    }

    return mvpList[mvpFlag];
}

// ============================================================
// §7.3.8.6 — prediction_unit (inter) parsing
// ============================================================

void decode_prediction_unit_inter(DecodingContext& ctx,
                                   int xCb, int yCb, int nCbS,
                                   int xPb, int yPb, int nPbW, int nPbH,
                                   int partIdx) {
    auto& cabac = *ctx.cabac;
    auto& sh = *ctx.sh;
    auto& cu = ctx.cu_at(xPb, yPb);
    PUMotionInfo result;

    if (cu.pred_mode == PredMode::MODE_SKIP) {
        // §7.3.8.6: cu_skip → merge mode
        int mergeIdx = 0;
        if (sh.MaxNumMergeCand > 1)
            mergeIdx = decode_merge_idx(cabac, sh.MaxNumMergeCand);

        // Store merge_flag for rqt_root_cbf condition
        ctx.cu_at(xPb, yPb).merge_flag = true;

        result = derive_merge_mode(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH,
                                    partIdx, mergeIdx);
    } else {
        // §7.3.8.6: MODE_INTER — check merge_flag
        bool merge_flag = decode_merge_flag(cabac);
        ctx.cu_at(xPb, yPb).merge_flag = merge_flag;

        if (merge_flag) {
            int mergeIdx = 0;
            if (sh.MaxNumMergeCand > 1)
                mergeIdx = decode_merge_idx(cabac, sh.MaxNumMergeCand);

            HEVC_LOG(INTER, "PU (%d,%d) MERGE idx=%d", xPb, yPb, mergeIdx);
            result = derive_merge_mode(ctx, xCb, yCb, nCbS, xPb, yPb, nPbW, nPbH,
                                        partIdx, mergeIdx);
        } else {
            // AMVP mode
            int inter_pred_idc = 0;  // 0=PRED_L0, 1=PRED_L1, 2=PRED_BI
            if (sh.slice_type == SliceType::B) {
                // §9.3.4.2.3 Table 9-48: ctxInc for inter_pred_idc binIdx=0
                // is CtDepth[x0][y0] = CtbLog2SizeY - log2CbSize
                int log2CbSize = 0;
                { int s = nCbS; while (s > 1) { s >>= 1; log2CbSize++; } }
                int ctDepth = ctx.sps->CtbLog2SizeY - log2CbSize;
                inter_pred_idc = decode_inter_pred_idc(cabac, nPbW, nPbH, ctDepth);
            }

            // L0
            if (inter_pred_idc != 1) {  // PRED_L0 or PRED_BI
                int refIdxL0 = 0;
                if (sh.num_ref_idx_l0_active_minus1 > 0)
                    refIdxL0 = decode_ref_idx(cabac, sh.num_ref_idx_l0_active_minus1);

                MV mvdL0 = decode_mvd(cabac);
                int mvpL0Flag = decode_mvp_flag(cabac);

                MV mvpL0 = derive_amvp_predictor(ctx, xCb, yCb, nCbS, xPb, yPb,
                                                   nPbW, nPbH, refIdxL0, 0, partIdx, mvpL0Flag);
                HEVC_LOG(INTER, "PU (%d,%d) AMVP L0 mvd=(%d,%d) mvp=(%d,%d) flag=%d ref=%d",
                         xPb, yPb, mvdL0.x, mvdL0.y, mvpL0.x, mvpL0.y, mvpL0Flag, refIdxL0);

                // §8.5.3.2.1 eq 8-94..8-97: modular 16-bit MV addition
                result.mv[0].x = static_cast<int16_t>((mvpL0.x + mvdL0.x + 0x10000) % 0x10000);
                result.mv[0].y = static_cast<int16_t>((mvpL0.y + mvdL0.y + 0x10000) % 0x10000);
                result.ref_idx[0] = refIdxL0;
                result.pred_flag[0] = true;
            }

            // L1
            if (inter_pred_idc != 0) {  // PRED_L1 or PRED_BI
                int refIdxL1 = 0;
                if (sh.num_ref_idx_l1_active_minus1 > 0)
                    refIdxL1 = decode_ref_idx(cabac, sh.num_ref_idx_l1_active_minus1);

                MV mvdL1 = {};
                if (sh.mvd_l1_zero_flag && inter_pred_idc == 2) {
                    // §7.3.8.6: MvdL1 = 0 when mvd_l1_zero_flag and PRED_BI
                } else {
                    mvdL1 = decode_mvd(cabac);
                }

                int mvpL1Flag = decode_mvp_flag(cabac);

                MV mvpL1 = derive_amvp_predictor(ctx, xCb, yCb, nCbS, xPb, yPb,
                                                   nPbW, nPbH, refIdxL1, 1, partIdx, mvpL1Flag);

                result.mv[1].x = static_cast<int16_t>((mvpL1.x + mvdL1.x + 0x10000) % 0x10000);
                result.mv[1].y = static_cast<int16_t>((mvpL1.y + mvdL1.y + 0x10000) % 0x10000);
                result.ref_idx[1] = refIdxL1;
                result.pred_flag[1] = true;
            }
        }
    }

    // Store MV info in the motion grid
    store_pu_motion(ctx, xPb, yPb, nPbW, nPbH, result);

    HEVC_LOG(INTER, "PU (%d,%d) %dx%d: L0[%d]=(%d,%d) L1[%d]=(%d,%d) pf=%d%d",
             xPb, yPb, nPbW, nPbH,
             result.ref_idx[0], result.mv[0].x, result.mv[0].y,
             result.ref_idx[1], result.mv[1].x, result.mv[1].y,
             result.pred_flag[0], result.pred_flag[1]);
}

} // namespace hevc
