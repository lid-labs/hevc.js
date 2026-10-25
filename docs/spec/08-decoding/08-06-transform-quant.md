# 8.6 — Transform and Quantization

Spec ref: 8.6.1 (scaling/transform general), 8.6.2 (scaling), 8.6.3 (transform), 8.6.4 (cross-component prediction)

## Overview

```
CABAC coefficients -> Dequant (scaling) -> Inverse transform -> Residual
```

## 8.6.2 — Scaling (Dequantization)

### Process

```cpp
// For each coefficient (x, y) of the TU:
// d[x][y] = coefficient decoded by CABAC (TransCoeffLevel)

// §8.6.3 — Scaling process for transform coefficients
// For each coefficient d[x][y] in the TU:
void scale_transform_coefficients(int32_t* d, int32_t* d_scaled,
                                   int log2TrSize, int qP, int cIdx,
                                   int BitDepth, const int* scalingFactor) {
    const int levelScale[6] = { 40, 45, 51, 57, 64, 72 };

    int bdShift = BitDepth + log2TrSize - 5;
    int qPPer = qP / 6;
    int qPRem = qP % 6;

    // coeffMin/coeffMax for clipping
    int coeffMin = -(1 << 15);  // -32768
    int coeffMax = (1 << 15) - 1;  // 32767

    int nTbS = 1 << log2TrSize;
    for (int y = 0; y < nTbS; y++) {
        for (int x = 0; x < nTbS; x++) {
            int m = scalingFactor ? scalingFactor[y * nTbS + x] : 16;  // flat 16 default
            int intermediate = (d[y*nTbS+x] * m * levelScale[qPRem]) << qPPer;
            d_scaled[y*nTbS+x] = Clip3(coeffMin, coeffMax,
                (intermediate + (1 << (bdShift - 1))) >> bdShift);
        }
    }
}
```

### QP Chroma Mapping (Table 8-10)

```cpp
// qPi -> qPc mapping (non-linear for qPi > 30)
const int8_t qp_chroma_table[58] = {
     0,  1,  2,  3,  4,  5,  6,  7,  8,  9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
    29, 30, 31, 32, 33, 33, 34, 34, 35, 35,
    36, 36, 37, 37, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 50, 51
};
// qPi = Clip3(0, 57, QpY + pps_cb_qp_offset + slice_cb_qp_offset)
// qPc = qp_chroma_table[qPi]
// Qp'C = qPc + QpBdOffsetC
```

## 8.6.3 — Inverse Transform

### Transform matrices

HEVC uses integer approximations of the DCT-II (and the DST for luma 4x4 intra):

```cpp
// DST-VII 4x4 (luma intra only) — Table 8-11
const int16_t dst_4x4[4][4] = {
    { 29, 55, 74, 84 },
    { 74, 74,  0,-74 },
    { 84,-29,-74, 55 },
    { 55,-84, 74,-29 }
};

// DCT-II 4x4 — Table 8-12
const int16_t dct_4x4[4][4] = {
    { 64, 64, 64, 64 },
    { 83, 36,-36,-83 },
    { 64,-64,-64, 64 },
    { 36,-83, 83,-36 }
};

// DCT 8x8 — Table 8-13
const int16_t dct_8x8[8][8] = { /* ... 8x8 matrix */ };

// DCT 16x16 — Table 8-14
const int16_t dct_16x16[16][16] = { /* ... */ };

// DCT 32x32 — Table 8-15
const int16_t dct_32x32[32][32] = { /* ... */ };
```

### Inverse transform process

