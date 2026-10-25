#pragma once

// Inter sample interpolation — spec §8.5.3.3
// Luma 8-tap (§8.5.3.3.3), Chroma 4-tap (§8.5.3.3.3)
// Weighted prediction (§8.5.3.3.4)

#include <cstddef>
#include <cstdint>
#include "common/picture.h"
#include "common/types.h"

namespace hevc {

struct DecodingContext;

// ============================================================
// Motion compensation for one PU — §8.5.3.3
// ============================================================

// Perform motion compensation and produce final prediction samples.
// Handles uni-pred and bi-pred, luma and chroma interpolation,
// and default weighted prediction averaging.
// pred_samples: output array, nPbW * nPbH (or nPbW/2 * nPbH/2 for chroma)
void perform_inter_prediction(DecodingContext& ctx,
                               int xPb, int yPb, int nPbW, int nPbH,
                               int cIdx,
                               const MV& mvL0, const MV& mvL1,
                               int refIdxL0, int refIdxL1,
                               bool predFlagL0, bool predFlagL1,
                               int16_t* pred_samples);

// Same, written straight into a picture plane: dst points at the PU's first
// sample in component cIdx, dstStride is the plane's stride.
void perform_inter_prediction(DecodingContext& ctx,
                               int xPb, int yPb, int nPbW, int nPbH,
                               int cIdx,
                               const MV& mvL0, const MV& mvL1,
                               int refIdxL0, int refIdxL1,
                               bool predFlagL0, bool predFlagL1,
                               uint16_t* dst, ptrdiff_t dstStride);

} // namespace hevc
