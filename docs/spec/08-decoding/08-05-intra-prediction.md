# 8.5.4 — Intra Prediction

Spec ref: 8.5.4.1 (general), 8.5.4.2 (reference sample availability + substitution), 8.5.4.3 (filtering), 8.5.4.4 (Planar), 8.5.4.5 (DC), 8.5.4.6 (Angular)

## Overview

35 intra modes for luma (0-34), 5 modes for chroma:

| Mode | Name | Description |
|------|-----|-------------|
| 0 | Planar | Bilinear interpolation |
| 1 | DC | Average of the reference samples |
| 2-34 | Angular | Directional (26 = vertical, 10 = horizontal) |

## 8.5.4.2 — Reference Sample Availability

Before prediction, the reference sample vector `p[x][y]` must be built:

```
Reference samples (for an NxN block):

        p[-1][-1]  p[0][-1] ... p[2N-1][-1]
        p[-1][0]
        p[-1][1]
        ...
        p[-1][2N-1]

-> 4N+1 samples in total (corner + top edge + left edge)
```

### Availability process

```cpp
// For each reference sample position:
// 1. Check whether the neighboring block is available (in the same slice/tile, already decoded)
// 2. If not available: substitution
//    - First available sample -> propagate to the unavailable positions
//    - If none is available: default value = 1 << (BitDepth - 1) (mid-scale)
```

## 8.5.4.3 — Reference Sample Filtering

```cpp
// Filtering depends on the mode and the block size
bool filter_flag;
if (intraMode == DC || nTbS == 4)
    filter_flag = false;  // No filtering for DC or 4x4
else {
    // Table 8-3: minDistVerHor = min(abs(mode-26), abs(mode-10))
    int minDist = std::min(std::abs(mode - 26), std::abs(mode - 10));
    // Threshold depends on the block size
    int thresh = (nTbS == 8) ? 7 : (nTbS == 16) ? 1 : 0;
    filter_flag = (minDist > thresh);
}

if (filter_flag) {
    // [1,2,1]/4 filter on the reference samples
    p'[-1][-1] = (p[-1][0] + 2*p[-1][-1] + p[0][-1] + 2) >> 2;
    for (i = 0; i < 2*nTbS - 1; i++) {
        p'[-1][i] = (p[-1][i-1] + 2*p[-1][i] + p[-1][i+1] + 2) >> 2;
        p'[i][-1] = (p[i-1][-1] + 2*p[i][-1] + p[i+1][-1] + 2) >> 2;
    }
    // Last sample not filtered
}

// Strong intra smoothing (8.5.4.2.3) for 32x32
if (strong_intra_smoothing_enabled_flag && nTbS == 32 && filter_flag) {
    int threshold = 1 << (BitDepthY - 5);
    bool bilinear = (abs(p[-1][2*nTbS-1] + p[2*nTbS-1][-1] - 2*p[-1][-1]) < threshold);
    if (bilinear) {
        // Bilinear interpolation between the corners
        for (i = 0; i < 2*nTbS - 1; i++) {
            p'[-1][i] = ((2*nTbS-1-i)*p[-1][-1] + (i+1)*p[-1][2*nTbS-1] + nTbS) >> (log2(nTbS)+1);
            p'[i][-1] = ((2*nTbS-1-i)*p[-1][-1] + (i+1)*p[2*nTbS-1][-1] + nTbS) >> (log2(nTbS)+1);
        }
    }
}
```

## 8.5.4.4 — Planar Mode (Mode 0)

