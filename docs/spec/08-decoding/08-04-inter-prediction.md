# 8.5.3 — Inter Prediction

Spec ref: 8.5.3.1 (general), 8.5.3.2 (luma interpolation), 8.5.3.3 (chroma interpolation), 8.5.3.4 (weighted pred)

## Overview

Inter prediction reconstructs a block from a reference frame + a motion vector. The MV has quarter-pixel precision (luma), which requires interpolation.

## 8.5.3.1 — General process

```
Inputs:
- (xPb, yPb): PU position
- (nPbW, nPbH): PU dimensions
- mvL0, mvL1: motion vectors (in 1/4 pel)
- refIdxL0, refIdxL1: indices into the reference lists
- predFlagL0, predFlagL1: prediction flags

Process:
if (predFlagL0)
    predSamplesL0 = motion_compensation(refPicL0, mvL0, nPbW, nPbH)
if (predFlagL1)
    predSamplesL1 = motion_compensation(refPicL1, mvL1, nPbW, nPbH)

if (predFlagL0 && predFlagL1)
    // Bi-prediction: weighted average
    predSamples = (predSamplesL0 + predSamplesL1 + offset) >> shift
else if (predFlagL0)
    predSamples = predSamplesL0
else
    predSamples = predSamplesL1
```

## 8.5.3.2 — Luma Sample Interpolation

8-tap interpolation filter for fractional positions:

### Luma filter coefficients (8.5.3.2.2, Table 8-1)

```cpp
// Fractional positions (1/4 pel): 0, 1, 2, 3
// Position 0 = integer pixel, no interpolation
const int16_t luma_filter[4][8] = {
    {  0,  0,  0, 64,  0,  0,  0,  0 },  // position 0 (integer)
    { -1,  4,-10, 58, 17, -5,  1,  0 },  // position 1 (1/4)
    { -1,  4,-11, 40, 40,-11,  4, -1 },  // position 2 (1/2)
    {  0,  1, -5, 17, 58,-10,  4, -1 },  // position 3 (3/4)
};
```

### Interpolation process

```cpp
// For each sample (x, y) of the prediction block:
void luma_interpolation(
    const int16_t* ref,        // reference frame
    int ref_stride,
    int16_t* pred,             // output block
    int pred_stride,
    int xFrac, int yFrac,      // fractional position (0-3)
    int width, int height
) {
    if (xFrac == 0 && yFrac == 0) {
        // Direct copy (integer pixel)
    } else if (yFrac == 0) {
        // Horizontal filter only
        for (y = 0; y < height; y++)
            for (x = 0; x < width; x++)
                pred[y*stride+x] = filter_h(ref, x, y, xFrac);
    } else if (xFrac == 0) {
        // Vertical filter only
        for (y = 0; y < height; y++)
            for (x = 0; x < width; x++)
                pred[y*stride+x] = filter_v(ref, x, y, yFrac);
    } else {
        // 2D filter: horizontal first, then vertical on the result
        // Step 1: horizontal filter -> temporary buffer (with vertical margin)
        // Step 2: vertical filter on the temporary buffer
    }
}

// 8-tap horizontal filter
int filter_h(const int16_t* ref, int x, int y, int frac) {
    const int16_t* f = luma_filter[frac];
    return f[0]*ref[x-3] + f[1]*ref[x-2] + f[2]*ref[x-1] + f[3]*ref[x]
         + f[4]*ref[x+1] + f[5]*ref[x+2] + f[6]*ref[x+3] + f[7]*ref[x+4];
}
```

### Intermediate precision for the 2D filter

For 2D interpolation (xFrac != 0 AND yFrac != 0), the horizontal filter produces intermediate values in extended precision:
- **No clipping** after the horizontal filter
- The intermediate values are on ~22 bits (8-bit input * 8-tap filter with coefficients up to 64)
- The vertical filter is then applied to these extended values
- The final clipping is applied after the vertical filter: Clip3(0, (1 << BitDepth) - 1, (result + offset) >> shift)

### Interpolation shifts — Definitive reference (§8.5.3.3.3)

The shifts depend on the combination (H/V/HV) and the mode (uni/bi pred). Exact values:

```
Case 1 — H-only (xFrac != 0, yFrac == 0):
  shift    = BitDepth - 8
  offset   = shift > 0 ? (1 << (shift - 1)) : 0
  result   = Clip3(0, (1 << BitDepth) - 1, (sum + offset) >> shift)

Case 2 — V-only (xFrac == 0, yFrac != 0):
  shift    = 14 - BitDepth
  offset   = 1 << (shift - 1)
  result   = Clip3(0, (1 << BitDepth) - 1, (sum + offset) >> shift)

Case 3 — 2D / H pass (xFrac != 0, yFrac != 0, first pass):
  shift    = BitDepth - 8
  offset   = 0
  result   = (sum + offset) >> shift    // NO clipping
  → intermediate values on ~15 bits (8-bit) or ~17 bits (10-bit)
  → int16_t buffer for 8-bit, int32_t for 10-bit

Case 4 — 2D / V pass (second pass on the intermediate buffer):
  shift    = 6
  offset   = 1 << 5 = 32
  result   = Clip3(0, (1 << BitDepth) - 1, (sum + offset) >> shift)
```

For **bi-prediction**, the interpolation produces values in extended precision (no final clip in cases 1-4), then:

```
Bi-pred averaging:
  shift    = 15 - BitDepth
  offset   = 1 << (shift - 1)
  result   = Clip3(0, (1 << BitDepth) - 1, (predL0 + predL1 + offset) >> shift)
```

In this case, the H-only and V-only interpolations use different shifts to preserve the extended precision. Refer to §8.5.3.3.3.1 for details.

## 8.5.3.3 — Chroma Sample Interpolation

4-tap filter for chroma (1/8 pel precision):

```cpp
// Table 8-2
const int16_t chroma_filter[8][4] = {
    {  0, 64,  0,  0 },  // 0
    { -2, 58, 10, -2 },  // 1/8
    { -4, 54, 16, -2 },  // 2/8
    { -6, 46, 28, -4 },  // 3/8
    { -4, 36, 36, -4 },  // 4/8
    { -4, 28, 46, -6 },  // 5/8
    { -2, 16, 54, -4 },  // 6/8
    { -2, 10, 58, -2 },  // 7/8
};
```

The chroma MV is derived from the luma MV by dividing by SubWidthC/SubHeightC (with an adjustment of the fractional position).

## 8.5.3.4 — Weighted Prediction

```cpp
// If weighted_pred_flag (P slice) or weighted_bipred_flag (B slice):
// Uni-prediction:
predSamples[x][y] = Clip3(0, maxVal,
    ((predSamplesLX[x][y] * w0 + (1 << (log2Wd - 1))) >> log2Wd) + o0)

// Bi-prediction:
predSamples[x][y] = Clip3(0, maxVal,
    ((predSamplesL0[x][y] * w0 + predSamplesL1[x][y] * w1
      + ((o0 + o1 + 1) << log2Wd)) >> (log2Wd + 1)))
```

## Motion Vector Derivation — 8.5.3.1

### Merge Mode (8.5.3.2.2)

```
Merge candidates (in priority order, Figure 8-5):
1. A1 (left)       : (xPb-1, yPb+nPbH-1)  — bottom of the PU's left side
2. B1 (above)      : (xPb+nPbW-1, yPb-1)  — right of the PU's top side
3. B0 (above-right) : (xPb+nPbW, yPb-1)    — top-right corner of the PU
4. A0 (below-left)  : (xPb-1, yPb+nPbH)    — bottom-left corner of the PU
5. B2 (above-left)  : (xPb-1, yPb-1)       — top-left corner, only if < 4 candidates
6. Temporal candidate (co-located block in the ref pic)
7. Zero MV (padding if < MaxNumMergeCand)
```

### Combined Bi-predictive Merge Candidates (§8.5.3.2.4)

If the number of merge candidates is lower than `MaxNumMergeCand` and the slice is of type B, combined bi-predictive candidates are generated:

```cpp
// Combine pairs of L0-only candidates into bi-predictive candidates
// For each pair (l0Idx, l1Idx) in a defined order:
// combIdx: 0 -> (0,1), 1 -> (1,0), 2 -> (0,2), ...
for (int combIdx = 0; combIdx < numCombinations && numMergeCand < MaxNumMergeCand; combIdx++) {
    int l0CandIdx = l0CandIdxTable[combIdx];
    int l1CandIdx = l1CandIdxTable[combIdx];

    MergeCand& l0Cand = mergeCandList[l0CandIdx];
    MergeCand& l1Cand = mergeCandList[l1CandIdx];

    // Combine only if the ref pics are different
    // (otherwise it is redundant with the original candidate)
    if (l0Cand.refPicL0 != l1Cand.refPicL1) {
        MergeCand combined;
        combined.predFlagL0 = 1;
        combined.predFlagL1 = 1;
        combined.mvL0 = l0Cand.mvL0;
        combined.refIdxL0 = l0Cand.refIdxL0;
        combined.mvL1 = l1Cand.mvL1;
        combined.refIdxL1 = l1Cand.refIdxL1;
        mergeCandList[numMergeCand++] = combined;
    }
}
```

### Pair order (Table 8-8 of the spec)

| combIdx | l0CandIdx | l1CandIdx |
|---------|-----------|-----------|
| 0 | 0 | 1 |
| 1 | 1 | 0 |
| 2 | 0 | 2 |
| 3 | 2 | 0 |
| 4 | 1 | 2 |
| ... | ... | ... |

### AMVP (8.5.3.2.6)

```
AMVP candidates (2 candidates):
1. Spatial: A0/A1 (left), then B0/B1/B2 (above)
2. Temporal: co-located block
3. Zero MV (padding)

Final MV = mvp_candidate[mvp_flag] + mvd
```

## Known pitfalls

1. **MV clipping**: The MV can point outside the frame -> clamping necessary + edge padding
2. **2D interpolation**: The horizontal filter produces intermediate values on more bits -> watch the temporary buffer (16 bits min needed)
3. **Bi-prediction shift/round**: Rounding errors are the #1 source of mismatch with the oracle
4. **Chroma MV derivation**: Divide the luma MV by SubWidthC/SubHeightC, the fractional position changes

## Checklist

- [ ] Motion vector merge mode (5 spatial + 1 temporal + zero padding)
- [ ] AMVP mode (2 candidates + mvd)
- [ ] Luma interpolation 8-tap (H, V, HV)
- [ ] Chroma interpolation 4-tap
- [ ] Bi-prediction averaging
- [ ] Weighted prediction (explicit)
- [ ] MV clipping at the frame edges
- [ ] Tests: P-only then B bitstreams, pixel-perfect vs libde265
