// Sample Adaptive Offset — Spec §8.7.3
// Transcription directe de la spec ITU-T H.265 v8 (08/2021)

#include "filters/sao.h"
#include "common/types.h"

#include <cstring>
#include <vector>

namespace hevc {

// §8.7.3.2: EO class direction offsets
// Class 0 (H):    (-1, 0), (1, 0)
// Class 1 (V):    (0, -1), (0, 1)
// Class 2 (D135): (-1, -1), (1, 1)
// Class 3 (D45):  (1, -1), (-1, 1)
static const int eo_dx[4][2] = {{-1, 1}, {0, 0}, {-1, 1}, {1, -1}};
static const int eo_dy[4][2] = {{0, 0}, {-1, 1}, {-1, 1}, {-1, 1}};

// True when the 3x3 CTB neighbourhood around (rx, ry) is uniform — same slice
// and same tile everywhere. SAO neighbours never reach past that neighbourhood,
// so no per-sample cross-boundary test of §8.7.3.2 can fire inside this CTB.
static bool sao_ctb_neighbourhood_uniform(const DecodingContext& ctx, const PPS& pps,
                                          const SPS& sps, int rx, int ry) {
    if (!ctx.slice_idx) return true;

    const int w = sps.PicWidthInCtbsY;
    const int h = sps.PicHeightInCtbsY;
    const int curAddr = ry * w + rx;
    const uint8_t si_cur = ctx.slice_idx[curAddr];

    const bool checkTiles = !pps.loop_filter_across_tiles_enabled_flag && !pps.TileId.empty();
    const int tile_cur = checkTiles ? pps.TileId[pps.CtbAddrRsToTs[curAddr]] : 0;

    for (int dy = -1; dy <= 1; dy++) {
        const int ny = ry + dy;
        if (ny < 0 || ny >= h) continue;
        for (int dx = -1; dx <= 1; dx++) {
            const int nx = rx + dx;
            if (nx < 0 || nx >= w) continue;
            const int nbrAddr = ny * w + nx;
            if (ctx.slice_idx[nbrAddr] != si_cur) return false;
            if (checkTiles && pps.TileId[pps.CtbAddrRsToTs[nbrAddr]] != tile_cur) return false;
        }
    }
    return true;
}

void apply_sao(DecodingContext& ctx) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    auto* pic = ctx.pic;

    if (!sps.sample_adaptive_offset_enabled_flag) return;

    int ctbSize = 1 << sps.CtbLog2SizeY;
    int subW = sps.SubWidthC;
    int subH = sps.SubHeightC;
    int numComp = (sps.ChromaArrayType != 0) ? 3 : 1;

    // Quick check: skip entirely if no CTU has SAO enabled
    bool anySao = false;
    for (int i = 0; i < sps.PicSizeInCtbsY && !anySao; i++) {
        for (int c = 0; c < numComp; c++) {
            if (ctx.sao_params[i].sao_type_idx[c] != 0) { anySao = true; break; }
        }
    }
    if (!anySao) return;

    // §8.7.3.1: SAO operates on a copy of the deblocked picture
    // Use persistent backup buffers (avoids heap allocation per frame)
    auto* origPlane = ctx.sao_backup;
    for (int c = 0; c < numComp; c++) {
        auto& plane = pic->planes[c];
        auto& backup = origPlane[c];
        backup.resize(plane.size());
        std::memcpy(backup.data(), plane.data(), plane.size() * sizeof(uint16_t));
    }