```cpp
// 8.6.3 — Transform process (2D = vertical then horizontal)
void transform_inverse(int16_t* coeffs, int16_t* residual, int log2TrSize,
                        int cIdx, bool intra) {
    int nTbS = 1 << log2TrSize;
    int16_t temp[32][32];

    // Matrix choice
    const int16_t* matrix;
    if (nTbS == 4 && cIdx == 0 && intra)
        matrix = dst_4x4;  // DST for luma 4x4 intra
    else
        matrix = get_dct_matrix(nTbS);

    // Transform skip check (§8.6.4.2)
    if (transform_skip_flag) {
        // No inverse transform (neither DCT nor DST)
        // The coefficients after dequant are directly the spatial residual
        // But a specific shift applies:
        int tsShift = 15 - BitDepth;
        for (int y = 0; y < nTbS; y++)
            for (int x = 0; x < nTbS; x++)
                residual[y*nTbS+x] = (coeffs[y*nTbS+x] + (1 << (tsShift-1))) >> tsShift;
        // Note: in transform skip, the scan order in residual_coding is
        // HORIZONTAL (not diagonal) — see §7.4.9.11
        return;
    }

    // Step 1: Vertical transform (columns)
    int shift1 = 7;
    for (int col = 0; col < nTbS; col++) {
        partial_butterfly_inverse(coeffs, temp, col, nTbS, matrix, shift1);
    }

    // CRITICAL: Intermediate clipping after first pass
    // Values must be clipped to 16-bit signed range [-32768, 32767]
    // Required for bit-exactness: without this clipping, overflow in the
    // second pass produces incorrect residual values that differ from the
    // reference decoder output.
    for (int y = 0; y < nTbS; y++)
        for (int x = 0; x < nTbS; x++)
            temp[y][x] = Clip3(-32768, 32767, temp[y][x]);

    // Step 2: Horizontal transform (rows)
    int shift2 = 20 - BitDepth;
    for (int row = 0; row < nTbS; row++) {
        partial_butterfly_inverse(temp, residual, row, nTbS, matrix, shift2);
    }
}
```

### Partial Butterfly

The spec uses a "partial butterfly" to optimize the matrix x vector multiplication:

```cpp
// For 4x4 inverse DCT:
void idct4(const int16_t* src, int16_t* dst, int shift) {
    int add = 1 << (shift - 1);
    for (int i = 0; i < 4; i++) {
        // Even part
        int E0 = 64*src[0*4+i] + 64*src[2*4+i];
        int E1 = 64*src[0*4+i] - 64*src[2*4+i];
        // Odd part
        int O0 = 83*src[1*4+i] + 36*src[3*4+i];
        int O1 = 36*src[1*4+i] - 83*src[3*4+i];

        dst[0*4+i] = Clip3(min, max, (E0 + O0 + add) >> shift);
        dst[1*4+i] = Clip3(min, max, (E1 + O1 + add) >> shift);
        dst[2*4+i] = Clip3(min, max, (E1 - O1 + add) >> shift);
        dst[3*4+i] = Clip3(min, max, (E0 - O0 + add) >> shift);
    }
}
// Similar structures for 8x8, 16x16, 32x32 with more even/odd stages
```

## 8.6.1 — QP Derivation

The QP can vary per CU (cu_qp_delta). The process:

```
SliceQpY = 26 + pps.init_qp_minus26 + slice_qp_delta
QpY = ((QpY_prev + CuQpDeltaVal + 52 + 2*QpBdOffsetY) % (52 + QpBdOffsetY)) - QpBdOffsetY
Qp'Y = QpY + QpBdOffsetY
```

## Sign Data Hiding (8.6.1)

If `sign_data_hiding_enabled_flag` is set and the first and last significant coefficients are more than 3 positions apart:
- The sign of the first coefficient is inferred from the parity of the sum of the levels

## Checklist

- [ ] QP derivation (luma + chroma with mapping table)
- [ ] CU QP delta handling
- [ ] Scaling process (dequant) with scaling lists
- [ ] Scaling process without scaling lists (flat 16)
- [ ] Inverse 4x4 DST (luma intra)
- [ ] Inverse 4x4, 8x8, 16x16, 32x32 DCT
- [ ] Transform skip
- [ ] Sign data hiding
- [ ] Reconstruction: Clip(pred + residual)
- [ ] Tests: known coefficients -> check exact residual
