#pragma once

// Inter prediction — §8.5.3
// Merge mode (§8.5.3.2.2), AMVP (§8.5.3.2.6), MV scaling (§8.5.3.2.12)
// Interpolation filters (§8.5.3.3) — in interpolation.h/cpp

#include <cstdint>
#include "common/types.h"

namespace hevc {

struct DecodingContext;

// PUMotionInfo (per-PU motion information) is in common/types.h, shared with
// the Picture that keeps it for TMVP.

// Merge candidate — used during merge list construction
struct MergeCandidate {
    MV mv[2] = {};
    int8_t ref_idx[2] = {-1, -1};
    bool pred_flag[2] = {};
};

// ============================================================
// Top-level functions
// ============================================================

// Parse prediction_unit for inter mode (§7.3.8.6)
// and derive MV, ref_idx, pred_flag via merge or AMVP
void decode_prediction_unit_inter(DecodingContext& ctx,
                                   int xCb, int yCb, int nCbS,
                                   int xPb, int yPb, int nPbW, int nPbH,
                                   int partIdx);

// Store MV info for a PU in the motion grid (for neighbor access)
void store_pu_motion(DecodingContext& ctx, int xPb, int yPb,
                     int nPbW, int nPbH, const PUMotionInfo& mi);

// Get MV info at a luma position (from the motion grid)
PUMotionInfo get_pu_motion(const DecodingContext& ctx, int x, int y);

} // namespace hevc