    // Process each CTU
    for (int ry = 0; ry < sps.PicHeightInCtbsY; ry++) {
        for (int rx = 0; rx < sps.PicWidthInCtbsY; rx++) {
            auto& sao = ctx.sao_params[ry * ctx.sao_params_stride + rx];

            // Once per CTB, not once per sample: decides whether the edge-offset
            // loop can skip the cross-slice/tile tests entirely.
            const bool ctbUniform = sao_ctb_neighbourhood_uniform(ctx, pps, sps, rx, ry);

            // Does this CTU hold any PCM or transquant_bypass CU? Scanned on luma
            // coordinates, so it is the same answer for all three components —
            // compute it once per CTB rather than once per component.
            bool ctbHasPcmOrBypass = false;
            if (sps.pcm_loop_filter_disabled_flag || pps.transquant_bypass_enabled_flag) {
                // Only scan when PCM or transquant_bypass are possible in this stream
                int xYctb = rx * ctbSize;
                int yYctb = ry * ctbSize;
                int minCb = sps.MinCbSizeY;
                int cbEnd_x = std::min(xYctb + ctbSize, (int)sps.pic_width_in_luma_samples);
                int cbEnd_y = std::min(yYctb + ctbSize, (int)sps.pic_height_in_luma_samples);
                for (int cy = yYctb; cy < cbEnd_y && !ctbHasPcmOrBypass; cy += minCb)
                    for (int cx = xYctb; cx < cbEnd_x && !ctbHasPcmOrBypass; cx += minCb) {
                        auto& cu = ctx.cu_at(cx, cy);
                        if ((sps.pcm_loop_filter_disabled_flag && cu.is_pcm) ||
                            cu.cu_transquant_bypass)
                            ctbHasPcmOrBypass = true;
                    }
            }

            for (int cIdx = 0; cIdx < numComp; cIdx++) {
                if (sao.sao_type_idx[cIdx] == 0) continue;

                // Check slice SAO flags
                // Note: we apply SAO globally; per-slice flag check would need
                // slice index per CTU. For single-slice pictures this is correct.
                // Multi-slice: the SAO params are already set to type=0 during
                // parsing if the slice flag was off.

                int bitDepth = (cIdx == 0) ? sps.BitDepthY : sps.BitDepthC;
                int maxVal = (1 << bitDepth) - 1;
                bool pcmFilterDisabled = sps.pcm_loop_filter_disabled_flag;

                // CTB dimensions in this component
                int nCtbSw, nCtbSh;
                if (cIdx == 0) {
                    nCtbSw = ctbSize;
                    nCtbSh = ctbSize;
                } else {
                    nCtbSw = ctbSize / subW;
                    nCtbSh = ctbSize / subH;
                }

                int xCtb = rx * nCtbSw;
                int yCtb = ry * nCtbSh;
                int compW = pic->width[cIdx];
                int compH = pic->height[cIdx];
                int stride = pic->stride[cIdx];

                // Cross-boundary tests can only fire on a non-uniform neighbourhood
                bool needBoundaryCheck = !ctbUniform;

                // Edge offset reads two neighbours, so it needs a uniform
                // neighbourhood on top of having no per-sample CU lookups to do.
                bool fastPathEdge = ctbUniform && !ctbHasPcmOrBypass;
                // Band offset reads no neighbour at all (§8.7.3.3): no cross-slice
                // or cross-tile test can ever apply to it, so uniformity is
                // irrelevant here — gating on it would drop multi-slice and
                // multi-tile streams onto the slow loop for nothing.
                bool fastPathBand = !ctbHasPcmOrBypass;

                const uint16_t* origData = origPlane[cIdx].data();
                uint16_t* destData = pic->planes[cIdx].data();

                if (sao.sao_type_idx[cIdx] == 2) {
                    // Edge offset — §8.7.3.2
                    int eoClass = sao.sao_eo_class[cIdx];
                    int dx0 = eo_dx[eoClass][0], dy0 = eo_dy[eoClass][0];
                    int dx1 = eo_dx[eoClass][1], dy1 = eo_dy[eoClass][1];

                    if (fastPathEdge) {
                        // Hoist the picture-boundary test out of the loop: a sample is
                        // processed iff both neighbours stay inside the picture, which
                        // reduces to a range restriction on x and y.
                        const int minDx = std::min(dx0, dx1), maxDx = std::max(dx0, dx1);
                        const int minDy = std::min(dy0, dy1), maxDy = std::max(dy0, dy1);
                        const int xLo = std::max(xCtb, -minDx);
                        const int xHi = std::min(xCtb + nCtbSw, compW - maxDx);
                        const int yLo = std::max(yCtb, -minDy);
                        const int yHi = std::min(yCtb + nCtbSh, compH - maxDy);

                        const int* offs = sao.sao_offset_val[cIdx];
                        const int nOff1 = dy0 * stride + dx0;
                        const int nOff2 = dy1 * stride + dx1;

                        for (int y = yLo; y < yHi; y++) {
                            const uint16_t* srcRow = origData + (ptrdiff_t)y * stride;
                            uint16_t* dstRow = destData + (ptrdiff_t)y * stride;
                            for (int x = xLo; x < xHi; x++) {
                                int c_val = srcRow[x];
                                int a = srcRow[x + nOff1];
                                int b = srcRow[x + nOff2];
                                // edgeIdx = 2 + sign(c-a) + sign(c-b); offs[2] is always 0
                                // (§7.4.9.3) so the flat category writes back c_val unchanged
                                // and the offset != 0 branch can be dropped.
                                int edgeIdx = 2 + ((c_val > a) - (c_val < a))
                                                + ((c_val > b) - (c_val < b));
                                dstRow[x] = static_cast<uint16_t>(
                                    Clip3(0, maxVal, c_val + offs[edgeIdx]));
                            }
                        }
                        continue;
                    }

                    for (int j = 0; j < nCtbSh; j++) {
                        int ySj = yCtb + j;
                        if (ySj >= compH) break;
                        for (int i = 0; i < nCtbSw; i++) {
                            int xSi = xCtb + i;
                            if (xSi >= compW) break;

                            // §8.7.3.2: skip PCM and transquant_bypass
                            int xY = (cIdx == 0) ? xSi : xSi * subW;
                            int yY = (cIdx == 0) ? ySj : ySj * subH;
                            if (ctbHasPcmOrBypass) {
                                auto& cu = ctx.cu_at(xY, yY);
                                if ((pcmFilterDisabled && cu.is_pcm) || cu.cu_transquant_bypass)
                                    continue;
                            }

                            // Neighbor positions
                            int xN1 = xSi + dx0;
                            int yN1 = ySj + dy0;
                            int xN2 = xSi + dx1;
                            int yN2 = ySj + dy1;

                            // §8.7.3.2: out-of-picture neighbors → no modification
                            if (xN1 < 0 || xN1 >= compW || yN1 < 0 || yN1 >= compH) continue;
                            if (xN2 < 0 || xN2 >= compW || yN2 < 0 || yN2 >= compH) continue;

                            // §8.7.3.2: cross-slice boundary check
                            // edgeIdx = 0 when neighbor is in a different slice and the
                            // relevant slice_loop_filter_across_slices_enabled_flag == 0
                            bool skipEdge = false;
                            if (needBoundaryCheck) {
                                int curAddr = (yY / ctbSize) * sps.PicWidthInCtbsY + (xY / ctbSize);
                                int si_cur = ctx.slice_idx[curAddr];
                                for (int nk = 0; nk < 2 && !skipEdge; nk++) {
                                    int xNk = (nk == 0) ? xN1 : xN2;
                                    int yNk = (nk == 0) ? yN1 : yN2;
                                    int xYn = (cIdx == 0) ? xNk : xNk * subW;
                                    int yYn = (cIdx == 0) ? yNk : yNk * subH;
                                    int nbrAddr = (yYn / ctbSize) * sps.PicWidthInCtbsY + (xYn / ctbSize);
                                    int si_nbr = ctx.slice_idx[nbrAddr];
                                    if (si_cur != si_nbr) {
                                        // §8.7.3.2: check the flag of the slice whose entry
                                        // boundary is being crossed
                                        if (si_nbr < si_cur) {
                                            // neighbor in earlier slice → check current's flag
                                            if (!ctx.sh_at_ctb(curAddr).slice_loop_filter_across_slices_enabled_flag)
                                                skipEdge = true;
                                        } else {
                                            // neighbor in later slice → check neighbor's flag
                                            if (!ctx.sh_at_ctb(nbrAddr).slice_loop_filter_across_slices_enabled_flag)
                                                skipEdge = true;
                                        }
                                    }
                                }
                                // §8.7.3.2: cross-tile boundary check
                                if (!skipEdge && !pps.loop_filter_across_tiles_enabled_flag
                                    && !pps.TileId.empty()) {
                                    int ts_cur = pps.CtbAddrRsToTs[curAddr];
                                    for (int nk = 0; nk < 2 && !skipEdge; nk++) {
                                        int xNk = (nk == 0) ? xN1 : xN2;
                                        int yNk = (nk == 0) ? yN1 : yN2;
                                        int xYn = (cIdx == 0) ? xNk : xNk * subW;
                                        int yYn = (cIdx == 0) ? yNk : yNk * subH;
                                        int nbrAddr = (yYn / ctbSize) * sps.PicWidthInCtbsY + (xYn / ctbSize);
                                        int ts_nbr = pps.CtbAddrRsToTs[nbrAddr];
                                        if (pps.TileId[ts_cur] != pps.TileId[ts_nbr])
                                            skipEdge = true;
                                    }
                                }
                            }
                            if (skipEdge) continue;

                            int c_val = origData[ySj * stride + xSi];
                            int a = origData[yN1 * stride + xN1];
                            int b = origData[yN2 * stride + xN2];

                            // §8.7.3.2: edge index categorization
                            int edgeIdx;
                            int signC_A = (c_val < a) ? -1 : (c_val > a) ? 1 : 0;
                            int signC_B = (c_val < b) ? -1 : (c_val > b) ? 1 : 0;
                            // edgeIdx = 2 + sign(c-a) + sign(c-b)
                            edgeIdx = 2 + signC_A + signC_B;
                            // Map: 0=valley(both<), 1=concave(one<), 2=flat, 3=convex(one>), 4=peak(both>)

                            int offset = sao.sao_offset_val[cIdx][edgeIdx];
                            if (offset != 0) {
                                destData[ySj * stride + xSi] =
                                    static_cast<uint16_t>(Clip3(0, maxVal, c_val + offset));
                            }
                        }
                    }
                } else {
                    // Band offset — §8.7.3.3
                    int bandShift = bitDepth - 5;
                    int bandPos = sao.sao_band_position[cIdx];

                    if (fastPathBand) {
                        // Fold the "is this sample in the offset window" test into a
                        // 32-entry table. No wrap-around: bands past 31 don't exist,
                        // so offsets falling off the end are simply unused.
                        int bandOffs[32] = {};
                        for (int k = 0; k < 4; k++) {
                            int b = bandPos + k;
                            if (b < 32) bandOffs[b] = sao.sao_offset_val[cIdx][k];
                        }

                        const int xHi = std::min(xCtb + nCtbSw, compW);
                        const int yHi = std::min(yCtb + nCtbSh, compH);

                        for (int y = yCtb; y < yHi; y++) {
                            const uint16_t* srcRow = origData + (ptrdiff_t)y * stride;
                            uint16_t* dstRow = destData + (ptrdiff_t)y * stride;
                            for (int x = xCtb; x < xHi; x++) {
                                int sample = srcRow[x];
                                // & 31 is a no-op while sample <= maxVal, which the
                                // decoder guarantees; it keeps a corrupt plane or an
                                // inconsistent bit depth from indexing past the table.
                                dstRow[x] = static_cast<uint16_t>(
                                    Clip3(0, maxVal, sample + bandOffs[(sample >> bandShift) & 31]));
                            }
                        }
                        continue;
                    }

                    for (int j = 0; j < nCtbSh; j++) {
                        int ySj = yCtb + j;
                        if (ySj >= compH) break;
                        for (int i = 0; i < nCtbSw; i++) {
                            int xSi = xCtb + i;
                            if (xSi >= compW) break;

                            if (ctbHasPcmOrBypass) {
                                int xY = (cIdx == 0) ? xSi : xSi * subW;
                                int yY = (cIdx == 0) ? ySj : ySj * subH;
                                auto& cu = ctx.cu_at(xY, yY);
                                if ((pcmFilterDisabled && cu.is_pcm) || cu.cu_transquant_bypass)
                                    continue;
                            }

                            int sample = origData[ySj * stride + xSi];
                            int band = sample >> bandShift;
                            int bandIdx = band - bandPos;
                            if (bandIdx >= 0 && bandIdx < 4) {
                                int offset = sao.sao_offset_val[cIdx][bandIdx];
                                if (offset != 0) {
                                    destData[ySj * stride + xSi] =
                                        static_cast<uint16_t>(Clip3(0, maxVal, sample + offset));
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
