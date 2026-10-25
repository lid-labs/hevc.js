#include "decoding/coding_tree.h"
#include "decoding/syntax_elements.h"
#include "decoding/cabac_tables.h"
#include "decoding/interpolation.h"
#include "decoding/dpb.h"
#include "common/debug.h"

#include <cstring>
#include <algorithm>

namespace hevc {

// Forward declarations for residual/transform/intra (implemented in separate files)
void decode_residual_coding(DecodingContext& ctx, int x0, int y0,
                            int log2TrafoSize, int cIdx,
                            int16_t* coefficients);
void perform_dequant(DecodingContext& ctx, int x0, int y0,
                     int log2TrafoSize, int cIdx, int qp,
                     const int16_t* coefficients, int16_t* scaled);
void perform_transform_inverse(int log2TrafoSize, int cIdx,
                                bool is_intra, bool transform_skip,
                                int bit_depth,
                                const int16_t* scaled, int16_t* residual);
void perform_intra_prediction(DecodingContext& ctx, int x0, int y0,
                              int log2PredSize, int cIdx, int intra_mode,
                              int16_t* pred_samples);

// ============================================================
// DecodingContext helpers
// ============================================================

void DecodingContext::set_intra_mode(int x, int y, int size, int mode) {
    int minTbSize = kGridSize;
    int x0 = x / minTbSize;
    int y0 = y / minTbSize;
    int n = std::max(1, size / minTbSize);
    for (int j = 0; j < n; j++)
        for (int i = 0; i < n; i++)
            intra_pred_mode_y[(y0 + j) * intra_pred_mode_stride + (x0 + i)] = mode;
}

void DecodingContext::set_chroma_mode(int x, int y, int size, int mode) {
    int minTbSize = kGridSize;
    int x0 = x / minTbSize;
    int y0 = y / minTbSize;
    int n = std::max(1, size / minTbSize);
    for (int j = 0; j < n; j++)
        for (int i = 0; i < n; i++)
            intra_pred_mode_c[(y0 + j) * intra_pred_mode_stride + (x0 + i)] = mode;
}

// ============================================================
// SAO parsing stub (§7.3.8.3)
// ============================================================

static void decode_sao(DecodingContext& ctx, int rx, int ry) {
    // §7.3.8.3 — Parse SAO parameters and store for Phase 6 filtering
    auto& cabac = *ctx.cabac;
    auto& sh = *ctx.sh;
    int CtbAddrInRs = ry * ctx.sps->PicWidthInCtbsY + rx;
    auto& sao = ctx.sao_params[ry * ctx.sao_params_stride + rx];
    sao = DecodingContext::SaoParams{}; // reset

    bool sao_merge_left_flag = false;
    bool sao_merge_up_flag = false;

    if (rx > 0) {
        bool leftInSlice = (CtbAddrInRs > static_cast<int>(sh.SliceAddrRs));
        bool leftInTile = (ctx.pps->TileId.empty() ||
            ctx.pps->TileId[ctx.pps->CtbAddrRsToTs[CtbAddrInRs]] ==
            ctx.pps->TileId[ctx.pps->CtbAddrRsToTs[CtbAddrInRs - 1]]);
        if (leftInSlice && leftInTile)
            sao_merge_left_flag = decode_sao_merge_flag(cabac);
    }

    if (ry > 0 && !sao_merge_left_flag) {
        int upAddr = CtbAddrInRs - ctx.sps->PicWidthInCtbsY;
        bool upInSlice = (upAddr >= static_cast<int>(sh.SliceAddrRs));
        bool upInTile = (ctx.pps->TileId.empty() ||
            ctx.pps->TileId[ctx.pps->CtbAddrRsToTs[CtbAddrInRs]] ==
            ctx.pps->TileId[ctx.pps->CtbAddrRsToTs[upAddr]]);
        if (upInSlice && upInTile)
            sao_merge_up_flag = decode_sao_merge_flag(cabac);
    }

    if (sao_merge_left_flag) {
        // Copy all params from left CTU
        sao = ctx.sao_params[ry * ctx.sao_params_stride + (rx - 1)];
        return;
    }
    if (sao_merge_up_flag) {
        // Copy all params from above CTU
        sao = ctx.sao_params[(ry - 1) * ctx.sao_params_stride + rx];
        return;
    }

    int numComp = (ctx.sps->ChromaArrayType != 0) ? 3 : 1;
    int sao_type_idx_chroma = 0; // §7.4.9.3: SaoTypeIdx[2] = SaoTypeIdx[1]
    for (int cIdx = 0; cIdx < numComp; cIdx++) {
        if ((sh.slice_sao_luma_flag && cIdx == 0) ||
            (sh.slice_sao_chroma_flag && cIdx > 0)) {
            int sao_type_idx = 0;
            if (cIdx == 0) {
                sao_type_idx = decode_sao_type_idx(cabac);
            } else if (cIdx == 1) {
                sao_type_idx = decode_sao_type_idx(cabac);
                sao_type_idx_chroma = sao_type_idx;
            } else {
                // §7.4.9.3: SaoTypeIdx[2][rx][ry] = SaoTypeIdx[1][rx][ry]
                sao_type_idx = sao_type_idx_chroma;
            }
            sao.sao_type_idx[cIdx] = sao_type_idx;

            if (sao_type_idx != 0) {
                int bitDepth = (cIdx == 0) ? ctx.sps->BitDepthY : ctx.sps->BitDepthC;
                int maxOff = (1 << (std::min(bitDepth, 10) - 5)) - 1;
                int sao_offset_abs_val[4] = {};
                for (int i = 0; i < 4; i++) {
                    // sao_offset_abs: TR cMax=maxOff, bypass
                    int val = 0;
                    for (int k = 0; k < maxOff; k++) {
                        if (cabac.decode_bypass() == 0) break;
                        val++;
                    }
                    sao_offset_abs_val[i] = val;
                }
                int sao_offset_sign[4] = {};
                if (sao_type_idx == 1) {
                    // Band offset: sign parsed, band_position parsed
                    for (int i = 0; i < 4; i++) {
                        if (sao_offset_abs_val[i] != 0)
                            sao_offset_sign[i] = cabac.decode_bypass();
                    }
                    sao.sao_band_position[cIdx] = cabac.decode_bypass_bins(5);
                } else {
                    // Edge offset: sign is fixed per category, eo_class parsed
                    if (cIdx == 0)
                        sao.sao_eo_class[cIdx] = cabac.decode_bypass_bins(2);
                    if (cIdx == 1) {
                        int eo_class = cabac.decode_bypass_bins(2);
                        sao.sao_eo_class[1] = eo_class;
                        sao.sao_eo_class[2] = eo_class; // §7.4.9.3: Cr shares Cb eo_class
                    }
                }

                // §7.4.9.3: Derive SaoOffsetVal
                // sao_offset_val[cIdx][0..4] maps to categories 0..4
                // Category 2 (flat) always has offset 0
                sao.sao_offset_val[cIdx][2] = 0; // flat
                if (sao_type_idx == 2) {
                    // Edge offset: categories 0,1 positive; 3,4 negative
                    sao.sao_offset_val[cIdx][0] = sao_offset_abs_val[0];   // valley
                    sao.sao_offset_val[cIdx][1] = sao_offset_abs_val[1];   // concave
                    sao.sao_offset_val[cIdx][3] = -sao_offset_abs_val[2];  // convex
                    sao.sao_offset_val[cIdx][4] = -sao_offset_abs_val[3];  // peak
                } else {
                    // Band offset: sign from bitstream
                    for (int i = 0; i < 4; i++) {
                        int val = sao_offset_abs_val[i];
                        if (sao_offset_sign[i]) val = -val;
                        sao.sao_offset_val[cIdx][i] = val;
                    }
                    sao.sao_offset_val[cIdx][4] = 0; // unused for band
                }
            }
        }
    }
}

// ============================================================
// split_cu_flag context derivation (§9.3.4.2.2)
// ============================================================

// §6.4.1: check if neighbour CTU at (nx,ny) is available (same slice, same tile, already decoded)
static bool is_ctb_available(const DecodingContext& ctx, int curX, int curY, int nbX, int nbY) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    if (nbX < 0 || nbY < 0 ||
        nbX >= static_cast<int>(sps.pic_width_in_luma_samples) ||
        nbY >= static_cast<int>(sps.pic_height_in_luma_samples))
        return false;
    int ctbSize = 1 << sps.CtbLog2SizeY;
    int curAddr = (curY / ctbSize) * sps.PicWidthInCtbsY + (curX / ctbSize);
    int nbAddr  = (nbY / ctbSize) * sps.PicWidthInCtbsY + (nbX / ctbSize);
    // Must be already decoded (in tile scan order)
    if (pps.CtbAddrRsToTs[nbAddr] > pps.CtbAddrRsToTs[curAddr])
        return false;
    // §6.4.1: SliceAddrRs must match
    if (ctx.slice_idx && ctx.slice_idx[nbAddr] != ctx.slice_idx[curAddr])
        return false;
    // Same tile check
    if (pps.TileId.size() > 0 && pps.TileId[pps.CtbAddrRsToTs[nbAddr]] != pps.TileId[pps.CtbAddrRsToTs[curAddr]])
        return false;
    return true;
}

