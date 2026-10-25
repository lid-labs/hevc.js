# 5.8 -- Chroma Interpolation + Bi-prediction

## Goal

Verify the 4-tap chroma filter and the complete bi-prediction pipeline.

## Spec refs

- S8.5.3.3 : Chroma sample interpolation process
- Table 8-2 : Chroma interpolation filter coefficients
- S8.5.3.2.1 eq 8-166..8-175 : Weighted sample prediction (default + explicit)

## 4-tap chroma filter (Table 8-2)

```cpp
const int16_t chroma_filter[8][4] = {
    {  0, 64,  0,  0 },  // frac=0
    { -2, 58, 10, -2 },  // frac=1
    { -4, 54, 16, -2 },  // frac=2
    { -6, 46, 28, -4 },  // frac=3
    { -4, 36, 36, -4 },  // frac=4
    { -4, 28, 46, -6 },  // frac=5
    { -2, 16, 54, -4 },  // frac=6
    { -2, 10, 58, -2 },  // frac=7
};
```

## Chroma MV derivation

```cpp
// Luma MV is in 1/4 pel, chroma MV in 1/8 pel (for 4:2:0)
mvC.x = mv.x;  // already in 1/4 luma pel = 1/8 chroma pel (since SubWidthC=2)
mvC.y = mv.y;
// Fractional part
xFracC = mvC.x & 7;  // 3 bits for 8 positions
yFracC = mvC.y & 7;
// Integer part
xIntC = mvC.x >> 3;
yIntC = mvC.y >> 3;
```

**WARNING** : for 4:2:0, the chroma coordinates are divided by 2
(SubWidthC=2, SubHeightC=2). The chroma MV has MORE fractional precision.

## Bi-prediction averaging

### Default weighted prediction (S8.5.3.2.1)
```cpp
// Uni-pred : clip to [0, maxVal]
pred = Clip3(0, maxVal, predSamples);

// Bi-pred : averaging with extended precision
shift = 15 - BitDepth;  // = 7 for 8-bit
offset = 1 << (shift - 1);  // = 64
pred = Clip3(0, maxVal, (predL0 + predL1 + offset) >> shift);
```

### Explicit weighted prediction (S8.5.3.4)
```cpp
// w0, w1 : weights, o0, o1 : offsets, logWDC : denominator
shift = logWDC + 1;  // for bi-pred
offset = ((o0 + o1 + 1) << logWDC);
pred = Clip3(0, maxVal, (w0 * predL0 + w1 * predL1 + offset) >> shift);
```

## Known pitfalls

1. **Chroma MV** : derived from the luma MV, NOT an independent MV
2. **1/8 pel chroma precision** : 8 fractional positions, not 4
3. **Bi-pred without intermediate clip** : both predictions stay in extended
   precision (int16_t) until the final averaging
4. **Weighted pred** : the weights are in the slice header (pred_weight_table)
5. **logWDC** : `luma_log2_weight_denom` (luma) or `+ delta_chroma_log2_weight_denom` (chroma)

## Validation test

```cpp
// Unit tests:
// 1. Chroma H-only frac=4 (half-pixel) : check coefficients
// 2. Chroma 2D frac=(2,6) : check temp buffer + result
// 3. Bi-pred averaging : predL0=100, predL1=200, check the exact result
// 4. Weighted pred : w0=64, w1=64, o0=0, o1=0 (equivalent to default)
```

## Exit criterion

- [ ] Chroma interpolation unit test (at least 2 fractional positions)
- [ ] Default bi-pred averaging unit test
- [ ] Weighted prediction unit test (if used in the test streams)
- [ ] Chroma MV derivation verification
