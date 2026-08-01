#include "syntax/pps.h"
#include "syntax/sps.h"
#include "bitstream/bitstream_reader.h"
#include "common/debug.h"

namespace hevc {

// Spec §7.3.2.3.1 — pic_parameter_set_rbsp()
bool PPS::parse(BitstreamReader& bs, const SPS& sps) {
    pps_pic_parameter_set_id = bs.read_ue();
    pps_seq_parameter_set_id = bs.read_ue();
    dependent_slice_segments_enabled_flag = bs.read_flag();
    output_flag_present_flag = bs.read_flag();
    num_extra_slice_header_bits = bs.read_bits(3);
    sign_data_hiding_enabled_flag = bs.read_flag();
    cabac_init_present_flag = bs.read_flag();

    num_ref_idx_l0_default_active_minus1 = bs.read_ue();
    num_ref_idx_l1_default_active_minus1 = bs.read_ue();
    // §7.4.3.3.1: range 0..14 — copied into slice headers whose ref arrays hold 16
    if (num_ref_idx_l0_default_active_minus1 > 14 ||
        num_ref_idx_l1_default_active_minus1 > 14) {
        HEVC_LOG(PARSE, "PPS rejected: num_ref_idx_default l0=%u l1=%u",
                 num_ref_idx_l0_default_active_minus1, num_ref_idx_l1_default_active_minus1);
        return false;
    }

    init_qp_minus26 = bs.read_se();
    constrained_intra_pred_flag = bs.read_flag();
    transform_skip_enabled_flag = bs.read_flag();

    cu_qp_delta_enabled_flag = bs.read_flag();
    if (cu_qp_delta_enabled_flag) {
        diff_cu_qp_delta_depth = bs.read_ue();
    }

    pps_cb_qp_offset = bs.read_se();
    pps_cr_qp_offset = bs.read_se();
    pps_slice_chroma_qp_offsets_present_flag = bs.read_flag();

    weighted_pred_flag = bs.read_flag();
    weighted_bipred_flag = bs.read_flag();
    transquant_bypass_enabled_flag = bs.read_flag();

    tiles_enabled_flag = bs.read_flag();
    entropy_coding_sync_enabled_flag = bs.read_flag();

    if (tiles_enabled_flag) {
        num_tile_columns_minus1 = bs.read_ue();
        num_tile_rows_minus1 = bs.read_ue();
        uniform_spacing_flag = bs.read_flag();

        if (!uniform_spacing_flag) {
            column_width_minus1.resize(num_tile_columns_minus1);
            for (uint32_t i = 0; i < num_tile_columns_minus1; i++) {
                column_width_minus1[i] = bs.read_ue();
            }
            row_height_minus1.resize(num_tile_rows_minus1);
            for (uint32_t i = 0; i < num_tile_rows_minus1; i++) {
                row_height_minus1[i] = bs.read_ue();
            }
        }

        loop_filter_across_tiles_enabled_flag = bs.read_flag();
    }

    pps_loop_filter_across_slices_enabled_flag = bs.read_flag();

    deblocking_filter_control_present_flag = bs.read_flag();
    if (deblocking_filter_control_present_flag) {
        deblocking_filter_override_enabled_flag = bs.read_flag();
        pps_deblocking_filter_disabled_flag = bs.read_flag();
        if (!pps_deblocking_filter_disabled_flag) {
            pps_beta_offset_div2 = bs.read_se();
            pps_tc_offset_div2 = bs.read_se();
        }
    }

    pps_scaling_list_data_present_flag = bs.read_flag();
    if (pps_scaling_list_data_present_flag) {
        scaling_list_data.parse(bs);
    }

    lists_modification_present_flag = bs.read_flag();
    log2_parallel_merge_level_minus2 = bs.read_ue();
    slice_segment_header_extension_present_flag = bs.read_flag();

    // pps_extension_present_flag — skip extensions
    // Not needed for Main profile decoding

    // Compute derived values
    Log2MinCuQpDeltaSize = sps.CtbLog2SizeY - static_cast<int>(diff_cu_qp_delta_depth);

    // Derive tile scan tables
    derive_tile_scan(sps);

    HEVC_LOG(PARSE, "PPS: id=%d sps=%d tiles=%d(%dx%d) qp=%d deblock=%s",
             pps_pic_parameter_set_id, pps_seq_parameter_set_id,
             tiles_enabled_flag ? 1 : 0,
             num_tile_columns_minus1 + 1, num_tile_rows_minus1 + 1,
             26 + init_qp_minus26,
             pps_deblocking_filter_disabled_flag ? "off" : "on");

    return true;
}

// Spec §6.5.1 — CTB raster and tile scanning conversion
void PPS::derive_tile_scan(const SPS& sps) {
    int numCtbsY = sps.PicSizeInCtbsY;
    int picWidthInCtbsY = sps.PicWidthInCtbsY;
    int picHeightInCtbsY = sps.PicHeightInCtbsY;
    int numTileCols = static_cast<int>(num_tile_columns_minus1) + 1;
    int numTileRows = static_cast<int>(num_tile_rows_minus1) + 1;

    // Column widths in CTBs
    std::vector<int> colWidth(numTileCols);
    if (uniform_spacing_flag) {
        for (int i = 0; i < numTileCols; i++) {
            colWidth[i] = ((i + 1) * picWidthInCtbsY) / numTileCols -
                          (i * picWidthInCtbsY) / numTileCols;
        }
    } else {
        int sum = 0;
        for (int i = 0; i < numTileCols - 1; i++) {
            colWidth[i] = static_cast<int>(column_width_minus1[i]) + 1;
            sum += colWidth[i];
        }
        colWidth[numTileCols - 1] = picWidthInCtbsY - sum;
    }

    // Row heights in CTBs
    std::vector<int> rowHeight(numTileRows);
    if (uniform_spacing_flag) {
        for (int i = 0; i < numTileRows; i++) {
            rowHeight[i] = ((i + 1) * picHeightInCtbsY) / numTileRows -
                           (i * picHeightInCtbsY) / numTileRows;
        }
    } else {
        int sum = 0;
        for (int i = 0; i < numTileRows - 1; i++) {
            rowHeight[i] = static_cast<int>(row_height_minus1[i]) + 1;
            sum += rowHeight[i];
        }
        rowHeight[numTileRows - 1] = picHeightInCtbsY - sum;
    }

    // Column boundary positions (in CTBs)
    std::vector<int> colBd(numTileCols + 1);
    colBd[0] = 0;
    for (int i = 0; i < numTileCols; i++) {
        colBd[i + 1] = colBd[i] + colWidth[i];
    }

    // Row boundary positions (in CTBs)
    std::vector<int> rowBd(numTileRows + 1);
    rowBd[0] = 0;
    for (int i = 0; i < numTileRows; i++) {
        rowBd[i + 1] = rowBd[i] + rowHeight[i];
    }

    // CtbAddrRsToTs and CtbAddrTsToRs
    CtbAddrRsToTs.resize(numCtbsY);
    CtbAddrTsToRs.resize(numCtbsY);
    TileId.resize(numCtbsY);

    // Build the raster-to-tile-scan mapping
    // Spec §6.5.1 — Equations 6-1 to 6-3
    int tbIdx = 0;
    for (int tileRow = 0; tileRow < numTileRows; tileRow++) {
        for (int tileCol = 0; tileCol < numTileCols; tileCol++) {
            int tileId = tileRow * numTileCols + tileCol;
            for (int y = rowBd[tileRow]; y < rowBd[tileRow + 1]; y++) {
                for (int x = colBd[tileCol]; x < colBd[tileCol + 1]; x++) {
                    int rsAddr = y * picWidthInCtbsY + x;
                    CtbAddrRsToTs[rsAddr] = tbIdx;
                    CtbAddrTsToRs[tbIdx] = rsAddr;
                    TileId[tbIdx] = tileId;
                    tbIdx++;
                }
            }
        }
    }
}

} // namespace hevc