static int derive_split_cu_flag_ctx(const DecodingContext& ctx, int x0, int y0,
                                     int log2CbSize) {
    int ctxInc = 0;

    // Left neighbour — §6.4.1 availability
    int xL = x0 - 1;
    if (xL >= 0 && is_ctb_available(ctx, x0, y0, xL, y0)) {
        const auto& cuL = ctx.cu_at(xL, y0);
        if (cuL.log2CbSize > 0 && cuL.log2CbSize < log2CbSize)
            ctxInc++;
    }

    // Above neighbour — §6.4.1 availability
    int yA = y0 - 1;
    if (yA >= 0 && is_ctb_available(ctx, x0, y0, x0, yA)) {
        const auto& cuA = ctx.cu_at(x0, yA);
        if (cuA.log2CbSize > 0 && cuA.log2CbSize < log2CbSize)
            ctxInc++;
    }

    return ctxInc;
}

// ============================================================
// cu_skip_flag context derivation
// ============================================================

static int derive_cu_skip_flag_ctx(const DecodingContext& ctx, int x0, int y0) {
    int ctxInc = 0;

    int xL = x0 - 1;
    if (xL >= 0 && is_ctb_available(ctx, x0, y0, xL, y0)) {
        const auto& cuL = ctx.cu_at(xL, y0);
        if (cuL.pred_mode == PredMode::MODE_SKIP) ctxInc++;
    }

    int yA = y0 - 1;
    if (yA >= 0 && is_ctb_available(ctx, x0, y0, x0, yA)) {
        const auto& cuA = ctx.cu_at(x0, yA);
        if (cuA.pred_mode == PredMode::MODE_SKIP) ctxInc++;
    }

    return ctxInc;
}

// ============================================================
// MPM derivation (§8.4.2)
// ============================================================

static void derive_mpm(const DecodingContext& ctx, int x0, int y0, int /*puSize*/,
                        int candModeList[3]) {
    // Left neighbour — §8.4.2 step 2 with §6.4.1 availability
    int xL = x0 - 1;
    int candA = 1; // DC default if not available
    if (xL >= 0 && is_ctb_available(ctx, x0, y0, xL, y0)) {
        const auto& cuL = ctx.cu_at(xL, y0);
        if (cuL.pred_mode == PredMode::MODE_INTRA)
            candA = ctx.intra_mode_at(xL, y0);
    }

    // Above neighbour — §8.4.2 step 2: cross-CTU-row → DC, plus §6.4.1
    int yA = y0 - 1;
    int candB = 1; // DC default if not available
    if (yA >= 0) {
        // §8.4.2: if yPb-1 < ((yPb >> CtbLog2SizeY) << CtbLog2SizeY),
        // the above neighbour is in a different CTB row → use DC
        int ctbRowStart = (y0 >> ctx.sps->CtbLog2SizeY) << ctx.sps->CtbLog2SizeY;
        if (yA >= ctbRowStart && is_ctb_available(ctx, x0, y0, x0, yA)) {
            const auto& cuA = ctx.cu_at(x0, yA);
            if (cuA.pred_mode == PredMode::MODE_INTRA)
                candB = ctx.intra_mode_at(x0, yA);
        }
    }

    // Derive 3 MPM candidates
    if (candA == candB) {
        if (candA < 2) {
            candModeList[0] = 0;  // Planar
            candModeList[1] = 1;  // DC
            candModeList[2] = 26; // Vertical
        } else {
            candModeList[0] = candA;
            candModeList[1] = 2 + ((candA + 29) % 32);       // eq 8-25
            candModeList[2] = 2 + ((candA - 2 + 1) % 32);    // eq 8-26
        }
    } else {
        candModeList[0] = candA;
        candModeList[1] = candB;
        if (candA != 0 && candB != 0)
            candModeList[2] = 0;  // Planar
        else if (candA != 1 && candB != 1)
            candModeList[2] = 1;  // DC
        else
            candModeList[2] = 26; // Vertical
    }
}

// ============================================================
// Chroma intra mode derivation (§8.4.3)
// ============================================================

static int derive_chroma_intra_mode(int coded_mode, int luma_mode) {
    // coded_mode: 0=Planar, 1=V(26), 2=H(10), 3=DC(1), 4=DM(=luma_mode)
    if (coded_mode == 4) return luma_mode;

    static const int chroma_cand[4] = { 0, 26, 10, 1 };
    int mode = chroma_cand[coded_mode];

    // If chroma mode equals luma mode, replace with mode 34
    if (mode == luma_mode) mode = 34;

    return mode;
}

// ============================================================
// QP derivation (§8.6.1)
// ============================================================

static int derive_qp_y(DecodingContext& ctx, int xCb, int yCb) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    auto& sh = *ctx.sh;

    if (!pps.cu_qp_delta_enabled_flag) {
        return sh.SliceQpY;
    }

    // §8.6.1: Derive QG top-left coordinates
    int qgMask = (1 << pps.Log2MinCuQpDeltaSize) - 1;
    int xQg = xCb - (xCb & qgMask);
    int yQg = yCb - (yCb & qgMask);

    // §8.6.1 step 1: qPY_PREV — saved at QG boundary, not updated within QG
    int qpPrev = ctx.QpY_prev_qg;

    // §8.6.1 step 2: qPY_A from CU at (xQg - 1, yQg)
    int qpPredA = qpPrev;
    if (xQg - 1 >= 0) {
        // Check that (xQg-1, yQg) is in the same CTB as current
        int ctbAddrCur = (yCb >> sps.CtbLog2SizeY) * sps.PicWidthInCtbsY +
                         (xCb >> sps.CtbLog2SizeY);
        int ctbAddrA   = (yQg >> sps.CtbLog2SizeY) * sps.PicWidthInCtbsY +
                         ((xQg - 1) >> sps.CtbLog2SizeY);
        if (pps.CtbAddrRsToTs[ctbAddrA] == pps.CtbAddrRsToTs[ctbAddrCur]) {
            qpPredA = ctx.cu_at(xQg - 1, yQg).qp_y;
        }
    }

    // §8.6.1 step 3: qPY_B from CU at (xQg, yQg - 1)
    int qpPredB = qpPrev;
    if (yQg - 1 >= 0) {
        int ctbAddrCur = (yCb >> sps.CtbLog2SizeY) * sps.PicWidthInCtbsY +
                         (xCb >> sps.CtbLog2SizeY);
        int ctbAddrB   = ((yQg - 1) >> sps.CtbLog2SizeY) * sps.PicWidthInCtbsY +
                         (xQg >> sps.CtbLog2SizeY);
        if (pps.CtbAddrRsToTs[ctbAddrB] == pps.CtbAddrRsToTs[ctbAddrCur]) {
            qpPredB = ctx.cu_at(xQg, yQg - 1).qp_y;
        }
    }

    // §8.6.1 step 4: predicted QP
    int qpPred = (qpPredA + qpPredB + 1) >> 1;

    // §8.6.1 eq 8-283
    int QpY = ((qpPred + ctx.CuQpDeltaVal + 52 + 2 * sps.QpBdOffsetY) %
               (52 + sps.QpBdOffsetY)) - sps.QpBdOffsetY;

    return QpY;
}

// ============================================================
// Reconstruction: pred + residual, clipping (§8.6.5)
// ============================================================

static void reconstruct_block(DecodingContext& ctx, int x0, int y0,
                               int log2Size, int cIdx,
                               const int16_t* pred, const int16_t* residual) {
    int size = 1 << log2Size;
    int bitDepth = (cIdx == 0) ? ctx.sps->BitDepthY : ctx.sps->BitDepthC;
    int maxVal = (1 << bitDepth) - 1;
    auto& pic = *ctx.pic;

    // For chroma, convert luma coordinates to chroma
    int xC = (cIdx > 0) ? x0 / ctx.sps->SubWidthC : x0;
    int yC = (cIdx > 0) ? y0 / ctx.sps->SubHeightC : y0;

    int picW = (cIdx == 0) ? ctx.sps->pic_width_in_luma_samples :
               ctx.sps->pic_width_in_luma_samples / ctx.sps->SubWidthC;
    int picH = (cIdx == 0) ? ctx.sps->pic_height_in_luma_samples :
               ctx.sps->pic_height_in_luma_samples / ctx.sps->SubHeightC;

    for (int j = 0; j < size; j++) {
        for (int i = 0; i < size; i++) {
            if (xC + i >= picW || yC + j >= picH) continue;
            int val = pred[j * size + i] + residual[j * size + i];
            val = Clip3(0, maxVal, val);
            pic.sample(cIdx, xC + i, yC + j) = static_cast<uint16_t>(val);
        }
    }
}