```cpp
// 8.4.4.2.4 — Planar prediction
//
// 1D layout convention for reference samples p[]:
//   p[0..2N]   = top row:   p[x][-1] for x = -1..2N-1  (index 0 = p[-1][-1] = corner)
//   p[2N+1..4N] = left col: p[-1][y] for y = 0..2N-1    (index 2N+1 = p[-1][0])
//
// Mapping from spec 2D notation to 1D array:
//   p[x][-1]   -> p[x + 1]         (x = -1..2N-1, so indices 0..2N)
//   p[-1][y]   -> p[2*nTbS + 1 + y] (y = 0..2N-1, so indices 2N+1..4N)
//   p[-1][-1]  -> p[0]              (corner, same as p[x+1] with x=-1)

void intra_pred_planar(int16_t* pred, int stride, const int16_t* p, int nTbS) {
    int log2 = Log2(nTbS);
    // Shorthand accessors matching spec notation
    // p_top(x)  = p[x][-1]  -> p[x + 1]
    // p_left(y) = p[-1][y]  -> p[2*nTbS + 1 + y]
    // p_top(nTbS)           = p[nTbS][-1]  (top-right)  -> p[nTbS + 1]
    // p_left(nTbS)          = p[-1][nTbS]  (bottom-left) -> p[2*nTbS + 1 + nTbS]

    for (int y = 0; y < nTbS; y++) {
        for (int x = 0; x < nTbS; x++) {
            pred[y*stride + x] = (
                (nTbS - 1 - x) * p[2*nTbS + 1 + y]     +  // p[-1][y]   (left)
                (x + 1)        * p[nTbS + 1]            +  // p[nTbS][-1] (top-right)
                (nTbS - 1 - y) * p[x + 1]               +  // p[x][-1]   (top)
                (y + 1)        * p[2*nTbS + 1 + nTbS]   +  // p[-1][nTbS] (bottom-left)
                nTbS                                        // rounding
            ) >> (log2 + 1);
        }
    }
}
```

## 8.5.4.5 — DC Mode (Mode 1)

```cpp
void intra_pred_dc(int16_t* pred, int stride, const int16_t* ref, int nTbS, int cIdx) {
    // Average of the top + left samples
    int sum = 0;
    for (int i = 0; i < nTbS; i++) {
        sum += ref[i + 1];       // top (p[i][-1])
        sum += ref[-1 - i - 1];  // left (p[-1][i]) — depends on the layout
    }
    int dcVal = (sum + nTbS) >> (log2(nTbS) + 1);

    // Fill the block
    for (int y = 0; y < nTbS; y++)
        for (int x = 0; x < nTbS; x++)
            pred[y*stride + x] = dcVal;

    // DC filtering (luma only, cIdx == 0)
    if (cIdx == 0) {
        pred[0] = (ref[1] + 2*dcVal + ref[-1-1] + 2) >> 2;  // corner
        for (int x = 1; x < nTbS; x++)
            pred[x] = (ref[x+1] + 3*dcVal + 2) >> 2;        // top edge
        for (int y = 1; y < nTbS; y++)
            pred[y*stride] = (ref[-1-y-1] + 3*dcVal + 2) >> 2; // left edge
    }
}
```

## 8.5.4.6 — Angular Modes (Modes 2-34)

### Prediction angles

```cpp
// Table 8-4: angles in 1/32 pixel
const int8_t intraPredAngle[35] = {
    0,   0,  32, 26, 21, 17, 13,  9,  5,  2,  // modes 0-9
    0,  -2, -5, -9,-13,-17,-21,-26,-32,-26,    // modes 10-19
   -21,-17,-13, -9, -5, -2,  0,  2,  5,  9,    // modes 20-29
    13, 17, 21, 26, 32                           // modes 30-34
};

// invAngle for modes with a negative angle (modes 11-25 except 10, 26)
const int16_t invAngle[35] = { /* ... */ };
```

### Process

