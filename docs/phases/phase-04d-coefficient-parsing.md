# Phase 4D — Coefficient Parsing

## Status: TO VALIDATE

## Goal

Validate that the decoded coefficients (before dequant) are IDENTICAL to HM, TU by TU.
This integrates 4A (CABAC), 4B (coding tree), 4C (contexts) and the parsing logic
(scan order, coded_sub_block_flag, sig_coeff_flag, levels, sign).

## Prerequisites

- 4B (coding tree) validated: the syntax element sequence is correct
- 4C (residual contexts) validated: each derive_*_ctx produces the right index

## Spec refs

- §7.3.8.11: residual_coding (spec)
- §9.3.3.5: last_sig_coeff prefix binarization
- §9.3.3.11: coeff_abs_level_remaining (Golomb-Rice + EGk)
- §7.4.9.11: Sign data hiding

## What is implemented

`residual_coding.cpp`: complete decode with scan orders (diag/horiz/vert),
sub-block scanning, sig_coeff_flag, greater1/2, sign, remaining, sign hiding.

## Elements to validate

### 1. Scan order derivation
- `derive_scan_idx()`: luma 4x4 and chroma 4x4 use the intra mode to choose diag/horiz/vert
- All others: diagonal
- Check against HM `TComTrQuant::getCodingParameters()`

### 2. Last significant coefficient position
- Prefix binarization with truncated unary
- Suffix with fixed-length bypass bins
- `maxBins = (log2TrafoSize << 1) - 1` for X and Y separately
- Check that the right log2TrafoSize is used (luma vs chroma)

### 3. Coefficient levels
- `coeff_abs_level_greater1_flag`: max 8 per sub-block, ctxSet rotation
- `coeff_abs_level_greater2_flag`: only 1 per sub-block (at lastGreater1ScanPos)
- `coeff_abs_level_remaining`: Golomb-Rice with adaptive cRiceParam
- `prevGreater1Ctx`: carry between sub-blocks (§9.3.4.2.6)

### 4. Sign data hiding
- Condition: `sign_data_hiding_enabled_flag && (lastSigScanPos - firstSigScanPos > 3)`
- The sign of the first significant coeff is derived from the parity of the sum

## Validation method

### Test: extract the coefficients from HM and compare

1. Add in HM (TDecSbac.cpp, after parseCoeffNxN):
```cpp
fprintf(stderr, "[HM_COEFF] (%d,%d) log2=%d cIdx=%d", x0, y0, log2, cIdx);
for (int i = 0; i < trSize*trSize; i++) fprintf(stderr, " %d", coefficients[i]);
fprintf(stderr, "\n");
```

2. Add the same trace in our `decode_residual_coding()` after the `coefficients[]` array is filled

3. Compare the two traces: the first differing TU points at the bug

### Unit test: known coefficients

Create minimal bitstreams (1 CU, 1 TU) and check the extracted coefficients
against the expected values (computed by hand or extracted from HM).

## Tasks

- [ ] Add a coefficient trace in our decoder
- [ ] Add the equivalent trace in HM
- [ ] Compare for i_64x64_qp22: find the first differing TU
- [ ] If divergence: identify whether it is the scan, the levels, the sign, or the cRiceParam
- [ ] Fix the bug(s)
- [ ] Unit test: at least 5 TUs with verified coefficients

## Exit criterion

- [ ] Coefficients of all the TUs of the i_64x64_qp22 frame are identical to HM
- [ ] Includes luma 4x4, 8x8, 16x16 and chroma 4x4, 8x8