// ============================================================
// WPP parallel decode — §7.3.8.1 with wavefront parallelism
// Each CTU row is a job submitted to the thread pool.
// Row N waits for col+1 of row N-1 (2-CTU diagonal dependency).
// ============================================================

static bool decode_wpp_parallel(DecodingContext& ctx, BitstreamReader& bs,
                                 const std::vector<size_t>& substream_byte_pos) {
    auto& sps = *ctx.sps;
    auto& sh = *ctx.sh;

    int numRows = sps.PicHeightInCtbsY;
    int numCols = sps.PicWidthInCtbsY;
    int startRow = (sh.slice_segment_address / numCols);

    // Per-row synchronization: completed_col[row] = last completed column (-1 = not started)
    std::vector<std::atomic<int>> completed_col(numRows);
    for (int r = 0; r < numRows; r++)
        completed_col[r].store(-1, std::memory_order_relaxed);

    // Per-row WPP saved contexts (row r saves at col 1, row r+1 restores at start)
    std::vector<CabacContext> wpp_ctx_storage(numRows * NUM_CABAC_CONTEXTS);
    auto wpp_ctx_ptr = [&](int row) -> CabacContext* {
        return &wpp_ctx_storage[row * NUM_CABAC_CONTEXTS];
    };

    // All readers share the same underlying data buffer (read-only)
    const uint8_t* rbsp_data = bs.data();
    size_t rbsp_size = bs.size();

    int sliceType = static_cast<int>(sh.slice_type);

    // Per-row sync: mutex + condvar per row for fine-grained waiting
    std::vector<std::mutex> row_mutex(numRows);
    std::vector<std::condition_variable> row_cv(numRows);

    auto decode_row = [&](int row) {
        // Per-row BitstreamReader and CabacEngine
        BitstreamReader row_bs(rbsp_data, rbsp_size);
        CabacEngine row_cabac;

        // Seek to this row's substream
        int substreamIdx = row - startRow;
        if (substreamIdx >= 0 && substreamIdx < static_cast<int>(substream_byte_pos.size())) {
            row_bs.seek_to_byte(substream_byte_pos[substreamIdx]);
        }

        // Init CABAC contexts
        if (row == startRow) {
            if (!sh.dependent_slice_segment_flag) {
                row_cabac.init_contexts(sliceType, sh.SliceQpY, sh.cabac_init_flag);
            }
        } else {
            // Wait for row-1 col 1 (2nd CTU) before restoring contexts
            {
                std::unique_lock<std::mutex> lock(row_mutex[row - 1]);
                row_cv[row - 1].wait(lock, [&] {
                    return completed_col[row - 1].load(std::memory_order_acquire) >= 1;
                });
            }
            row_cabac.load_contexts(wpp_ctx_ptr(row - 1));
        }
        row_cabac.init_decoder(row_bs);

        // Per-row DecodingContext (shallow copy — shared grids, pic, etc.)
        DecodingContext row_ctx = ctx;
        row_ctx.cabac = &row_cabac;
        row_ctx.QpY_prev = sh.SliceQpY;
        row_ctx.QpY_prev_qg = sh.SliceQpY;

        for (int col = 0; col < numCols; col++) {
            int CtbAddrInRs = row * numCols + col;

            // Diagonal dependency: wait for row-1 to complete col+1
            if (row > startRow && col > 0) {
                int needed = std::min(col + 1, numCols - 1);
                std::unique_lock<std::mutex> lock(row_mutex[row - 1]);
                row_cv[row - 1].wait(lock, [&] {
                    return completed_col[row - 1].load(std::memory_order_acquire) >= needed;
                });
            }

            int xCtb = col << sps.CtbLog2SizeY;
            int yCtb = row << sps.CtbLog2SizeY;

            // Phase 10: record slice ownership
            if (row_ctx.slice_idx) {
                row_ctx.slice_idx[CtbAddrInRs] = static_cast<uint16_t>(ctx.current_slice_idx);
            }

            decode_coding_tree_unit(row_ctx, xCtb, yCtb);

            // §9.3.2.4: save contexts after 2nd CTU (col 1) for next row
            if (col == 1) {
                row_cabac.save_contexts(wpp_ctx_ptr(row));
            }

            // Signal completion and notify waiting rows
            {
                std::lock_guard<std::mutex> lock(row_mutex[row]);
                completed_col[row].store(col, std::memory_order_release);
            }
            row_cv[row].notify_all();

            bool end_of_slice = decode_end_of_slice_segment_flag(row_cabac);
            if (end_of_slice || col == numCols - 1)
                break;
        }

        // Final notify for rows that might wait on last column
        {
            std::lock_guard<std::mutex> lock(row_mutex[row]);
            completed_col[row].store(numCols - 1, std::memory_order_release);
        }
        row_cv[row].notify_all();
    };

    int num_active_rows = numRows - startRow;

    if (num_active_rows <= 1 || !ctx.thread_pool || ctx.thread_pool->num_workers() <= 1) {
        decode_row(startRow);
        return true;
    }

    // Submit worker rows to thread pool; run first row on current thread
    for (int r = startRow + 1; r < numRows; r++) {
        ctx.thread_pool->submit([&decode_row, r]() { decode_row(r); });
    }
    decode_row(startRow);
    ctx.thread_pool->wait_all();

    return true;
}

// ============================================================
// slice_segment_data (§7.3.8.1)
// ============================================================

