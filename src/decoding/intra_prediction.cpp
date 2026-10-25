#include "decoding/intra_prediction.h"
#include "decoding/coding_tree.h"
#include "common/types.h"
#include "common/debug.h"

#include <cstring>
#include <cstdlib>
#include <algorithm>

namespace hevc {

// Intra prediction angle tables (Table 8-4, 8-5)
static const int intraPredAngle[35] = {
     0,   0,
    32,  26,  21,  17,  13,   9,   5,   2,
     0,  -2,  -5,  -9, -13, -17, -21, -26,
   -32, -26, -21, -17, -13,  -9,  -5,  -2,
     0,   2,   5,   9,  13,  17,  21,  26,
    32
};

static const int invAngle[35] = {
       0,    0,
     256,  315,  390,  482,  630,  910, 1638, 4096,
       0, 4096, 1638,  910,  630,  482,  390,  315,
     256,  315,  390,  482,  630,  910, 1638, 4096,
       0, 4096, 1638,  910,  630,  482,  390,  315,
     256
};

// ============================================================
// Reference sample construction (§8.4.4.2.2)
// ============================================================

// Reference array layout: ref[0..4*nTbS]
// ref[0]           = p[-1][-1] (top-left corner)
// ref[1..nTbS]     = p[0][-1] .. p[nTbS-1][-1] (top row)
// ref[nTbS+1..2*nTbS] = p[nTbS][-1] .. p[2*nTbS-1][-1] (top-right extension)
// For the left: stored after top
// refLeft[0]       = p[-1][-1] (top-left corner, same as ref[0])
// refLeft[1..nTbS] = p[-1][0] .. p[-1][nTbS-1] (left column)
// refLeft[nTbS+1..2*nTbS] = p[-1][nTbS] .. p[-1][2*nTbS-1] (bottom-left extension)

static void build_reference_samples(const DecodingContext& ctx, int x0, int y0,
                                     int nTbS, int cIdx,
                                     int16_t* refTop, int16_t* refLeft) {
    auto& pic = *ctx.pic;
    auto& sps = *ctx.sps;

    int picW, picH;
    if (cIdx == 0) {
        picW = static_cast<int>(sps.pic_width_in_luma_samples);
        picH = static_cast<int>(sps.pic_height_in_luma_samples);
    } else {
        picW = static_cast<int>(sps.pic_width_in_luma_samples) / sps.SubWidthC;
        picH = static_cast<int>(sps.pic_height_in_luma_samples) / sps.SubHeightC;
    }

    // Convert luma coords to component coords
    int xC = (cIdx > 0) ? x0 / sps.SubWidthC : x0;
    int yC = (cIdx > 0) ? y0 / sps.SubHeightC : y0;

    int bitDepth = (cIdx == 0) ? sps.BitDepthY : sps.BitDepthC;
    int defaultVal = 1 << (bitDepth - 1);

    // Build availability and sample arrays
    // Total reference samples needed: 4*nTbS + 1
    int totalSamples = 4 * nTbS + 1;
    bool available[4 * 64 + 1];
    int16_t samples[4 * 64 + 1] = {};

    std::memset(available, false, sizeof(available));

    // Helper: check if a sample at (rx,ry) in component coordinates is available
    // Available = in picture, in a previously decoded CTU, or in the same CTU
    // but preceding in Z-scan order. Simplified: available if before current TU
    // in raster scan (ry < yC) or (ry == yC..yC+nTbS-1 and rx < xC)
    // or the sample is in a CTU that precedes the current CTU.
    int ctbSize = (cIdx > 0) ? sps.CtbSizeY / sps.SubWidthC : sps.CtbSizeY;
    int curCtbX = xC / ctbSize;
    int curCtbY = yC / ctbSize;

    // Z-scan address from min-CB coordinates within a CTU
    // Interleave bits: x in even positions, y in odd positions
    auto zscan_addr = [](int bx, int by) -> uint32_t {
        uint32_t z = 0;
        for (int i = 0; i < 8; i++) {
            z |= ((bx >> i) & 1) << (2 * i);
            z |= ((by >> i) & 1) << (2 * i + 1);
        }
        return z;
    };

    // Use min-TB granularity (4x4) for Z-scan to handle NxN sub-PU correctly
    int minBlkSize = kGridSize;
    int ctbOriginX = curCtbX * static_cast<int>(sps.CtbSizeY);
    int ctbOriginY = curCtbY * static_cast<int>(sps.CtbSizeY);
    // Current TU's Z-scan address (in min-TB units within CTU)
    uint32_t curZScan = zscan_addr((x0 - ctbOriginX) / minBlkSize,
                                    (y0 - ctbOriginY) / minBlkSize);

    auto is_decoded = [&](int rx, int ry) -> bool {
        if (rx < 0 || ry < 0 || rx >= picW || ry >= picH) return false;

        int refCtbX = rx / ctbSize;
        int refCtbY = ry / ctbSize;

        // Different CTU: available if CTU was already decoded AND in same slice/tile (§6.4.1)
        if (refCtbX != curCtbX || refCtbY != curCtbY) {
            int refCtbAddr = refCtbY * sps.PicWidthInCtbsY + refCtbX;
            int curCtbAddr = curCtbY * sps.PicWidthInCtbsY + curCtbX;
            if (refCtbAddr >= curCtbAddr) return false;
            // §6.4.1: SliceAddrRs must match
            if (ctx.slice_idx && ctx.slice_idx[refCtbAddr] != ctx.slice_idx[curCtbAddr])
                return false;
            // §6.4.1: TileId must match
            if (ctx.pps->TileId.size() > 0) {
                int ts_ref = ctx.pps->CtbAddrRsToTs[refCtbAddr];
                int ts_cur = ctx.pps->CtbAddrRsToTs[curCtbAddr];
                if (ctx.pps->TileId[ts_ref] != ctx.pps->TileId[ts_cur])
                    return false;
            }
            return true;
        }

        // Same CTU: compare Z-scan addresses at min-TB granularity
        int lumaRx = (cIdx > 0) ? rx * sps.SubWidthC : rx;
        int lumaRy = (cIdx > 0) ? ry * sps.SubHeightC : ry;

        uint32_t refZScan = zscan_addr((lumaRx - ctbOriginX) / minBlkSize,
                                        (lumaRy - ctbOriginY) / minBlkSize);
        return refZScan < curZScan;
    };
    // §8.4.4.2.2: with constrained_intra_pred_flag, samples of a coding unit
    // that is not intra coded are not available for intra prediction either
    auto is_reconstructed = [&](int rx, int ry) -> bool {
        if (!is_decoded(rx, ry)) return false;
        if (!ctx.pps->constrained_intra_pred_flag) return true;
        int lumaRx = (cIdx > 0) ? rx * sps.SubWidthC : rx;
        int lumaRy = (cIdx > 0) ? ry * sps.SubHeightC : ry;
        return ctx.cu_at(lumaRx, lumaRy).pred_mode == PredMode::MODE_INTRA;
    };

    // Sample ordering in the reference array:
    // Index 0: bottom-left extension (p[-1][2*nTbS-1])
    // ...
    // Index 2*nTbS-1: p[-1][0]
    // Index 2*nTbS: p[-1][-1] (top-left corner)
    // Index 2*nTbS+1: p[0][-1]
    // ...
    // Index 4*nTbS: p[2*nTbS-1][-1]

    // Availability only changes from one 4x4 luma block to the next (the
    // Z-scan granularity above; CUs, CTBs and the picture size are multiples of
    // it), and TUs are aligned on it: one test per group of `unit` samples.
    const int unit = (cIdx > 0) ? minBlkSize / sps.SubWidthC : minBlkSize;
    const int unitY = (cIdx > 0) ? minBlkSize / sps.SubHeightC : minBlkSize;

    // Bottom-left to top along left edge
    for (int k = 0; k < 2 * nTbS; k += unitY) {
        int refX = xC - 1;
        if (!is_reconstructed(refX, yC + 2 * nTbS - 1 - k)) continue;
        for (int j = k; j < k + unitY; j++) {
            int refY = yC + 2 * nTbS - 1 - j;
            samples[j] = static_cast<int16_t>(pic.get(cIdx, refX, refY));
            available[j] = true;
        }
    }

    // Top-left corner
    {
        int refX = xC - 1;
        int refY = yC - 1;
        int idx = 2 * nTbS;
        if (is_reconstructed(refX, refY)) {
            samples[idx] = static_cast<int16_t>(pic.get(cIdx, refX, refY));
            available[idx] = true;
        }
    }

    // Top edge, left to right, then top-right extension
    for (int k = 0; k < 2 * nTbS; k += unit) {
        int refY = yC - 1;
        if (!is_reconstructed(xC + k, refY)) continue;
        for (int j = k; j < k + unit; j++) {
            int idx = 2 * nTbS + 1 + j;
            samples[idx] = static_cast<int16_t>(pic.get(cIdx, xC + j, refY));
            available[idx] = true;
        }
    }

    // Substitution: replace unavailable samples
    // Find first available sample
    int firstAvail = -1;
    for (int i = 0; i < totalSamples; i++) {
        if (available[i]) { firstAvail = i; break; }
    }

    if (firstAvail == -1) {
        // No neighbours available at all — fill with default
        for (int i = 0; i < totalSamples; i++)
            samples[i] = static_cast<int16_t>(defaultVal);
    } else {
        // Propagate: fill unavailable before first with first available
        for (int i = 0; i < firstAvail; i++)
            samples[i] = samples[firstAvail];
        // Propagate forward
        for (int i = firstAvail + 1; i < totalSamples; i++) {
            if (!available[i])
                samples[i] = samples[i - 1];
        }
    }

    // Convert to refTop/refLeft format
    // refTop[0] = top-left = samples[2*nTbS]
    // refTop[1..2*nTbS] = top row = samples[2*nTbS+1 .. 4*nTbS]
    refTop[0] = samples[2 * nTbS];
    for (int i = 0; i < 2 * nTbS; i++)
        refTop[1 + i] = samples[2 * nTbS + 1 + i];

    // refLeft[0] = top-left = samples[2*nTbS]
    // refLeft[1..2*nTbS] = left column top to bottom = samples[2*nTbS-1 .. 0]
    refLeft[0] = samples[2 * nTbS];
    for (int i = 0; i < 2 * nTbS; i++)
        refLeft[1 + i] = samples[2 * nTbS - 1 - i];
}

// ============================================================
// Reference sample filtering (§8.4.4.2.3)
// ============================================================

static bool needs_filtering(int intra_mode, int log2BlkSize) {
    // §8.4.4.2.3: filterFlag = 0 when DC mode or nTbS == 4
    if (intra_mode == 1) return false; // INTRA_DC
    if (log2BlkSize == 2) return false; // nTbS == 4

    // minDistVerHor = Min(|mode - 26|, |mode - 10|)
    int minDistVerHor = std::min(std::abs(intra_mode - 26),
                                  std::abs(intra_mode - 10));
    // Table 8-4: intraHorVerDistThres
    int thresholds[3] = { 7, 1, 0 }; // nTbS = 8, 16, 32
    if (log2BlkSize >= 3 && log2BlkSize <= 5)
        return minDistVerHor > thresholds[log2BlkSize - 3];
    return false;
}

static void filter_reference_samples(int16_t* ref, int nTbS, bool biIntFlag,
                                      int /*bitDepth*/) {
    if (biIntFlag) {
        // §8.4.4.2.3: bilinear interpolation between endpoints
        int16_t filtered[2 * 64 + 1];
        int topLeft = ref[0];
        int endVal = ref[2 * nTbS];
        filtered[0] = ref[0];
        for (int i = 1; i < 2 * nTbS; i++) {
            filtered[i] = static_cast<int16_t>(
                ((2 * nTbS - i) * topLeft + i * endVal + nTbS) / (2 * nTbS));
        }
        filtered[2 * nTbS] = ref[2 * nTbS];
        std::memcpy(ref, filtered, sizeof(int16_t) * (2 * nTbS + 1));
        return;
    }

    // Standard [1,2,1]/4 filter (eq 8-41 to 8-45)
    int16_t filtered[2 * 64 + 1];
    filtered[0] = ref[0]; // Corner not filtered
    for (int i = 1; i < 2 * nTbS; i++) {
        filtered[i] = static_cast<int16_t>((ref[i - 1] + 2 * ref[i] + ref[i + 1] + 2) >> 2);
    }
    filtered[2 * nTbS] = ref[2 * nTbS];
    std::memcpy(ref, filtered, sizeof(int16_t) * (2 * nTbS + 1));
}

// ============================================================
// Planar prediction (mode 0) — §8.4.4.2.4
// ============================================================

static void predict_planar(const int16_t* refTop, const int16_t* refLeft,
                            int nTbS, int16_t* pred) {
    int log2N = 0;
    while ((1 << log2N) < nTbS) log2N++;

    int topRight  = refTop[nTbS + 1];   // p[nTbS][-1] — index nTbS+1 in refTop
    // Actually refTop[nTbS] is p[nTbS-1][-1], refTop[nTbS+1] is p[nTbS][-1]
    // Wait — refTop layout: [0]=topLeft, [1]=p[0][-1], [2]=p[1][-1], ... [nTbS]=p[nTbS-1][-1], [nTbS+1]=p[nTbS][-1]
    // So topRight = refTop[nTbS + 1] — but we need the 2*nTbS+1 sized array
    // Actually our refTop has 2*nTbS+1 elements: [0]=corner, [1..2*nTbS]=top row
    // So refTop[nTbS] = p[nTbS-1][-1] and refTop[nTbS+1] if it exists = p[nTbS][-1]
    // In our build_reference_samples, refTop has indices 0..2*nTbS

    // Correction: topRight = refTop[nTbS + 1] — this is p[nTbS][-1]
    // bottomLeft = refLeft[nTbS + 1] — this is p[-1][nTbS]

    int bottomLeft = refLeft[nTbS + 1]; // p[-1][nTbS]

    for (int y = 0; y < nTbS; y++) {
        for (int x = 0; x < nTbS; x++) {
            pred[y * nTbS + x] = static_cast<int16_t>(
                ((nTbS - 1 - x) * refLeft[y + 1] + (x + 1) * topRight +
                 (nTbS - 1 - y) * refTop[x + 1]  + (y + 1) * bottomLeft +
                 nTbS) >> (log2N + 1));
        }
    }
}

// ============================================================
// DC prediction (mode 1) — §8.4.4.2.5
// ============================================================

static void predict_dc(const int16_t* refTop, const int16_t* refLeft,
                        int nTbS, int log2BlkSize, int cIdx, int16_t* pred) {
    int sum = 0;
    for (int i = 1; i <= nTbS; i++) {
        sum += refTop[i] + refLeft[i];
    }
    int dcVal = (sum + nTbS) >> (log2BlkSize + 1);

    for (int y = 0; y < nTbS; y++)
        for (int x = 0; x < nTbS; x++)
            pred[y * nTbS + x] = static_cast<int16_t>(dcVal);

    // §8.4.4.2.5 eq 8-48..8-51: DC boundary filter (cIdx == 0 only, nTbS < 32)
    if (cIdx == 0 && nTbS < 32) {
        pred[0] = static_cast<int16_t>((refTop[1] + refLeft[1] + 2 * dcVal + 2) >> 2);

        for (int x = 1; x < nTbS; x++)
            pred[x] = static_cast<int16_t>((refTop[x + 1] + 3 * dcVal + 2) >> 2);

        for (int y = 1; y < nTbS; y++)
            pred[y * nTbS] = static_cast<int16_t>((refLeft[y + 1] + 3 * dcVal + 2) >> 2);
    }
}

// ============================================================
// Angular prediction (modes 2-34) — §8.4.4.2.6
// ============================================================

static void predict_angular(const int16_t* refTop, const int16_t* refLeft,
                             int nTbS, int intra_mode, int cIdx, int bitDepth,
                             int16_t* pred) {
    int angle = intraPredAngle[intra_mode];
    bool isVertical = (intra_mode >= 18);

    // Select reference array (main and side)
    const int16_t* refMain;
    const int16_t* refSide;

    // Extended reference for negative angles
    int16_t refMainExt[2 * 64 + 1 + 64]; // extra space for negative index projection

    if (isVertical) {
        refMain = refTop;
        refSide = refLeft;
    } else {
        // Horizontal modes (2-17): swap axes, use mirror mode
        refMain = refLeft;
        refSide = refTop;
    }

    // Build extended main reference for negative angles
    if (angle < 0) {
        int invA = invAngle[intra_mode];
        // §8.4.4.2.6 eq 8-54/8-62: range is x = -1 .. floor((nTbS * angle) / 32)
        // C++ right-shift of negative values truncates toward zero, but the spec
        // requires floor division. Use explicit floor: -((-n + 31) >> 5) for n < 0
        int nTimesAngle = nTbS * angle; // negative
        int numNeg = (-nTimesAngle + 31) >> 5; // ceil(|nTimesAngle| / 32) = floor division magnitude

        // Copy main reference to extended array (offset so index 0 = refMain[0])
        int offset = numNeg;
        for (int i = 0; i <= 2 * nTbS; i++)
            refMainExt[offset + i] = refMain[i];

        // §8.4.4.2.6 eq 8-54/8-62: project side reference into negative positions
        // spec uses negative invAngle, we store positive → use (-i) to compensate
        for (int i = -1; i >= -numNeg; i--) {
            int sideIdx = ((-i * invA + 128) >> 8);
            if (sideIdx > 2 * nTbS) sideIdx = 2 * nTbS;
            refMainExt[offset + i] = refSide[sideIdx];
        }

        refMain = refMainExt + offset;
    }

    // Generate prediction samples
    for (int y = 0; y < nTbS; y++) {
        for (int x = 0; x < nTbS; x++) {
            int iIdx, iFact;
            if (isVertical) {
                iIdx = ((y + 1) * angle) >> 5;
                iFact = ((y + 1) * angle) & 31;
            } else {
                iIdx = ((x + 1) * angle) >> 5;
                iFact = ((x + 1) * angle) & 31;
            }

            int refIdx;
            if (isVertical) {
                refIdx = x + 1 + iIdx;
            } else {
                refIdx = y + 1 + iIdx;
            }

            int val;
            if (iFact != 0) {
                val = ((32 - iFact) * refMain[refIdx] +
                       iFact * refMain[refIdx + 1] + 16) >> 5;
            } else {
                val = refMain[refIdx];
            }

            if (isVertical) {
                pred[y * nTbS + x] = static_cast<int16_t>(val);
            } else {
                // Horizontal: x/y swapped in computation, store in row-major
                pred[y * nTbS + x] = static_cast<int16_t>(val);
            }
        }
    }

    // §8.4.4.2.6 eq 8-60/8-68: post-filtering for exact H/V (cIdx == 0 only)
    if (cIdx == 0 && intra_mode == 26 && nTbS < 32) {
        // Vertical: filter first column with left reference
        for (int y = 0; y < nTbS; y++) {
            pred[y * nTbS + 0] = static_cast<int16_t>(
                Clip3(0, (1 << bitDepth) - 1,
                      pred[y * nTbS + 0] + ((refLeft[y + 1] - refLeft[0]) >> 1)));
        }
    } else if (cIdx == 0 && intra_mode == 10 && nTbS < 32) {
        // Horizontal: filter first row with top reference
        for (int x = 0; x < nTbS; x++) {
            pred[0 * nTbS + x] = static_cast<int16_t>(
                Clip3(0, (1 << bitDepth) - 1,
                      pred[0 * nTbS + x] + ((refTop[x + 1] - refTop[0]) >> 1)));
        }
    }
}

// ============================================================
// Main entry point
// ============================================================

void perform_intra_prediction(DecodingContext& ctx, int x0, int y0,
                              int log2PredSize, int cIdx, int intra_mode,
                              int16_t* pred_samples) {
    int nTbS = 1 << log2PredSize;
    int bitDepth = (cIdx == 0) ? ctx.sps->BitDepthY : ctx.sps->BitDepthC;
    // Modes 0..34 index the angle tables; a corrupt stream must not read past them
    if (intra_mode < 0 || intra_mode > 34) intra_mode = 1;  // INTRA_DC

    // Build reference samples
    int16_t refTop[2 * 64 + 1];
    int16_t refLeft[2 * 64 + 1];

    build_reference_samples(ctx, x0, y0, nTbS, cIdx, refTop, refLeft);

    // §8.4.4.2.3: Reference sample filtering
    // Spec: filtering applies when intra_smoothing_disabled_flag == 0 AND
    //        (cIdx == 0 OR ChromaArrayType == 3)
    bool doFilter = !ctx.sps->intra_smoothing_disabled_flag &&
                     (cIdx == 0 || ctx.sps->ChromaArrayType == 3) &&
                     needs_filtering(intra_mode, log2PredSize);
    if (doFilter) {
        // §8.4.4.2.3: biIntFlag requires ALL conditions:
        // strong_intra_smoothing, cIdx==0, nTbS==32,
        // top smoothness check AND left smoothness check
        bool biIntFlag = false;
        if (ctx.sps->strong_intra_smoothing_enabled_flag &&
            cIdx == 0 && nTbS == 32) {
            int threshold = 1 << (bitDepth - 5);
            int topLeft = refTop[0];
            bool topSmooth = std::abs(topLeft + refTop[2 * nTbS] -
                                       2 * refTop[nTbS]) < threshold;
            bool leftSmooth = std::abs(topLeft + refLeft[2 * nTbS] -
                                        2 * refLeft[nTbS]) < threshold;
            biIntFlag = topSmooth && leftSmooth;
        }
        // §8.4.4.2.3 eq 8-41: corner sample filtered using both neighbours
        int16_t filteredCorner = static_cast<int16_t>(
            (refLeft[1] + 2 * refTop[0] + refTop[1] + 2) >> 2);
        filter_reference_samples(refTop, nTbS, biIntFlag, bitDepth);
        filter_reference_samples(refLeft, nTbS, biIntFlag, bitDepth);
        // Apply cross-filtered corner to both arrays
        if (!biIntFlag) {
            refTop[0] = filteredCorner;
            refLeft[0] = filteredCorner;
        }
    }

    // Dispatch to prediction mode
    if (intra_mode == 0) {
        predict_planar(refTop, refLeft, nTbS, pred_samples);
    } else if (intra_mode == 1) {
        predict_dc(refTop, refLeft, nTbS, log2PredSize, cIdx, pred_samples);
    } else {
        predict_angular(refTop, refLeft, nTbS, intra_mode, cIdx, bitDepth, pred_samples);
    }
}

} // namespace hevc
