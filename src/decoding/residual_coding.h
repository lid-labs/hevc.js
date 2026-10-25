#pragma once

// Residual coding — Spec §7.3.8.11
// Parses transform coefficients from CABAC bitstream

#include <cstdint>

namespace hevc {

struct DecodingContext;

// Bounding box of a TU's nonzero coefficients: every coefficient at x > max_x
// or y > max_y is zero. Lets dequantization and the inverse transform skip the
// zero rows and columns.
struct CoeffExtent {
    int max_x = -1;
    int max_y = -1;
};

// Parse residual coefficients for one TU block
// coefficients: output array of size (1<<log2TrafoSize)^2
CoeffExtent decode_residual_coding(DecodingContext& ctx, int x0, int y0,
                                   int log2TrafoSize, int cIdx,
                                   int16_t* coefficients);

} // namespace hevc