bool decode_slice_segment_data(DecodingContext& ctx, BitstreamReader& bs,
                                const std::vector<size_t>& epb_positions,
                                size_t slice_header_coded_size) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    auto& sh = *ctx.sh;
    auto& cabac = *ctx.cabac;

    // §7.3.8.1: Compute RBSP byte positions of WPP/tile substreams.
    // entry_point_offsets are in bytes of the coded slice data (including EP bytes).
    // We must convert to RBSP positions (EP bytes removed).
    size_t slice_data_rbsp_start = bs.byte_position();
    std::vector<size_t> substream_byte_pos;
    if (sh.num_entry_point_offsets > 0) {
        substream_byte_pos.resize(sh.num_entry_point_offsets + 1);
        substream_byte_pos[0] = slice_data_rbsp_start;

        // Cumulative coded offsets from slice data start
        size_t coded_offset = 0;
        for (uint32_t i = 0; i < sh.num_entry_point_offsets; i++) {
            coded_offset += sh.entry_point_offset_minus1[i] + 1;
            if (!epb_positions.empty()) {
                // Convert coded offset to RBSP offset accounting for EP bytes
                size_t rbsp_off = coded_to_rbsp_offset(coded_offset,
                                                        slice_header_coded_size,
                                                        epb_positions);
                substream_byte_pos[i + 1] = slice_data_rbsp_start + rbsp_off;
            } else {
                // No EP bytes tracked — use coded offset directly (works when no EP bytes)
                substream_byte_pos[i + 1] = slice_data_rbsp_start + coded_offset;
            }
        }
    }

    // WPP parallel path: rows decoded in parallel via the thread pool. It
    // assumes one slice segment covering the whole picture, one substream per
    // row, and a row above that saves contexts after its second CTB — so a
    // picture with several segments, or one CTB wide, takes the serial path.
    if (pps.entropy_coding_sync_enabled_flag && !pps.tiles_enabled_flag &&
        ctx.num_slices == 1 && sh.slice_segment_address == 0 &&
        sps.PicWidthInCtbsY >= 2 &&
        sh.num_entry_point_offsets + 1 == static_cast<uint32_t>(sps.PicHeightInCtbsY) &&
        ctx.thread_pool && ctx.thread_pool->num_workers() > 1) {
        return decode_wpp_parallel(ctx, bs, substream_byte_pos);
    }

    uint32_t substream_idx = 0;

    // CTU scan
    int CtbAddrInTs = pps.CtbAddrRsToTs[sh.slice_segment_address];
    int CtbAddrInRs = sh.slice_segment_address;

    const int picWCtbs = sps.PicWidthInCtbsY;
    auto init_contexts = [&]() {
        cabac.init_contexts(static_cast<int>(sh.slice_type), sh.SliceQpY, sh.cabac_init_flag);
    };
    // §9.3.1: a CTB row of WPP syncs from the contexts saved after the CTB above
    // and to the right, when that CTB is available (§6.4.1): inside the picture,
    // already decoded, in the same slice and the same tile. Otherwise the row
    // starts from initialised contexts.
    auto wpp_sync_available = [&](int rs) {
        int col = rs % picWCtbs;
        if (rs < picWCtbs || col + 1 >= picWCtbs) return false;
        int tr = rs - picWCtbs + 1;
        if (pps.CtbAddrRsToTs[tr] > pps.CtbAddrRsToTs[rs]) return false;
        if (ctx.slice_idx && ctx.slice_idx[tr] != ctx.current_slice_idx) return false;
        if (pps.tiles_enabled_flag &&
            pps.TileId[pps.CtbAddrRsToTs[tr]] != pps.TileId[pps.CtbAddrRsToTs[rs]])
            return false;
        return ctx.wpp_contexts_available;
    };

    // Initialize CABAC (§9.3.1), in this order: a segment that starts a tile
    // initialises; one that starts a WPP row syncs as any row does; a dependent
    // segment carries the contexts over from the previous segment; anything
    // else initialises.
    bool starts_tile = pps.tiles_enabled_flag &&
        (CtbAddrInTs == 0 || pps.TileId[CtbAddrInTs] != pps.TileId[CtbAddrInTs - 1]);
    bool starts_wpp_row = pps.entropy_coding_sync_enabled_flag &&
        (CtbAddrInRs % picWCtbs == 0 ||
         (pps.tiles_enabled_flag &&
          pps.TileId[CtbAddrInTs] != pps.TileId[pps.CtbAddrRsToTs[CtbAddrInRs - 1]]));
    if (starts_tile) {
        init_contexts();
        ctx.wpp_contexts_available = false;
    } else if (starts_wpp_row) {
        if (wpp_sync_available(CtbAddrInRs)) cabac.load_contexts(ctx.wpp_saved_contexts);
        else init_contexts();
    } else if (!sh.dependent_slice_segment_flag) {
        init_contexts();
    }
    cabac.init_decoder(bs);

    // §8.6.1: qPY_PREV restarts at SliceQpY at the first quantization group of
    // a slice, a tile, or a WPP row — not of a dependent slice segment, which
    // continues from the previous segment.
    if (!sh.dependent_slice_segment_flag || starts_tile || starts_wpp_row) {
        ctx.QpY_prev = sh.SliceQpY;
        ctx.QpY_prev_qg = sh.SliceQpY;
    }

    HEVC_LOG(TREE, "slice_segment_data: addr=%d type=%d QP=%d entry_points=%u",
             sh.slice_segment_address, static_cast<int>(sh.slice_type),
             sh.SliceQpY, sh.num_entry_point_offsets);

    bool end_of_slice = false;
    while (!end_of_slice) {
        int xCtb = (CtbAddrInRs % sps.PicWidthInCtbsY) << sps.CtbLog2SizeY;
        int yCtb = (CtbAddrInRs / sps.PicWidthInCtbsY) << sps.CtbLog2SizeY;
        int ctuCol = CtbAddrInRs % sps.PicWidthInCtbsY;

        [[maybe_unused]] size_t bits_before = bs.bits_read();
        HEVC_LOG(TREE, "CTU addr_rs=%d pos=(%d,%d) bits=%zu bins=%d",
                 CtbAddrInRs, xCtb, yCtb, bits_before, cabac.bin_count());

        // Phase 10: record slice ownership for this CTU
        if (ctx.slice_idx) {
            ctx.slice_idx[CtbAddrInRs] = static_cast<uint16_t>(ctx.current_slice_idx);
        }

        decode_coding_tree_unit(ctx, xCtb, yCtb);
        HEVC_LOG(TREE, "CTU addr_rs=%d consumed %zu bits, remaining=%zu",
                 CtbAddrInRs, bs.bits_read() - bits_before, bs.bits_remaining());

        // §9.3.2.2: WPP — save contexts after the 2nd CTU of each row of the
        // tile, i.e. one past the tile's first column
        if (pps.entropy_coding_sync_enabled_flag) {
            int tileCol0 = 0;
            if (pps.tiles_enabled_flag) {
                int rowStart = CtbAddrInRs - ctuCol;
                tileCol0 = ctuCol;
                while (tileCol0 > 0 &&
                       pps.TileId[pps.CtbAddrRsToTs[rowStart + tileCol0 - 1]] ==
                       pps.TileId[CtbAddrInTs])
                    tileCol0--;
            }
            if (ctuCol == tileCol0 + 1) {
                cabac.save_contexts(ctx.wpp_saved_contexts);
                ctx.wpp_contexts_available = true;
            }
        }

        end_of_slice = decode_end_of_slice_segment_flag(cabac);

        if (!end_of_slice) {
            CtbAddrInTs++;
            if (CtbAddrInTs >= sps.PicSizeInCtbsY) break;
            CtbAddrInRs = pps.CtbAddrTsToRs[CtbAddrInTs];

            // Tile boundary (§7.3.8.1): each tile is a substream. Seek to its
            // entry point rather than byte-aligning the reader, which the CABAC
            // engine has already read past.
            bool new_tile = pps.tiles_enabled_flag &&
                pps.TileId[CtbAddrInTs] != pps.TileId[CtbAddrInTs - 1];
            if (new_tile) {
                cabac.decode_terminate(); // end_of_subset_one_bit
                substream_idx++;
                if (substream_idx < substream_byte_pos.size()) {
                    bs.seek_to_byte(substream_byte_pos[substream_idx]);
                } else {
                    bs.byte_alignment();
                }
                // §9.3.1: a tile starts with freshly initialised contexts, and
                // WPP rows in it never sync from another tile
                init_contexts();
                ctx.wpp_contexts_available = false;
                cabac.init_decoder(bs);
                // §8.6.1: Reset QpY_prev at first QG in a tile
                ctx.QpY_prev = sh.SliceQpY;
                ctx.QpY_prev_qg = sh.SliceQpY;
            }

            // WPP boundary (§7.3.8.1 / §9.2.2): at end of each CTU row,
            // seek to the next substream (via entry_point_offset), reinit CABAC,
            // and restore contexts from the 2nd CTU of the previous row.
            if (pps.entropy_coding_sync_enabled_flag) {
                int prevRs = pps.CtbAddrTsToRs[CtbAddrInTs - 1];
                int prevRow = prevRs / sps.PicWidthInCtbsY;
                int curRow  = CtbAddrInRs / sps.PicWidthInCtbsY;
                if (curRow != prevRow && !new_tile) {
                    substream_idx++;
                    // Seek to the exact byte position of this substream
                    if (substream_idx < substream_byte_pos.size()) {
                        bs.seek_to_byte(substream_byte_pos[substream_idx]);
                    }
                    cabac.init_decoder(bs);
                    // §8.6.1: Reset QpY_prev at first QG of each CTB row (WPP)
                    ctx.QpY_prev = sh.SliceQpY;
                    ctx.QpY_prev_qg = sh.SliceQpY;
                    // §9.3.1: sync from the CTB above and to the right
                    if (wpp_sync_available(CtbAddrInRs)) {
                        cabac.load_contexts(ctx.wpp_saved_contexts);
                    } else {
                        init_contexts();
                    }
                }
            }
        }
    }

    return true;
}

// ============================================================
// coding_tree_unit (§7.3.8.2)
// ============================================================

void decode_coding_tree_unit(DecodingContext& ctx, int xCtb, int yCtb) {
    // SAO parsing (store params for Phase 6)
    if (ctx.sh->slice_sao_luma_flag || ctx.sh->slice_sao_chroma_flag) {
        int rx = xCtb >> ctx.sps->CtbLog2SizeY;
        int ry = yCtb >> ctx.sps->CtbLog2SizeY;
        decode_sao(ctx, rx, ry);
    }

    // QP group reset (CTU level)
    if (ctx.pps->cu_qp_delta_enabled_flag) {
        ctx.IsCuQpDeltaCoded = false;
        ctx.CuQpDeltaVal = 0;
        ctx.QpY_prev_qg = ctx.QpY_prev;
    }

    decode_coding_quadtree(ctx, xCtb, yCtb, ctx.sps->CtbLog2SizeY, 0);
}

// ============================================================
// coding_quadtree (§7.3.8.4)
// ============================================================

