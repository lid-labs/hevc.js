# Phase 4E — Inverse Transform + Dequantization

## Status: DONE (to be validated in isolation)

## Goal

Validate that the dequant → inverse transform → residual chain is bit-exact.
Test on known coefficient vectors, without depending on CABAC or parsing.

## Spec refs

- §8.6.1: Scaling process (dequantization)
- §8.6.2: Scaling list derivation
- §8.6.3: Transform coefficient scaling (level scale, QP, bit shift)
- §8.6.4: Inverse transform (DCT/DST)
- Table 8-10: Chroma QP mapping (non-linear)

## What is implemented (`transform.h`, `transform.cpp`)

- `perform_dequant()`: 4x4/8x8 scaling matrices, level scale table [40,45,51,57,64,72]
- `perform_transform_inverse()`: 4x4 DST (luma intra only), 4x4/8x8/16x16/32x32 DCT
- Partial butterfly implementation
- Inter-pass clipping (§8.6.4.2): clip [-32768, 32767] between the V and H passes
- Transform skip (bypass transform, specific shift)

## Critical points verified

| Point | Spec | Status |
|-------|------|--------|
| Inter-pass clipping | §8.6.4.2 | Implemented |
| Shift1 = 7 (after V), Shift2 = 20 - BitDepth (after H) | §8.6.4.2 | Implemented |
| 4x4 DST for luma intra only | §8.6.4.2 | Implemented |
| Transform skip shift (15 - BitDepth) | §8.6.4.2 | Implemented |
| Non-linear chroma QP mapping table | Table 8-10 | Implemented |
| Scaling list defaults (non-flat for 8x8+) | §7.4.5 | Implemented |

## Existing tests

Validated indirectly by the 3 pixel-perfect toy tests.
No isolated unit test.

## Tests to add

### 1. Inverse DCT round-trip
Generate known coefficients → dequant → inverse transform → check the residual.
```cpp
// Coefficients: only the DC is non-zero (simple case)
int16_t coeffs[16] = {100, 0, 0, ..., 0};
perform_dequant(..., qp, coeffs, scaled);
perform_transform_inverse(2, 0, true, false, 8, scaled, residual);
// Check that residual[i] == expected value (computed by hand)
```

### 2. Inter-pass clipping
Coefficients that produce intermediate values > 32767 or < -32768.
Check that the clipping is applied correctly.

### 3. Chroma QP mapping
Check the non-linear table for qPi in [30, 43].

### 4. Transform skip
Coefficients with transform_skip=1 → residual = (coeffs + round) >> shift.

## Tasks

- [ ] Create `tests/unit/test_transform.cpp`
- [ ] Inverse DCT 4x4 (DST) test with known coefficients
- [ ] Inverse DCT 8x8 test with known coefficients
- [ ] Inter-pass clipping test
- [ ] Chroma QP mapping table test
- [ ] Transform skip test

## Exit criterion

- [ ] 6+ tests pass in test_transform.cpp
- [ ] The residual for a set of known coefficients is bit-exact
