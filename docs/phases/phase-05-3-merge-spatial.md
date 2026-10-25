# 5.3 -- Merge Candidates (Spatial)

## Goal

Verify that the 5 spatial merge mode candidates are derived correctly.

## Spec refs

- S8.5.3.2.2 : Derivation process for spatial merge candidates
- Figure 8-5 : Neighbour positions (A0, A1, B0, B1, B2)

## Existing code

`src/decoding/inter_prediction.cpp` : spatial merge part of `derive_merge_mode()`

## Neighbour positions (Figure 8-5)

```
                B2      B1    B0
                 +-------+-----+
                 |             |
                 |   current   |
                 |     PU      |
                 |             |
            A0---+-------+-----+
            A1   |
```

Exact coordinates (spec) :
- A1 : (xPb - 1, yPb + nPbH - 1)
- B1 : (xPb + nPbW - 1, yPb - 1)
- B0 : (xPb + nPbW, yPb - 1)
- A0 : (xPb - 1, yPb + nPbH)
- B2 : (xPb - 1, yPb - 1)

## Known pitfalls

1. **Test order** : A1 -> B1 -> B0 -> A0 -> B2 (NOT alphabetical !)
2. **B2 is conditional** : only if < 4 candidates after the first 4
3. **Deduplication** : each candidate is skipped if it has the same MV+refIdx as a previous one
4. **Availability** : check slice boundary, tile boundary, and picture boundary
5. **PU partition boundary** : for asymmetric modes (AMP), some neighbours are
   in the SAME CU -- they must be excluded in that case
6. **Off-by-one** : the positions use `nPbH - 1` and `nPbW - 1`, not `nPbH`/`nPbW`

## Audit to do

1. Read S8.5.3.2.2 of the PDF (pages 167-172)
2. Check each neighbour position in the code
3. Check the deduplication condition (refIdx + MV comparison)
4. Check the exclusion conditions for intra-CU PUs (PART_Nx2N, PART_2NxN, AMP)
5. Compare the 5 candidates against HM for 5 chosen PUs

## Validation test

```cpp
// Unit test: derive the spatial candidates for a 16x16 PU at (32,32)
// in a frame where the neighbours have known MVs
// Check: number of candidates, MV and refIdx of each candidate
```

Comparative trace:
```bash
# Add a log before each merge:
# "merge_cand[i] pos=A1 mv=(%d,%d) ref=%d"
# Compare with HM
```

## Exit criterion

- [ ] 5 spatial candidates identical to HM for the first merge PU of the first P-frame
- [ ] Correct deduplication (check a case where A1 == B1)
- [ ] Conditional B2 case verified