```cpp
void intra_pred_angular(int16_t* pred, int stride, const int16_t* ref,
                         int nTbS, int mode, int cIdx) {
    int angle = intraPredAngle[mode];
    bool is_horizontal = (mode >= 2 && mode <= 17);  // modes 2-17

    // Build the extended reference vector
    // For horizontal modes: main = left refs, side = top refs
    // For vertical modes:   main = top refs,  side = left refs
    int16_t refMain[2*64+1];  // max size for 32x32
    int16_t refSide[2*64+1];

    if (is_horizontal) {
        // Main = left, Side = top
        // Copy left into refMain, top into refSide
    } else {
        // Main = top, Side = left
    }

    // Extension for negative angles (spec 8.4.4.2.6)
    // For negative angles, extend refMain with projected samples from refSide
    if (angle < 0) {
        int invAng = invAngle[mode];
        // x goes from -1 down to the limit determined by the angle
        for (int x = -1; x >= -(nTbS * angle >> 5) - 1; x--) {
            refMain[x] = refSide[(x * invAng + 128) >> 8];
        }
    }

    // Prediction
    // For both horizontal and vertical modes, the prediction loop is written
    // in "vertical" form: outer loop = y (rows), inner loop = x (columns).
    // For horizontal modes (2-17), the roles of x/y are swapped relative to
    // the output block — the result is transposed after the loop.
    for (int y = 0; y < nTbS; y++) {
        int iIdx  = ((y + 1) * angle) >> 5;
        int iFact = ((y + 1) * angle) & 31;
        for (int x = 0; x < nTbS; x++) {
            if (iFact != 0)
                pred[y*stride+x] = ((32-iFact)*refMain[x+iIdx+1] + iFact*refMain[x+iIdx+2] + 16) >> 5;
            else
                pred[y*stride+x] = refMain[x+iIdx+1];
        }
    }

    // For horizontal modes (2-17), the prediction was computed in transposed form
    // (using left refs as main, iterating as if vertical). Transpose the result.
    if (is_horizontal) {
        for (int y = 0; y < nTbS; y++)
            for (int x = y + 1; x < nTbS; x++)
                std::swap(pred[y*stride+x], pred[x*stride+y]);
    }

    // Post-filtering for pure horizontal (mode 10) and pure vertical (mode 26)
    // Only for luma (cIdx == 0) and only the first row/column
    // 8.4.4.2.6 — applies when intraPredAngle == 0
    if (cIdx == 0 && (mode == 10 || mode == 26)) {
        if (mode == 26) {
            // Vertical: filter first column
            for (int y = 0; y < nTbS; y++)
                pred[y*stride] = Clip1Y(p[0][-1] + ((p[-1][y] - p[-1][-1]) >> 1));
        } else {
            // Horizontal: filter first row
            for (int x = 0; x < nTbS; x++)
                pred[x] = Clip1Y(p[-1][0] + ((p[x][-1] - p[-1][-1]) >> 1));
        }
    }
}
```

## Intra Mode Derivation — 8.5.4.1

### Most Probable Modes (MPM)

```cpp
// 3 MPMs derived from neighbors A (left) and B (above)
void derive_mpm(int candModeList[3], int modeA, int modeB) {
    if (modeA == modeB) {
        if (modeA < 2) {
            candModeList[0] = 0;  // Planar
            candModeList[1] = 1;  // DC
            candModeList[2] = 26; // Vertical
        } else {
            candModeList[0] = modeA;
            candModeList[1] = 2 + ((modeA - 2 + 29) % 32);  // neighbor -1
            candModeList[2] = 2 + ((modeA - 2 +  1) % 32);  // neighbor +1  (spec: reversed?)
        }
    } else {
        candModeList[0] = modeA;
        candModeList[1] = modeB;
        if (modeA != 0 && modeB != 0)
            candModeList[2] = 0;   // Planar
        else if (modeA != 1 && modeB != 1)
            candModeList[2] = 1;   // DC
        else
            candModeList[2] = 26;  // Vertical
    }
}

// If prev_intra_luma_pred_flag:
//    IntraPredModeY = candModeList[mpm_idx]
// Otherwise:
//    Sort the 3 MPMs, then index rem_intra_luma_pred_mode into the 32 remaining modes
```

### Chroma mode derivation

```cpp
// 5 possible chroma modes:
// intra_chroma_pred_mode  -> mode
// 0                       -> Planar (0)
// 1                       -> Vertical (26)
// 2                       -> Horizontal (10)
// 3                       -> DC (1)
// 4                       -> Derived from luma (IntraPredModeY)
// If the chroma mode == luma mode, replace it with mode 34
```

## Checklist

- [ ] Reference sample availability check
- [ ] Reference sample substitution
- [ ] Reference sample filtering ([1,2,1] + strong intra smoothing)
- [ ] Planar mode prediction
- [ ] DC mode prediction + DC filtering
- [ ] Angular prediction (modes 2-34) with ref extension
- [ ] Post-filtering for pure vertical/horizontal
- [ ] MPM derivation
- [ ] Chroma mode derivation
- [ ] Tests: I-only bitstreams, each mode in isolation if possible