void decode_coding_quadtree(DecodingContext& ctx, int x0, int y0,
                            int log2CbSize, int ctDepth) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    int cbSize = 1 << log2CbSize;

    bool split = false;

    // Determine if split_cu_flag needs to be read
    bool atBoundary = (x0 + cbSize > static_cast<int>(sps.pic_width_in_luma_samples)) ||
                      (y0 + cbSize > static_cast<int>(sps.pic_height_in_luma_samples));

    if (atBoundary) {
        // Force split if we exceed picture boundaries and can still split
        if (log2CbSize > sps.MinCbLog2SizeY)
            split = true;
    } else if (log2CbSize > sps.MinCbLog2SizeY) {
        int ctxInc = derive_split_cu_flag_ctx(ctx, x0, y0, log2CbSize);
        split = decode_split_cu_flag(*ctx.cabac, ctxInc);
    }

    // QP group boundary — §8.6.1
    if (pps.cu_qp_delta_enabled_flag && log2CbSize >= pps.Log2MinCuQpDeltaSize) {
        ctx.IsCuQpDeltaCoded = false;
        ctx.CuQpDeltaVal = 0;
        ctx.QpY_prev_qg = ctx.QpY_prev;
    }

    if (split) {
        int x1 = x0 + (1 << (log2CbSize - 1));
        int y1 = y0 + (1 << (log2CbSize - 1));
        int picW = static_cast<int>(sps.pic_width_in_luma_samples);
        int picH = static_cast<int>(sps.pic_height_in_luma_samples);

        decode_coding_quadtree(ctx, x0, y0, log2CbSize - 1, ctDepth + 1);
        if (x1 < picW)
            decode_coding_quadtree(ctx, x1, y0, log2CbSize - 1, ctDepth + 1);
        if (y1 < picH)
            decode_coding_quadtree(ctx, x0, y1, log2CbSize - 1, ctDepth + 1);
        if (x1 < picW && y1 < picH)
            decode_coding_quadtree(ctx, x1, y1, log2CbSize - 1, ctDepth + 1);
    } else {
        decode_coding_unit(ctx, x0, y0, log2CbSize);
    }
}

// ============================================================
// coding_unit (§7.3.8.5)
// ============================================================

