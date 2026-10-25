#include "decoding/residual_coding.h"
#include "decoding/coding_tree.h"
#include "decoding/syntax_elements.h"
#include "decoding/cabac_tables.h"
#include "common/debug.h"

#include <algorithm>
#include <cstring>

namespace hevc {

// ============================================================
// Scan order generation
// ============================================================

// Pre-computed horizontal/vertical sub-block scan tables
// (diagonal scans are in cabac_tables.h: diag_scan_2x2, 4x4, 8x8)
static const uint8_t horiz_sb_2x2[4][2] = {{0,0},{1,0},{0,1},{1,1}};
static const uint8_t horiz_sb_4x4[16][2] = {
    {0,0},{1,0},{2,0},{3,0},{0,1},{1,1},{2,1},{3,1},
    {0,2},{1,2},{2,2},{3,2},{0,3},{1,3},{2,3},{3,3}
};
static const uint8_t horiz_sb_8x8[64][2] = {
    {0,0},{1,0},{2,0},{3,0},{4,0},{5,0},{6,0},{7,0},
    {0,1},{1,1},{2,1},{3,1},{4,1},{5,1},{6,1},{7,1},
    {0,2},{1,2},{2,2},{3,2},{4,2},{5,2},{6,2},{7,2},
    {0,3},{1,3},{2,3},{3,3},{4,3},{5,3},{6,3},{7,3},
    {0,4},{1,4},{2,4},{3,4},{4,4},{5,4},{6,4},{7,4},
    {0,5},{1,5},{2,5},{3,5},{4,5},{5,5},{6,5},{7,5},
    {0,6},{1,6},{2,6},{3,6},{4,6},{5,6},{6,6},{7,6},
    {0,7},{1,7},{2,7},{3,7},{4,7},{5,7},{6,7},{7,7}
};
static const uint8_t vert_sb_2x2[4][2] = {{0,0},{0,1},{1,0},{1,1}};
static const uint8_t vert_sb_4x4[16][2] = {
    {0,0},{0,1},{0,2},{0,3},{1,0},{1,1},{1,2},{1,3},
    {2,0},{2,1},{2,2},{2,3},{3,0},{3,1},{3,2},{3,3}
};
static const uint8_t vert_sb_8x8[64][2] = {
    {0,0},{0,1},{0,2},{0,3},{0,4},{0,5},{0,6},{0,7},
    {1,0},{1,1},{1,2},{1,3},{1,4},{1,5},{1,6},{1,7},
    {2,0},{2,1},{2,2},{2,3},{2,4},{2,5},{2,6},{2,7},
    {3,0},{3,1},{3,2},{3,3},{3,4},{3,5},{3,6},{3,7},
    {4,0},{4,1},{4,2},{4,3},{4,4},{4,5},{4,6},{4,7},
    {5,0},{5,1},{5,2},{5,3},{5,4},{5,5},{5,6},{5,7},
    {6,0},{6,1},{6,2},{6,3},{6,4},{6,5},{6,6},{6,7},
    {7,0},{7,1},{7,2},{7,3},{7,4},{7,5},{7,6},{7,7}
};
static const uint8_t diag_scan_1x1[1][2] = {{0,0}};

// Return pointer to sub-block scan table (no copy)
static const uint8_t (*get_sub_block_scan(int log2TrafoSize, int scanIdx))[2] {
    int sbSize = (1 << log2TrafoSize) >> 2;
    if (sbSize <= 0) sbSize = 1;

    if (scanIdx == 1) {
        if (sbSize <= 1) return diag_scan_1x1;
        if (sbSize == 2) return horiz_sb_2x2;
        if (sbSize == 4) return horiz_sb_4x4;
        return horiz_sb_8x8;
    } else if (scanIdx == 2) {
        if (sbSize <= 1) return diag_scan_1x1;
        if (sbSize == 2) return vert_sb_2x2;
        if (sbSize == 4) return vert_sb_4x4;
        return vert_sb_8x8;
    } else {
        if (sbSize <= 1) return diag_scan_1x1;
        if (sbSize == 2) return diag_scan_2x2;
        if (sbSize == 4) return diag_scan_4x4;
        return diag_scan_8x8;
    }
}

// Return pointer to coefficient scan table (no copy)
static const uint8_t (*get_coeff_scan(int scanIdx))[2] {
    if (scanIdx == 1) return horiz_scan_4x4;
    if (scanIdx == 2) return vert_scan_4x4;
    return diag_scan_4x4;
}

// Derive scan index from intra mode and TU size (§8.4.4.2.1)
// §7.4.9.11 — scanIdx derivation
// scanIdx: 0=up-right diagonal, 1=horizontal, 2=vertical
static int derive_scan_idx(int predModeIntra, bool modeDependent) {
    if (modeDependent) {
        if (predModeIntra >= 6 && predModeIntra <= 14)
            return 2; // vertical scan
        if (predModeIntra >= 22 && predModeIntra <= 30)
            return 1; // horizontal scan
    }
    return 0; // diagonal
}

// ============================================================
// sig_coeff_flag context derivation (§9.3.4.2.8)
// This is the most complex context derivation in HEVC CABAC
// ============================================================

// §9.3.4.2.5 — Derivation process of ctxInc for sig_coeff_flag
// Transcription directe des eq 9-40 à 9-55 de la spec.
// Note: eq 9-55 donne ctxInc = 27 + sigCtx pour chroma, mais les init values
// Table 9-29 sont organisées avec 28 luma contexts (offset chroma = 28).
// On utilise 28 (layout HM) pour matcher les init values. Voir LEARNINGS.md.
//
// Everything but the position inside the sub-block is constant across a
// sub-block, so the derivation is split: SigCtxSubBlock holds what eq 9-43 to
// 9-55 take from the TU and the neighbouring sub-blocks, sig_ctx() adds the
// position. eq 9-40 (transform skip / bypass) is not handled, as before.

// Table 9-50 — spec has only 15 entries (i=0..14), position 15 is never accessed
// (it's always lastScanPos which is implicitly significant). 99 = sentinel.
static const uint8_t ctxIdxMap[16] = {
    0, 1, 4, 5, 2, 3, 4, 5, 6, 6, 8, 8, 7, 7, 8, 99
};

// eq 9-45 to 9-48, indexed by prevCsbf then (yP << 2) + xP
static const uint8_t sig_ctx_pattern[4][16] = {
    {2, 1, 1, 0,  1, 1, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0},  // prevCsbf 0: xP + yP
    {2, 2, 2, 2,  1, 1, 1, 1,  0, 0, 0, 0,  0, 0, 0, 0},  // prevCsbf 1: yP
    {2, 1, 0, 0,  2, 1, 0, 0,  2, 1, 0, 0,  2, 1, 0, 0},  // prevCsbf 2: xP
    {2, 2, 2, 2,  2, 2, 2, 2,  2, 2, 2, 2,  2, 2, 2, 2},  // prevCsbf 3
};

struct SigCtxSubBlock {
    const uint8_t* pattern;  // sig_ctx_pattern row, or ctxIdxMap for a 4x4 TU
    int offset;              // eq 9-49 to 9-53, plus 27 for chroma (eq 9-55)
    int dc_ctx;              // eq 9-42 at (0,0) of a non-4x4 TU, else -1
};

static SigCtxSubBlock sig_ctx_sub_block(int cIdx, int log2TrafoSize, int xS, int yS,
                                        int scanIdx, const int coded_sub_block_flag[],
                                        int numSbPerSide) {
    const int chroma = (cIdx == 0) ? 0 : 27;                     // eq 9-54, 9-55
    if (log2TrafoSize == 2)                                      // eq 9-41
        return {ctxIdxMap, chroma, -1};

    int prevCsbf = 0;                                            // eq 9-43, 9-44
    if (xS < numSbPerSide - 1)
        prevCsbf += coded_sub_block_flag[yS * numSbPerSide + (xS + 1)];
    if (yS < numSbPerSide - 1)
        prevCsbf += coded_sub_block_flag[(yS + 1) * numSbPerSide + xS] << 1;

    int offset;
    if (cIdx == 0) {
        offset = ((xS + yS) > 0) ? 3 : 0;                        // eq 9-49
        if (log2TrafoSize == 3)
            offset += (scanIdx == 0) ? 9 : 15;                   // eq 9-50
        else
            offset += 21;                                        // eq 9-51
    } else {
        offset = (log2TrafoSize == 3) ? 9 : 12;                  // eq 9-52, 9-53
    }
    const int dc_ctx = (xS == 0 && yS == 0) ? chroma : -1;       // eq 9-42
    return {sig_ctx_pattern[prevCsbf], offset + chroma, dc_ctx};
}

// xP, yP: the position inside the sub-block
static inline int sig_ctx(const SigCtxSubBlock& sb, int xP, int yP) {
    if (sb.dc_ctx >= 0 && (xP | yP) == 0) return sb.dc_ctx;
    return sb.offset + sb.pattern[(yP << 2) + xP];
}

// ============================================================
// residual_coding (§7.3.8.11)
// ============================================================

CoeffExtent decode_residual_coding(DecodingContext& ctx, int x0, int y0,
                                   int log2TrafoSize, int cIdx,
                                   int16_t* coefficients) {
    CoeffExtent extent;
    auto& cabac = *ctx.cabac;
    int trSize = 1 << log2TrafoSize;
    std::memset(coefficients, 0, sizeof(int16_t) * trSize * trSize);

    // §7.4.9.11 — scanIdx derivation
    auto& cu = ctx.cu_at(x0, y0);
    int scanIdx = 0;
    if (cu.pred_mode == PredMode::MODE_INTRA &&
        (log2TrafoSize == 2 ||
         (log2TrafoSize == 3 && cIdx == 0) ||
         (log2TrafoSize == 3 && ctx.sps->ChromaArrayType == 3))) {
        int predModeIntra = (cIdx == 0) ? ctx.intra_mode_at(x0, y0)
                                        : ctx.chroma_mode_at(x0, y0);
        scanIdx = derive_scan_idx(predModeIntra, true);
    }

    [[maybe_unused]] int bins_start = cabac.bin_count();
    HEVC_LOG(CABAC, "residual_coding (%d,%d) log2=%d cIdx=%d scanIdx=%d bins_at=%d",
             x0, y0, log2TrafoSize, cIdx, scanIdx, bins_start);

    // Last significant coefficient position
    // §7.3.8.11: For vertical scan, swap width/height for context derivation,
    // then swap the decoded X/Y coordinates back
    int log2W = log2TrafoSize, log2H = log2TrafoSize;
    if (scanIdx == 2) std::swap(log2W, log2H); // vertical scan: swap dimensions

    int lastSigCoeffXPrefix = decode_last_sig_coeff_prefix(cabac, CTX_LAST_SIG_COEFF_X,
                                                            cIdx, log2W);
    int lastSigCoeffYPrefix = decode_last_sig_coeff_prefix(cabac, CTX_LAST_SIG_COEFF_Y,
                                                            cIdx, log2H);

    int LastSignificantCoeffX = lastSigCoeffXPrefix;
    int LastSignificantCoeffY = lastSigCoeffYPrefix;

    if (lastSigCoeffXPrefix > 3) {
        int suffix = decode_last_sig_coeff_suffix(cabac, lastSigCoeffXPrefix);
        int base = ((lastSigCoeffXPrefix >> 1) - 1);
        LastSignificantCoeffX = (1 << base) * ((lastSigCoeffXPrefix & 1) + 2) + suffix;
    }
    if (lastSigCoeffYPrefix > 3) {
        int suffix = decode_last_sig_coeff_suffix(cabac, lastSigCoeffYPrefix);
        int base = ((lastSigCoeffYPrefix >> 1) - 1);
        LastSignificantCoeffY = (1 << base) * ((lastSigCoeffYPrefix & 1) + 2) + suffix;
    }

    if (scanIdx == 2) std::swap(LastSignificantCoeffX, LastSignificantCoeffY);

    HEVC_LOG(CABAC, "  lastSig=(%d,%d)", LastSignificantCoeffX, LastSignificantCoeffY);

    // Scan tables
    int numSbPerSide = trSize >> 2;
    if (numSbPerSide < 1) numSbPerSide = 1;
    int numSubBlocks = numSbPerSide * numSbPerSide;

    const uint8_t (*sbScan)[2] = get_sub_block_scan(log2TrafoSize, scanIdx);
    const uint8_t (*coeffScan)[2] = get_coeff_scan(scanIdx);

    // Find last sub-block and last scan position: the sub-block holding the
    // last coefficient, then the position inside it — two short searches
    // instead of walking every position of the TU from its end. The prefix and
    // suffix bound LastSignificantCoeffX/Y below trSize, so both are found; the
    // > 0 bounds only keep a lookup that missed inside the tables.
    const int xSLast = LastSignificantCoeffX >> 2, ySLast = LastSignificantCoeffY >> 2;
    const int xPLast = LastSignificantCoeffX & 3, yPLast = LastSignificantCoeffY & 3;
    int lastSubBlock = numSubBlocks - 1;
    while (lastSubBlock > 0 &&
           (sbScan[lastSubBlock][0] != xSLast || sbScan[lastSubBlock][1] != ySLast))
        lastSubBlock--;
    int lastScanPos = 15;
    while (lastScanPos > 0 &&
           (coeffScan[lastScanPos][0] != xPLast || coeffScan[lastScanPos][1] != yPLast))
        lastScanPos--;

    // coded_sub_block_flag array
    int coded_sub_block_flag[64] = {};
    // Set the sub-block containing the last sig coeff
    coded_sub_block_flag[sbScan[lastSubBlock][1] * numSbPerSide +
                         sbScan[lastSubBlock][0]] = 1;
    // DC sub-block is always implicitly 1 if there's any coefficient
    coded_sub_block_flag[0] = 1;

    // Cross-sub-block state for ctxSet derivation (§9.3.4.2.6)
    // prevGreater1Ctx tracks greater1Ctx from the last sub-block where
    // coeff_abs_level_greater1_flag was decoded (skipping empty sub-blocks).
    // ctxSet++ when prevGreater1Ctx == 0 (previous sub-block had a coeff > 1).
    int prevGreater1Ctx = 0;       // 0 = no previous sub-block yet
    bool hasGreater1History = false;

    // Process sub-blocks from last to first
    for (int i = lastSubBlock; i >= 0; i--) {
        int xS = sbScan[i][0];
        int yS = sbScan[i][1];
        int sbIdx = yS * numSbPerSide + xS;

        bool inferSbDcSigCoeffFlag = false;

        // Read coded_sub_block_flag for non-first, non-last sub-blocks
        if (i < lastSubBlock && i > 0) {
            // Context: depends on right and below neighbour csbf
            int csbfRight = 0, csbfBelow = 0;
            if (xS + 1 < numSbPerSide)
                csbfRight = coded_sub_block_flag[yS * numSbPerSide + (xS + 1)];
            if (yS + 1 < numSbPerSide)
                csbfBelow = coded_sub_block_flag[(yS + 1) * numSbPerSide + xS];

            int ctxInc = (cIdx > 0) ? 2 : 0;
            ctxInc += (csbfRight || csbfBelow) ? 1 : 0;

            coded_sub_block_flag[sbIdx] = decode_coded_sub_block_flag(cabac, ctxInc);
            inferSbDcSigCoeffFlag = true;
        }

        // Significant positions of this sub-block, in decreasing scan order —
        // the order every later pass reads them in, so they skip the zeros.
        int sigPos[16];
        int nSig = 0;

        // For the last sub-block, the last scan position is always significant
        if (i == lastSubBlock) sigPos[nSig++] = lastScanPos;

        int firstN = (i == lastSubBlock) ? lastScanPos - 1 : 15;

        const SigCtxSubBlock sigCtxSb = sig_ctx_sub_block(
            cIdx, log2TrafoSize, xS, yS, scanIdx, coded_sub_block_flag, numSbPerSide);

        if (coded_sub_block_flag[sbIdx]) {
            for (int n = firstN; n >= 0; n--) {
                if (n > 0 || !inferSbDcSigCoeffFlag) {
                    int sigCtx = sig_ctx(sigCtxSb, coeffScan[n][0], coeffScan[n][1]);
                    if (decode_sig_coeff_flag(cabac, sigCtx)) {
                        sigPos[nSig++] = n;
                        inferSbDcSigCoeffFlag = false;
                    }
                } else {
                    // Infer DC coefficient as significant
                    sigPos[nSig++] = 0;
                }
            }
        }

        // Decode coefficient levels
        int numGreater1Flag = 0;
        int lastGreater1Idx = -1;  // index into sigPos, not a scan position

        int coeff_abs_greater1[16];

        // Context set selection (§9.3.4.2.6)
        int ctxSet = (i > 0 && cIdx == 0) ? 2 : 0;

        // §9.3.4.2.6: increment ctxSet when the previous sub-block
        // (where greater1 was decoded) had greater1Ctx == 0
        if (hasGreater1History && prevGreater1Ctx == 0)
            ctxSet++;

        int greater1Ctx = 1;

        for (int k = 0; k < nSig; k++) {
            coeff_abs_greater1[k] = 0;
            if (numGreater1Flag < 8) {
                coeff_abs_greater1[k] = decode_coeff_abs_level_greater1_flag(
                    cabac, ctxSet, greater1Ctx, cIdx);
                numGreater1Flag++;

                if (coeff_abs_greater1[k]) {
                    if (lastGreater1Idx == -1)
                        lastGreater1Idx = k;
                    greater1Ctx = 0;
                } else if (greater1Ctx > 0 && greater1Ctx < 3) {
                    greater1Ctx++;
                }
            }
        }

        // Sign hidden condition (§7.3.8.11): lastSigScanPos - firstSigScanPos > 3
        auto& pps = *ctx.pps;
        auto& cu = ctx.cu_at(x0, y0);
        bool signHidden = false;
        if (!cu.cu_transquant_bypass && nSig > 0) {
            signHidden = pps.sign_data_hiding_enabled_flag &&
                         (sigPos[0] - sigPos[nSig - 1] > 3);
        }

        // coeff_abs_level_greater2_flag
        int greater2 = 0;
        if (lastGreater1Idx != -1)
            greater2 = decode_coeff_abs_level_greater2_flag(cabac, ctxSet, cIdx);

        // §7.3.8.11 + SPS RExt §7.4.3.2.2: alignment only when
        // cabac_bypass_alignment_enabled_flag is 1 (RExt profiles).
        // Main profile infers this flag as 0 — no alignment performed.
        if (ctx.sps->cabac_bypass_alignment_enabled_flag)
            cabac.align_bypass();

        // Sign flags — read for all sig coeffs except the hidden one, which is
        // the first in scan order, so the last in sigPos
        int coeff_sign_flag[16];
        const int nSigns = signHidden ? nSig - 1 : nSig;
        // One batch of bypass bins, first sign in the most significant bit
        const uint32_t signs = static_cast<uint32_t>(cabac.decode_bypass_bins(nSigns));
        for (int k = 0; k < nSigns; k++)
            coeff_sign_flag[k] = (signs >> (nSigns - 1 - k)) & 1;

        // coeff_abs_level_remaining + reconstruction (spec §7.3.8.11 final loop)
        int sumAbsLevel = 0;
        int cRiceParam = 0;

        for (int k = 0; k < nSig; k++) {
            const int n = sigPos[k];
            int xC = (xS << 2) + coeffScan[n][0];
            int yC = (yS << 2) + coeffScan[n][1];

            int baseLevel = 1 + coeff_abs_greater1[k] +
                            (k == lastGreater1Idx ? greater2 : 0);

            // Spec: read remaining when baseLevel equals max possible
            // max = 3 if numSigCoeff<8 and n==lastGreater1ScanPos
            // max = 2 if numSigCoeff<8 and n!=lastGreater1ScanPos
            // max = 1 if numSigCoeff>=8 (numSigCoeff is k here)
            int maxBase;
            if (k < 8) {
                maxBase = (k == lastGreater1Idx) ? 3 : 2;
            } else {
                maxBase = 1;
            }

            int coeff_remaining = 0;
            if (baseLevel == maxBase) {
                coeff_remaining = decode_coeff_abs_level_remaining(
                    cabac, cRiceParam);

                // Update cRiceParam (§9.3.3.11)
                int absLevel = baseLevel + coeff_remaining;
                if (absLevel > 3 * (1 << cRiceParam) && cRiceParam < 4)
                    cRiceParam++;
            }

            int absLevel = baseLevel + coeff_remaining;

            // Sign
            int sign;
            if (k >= nSigns) {
                // §7.4.9.11: parity of sum INCLUDING current level
                sign = ((sumAbsLevel + absLevel) & 1) ? -1 : 1;
            } else {
                sign = coeff_sign_flag[k] ? -1 : 1;
            }

            coefficients[yC * trSize + xC] = static_cast<int16_t>(sign * absLevel);
            extent.max_x = std::max(extent.max_x, xC);
            extent.max_y = std::max(extent.max_y, yC);

            sumAbsLevel += absLevel;
        }

        // Save cross-sub-block state for next iteration (§9.3.4.2.6)
        // Only update when greater1 flags were actually decoded
        if (numGreater1Flag > 0) {
            prevGreater1Ctx = greater1Ctx;
            hasGreater1History = true;
        }
    }

    // Count total nonzero
    [[maybe_unused]] int totalNonzero = 0;
    for (int k = 0; k < trSize * trSize; k++)
        if (coefficients[k] != 0) totalNonzero++;

    HEVC_LOG(CABAC, "residual_coding done: %d bins consumed, %d nonzero coeffs",
             cabac.bin_count() - bins_start, totalNonzero);
    return extent;
}

} // namespace hevc
