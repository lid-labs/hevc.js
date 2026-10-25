# 5.5 -- Full Merge Mode

## Goal

Verify the complete merge candidate list: spatial + temporal + combined bi-pred + zero MVs.

## Spec refs

- S8.5.3.2.1 : Merge candidate list construction (general)
- S8.5.3.2.3 : Combined bi-predictive merge candidates (B-slices only)
- S8.5.3.2.4 : Zero motion vector merge candidates (padding)
- Table 8-8 : combIdx mapping

## Existing code

`src/decoding/inter_prediction.cpp` : complete `derive_merge_mode()`

## List construction (spec order)

1. **Spatial candidates** (max 4, see 5.3) : A1, B1, B0, A0, (B2 if < 4)
2. **Temporal candidate** (max 1, see 5.4) : collocated MV
3. **Combined bi-pred** (B-slice only, Table 8-8) : pairs of L0/L1 candidates
4. **Zero MVs** (padding) : MV=(0,0) with incrementing refIdx

Total : `MaxNumMergeCand` candidates (typically 5).

## Known pitfalls

1. **Combined bi-pred** : only for B-slices, and only if one candidate is
   uni-pred L0 and the other uni-pred L1 (or the L0 MV of a bi-pred is taken)
2. **Table 8-8 ordering** : the pair order is specific (see merge-table.md)
3. **Zero padding** : refIdx increments from 0 to MaxNumMergeCand-1, not only refIdx=0
4. **MaxNumMergeCand** : derived from `five_minus_max_num_merge_cand` in the slice header
5. **Zero MV deduplication** : do not add if already present

## Audit to do

1. Check the complete order: spatial -> temporal -> combined -> zero
2. Check the `slice_type == B` condition for combined bi-pred
3. Check the Table 8-8 mapping in the code
4. Check zero MV padding with variable refIdx

## Validation test

Complete comparative trace:
```bash
# For each merge PU, log the complete list:
# "merge_list PU(%d,%d): [0] mv=(%d,%d)/(%d,%d) ref=%d/%d pf=%d%d"
# Compare with HM
```

## Exit criterion

- [ ] Complete merge list identical to HM for 3 PUs of the first P-frame
- [ ] Merge list identical to HM for 3 PUs of a B-frame (combined bi-pred tested)
- [ ] Zero padding verified
