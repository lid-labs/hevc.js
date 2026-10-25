# Phase 4C — Residual Coding Context Derivation

## Status: TO VALIDATE

## Goal

Validate that EACH `derive_*_ctx()` function produces the SAME context index as HM,
for all parameter combinations. Purely functional test, no CABAC.

## Why it is critical

A wrong context index does not necessarily change the value of the decoded bin
(two different contexts can decode the same value by coincidence),
but it corrupts the arithmetic state of the CABAC engine. The bug then shows up
tens or hundreds of bins later, making debugging nearly impossible.

## Bugs found in this area

| Bug | Cause | Fix |
|-----|-------|-----|
| Chroma sig_coeff_flag offset 27 vs 28 | Spec eq 9-55 vs HM layout | Chroma base = 28 |
| Chroma 4x4 firstSigCtx = 9 instead of 0 | Confusion with luma 4x4 | firstSigCtx[CHROMA][4x4] = 0 |
| Chroma 8x8 firstSigCtx = 12 instead of 9 | Off by one context type | firstSigCtx[CHROMA][8x8] = 9 |
| Luma 8x8 firstSigCtx = 21 instead of 9 | Confusion NxN vs 8x8 | firstSigCtx[LUMA][8x8] = 9 |

## Spec refs

- §9.3.4.2.5: sig_coeff_flag context derivation (the most complex)
- §9.3.4.2.6: coeff_abs_level_greater1_flag ctxSet
- §9.3.4.2.7: coeff_abs_level_greater2_flag ctxSet
- §9.3.3.5: last_sig_coeff prefix context
- HM `ContextTables.h`: reference tables
- HM `TComTrQuant.cpp`: `getSigCtxInc()`, `calcPatternSigCtx()`
- HM `TComChromaFormat.h`: `getContextSetIndex()`, `significanceMapContextSetStart`

## Functions to test

### 1. `derive_sig_coeff_flag_ctx(cIdx, log2TrafoSize, xC, yC, scanIdx, coded_sub_block_flag, numSbPerSide)`

HM reference values (`significanceMapContextSetStart` + `getSigCtxInc`):

```
Luma (base=0):
  DC (xC+yC==0) → 0
  4x4 non-DC → ctxIdxMap[pos]  (range 1-8)
  8x8 diag → 9 + offset  (range 9-14)
  8x8 non-diag → 15 + offset  (range 15-20)
  NxN (>=16x16) → 21 + offset  (range 21-26)
  transform_skip → 27

Chroma (base=28):
  DC → 28
  4x4 non-DC → 28 + ctxIdxMap[pos]  (range 29-36)
  8x8 → 28 + 9 + offset  (range 37-39)
  NxN (>=16x16) → 28 + 12 + offset  (range 40-42)
  transform_skip → 28 + 15 = 43
```

Test cases:
```cpp
// Luma DC
EXPECT_EQ(derive_sig_coeff_flag_ctx(0, 4, 0, 0, 0, csbf, 4), 0);
// Luma 4x4, pos (1,0)
EXPECT_EQ(derive_sig_coeff_flag_ctx(0, 2, 1, 0, 0, csbf, 1), 1);
// Luma 8x8 diag, first group, pos (1,0) with prevCsbf=0
EXPECT_EQ(derive_sig_coeff_flag_ctx(0, 3, 1, 0, 0, csbf, 2), 9+2);
// Chroma DC
EXPECT_EQ(derive_sig_coeff_flag_ctx(1, 3, 0, 0, 0, csbf, 2), 28);
// Chroma 4x4, pos (0,1)
EXPECT_EQ(derive_sig_coeff_flag_ctx(1, 2, 0, 1, 0, csbf, 1), 28+2);
// Chroma 8x8, first group, pos (1,0) with prevCsbf=0
EXPECT_EQ(derive_sig_coeff_flag_ctx(1, 3, 1, 0, 0, csbf, 2), 28+9+2);
```

### 2. `decode_coeff_abs_level_greater1_flag` context

HM `getContextSetIndex`:
```
Luma:   ctxSet = (subsetIdx > 0 ? 2 : 0) + (prevGreater1==0 ? 1 : 0)
Chroma: ctxSet = 0 + (prevGreater1==0 ? 1 : 0)
ctxIdx = (cIdx==0 ? 0 : 16) + ctxSet*4 + greater1Ctx
```

### 3. `decode_coeff_abs_level_greater2_flag` context

```
ctxIdx = (cIdx==0 ? ctxSet : 4 + (ctxSet & 1))
```

### 4. `decode_last_sig_coeff_prefix` context

```
Luma:   ctxOff = 3*(log2-2) + ((log2-1)>>2), ctxShift = (log2+1)>>2
Chroma: ctxOff = 15, ctxShift = log2-2
ctxIdx = ctxOffset + ctxOff + (i >> ctxShift)
```

### 5. `decode_coded_sub_block_flag` context

```
ctxInc = (cIdx > 0 ? 2 : 0) + (csbfRight || csbfBelow ? 1 : 0)
```

## Validation method

### Option A: Pure unit test (recommended)

Create `tests/unit/test_residual_contexts.cpp` that calls each `derive_*` with varied parameters and compares with expected values computed by hand from HM.

Advantage: fast, deterministic, no HM build needed.

### Option B: Automatic extraction from HM

1. Modify HM to log `(cIdx, log2, xC, yC, scanIdx, prevCsbf) → ctxIdx` for each sig_coeff_flag
2. Parse the log
3. Replay the same parameters in our `derive_sig_coeff_flag_ctx()`
4. Compare

Advantage: exhaustive coverage on a real bitstream.

## Tasks

- [ ] Create `tests/unit/test_residual_contexts.cpp`
- [ ] Test `derive_sig_coeff_flag_ctx`: 20+ cases covering luma/chroma x DC/4x4/8x8/NxN x prevCsbf
- [ ] Test `decode_coeff_abs_level_greater1_flag` context: luma/chroma x ctxSet x greater1Ctx
- [ ] Test `decode_coeff_abs_level_greater2_flag` context: luma/chroma x ctxSet
- [ ] Test `decode_last_sig_coeff_prefix` context: luma/chroma x log2 2-5
- [ ] Test `decode_coded_sub_block_flag` context: luma/chroma x neighbours
- [ ] Validate by comparative trace vs HM on i_64x64_qp22 (Option B)

## Exit criterion

- [ ] test_residual_contexts passes with 30+ cases
- [ ] sig_coeff_flag ctx trace identical to HM for the first 100 sig_coeff_flag of i_64x64_qp22
