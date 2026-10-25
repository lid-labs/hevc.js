# 8.7.2 — Deblocking Filter

Spec ref: 8.7.2.1 (general), 8.7.2.2 (boundary derivation), 8.7.2.3 (boundary filtering strength), 8.7.2.4 (filtering process for luma), 8.7.2.5 (filtering process for chroma)

## Overview

The deblocking filter smooths block edges to reduce visual artifacts. It operates on the horizontal and vertical boundaries of CUs/TUs/PUs.

### Processing order

```
1. Filter all VERTICAL boundaries (for each CTU, left -> right, top -> bottom)
2. Filter all HORIZONTAL boundaries (same order)

Important: the vertical edges are filtered BEFORE the horizontal ones.
```

## 8.7.2.2 — Boundary Derivation

The boundaries to filter are at positions aligned on 8 pixels (luma):

```cpp
// For each vertical edge at position xB:
// - xB must be a multiple of 8 (luma) or 4 (if conditions)
// - The edge exists if two adjacent blocks have CU/TU/PU boundaries

// No filtering if:
// - The edge is on the picture border
// - The edge is on a tile border with loop_filter_across_tiles_enabled_flag = 0
// - The edge is on a slice border with loop_filter_across_slices_enabled_flag = 0
```

## 8.7.2.3 — Boundary Filtering Strength (Bs)

```cpp
int derive_boundary_strength(const Block& p, const Block& q) {
    // p = block on one side, q = block on other side of the edge

    // Bs = 2 if either block is intra
    if (p.CuPredMode == MODE_INTRA || q.CuPredMode == MODE_INTRA)
        return 2;

    // Bs = 1 if either block has non-zero transform coefficients
    if (p.has_nonzero_coeffs || q.has_nonzero_coeffs)
        return 1;

    // §8.7.2.4.5 — Compare motion parameters
    // nRefP, nRefQ = number of MVs (1 for uni-pred, 2 for bi-pred)
    int nRefP = p.predFlagL0 + p.predFlagL1;
    int nRefQ = q.predFlagL0 + q.predFlagL1;

    if (nRefP != nRefQ)
        return 1;

    if (nRefP == 1) {
        // Uni-prediction: compare the single MV + ref pic
        PicRef refP = p.predFlagL0 ? p.refPicL0 : p.refPicL1;
        PicRef refQ = q.predFlagL0 ? q.refPicL0 : q.refPicL1;
        MV mvP = p.predFlagL0 ? p.mvL0 : p.mvL1;
        MV mvQ = q.predFlagL0 ? q.mvL0 : q.mvL1;

        if (refP != refQ)
            return 1;
        if (abs(mvP.x - mvQ.x) >= 4 || abs(mvP.y - mvQ.y) >= 4)
            return 1;
    } else {
        // Bi-prediction: two ref pics on each side
        // Check both orderings (same pair or swapped pair)
        bool samePairSameOrder =
            (p.refPicL0 == q.refPicL0 && p.refPicL1 == q.refPicL1);
        bool samePairSwapped =
            (p.refPicL0 == q.refPicL1 && p.refPicL1 == q.refPicL0);

        if (!samePairSameOrder && !samePairSwapped)
            return 1;

        if (samePairSameOrder && !samePairSwapped) {
            // Same order: compare L0↔L0 and L1↔L1
            if (abs(p.mvL0.x - q.mvL0.x) >= 4 || abs(p.mvL0.y - q.mvL0.y) >= 4 ||
                abs(p.mvL1.x - q.mvL1.x) >= 4 || abs(p.mvL1.y - q.mvL1.y) >= 4)
                return 1;
        } else if (!samePairSameOrder && samePairSwapped) {
            // Swapped: compare L0↔L1 and L1↔L0
            if (abs(p.mvL0.x - q.mvL1.x) >= 4 || abs(p.mvL0.y - q.mvL1.y) >= 4 ||
                abs(p.mvL1.x - q.mvL0.x) >= 4 || abs(p.mvL1.y - q.mvL0.y) >= 4)
                return 1;
        } else {
            // Both orderings match: Bs=0 only if BOTH orderings give small MV diff
            bool order1_ok =
                abs(p.mvL0.x - q.mvL0.x) < 4 && abs(p.mvL0.y - q.mvL0.y) < 4 &&
                abs(p.mvL1.x - q.mvL1.x) < 4 && abs(p.mvL1.y - q.mvL1.y) < 4;
            bool order2_ok =
                abs(p.mvL0.x - q.mvL1.x) < 4 && abs(p.mvL0.y - q.mvL1.y) < 4 &&
                abs(p.mvL1.x - q.mvL0.x) < 4 && abs(p.mvL1.y - q.mvL0.y) < 4;
            if (!order1_ok && !order2_ok)
                return 1;
        }
    }

    return 0;  // No filtering needed
}
```

