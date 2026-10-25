# 5.7 -- Luma Interpolation (8-tap)

## Goal

Verify that the 8-tap luma interpolation filter is bit-exact for the 4 shift/clip
cases (H-only, V-only, 2D H pass, 2D V pass).

## Spec refs

- S8.5.3.2.2 : Luma sample interpolation process
- Table 8-1 : Luma interpolation filter coefficients

## Existing code

`src/decoding/interpolation.cpp` (303 lines) : `perform_inter_prediction()`

## Filter coefficients (Table 8-1)

```cpp
const int16_t luma_filter[4][8] = {
    {  0,  0,  0, 64,  0,  0,  0,  0 },  // frac=0 (integer)
    { -1,  4,-10, 58, 17, -5,  1,  0 },  // frac=1 (1/4 pel)
    { -1,  4,-11, 40, 40,-11,  4, -1 },  // frac=2 (1/2 pel)
    {  0,  1, -5, 17, 58,-10,  4, -1 },  // frac=3 (3/4 pel)
};
```

## 4 shift/clip cases (#1 SOURCE OF MISMATCH)

### Case 1 : H-only (xFrac != 0, yFrac == 0)
```
shift1 = BitDepth - 8     (= 0 for 8-bit)
offset1 = 0 (if shift1 == 0) or 1 << (shift1 - 1)
result = Clip3(0, maxVal, (sum + offset1) >> shift1)
```

### Case 2 : V-only (xFrac == 0, yFrac != 0)
```
shift1 = BitDepth - 8
offset1 = 0 or 1 << (shift1 - 1)
result = Clip3(0, maxVal, (sum + offset1) >> shift1)
```
Note: same shift as H-only for uni-pred.

### Case 3 : 2D H pass (xFrac != 0, yFrac != 0, first pass)
```
shift1 = BitDepth - 8
offset1 = 0 or 1 << (shift1 - 1)
temp = (sum + offset1) >> shift1     ← NO clip ! int16_t result
```

### Case 4 : 2D V pass (second pass on the temporary buffer)
```
shift2 = 6
offset2 = 1 << (shift2 - 1) = 32
result = Clip3(0, maxVal, (sum + offset2) >> shift2)
```

### Bi-prediction : extended precision
For bi-pred, the H and V passes use DIFFERENT shifts :
```
shift1_bipred = 14 - BitDepth    (= 6 for 8-bit)
No intermediate clip, result in extended precision (int16_t)
Final averaging : (predL0 + predL1 + offset) >> (15 - BitDepth + 1)
                  with offset = 1 << (15 - BitDepth)
```

## Known pitfalls

1. **shift1 for 8-bit = 0** : no shift in the H pass for 8-bit uni-pred
2. **2D H pass : NO clip** between the two passes
3. **Bi-pred shifts differ from uni-pred** : shift1=6 instead of 0 for 8-bit
4. **Temporary buffer** : must be int16_t, not uint8_t (values can be negative)
5. **Temp buffer margin** : for the V pass, 3 lines above and 4 below are needed

## Audit to do

1. Read S8.5.3.2.2 of the PDF (pages 163-168) -- READ THE PDF, NOT THE NOTES
2. Check each shift/offset case in the code
3. Check whether there is a clip between the passes

## Validation test

```cpp
// Unit test per case:
// 1. H-only frac=2 on 8 samples : check the exact result
// 2. V-only frac=1 on 8 samples
// 3. 2D frac=(1,2) on a 4x4 block : check temp buffer + final result
// 4. Bi-pred : check extended precision + averaging

// Test vectors: use simple values (128, 129, 130...)
// so the result can be computed by hand
```

## Exit criterion

- [ ] H-only unit test : 3 fractional positions (1, 2, 3)
- [ ] V-only unit test : 3 fractional positions
- [ ] 2D unit test : at least 1 position (xFrac, yFrac) != (0,0)
- [ ] Shift verification : all shifts match the spec for 8-bit