void decode_coding_unit(DecodingContext& ctx, int x0, int y0, int log2CbSize) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    auto& sh = *ctx.sh;
    auto& cabac = *ctx.cabac;

    int cbSize = 1 << log2CbSize;

    bool cu_transquant_bypass = false;
    if (pps.transquant_bypass_enabled_flag) {
        cu_transquant_bypass = decode_cu_transquant_bypass_flag(cabac);
    }

    bool cu_skip = false;
    if (sh.slice_type != SliceType::I) {
        int ctxInc = derive_cu_skip_flag_ctx(ctx, x0, y0);
        cu_skip = decode_cu_skip_flag(cabac, ctxInc);
    }

    PredMode pred_mode = PredMode::MODE_INTRA;
    PartMode part_mode = PartMode::PART_2Nx2N;

    if (cu_skip) {
        // §7.3.8.5: Skip mode = merge without residual
        pred_mode = PredMode::MODE_SKIP;
        HEVC_LOG(TREE, "CU (%d,%d) %dx%d SKIP", x0, y0, cbSize, cbSize);

        // Store pred_mode in grid BEFORE decode_prediction_unit_inter
        // so that it correctly selects the merge path (not AMVP)
        {
            int n = cbSize / sps.MinCbSizeY;
            for (int j = 0; j < n; j++)
                for (int i = 0; i < n; i++)
                    ctx.cu_at(x0 + i * sps.MinCbSizeY,
                              y0 + j * sps.MinCbSizeY).pred_mode = PredMode::MODE_SKIP;
        }

        // prediction_unit for skip (always 2Nx2N) + motion compensation
        decode_prediction_unit_inter(ctx, x0, y0, cbSize, x0, y0, cbSize, cbSize, 0);
        {
            PUMotionInfo mi = get_pu_motion(ctx, x0, y0);
            int16_t pred[64*64];
            perform_inter_prediction(ctx, x0, y0, cbSize, cbSize, 0,
                mi.mv[0], mi.mv[1], mi.ref_idx[0], mi.ref_idx[1],
                mi.pred_flag[0], mi.pred_flag[1], pred);
            {
                uint16_t* dst = ctx.pic->planes[0].data();
                int dstStride = ctx.pic->stride[0];
                for (int y = 0; y < cbSize; y++) {
                    uint16_t* row = dst + (y0 + y) * dstStride + x0;
                    const int16_t* src = pred + y * cbSize;
                    for (int x = 0; x < cbSize; x++)
                        row[x] = static_cast<uint16_t>(src[x]);
                }
            }
            if (sps.ChromaArrayType != 0) {
                int cW = cbSize / sps.SubWidthC, cH = cbSize / sps.SubHeightC;
                int xC = x0 / sps.SubWidthC, yC = y0 / sps.SubHeightC;
                for (int c = 1; c <= 2; c++) {
                    int16_t cpred[32*32];
                    perform_inter_prediction(ctx, x0, y0, cbSize, cbSize, c,
                        mi.mv[0], mi.mv[1], mi.ref_idx[0], mi.ref_idx[1],
                        mi.pred_flag[0], mi.pred_flag[1], cpred);
                    uint16_t* dst = ctx.pic->planes[c].data();
                    int dstStride = ctx.pic->stride[c];
                    for (int y = 0; y < cH; y++) {
                        uint16_t* row = dst + (yC + y) * dstStride + xC;
                        const int16_t* src = cpred + y * cW;
                        for (int x = 0; x < cW; x++)
                            row[x] = static_cast<uint16_t>(src[x]);
                    }
                }
            }
        }
    } else {
        if (sh.slice_type != SliceType::I) {
            pred_mode = decode_pred_mode_flag(cabac) ?
                        PredMode::MODE_INTRA : PredMode::MODE_INTER;
        }

        if (pred_mode != PredMode::MODE_INTRA ||
            log2CbSize == sps.MinCbLog2SizeY) {
            part_mode = static_cast<PartMode>(
                decode_part_mode(cabac, pred_mode, log2CbSize,
                                 sps.MinCbLog2SizeY, sps.amp_enabled_flag));
        }
        HEVC_LOG(TREE, "CU (%d,%d) %dx%d pred=%d part=%d",
                 x0, y0, cbSize, cbSize, static_cast<int>(pred_mode),
                 static_cast<int>(part_mode));

        // §6.4.2: Store pred_mode and part_mode early so PU-level AMVP/merge
        // can see them for intra-CU neighbor availability (sameCb path)
        {
            int n_early = cbSize / sps.MinCbSizeY;
            for (int j = 0; j < n_early; j++)
                for (int i = 0; i < n_early; i++) {
                    auto& cu_early = ctx.cu_at(x0 + i * sps.MinCbSizeY,
                                               y0 + j * sps.MinCbSizeY);
                    cu_early.pred_mode = pred_mode;
                    cu_early.part_mode = part_mode;
                }
        }

        if (pred_mode == PredMode::MODE_INTRA) {
            // Check PCM — §7.3.8.5
            bool is_pcm = false;
            if (part_mode == PartMode::PART_2Nx2N && sps.pcm_enabled_flag &&
                log2CbSize >= sps.Log2MinIpcmCbSizeY &&
                log2CbSize <= sps.Log2MaxIpcmCbSizeY) {
                is_pcm = cabac.decode_terminate();
            }

            if (is_pcm) {
                decode_pcm_samples(ctx, x0, y0, log2CbSize);
                // Store CU info
                int n = cbSize / sps.MinCbSizeY;
                for (int j = 0; j < n; j++)
                    for (int i = 0; i < n; i++) {
                        auto& cu = ctx.cu_at(x0 + i * sps.MinCbSizeY,
                                              y0 + j * sps.MinCbSizeY);
                        cu.pred_mode = PredMode::MODE_INTRA;
                        cu.log2CbSize = log2CbSize;
                        cu.is_pcm = true;
                        cu.qp_y = ctx.QpY_prev;
                    }
                return;
            }

            // Intra prediction
            decode_prediction_unit_intra(ctx, x0, y0, log2CbSize, part_mode);
        }
        if (pred_mode == PredMode::MODE_INTER) {
            // §7.3.8.5: parse prediction_unit(s) and perform motion compensation
            auto mc_pu = [&](int xPb, int yPb, int nPbW, int nPbH, int partIdx) {
                decode_prediction_unit_inter(ctx, x0, y0, cbSize, xPb, yPb, nPbW, nPbH, partIdx);
                // §8.5.3: motion compensation → write prediction to picture
                PUMotionInfo mi = get_pu_motion(ctx, xPb, yPb);
                // Luma
                {
                    int16_t pred[64*64];
                    perform_inter_prediction(ctx, xPb, yPb, nPbW, nPbH, 0,
                        mi.mv[0], mi.mv[1], mi.ref_idx[0], mi.ref_idx[1],
                        mi.pred_flag[0], mi.pred_flag[1], pred);
                    {
                        uint16_t* dst = ctx.pic->planes[0].data();
                        int dstStride = ctx.pic->stride[0];
                        for (int y = 0; y < nPbH; y++) {
                            uint16_t* row = dst + (yPb + y) * dstStride + xPb;
                            const int16_t* src = pred + y * nPbW;
                            for (int x = 0; x < nPbW; x++)
                                row[x] = static_cast<uint16_t>(src[x]);
                        }
                    }
                }
                // Chroma (4:2:0)
                if (sps.ChromaArrayType != 0) {
                    int cW = nPbW / sps.SubWidthC;
                    int cH = nPbH / sps.SubHeightC;
                    int xC = xPb / sps.SubWidthC;
                    int yC = yPb / sps.SubHeightC;
                    for (int c = 1; c <= 2; c++) {
                        int16_t pred[32*32];
                        perform_inter_prediction(ctx, xPb, yPb, nPbW, nPbH, c,
                            mi.mv[0], mi.mv[1], mi.ref_idx[0], mi.ref_idx[1],
                            mi.pred_flag[0], mi.pred_flag[1], pred);
                        uint16_t* dst = ctx.pic->planes[c].data();
                        int dstStride = ctx.pic->stride[c];
                        for (int y = 0; y < cH; y++) {
                            uint16_t* row = dst + (yC + y) * dstStride + xC;
                            const int16_t* src = pred + y * cW;
                            for (int x = 0; x < cW; x++)
                                row[x] = static_cast<uint16_t>(src[x]);
                        }
                    }
                }
            };
            if (part_mode == PartMode::PART_2Nx2N) {
                mc_pu(x0, y0, cbSize, cbSize, 0);
            } else if (part_mode == PartMode::PART_2NxN) {
                mc_pu( x0, y0, cbSize, cbSize/2, 0);
                mc_pu( x0, y0+cbSize/2, cbSize, cbSize/2, 1);
            } else if (part_mode == PartMode::PART_Nx2N) {
                mc_pu( x0, y0, cbSize/2, cbSize, 0);
                mc_pu( x0+cbSize/2, y0, cbSize/2, cbSize, 1);
            } else if (part_mode == PartMode::PART_2NxnU) {
                mc_pu( x0, y0, cbSize, cbSize/4, 0);
                mc_pu( x0, y0+cbSize/4, cbSize, cbSize*3/4, 1);
            } else if (part_mode == PartMode::PART_2NxnD) {
                mc_pu( x0, y0, cbSize, cbSize*3/4, 0);
                mc_pu( x0, y0+cbSize*3/4, cbSize, cbSize/4, 1);
            } else if (part_mode == PartMode::PART_nLx2N) {
                mc_pu( x0, y0, cbSize/4, cbSize, 0);
                mc_pu( x0+cbSize/4, y0, cbSize*3/4, cbSize, 1);
            } else if (part_mode == PartMode::PART_nRx2N) {
                mc_pu( x0, y0, cbSize*3/4, cbSize, 0);
                mc_pu( x0+cbSize*3/4, y0, cbSize/4, cbSize, 1);
            } else if (part_mode == PartMode::PART_NxN) {
                // §7.3.8.5: NxN inter (only at min CB size)
                int half = cbSize / 2;
                mc_pu( x0,      y0,      half, half, 0);
                mc_pu( x0+half, y0,      half, half, 1);
                mc_pu( x0,      y0+half, half, half, 2);
                mc_pu( x0+half, y0+half, half, half, 3);
            }
        }
    }

    // Store CU info in grid
    int n = cbSize / sps.MinCbSizeY;
    for (int j = 0; j < n; j++)
        for (int i = 0; i < n; i++) {
            auto& cu = ctx.cu_at(x0 + i * sps.MinCbSizeY,
                                  y0 + j * sps.MinCbSizeY);
            cu.pred_mode = pred_mode;
            cu.part_mode = part_mode;
            cu.log2CbSize = log2CbSize;
            cu.cu_transquant_bypass = cu_transquant_bypass;
        }

    // Phase 6: initialize grids for this CU
    if (ctx.log2_tu_size_grid) {
        int stride = ctx.filter_grid_stride;
        for (int dy = 0; dy < cbSize; dy += 4) {
            for (int dx = 0; dx < cbSize; dx += 4) {
                int gx = (x0 + dx) / 4;
                int gy = (y0 + dy) / 4;
                ctx.log2_tu_size_grid[gy * stride + gx] = static_cast<uint8_t>(log2CbSize);
                ctx.cbf_luma_grid[gy * stride + gx] = 0;
            }
        }

        // §8.7.2.2: CU left/top edges (transform block boundary at trafoDepth=0)
        // Left edge (vertical): edgeFlags[0][k] for k=0..cbSize-1
        for (int dy = 0; dy < cbSize; dy += 4) {
            ctx.edge_flags_v[(y0 + dy) / 4 * stride + x0 / 4] = 1;
        }
        // Top edge (horizontal): edgeFlags[k][0] for k=0..cbSize-1
        for (int dx = 0; dx < cbSize; dx += 4) {
            ctx.edge_flags_h[y0 / 4 * stride + (x0 + dx) / 4] = 1;
        }

        // §8.7.2.3: PU boundary edges within CU
        if (part_mode == PartMode::PART_Nx2N || part_mode == PartMode::PART_NxN) {
            int px = x0 + cbSize / 2;
            for (int dy = 0; dy < cbSize; dy += 4)
                ctx.edge_flags_v[(y0 + dy) / 4 * stride + px / 4] = 1;
        }
        if (part_mode == PartMode::PART_nLx2N) {
            int px = x0 + cbSize / 4;
            for (int dy = 0; dy < cbSize; dy += 4)
                ctx.edge_flags_v[(y0 + dy) / 4 * stride + px / 4] = 1;
        }
        if (part_mode == PartMode::PART_nRx2N) {
            int px = x0 + 3 * cbSize / 4;
            for (int dy = 0; dy < cbSize; dy += 4)
                ctx.edge_flags_v[(y0 + dy) / 4 * stride + px / 4] = 1;
        }
        if (part_mode == PartMode::PART_2NxN || part_mode == PartMode::PART_NxN) {
            int py = y0 + cbSize / 2;
            for (int dx = 0; dx < cbSize; dx += 4)
                ctx.edge_flags_h[py / 4 * stride + (x0 + dx) / 4] = 1;
        }
        if (part_mode == PartMode::PART_2NxnU) {
            int py = y0 + cbSize / 4;
            for (int dx = 0; dx < cbSize; dx += 4)
                ctx.edge_flags_h[py / 4 * stride + (x0 + dx) / 4] = 1;
        }
        if (part_mode == PartMode::PART_2NxnD) {
            int py = y0 + 3 * cbSize / 4;
            for (int dx = 0; dx < cbSize; dx += 4)
                ctx.edge_flags_h[py / 4 * stride + (x0 + dx) / 4] = 1;
        }
    }

    // §8.6.1: Store CU position for QP derivation in transform units
    ctx.cu_x0 = x0;
    ctx.cu_y0 = y0;

    // Transform tree (only for non-skip, non-PCM)
    if (!cu_skip) {
        bool rqt_root_cbf = true;
        if (pred_mode != PredMode::MODE_INTRA) {
            // §7.3.8.5: rqt_root_cbf parsed when NOT (PART_2Nx2N && merge_flag)
            bool is_merge_2Nx2N = (part_mode == PartMode::PART_2Nx2N &&
                                    ctx.cu_at(x0, y0).merge_flag);
            if (!is_merge_2Nx2N) {
                rqt_root_cbf = decode_rqt_root_cbf(cabac);
            }
        }

        if (rqt_root_cbf) {
            decode_transform_tree(ctx, x0, y0, x0, y0, log2CbSize, 0, 0,
                                  true, true);
        }
    }

    // §8.6.1: Derive QpY for this CU. Uses CuQpDeltaVal (0 if not coded).
    int qpY = derive_qp_y(ctx, x0, y0);
    ctx.QpY_prev = qpY;

    // Store QP in grid (will be updated after cu_qp_delta if needed)
    for (int j = 0; j < n; j++)
        for (int i = 0; i < n; i++) {
            ctx.cu_at(x0 + i * sps.MinCbSizeY,
                      y0 + j * sps.MinCbSizeY).qp_y = qpY;
        }

}

// ============================================================
// prediction_unit intra (§7.3.8.8 — intra part)
// ============================================================

