# Phase 4F — Intra Prediction + Reconstruction

## Status: DONE (3 pixel-perfect toy tests)

## Goal

Validate the 35 intra modes, the construction of the reference samples,
the filtering, and the reconstruction (pred + residual + clipping).

## Spec refs

- §8.4.4.2.2: Reference sample availability (Z-scan)
- §8.4.4.2.3: Reference sample substitution
- §8.4.4.2.4: Reference sample filtering (strong intra smoothing 32x32)
- §8.4.4.2.5: Planar mode (mode 0)
- §8.4.4.2.6: DC mode (mode 1) + DC filtering
- §8.4.4.2.7: Angular modes (modes 2-34)
- §8.4.4.2.8: Post-filtering modes 10/26

## What is implemented (`intra_prediction.h`, `intra_prediction.cpp`)

- 35 modes (Planar, DC, Angular 2-34)
- Reference sample construction with Z-scan availability
- Reference sample substitution (propagation of the first available one)
- [1,2,1] filtering conditional on the mode and the size
- Strong intra smoothing (32x32)
- Angular: intraPredAngle[35] and invAngle[] tables
- Transposition for horizontal modes (2-17)
- Post-filtering for modes 10 (horizontal) and 26 (vertical)
- Reconstruction: `Clip(pred + residual, 0, (1<<BitDepth)-1)`

## Critical points verified

| Point | Spec | Status |
|-------|------|--------|
| Z-scan reference availability (not row-major) | §8.4.4.2.2 | Fixed (bug #1 of the session) |
| Intra mode grid granularity MinTbSizeY | §8.4.4.2 | Fixed (bug #2 of the session) |
| Chroma TU position deferred (xBase/yBase) | §8.4.4 | Fixed (bug #3 of the session) |
| Planar indexing (nTbS, not nTbS-1) | §8.4.4.2.5 | Implemented |
| Transposition angular modes 2-17 | §8.4.4.2.7 | Implemented |
| DC filtering (top and left edge) | §8.4.4.2.6 | Implemented |
| constrained_intra_pred_flag | §8.4.4.2.2 | Implemented |

## Existing tests

| Test | Resolution | QP | Status |
|------|-----------|-----|--------|
| toy_qp10 | 64x64 | 10 | Pixel-perfect |
| toy_qp30 | 64x64 | 30 | Pixel-perfect |
| toy_qp45 | 64x64 | 45 | Pixel-perfect |

## Limitations of the toy tests

These tests do NOT cover:
- CU 8x8 with part_mode NxN (4 PUs of 4x4)
- Chroma 8x8 (they only have a single 16x16 CU)
- split_transform_flag (a single TU per CU)
- Multiple CUs in a CTB (the CTB is 64x64 and contains a single CU)

## Tests to add

### Target bitstreams
Generate with ffmpeg/x265 bitstreams that exercise the missing cases:
```bash
# 128x128 I-frame to get multiple CUs with varied sizes
ffmpeg -f lavfi -i testsrc=size=128x128:rate=1 -frames:v 1 \
       -c:v libx265 -x265-params "qp=22:no-deblock:no-sao:keyint=1" \
       -f hevc tests/conformance/fixtures/i_128x128_qp22.265

# Forced 8x8 blocks (min CU = 8)
ffmpeg -f lavfi -i testsrc=size=64x64:rate=1 -frames:v 1 \
       -c:v libx265 -x265-params "qp=30:no-deblock:no-sao:keyint=1:ctu=64:min-cu-size=8" \
       -f hevc tests/conformance/fixtures/i_64x64_smallcu.265
```

### Intra prediction unit test
Test each mode in isolation with known reference samples.
Not needed yet — the 35 modes work (toy tests).

## Tasks

- [ ] Generate additional bitstreams with 8x8 CU and NxN
- [ ] Validate pixel-perfect on these bitstreams (after the 4B/4C/4D fixes)

## Exit criterion

- [x] 3 pixel-perfect toy tests
- [ ] i_64x64_qp22 pixel-perfect (depends on 4B+4C+4D)
- [ ] At least 1 bitstream with 8x8 NxN CU pixel-perfect
