# Scaling List Default Matrices

Default matrices for dequantization (spec ITU-T H.265, Tables 7-3 to 7-6).

Used when `scaling_list_enabled_flag == 1` but the scaling lists are not present in the SPS/PPS.

## 4x4 — Default matrix (identical for intra and inter)

Flat 16 for all 4x4 sizes (Table 7-3):

```cpp
const uint8_t default_scaling_list_4x4[16] = {
    16, 16, 16, 16,
    16, 16, 16, 16,
    16, 16, 16, 16,
    16, 16, 16, 16,
};
```

## 8x8 Intra (Table 7-4)

```cpp
const uint8_t default_scaling_list_8x8_intra[64] = {
    16, 16, 16, 16, 17, 18, 21, 24,
    16, 16, 16, 16, 17, 19, 22, 25,
    16, 16, 17, 18, 20, 22, 25, 29,
    16, 16, 18, 21, 24, 27, 31, 36,
    17, 17, 20, 24, 30, 35, 41, 47,
    18, 19, 22, 27, 35, 44, 54, 65,
    21, 22, 25, 31, 41, 54, 70, 88,
    24, 25, 29, 36, 47, 65, 88, 115,
};
```

## 8x8 Inter (Table 7-5)

```cpp
const uint8_t default_scaling_list_8x8_inter[64] = {
    16, 16, 16, 16, 17, 18, 20, 24,
    16, 16, 16, 17, 18, 20, 24, 25,
    16, 16, 17, 18, 20, 24, 25, 28,
    16, 17, 18, 20, 24, 25, 28, 33,
    17, 18, 20, 24, 25, 28, 33, 41,
    18, 20, 24, 25, 28, 33, 41, 54,
    20, 24, 25, 28, 33, 41, 54, 71,
    24, 25, 28, 33, 41, 54, 71, 91,
};
```

## 16x16 and 32x32

The 16x16 and 32x32 matrices reuse the 8x8 matrices by upscaling:
- The 16x16 matrix is the 8x8 matrix upsampled 2x in each dimension
- The 32x32 matrix is the 8x8 matrix upsampled 4x, with `dc_coef` (corner [0][0]) specified separately

```cpp
// Upsample an 8x8 matrix to NxN (N = 16 or 32)
void upscale_scaling_list(const uint8_t* src_8x8, uint8_t* dst, int dstSize) {
    int ratio = dstSize / 8;
    for (int y = 0; y < dstSize; y++)
        for (int x = 0; x < dstSize; x++)
            dst[y * dstSize + x] = src_8x8[(y / ratio) * 8 + (x / ratio)];
}
```

## DC coefficient for 16x16 and 32x32

When `scaling_list_dc_coef_minus8` is not present, the default value of the DC coefficient is **16** (identical to the 4x4 matrix).

```cpp
// For the 16x16 and 32x32 matrices, coefficient [0][0] is replaced by dc_coef
int dc_coef_16x16 = scaling_list_dc_coef_minus8 + 8;  // if present
// default: dc_coef = 16
```

## Scaling list mapping by sizeId and matrixId

```
sizeId 0 (4x4)   : matrixId 0-5  → 6 matrices (3 intra Y/Cb/Cr + 3 inter Y/Cb/Cr)
sizeId 1 (8x8)   : matrixId 0-5  → 6 matrices (3 intra + 3 inter)
sizeId 2 (16x16) : matrixId 0-5  → 6 matrices (3 intra + 3 inter)
sizeId 3 (32x32) : matrixId 0-1  → 2 matrices (1 intra Y + 1 inter Y)
```

The default matrices:
- `sizeId 0`: all flat 16
- `sizeId 1, matrixId 0-2` (intra): `default_scaling_list_8x8_intra`
- `sizeId 1, matrixId 3-5` (inter): `default_scaling_list_8x8_inter`
- `sizeId 2`: upscale of sizeId 1 (same intra/inter defaults)
- `sizeId 3, matrixId 0` (intra): upscale of `default_scaling_list_8x8_intra`
- `sizeId 3, matrixId 1` (inter): upscale of `default_scaling_list_8x8_inter`

## Fallback mechanism (§7.4.5)

When `scaling_list_pred_mode_flag[sizeId][matrixId] == 0` and `scaling_list_pred_matrix_id_delta == 0`, the default matrix applies.

When `scaling_list_pred_matrix_id_delta > 0`, the matrix is copied from `matrixId - delta` (same sizeId).