void decode_prediction_unit_intra(DecodingContext& ctx, int x0, int y0,
                                   int log2CbSize, PartMode part_mode) {
    auto& cabac = *ctx.cabac;
    auto& sps = *ctx.sps;

    int cbSize = 1 << log2CbSize;
    int pbOffset = (part_mode == PartMode::PART_NxN) ? (cbSize / 2) : cbSize;
    // First pass: decode prev_intra_luma_pred_flag for all PUs
    bool prev_flag[4] = {};
    int mpm_idx_val[4] = {};
    int rem_mode[4] = {};

    int pu = 0;
    for (int j = 0; j < cbSize; j += pbOffset) {
        for (int i = 0; i < cbSize; i += pbOffset) {
            prev_flag[pu] = decode_prev_intra_luma_pred_flag(cabac);
            pu++;
        }
    }

    // Second pass: decode mpm_idx or rem_intra_luma_pred_mode
    pu = 0;
    for (int j = 0; j < cbSize; j += pbOffset) {
        for (int i = 0; i < cbSize; i += pbOffset) {
            if (prev_flag[pu])
                mpm_idx_val[pu] = decode_mpm_idx(cabac);
            else
                rem_mode[pu] = decode_rem_intra_luma_pred_mode(cabac);
            pu++;
        }
    }

    // Derive luma intra modes
    pu = 0;
    for (int j = 0; j < cbSize; j += pbOffset) {
        for (int i = 0; i < cbSize; i += pbOffset) {
            int px = x0 + i;
            int py = y0 + j;

            int candModeList[3];
            derive_mpm(ctx, px, py, pbOffset, candModeList);

            int intra_mode;
            if (prev_flag[pu]) {
                intra_mode = candModeList[mpm_idx_val[pu]];
            } else {
                // Sort candidates
                if (candModeList[0] > candModeList[1])
                    std::swap(candModeList[0], candModeList[1]);
                if (candModeList[0] > candModeList[2])
                    std::swap(candModeList[0], candModeList[2]);
                if (candModeList[1] > candModeList[2])
                    std::swap(candModeList[1], candModeList[2]);

                intra_mode = rem_mode[pu];
                for (int k = 0; k < 3; k++) {
                    if (intra_mode >= candModeList[k])
                        intra_mode++;
                }
            }
            HEVC_LOG(INTRA, "PU (%d,%d) luma_mode=%d (prev=%d mpm_idx=%d rem=%d)",
                     px, py, intra_mode, prev_flag[pu], mpm_idx_val[pu], rem_mode[pu]);

            ctx.set_intra_mode(px, py, pbOffset, intra_mode);
            pu++;
        }
    }

    // Chroma mode
    if (sps.ChromaArrayType != 0) {
        int coded_chroma = decode_intra_chroma_pred_mode(cabac);
        // For 4:2:0/4:2:2, one chroma mode per CU
        int luma_mode_for_chroma = ctx.intra_mode_at(x0, y0);
        int chroma_mode = derive_chroma_intra_mode(coded_chroma, luma_mode_for_chroma);
        ctx.set_chroma_mode(x0, y0, cbSize, chroma_mode);
        HEVC_LOG(INTRA, "CU (%d,%d) chroma_mode=%d (coded=%d luma=%d)",
                 x0, y0, chroma_mode, coded_chroma, luma_mode_for_chroma);
    }
}

// ============================================================
// transform_tree (§7.3.8.8)
// ============================================================

void decode_transform_tree(DecodingContext& ctx, int x0, int y0,
                           int xBase, int yBase,
                           int log2TrafoSize, int trafoDepth,
                           int blkIdx,
                           bool cbf_cb_parent, bool cbf_cr_parent) {
    auto& sps = *ctx.sps;
    auto& cabac = *ctx.cabac;

    bool split = false;

    // IntraSplitFlag — Table 7-10: only set when PartMode == NxN for intra
    auto& cu = ctx.cu_at(x0, y0);
    bool intraSplitFlag = (cu.pred_mode == PredMode::MODE_INTRA &&
                           cu.part_mode == PartMode::PART_NxN);
    int maxTrafoDepth;
    if (cu.pred_mode == PredMode::MODE_INTRA) {
        maxTrafoDepth = sps.max_transform_hierarchy_depth_intra +
                        (intraSplitFlag ? 1 : 0);
    } else {
        maxTrafoDepth = sps.max_transform_hierarchy_depth_inter;
    }

    // §7.4.9.4: interSplitFlag — force split for non-2Nx2N inter CUs
    // when max_transform_hierarchy_depth_inter == 0
    bool interSplitFlag = (sps.max_transform_hierarchy_depth_inter == 0) &&
                          (cu.pred_mode == PredMode::MODE_INTER) &&
                          (cu.part_mode != PartMode::PART_2Nx2N) &&
                          (trafoDepth == 0);

    // Determine split_transform_flag
    if (log2TrafoSize <= sps.MaxTbLog2SizeY &&
        log2TrafoSize > sps.MinTbLog2SizeY &&
        trafoDepth < maxTrafoDepth &&
        !(intraSplitFlag && trafoDepth == 0) &&
        !interSplitFlag) {
        split = decode_split_transform_flag(cabac, log2TrafoSize);
    } else {
        // Implicit split
        split = (log2TrafoSize > sps.MaxTbLog2SizeY) ||
                (intraSplitFlag && trafoDepth == 0) ||
                interSplitFlag;
    }

    // §7.3.8.8: Chroma CBF parsed when log2TrafoSize > 2 (4:2:0) or ChromaArrayType == 3
    // When not parsed, inherit parent values for deferred chroma (§7.3.8.10 cbfDepthC)
    bool cbf_cb = cbf_cb_parent, cbf_cr = cbf_cr_parent;
    if ((log2TrafoSize > 2 && sps.ChromaArrayType != 0) ||
        sps.ChromaArrayType == 3) {
        if (trafoDepth == 0 || cbf_cb_parent) {
            cbf_cb = decode_cbf_chroma(cabac, trafoDepth);
        } else {
            cbf_cb = false;
        }
        if (trafoDepth == 0 || cbf_cr_parent) {
            cbf_cr = decode_cbf_chroma(cabac, trafoDepth);
        } else {
            cbf_cr = false;
        }
    }

    if (split) {
        int x1 = x0 + (1 << (log2TrafoSize - 1));
        int y1 = y0 + (1 << (log2TrafoSize - 1));

        decode_transform_tree(ctx, x0, y0, x0, y0, log2TrafoSize - 1,
                              trafoDepth + 1, 0, cbf_cb, cbf_cr);
        decode_transform_tree(ctx, x1, y0, x0, y0, log2TrafoSize - 1,
                              trafoDepth + 1, 1, cbf_cb, cbf_cr);
        decode_transform_tree(ctx, x0, y1, x0, y0, log2TrafoSize - 1,
                              trafoDepth + 1, 2, cbf_cb, cbf_cr);
        decode_transform_tree(ctx, x1, y1, x0, y0, log2TrafoSize - 1,
                              trafoDepth + 1, 3, cbf_cb, cbf_cr);
    } else {
        // Leaf: read cbf_luma and decode transform unit
        bool cbf_luma = true;
        if (cu.pred_mode == PredMode::MODE_INTRA || trafoDepth != 0 ||
            cbf_cb || cbf_cr) {
            cbf_luma = decode_cbf_luma(cabac, trafoDepth);
        }

        decode_transform_unit(ctx, x0, y0, xBase, yBase, log2TrafoSize, trafoDepth, blkIdx,
                              cbf_luma, cbf_cb, cbf_cr);

        // Phase 6: store TU info for deblocking
        if (ctx.cbf_luma_grid && ctx.log2_tu_size_grid) {
            int trSize = 1 << log2TrafoSize;
            int stride = ctx.filter_grid_stride;
            for (int dy = 0; dy < trSize; dy += 4) {
                for (int dx = 0; dx < trSize; dx += 4) {
                    int gx = (x0 + dx) / 4;
                    int gy = (y0 + dy) / 4;
                    ctx.cbf_luma_grid[gy * stride + gx] = cbf_luma ? 1 : 0;
                    ctx.log2_tu_size_grid[gy * stride + gx] = static_cast<uint8_t>(log2TrafoSize);
                }
            }
            // §8.7.2.2: TU left edge (vertical) — always 1 for internal edges
            // (CU edge was already set in decode_coding_unit)
            for (int dy = 0; dy < trSize; dy += 4)
                ctx.edge_flags_v[(y0 + dy) / 4 * stride + x0 / 4] = 1;
            // §8.7.2.2: TU top edge (horizontal)
            for (int dx = 0; dx < trSize; dx += 4)
                ctx.edge_flags_h[y0 / 4 * stride + (x0 + dx) / 4] = 1;
        }
    }
}

// ============================================================
// transform_unit (§7.3.8.10)
// ============================================================

