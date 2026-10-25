#pragma once

// Transform inverse + Dequantization
// Spec §8.6 (transform), §8.6.3 (scaling/dequant)

#include <cstdint>

#include "decoding/residual_coding.h"

namespace hevc {

struct DecodingContext;

// Dequantization (§8.6.3)
// Scales the coefficients inside ext; scaled is only written there.
void perform_dequant(DecodingContext& ctx, int x0, int y0,
                     int log2TrafoSize, int cIdx, int qp, const CoeffExtent& ext,
                     const int16_t* coefficients, int16_t* scaled);

// Inverse transform (§8.6.4)
// DST 4x4 for luma intra, DCT for all others
void perform_transform_inverse(int log2TrafoSize, int cIdx,
                                bool is_intra, bool transform_skip,
                                int bit_depth, const CoeffExtent& ext,
                                const int16_t* scaled, int16_t* residual);

} // namespace hevc