### Note: PCM and deblocking

If `pcm_loop_filter_disabled_flag` is set in the SPS and a block is PCM, deblocking is disabled for the edges of that block (Bs forced to 0 for edges touching a PCM block).

## 8.7.2.4 — Luma Filtering

### Decision process

```cpp
// For each 4-sample edge:
// Read the samples on both sides: p0,p1,p2,p3 | q0,q1,q2,q3

// beta and tC depend on the QP
int Q = (QpP + QpQ + 1) >> 1;  // average QP
int beta = beta_table[Clip3(0, 51, Q + slice_beta_offset)];
int tc = tc_table[Clip3(0, 53, Q + 2*(bS-1) + slice_tc_offset)];

// Filtering condition:
// |p0-q0| < beta, |p3-p0| + |q3-q0| < beta >> 3, |p0-q0| < (5*tC+1) >> 1
bool filter = (dp + dq < beta);
// dp = |p2-p0|, dq = |q2-q0| for the 2 lines of the edge
```

### Strong vs Weak filter

```cpp
// Strong filter condition:
// 2*(dp+dq) < beta/4 && |p0-q0| < (5*tC+1) >> 1 && |p3-p0| + |q3-q0| < beta >> 3
bool strong = (2*(dp+dq) < (beta >> 2)) && (abs(p0-q0) < ((5*tc+1)>>1));

if (strong) {
    // Strong filter: modifies p0,p1,p2 and q0,q1,q2
    p0' = Clip3(p0-2*tc, p0+2*tc, (p2 + 2*p1 + 2*p0 + 2*q0 + q1 + 4) >> 3);
    p1' = Clip3(p1-2*tc, p1+2*tc, (p2 + p1 + p0 + q0 + 2) >> 2);
    p2' = Clip3(p2-2*tc, p2+2*tc, (2*p3 + 3*p2 + p1 + p0 + q0 + 4) >> 3);
    // Symmetric for q0', q1', q2'
} else {
    // Weak filter: modifies p0,p1 and q0,q1
    int delta = (9*(q0-p0) - 3*(q1-p1) + 8) >> 4;
    delta = Clip3(-tc, tc, delta);
    p0' = Clip1Y(p0 + delta);
    q0' = Clip1Y(q0 - delta);

    // Optional: modify p1, q1
    int deltaP = Clip3(-tc>>1, tc>>1, ((p2+p0+1)>>1) - p1 + delta/2);
    // ...
}
```

## 8.7.2.5 — Chroma Filtering

Simpler than luma: no strong/weak distinction.

```cpp
// Chroma filtering only if Bs == 2
if (bS == 2) {
    int delta = Clip3(-tc, tc, ((q0-p0)*4 + p1-q1 + 4) >> 3);
    p0' = Clip1C(p0 + delta);
    q0' = Clip1C(q0 - delta);
}
```

## beta and tC tables

```cpp
// Table 8-16 (simplified)
const uint8_t beta_table[52] = {
     0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  6,  7,  8,  9,
    10, 11, 12, 13, 14, 15, 16, 17, 18, 20,
    22, 24, 26, 28, 30, 32, 34, 36, 38, 40,
    42, 44, 46, 48, 50, 52, 54, 56, 58, 60,
    62, 64
};

const uint8_t tc_table[54] = {
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 2, 2, 2,
    2, 3, 3, 3, 3, 4, 4, 4, 5, 5,
    6, 6, 7, 8, 9, 10, 11, 13, 14, 16,
    18, 20, 22, 24
};
```

## Known pitfalls

1. **V then H order**: Filter the vertical edges first over the whole picture, then the horizontal ones
2. **8-pixel alignment**: Edges are only filtered if aligned on multiples of 8
3. **Picture borders**: No filtering on the image borders
4. **Inter-CTU dependency**: Deblocking one CTU may require the samples of the neighboring CTU

## Checklist

- [ ] Boundary derivation (which edges to filter)
- [ ] Boundary strength calculation (Bs = 0, 1, 2)
- [ ] beta and tC lookup with QP + offsets
- [ ] Luma strong filter
- [ ] Luma weak filter
- [ ] Chroma filter
- [ ] Correct order: V then H
- [ ] Handling of picture/tile/slice borders
- [ ] Tests: pixel-perfect vs libde265 (the filters are often the source of mismatch)
