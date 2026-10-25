# 5.4 -- TMVP (Temporal Motion Vector Predictor)

## Goal

Verify that the temporal candidate is correctly derived from the collocated picture.

## Spec refs

- S8.5.3.2.7 : Derivation of temporal luma MV predictor (collocated MV)
- S8.5.3.2.12 : Derivation of collocated MVs
- S8.3.5 : Collocated picture derivation

## Existing code

`src/decoding/inter_prediction.cpp` : TMVP part
`src/decoding/dpb.cpp` : `derive_colpic()`

## Critical points to verify

### Collocated picture (S8.3.5)
- `colPic` = `RefPicList[collocated_from_l0_flag ? 0 : 1][collocated_ref_idx]`
- `slice_temporal_mvp_enabled_flag` must be true

### Collocated position (S8.5.3.2.7)
- Bottom-right (+1, +1) first : `(xPb + nPbW, yPb + nPbH)`
- Clip at the CTB boundary : if outside the current CTB, use the centre
- Fallback to the centre : `(xPb + nPbW/2, yPb + nPbH/2)` if bottom-right is unavailable

### MV scaling (S8.5.3.2.12)
```cpp
// POC distance
int td = Clip3(-128, 127, poc_current - poc_collocated);
int tb = Clip3(-128, 127, poc_current - poc_ref);

// Scale factor
int tx = (16384 + (abs(td) >> 1)) / td;
int distScaleFactor = Clip3(-4096, 4095, (tb * tx + 32) >> 6);

// MV scale
mv_scaled.x = Clip3(-32768, 32767, Sign(distScaleFactor * mv_col.x) *
              ((abs(distScaleFactor * mv_col.x) + 127) >> 8));
mv_scaled.y = same for y;
```

## Known pitfalls

1. **Bottom-right clip at the CTB** : do not access the next CTB (not decoded yet)
2. **MV scaling** : the formula is complex, the clippings are critical
3. **collocated list selection** : `collocated_from_l0_flag` and `collocated_ref_idx`
4. **PU motion storage in the collocated picture** : must be at the right granularity (4x4)
5. **td == 0** : degenerate case, avoid division by zero

## Audit to do

1. Read S8.5.3.2.7 and S8.5.3.2.12 of the PDF (pages 180-185)
2. Check the MV scaling formula bit-exactly
3. Check the CTB boundary clip for bottom-right
4. Compare the temporal candidate against HM on the first P-frame

## Validation test

```cpp
// MV scaling unit test:
// - td=1, tb=1 : scale factor = 256, MV unchanged
// - td=2, tb=1 : scale factor = 128, MV halved
// - td=1, tb=2 : scale factor = 512, MV doubled
// - td=-1, tb=1 : negative scale factor, MV inverted
// - Large MVs : check clipping
```

## Exit criterion

- [ ] Temporal MV identical to HM for the first merge PU of the first P-frame
- [ ] MV scaling unit test (5 cases)
- [ ] Bottom-right clip at the CTB verified