void decode_transform_unit(DecodingContext& ctx, int x0, int y0,
                           int xBase, int yBase,
                           int log2TrafoSize, int /*trafoDepth*/,
                           int blkIdx,
                           bool cbf_luma, bool cbf_cb, bool cbf_cr) {
    auto& sps = *ctx.sps;
    auto& pps = *ctx.pps;
    auto& cabac = *ctx.cabac;
    auto& cu = ctx.cu_at(x0, y0);

    int trSize = 1 << log2TrafoSize;

    // QP delta
    if ((cbf_luma || cbf_cb || cbf_cr) &&
        pps.cu_qp_delta_enabled_flag && !ctx.IsCuQpDeltaCoded) {
        ctx.CuQpDeltaVal = decode_cu_qp_delta(cabac);
        ctx.IsCuQpDeltaCoded = true;
    }

    // §8.6.1: QP derivation uses CU position (xCb, yCb), not TU position
    int qpY = derive_qp_y(ctx, ctx.cu_x0, ctx.cu_y0);

    // Luma residual
    if (cbf_luma) {
        int16_t coefficients[64 * 64] = {};
        int16_t scaled[64 * 64] = {};
        int16_t residual[64 * 64] = {};

        bool transform_skip = false;
        if (pps.transform_skip_enabled_flag && !cu.cu_transquant_bypass &&
            log2TrafoSize <= 2) {
            transform_skip = decode_transform_skip_flag(cabac, 0);
        }

        decode_residual_coding(ctx, x0, y0, log2TrafoSize, 0, coefficients);

        if (!cu.cu_transquant_bypass) {
            int qpPrime = qpY + sps.QpBdOffsetY;
            perform_dequant(ctx, x0, y0, log2TrafoSize, 0, qpPrime,
                           coefficients, scaled);

            perform_transform_inverse(log2TrafoSize, 0,
                                       cu.pred_mode == PredMode::MODE_INTRA,
                                       transform_skip, sps.BitDepthY,
                                       scaled, residual);

        } else {
            std::memcpy(residual, coefficients, sizeof(int16_t) * trSize * trSize);
        }

        // Prediction for luma
        int16_t pred_samples[64 * 64] = {};
        if (cu.pred_mode == PredMode::MODE_INTRA) {
            int intra_mode = ctx.intra_mode_at(x0, y0);
            perform_intra_prediction(ctx, x0, y0, log2TrafoSize, 0, intra_mode,
                                     pred_samples);
        } else {
            // Inter: pred already in picture from PU-level MC, read it back
            for (int y = 0; y < trSize; y++)
                for (int x = 0; x < trSize; x++)
                    pred_samples[y * trSize + x] = static_cast<int16_t>(
                        ctx.pic->sample(0, x0 + x, y0 + y));
        }

        // Reconstruct
        reconstruct_block(ctx, x0, y0, log2TrafoSize, 0, pred_samples, residual);

    } else if (cu.pred_mode == PredMode::MODE_INTRA) {
        // No residual but still need intra prediction
        int intra_mode = ctx.intra_mode_at(x0, y0);
        int16_t pred_samples[64 * 64] = {};
        perform_intra_prediction(ctx, x0, y0, log2TrafoSize, 0, intra_mode,
                                 pred_samples);

        // Reconstruct with zero residual
        int16_t zero[64 * 64] = {};
        reconstruct_block(ctx, x0, y0, log2TrafoSize, 0, pred_samples, zero);

    }

    // Chroma residual (4:2:0: chroma TU is log2TrafoSize-1, min 2)
    if (sps.ChromaArrayType != 0) {
        int log2TrafoSizeC = std::max(2, log2TrafoSize - 1);
        int trSizeC = 1 << log2TrafoSizeC;

        // For 4:2:0 with log2TrafoSize==2, chroma is deferred to blkIdx==3
        bool processChroma = (log2TrafoSize > 2) || (blkIdx == 3);

        // §7.3.8.10: chroma position uses xBase/yBase when log2TrafoSize==2
        int xC = (sps.ChromaArrayType != 3 && log2TrafoSize == 2) ? xBase : x0;
        int yC = (sps.ChromaArrayType != 3 && log2TrafoSize == 2) ? yBase : y0;

        if (processChroma) {
            for (int cIdx = 1; cIdx <= 2; cIdx++) {
                bool cbf_c = (cIdx == 1) ? cbf_cb : cbf_cr;
                if (cbf_c) {
                    int16_t coefficients[32 * 32] = {};
                    int16_t scaled[32 * 32] = {};
                    int16_t residual[32 * 32] = {};

                    bool transform_skip = false;
                    if (pps.transform_skip_enabled_flag &&
                        !cu.cu_transquant_bypass && log2TrafoSizeC <= 2) {
                        transform_skip = decode_transform_skip_flag(cabac, cIdx);
                    }

                    decode_residual_coding(ctx, xC, yC, log2TrafoSizeC, cIdx,
                                          coefficients);

                    if (!cu.cu_transquant_bypass) {
                        // Chroma QP derivation
                        int qpOffset = (cIdx == 1) ? pps.pps_cb_qp_offset +
                                        ctx.sh->slice_cb_qp_offset
                                      : pps.pps_cr_qp_offset +
                                        ctx.sh->slice_cr_qp_offset;
                        int qPi = Clip3(-sps.QpBdOffsetC, 57, qpY + qpOffset);
                        int qPc;
                        if (qPi < 0) qPc = qPi;
                        else if (qPi < 58) qPc = qpChromaTable[qPi];
                        else qPc = qPi - 6;
                        int qpPrimeC = qPc + sps.QpBdOffsetC;

                        perform_dequant(ctx, xC, yC, log2TrafoSizeC, cIdx,
                                       qpPrimeC, coefficients, scaled);
                        perform_transform_inverse(log2TrafoSizeC, cIdx,
                                                   cu.pred_mode == PredMode::MODE_INTRA,
                                                   transform_skip, sps.BitDepthC,
                                                   scaled, residual);
                    } else {
                        std::memcpy(residual, coefficients,
                                    sizeof(int16_t) * trSizeC * trSizeC);
                    }

                    // Chroma prediction
                    int16_t pred_samples[32 * 32] = {};
                    if (cu.pred_mode == PredMode::MODE_INTRA) {
                        int chroma_mode = ctx.chroma_mode_at(xC, yC);
                        perform_intra_prediction(ctx, xC, yC, log2TrafoSizeC, cIdx,
                                                chroma_mode, pred_samples);
                    } else {
                        // Inter: pred already written by PU-level MC
                        int xCC = xC / sps.SubWidthC;
                        int yCC = yC / sps.SubHeightC;
                        for (int y = 0; y < trSizeC; y++)
                            for (int x = 0; x < trSizeC; x++)
                                pred_samples[y * trSizeC + x] = static_cast<int16_t>(
                                    ctx.pic->sample(cIdx, xCC + x, yCC + y));
                    }

                    reconstruct_block(ctx, xC, yC, log2TrafoSizeC, cIdx,
                                     pred_samples, residual);
                } else if (cu.pred_mode == PredMode::MODE_INTRA) {
                    int chroma_mode = ctx.chroma_mode_at(xC, yC);
                    int16_t pred_samples[32 * 32] = {};
                    perform_intra_prediction(ctx, xC, yC, log2TrafoSizeC, cIdx,
                                            chroma_mode, pred_samples);
                    int16_t zero[32 * 32] = {};
                    reconstruct_block(ctx, xC, yC, log2TrafoSizeC, cIdx,
                                     pred_samples, zero);
                }
            }
        }
    }
}

// ============================================================
// PCM mode (§7.3.10.2)
// ============================================================

void decode_pcm_samples(DecodingContext& ctx, int x0, int y0, int log2CbSize) {
    auto& sps = *ctx.sps;
    auto bs = ctx.cabac->bitstream();

    HEVC_LOG(TREE, "PCM samples at (%d,%d) size=%d", x0, y0, 1 << log2CbSize);

    // Byte alignment before PCM data
    bs->byte_alignment();

    int cbSize = 1 << log2CbSize;
    int numLumaSamples = cbSize * cbSize;
    int lumaBits = sps.pcm_sample_bit_depth_luma_minus1 + 1;

    // Read luma samples
    for (int i = 0; i < numLumaSamples; i++) {
        int y = i / cbSize;
        int x = i % cbSize;
        uint16_t val = static_cast<uint16_t>(bs->read_bits(lumaBits));
        ctx.pic->sample(0, x0 + x, y0 + y) = val;
    }

    // Read chroma samples
    if (sps.ChromaArrayType != 0) {
        int chromaBits = sps.pcm_sample_bit_depth_chroma_minus1 + 1;
        int chromaW = cbSize / sps.SubWidthC;
        int chromaH = cbSize / sps.SubHeightC;
        int numChromaSamples = chromaW * chromaH;

        for (int cIdx = 1; cIdx <= 2; cIdx++) {
            int xC = x0 / sps.SubWidthC;
            int yC = y0 / sps.SubHeightC;
            for (int i = 0; i < numChromaSamples; i++) {
                int y = i / chromaW;
                int x = i % chromaW;
                uint16_t val = static_cast<uint16_t>(bs->read_bits(chromaBits));
                ctx.pic->sample(cIdx, xC + x, yC + y) = val;
            }
        }
    }

    // Reset CABAC contexts after PCM (§9.3.1.2)
    int sliceType = static_cast<int>(ctx.sh->slice_type);
    ctx.cabac->init_contexts(sliceType, ctx.sh->SliceQpY, ctx.sh->cabac_init_flag);
    ctx.cabac->init_decoder(*bs);
}

} // namespace hevc
