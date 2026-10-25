# 5.6 -- AMVP + MVD

## Goal

Verify the AMVP (Advanced Motion Vector Prediction) derivation and the application of the MVD.

## Spec refs

- S8.5.3.2.6 : AMVP candidate list construction
- S7.3.8.9 : mvd_coding syntax
- S7.3.8.6 : prediction_unit inter syntax (mvp_l0_flag, mvp_l1_flag)

## Existing code

`src/decoding/inter_prediction.cpp` : `derive_amvp_predictor()`
`src/decoding/syntax_elements.cpp` : `decode_mvd()`

## AMVP vs Merge

| Aspect | Merge | AMVP |
|--------|-------|------|
| Candidates | 5 (spatial+temporal+combined+zero) | 2 (spatial+temporal) |
| Selection | merge_idx | mvp_flag (0 or 1) |
| MVD | no | yes (additional) |
| refIdx | implicit (from the candidate) | explicit (parsed from the bitstream) |

## AMVP list construction (S8.5.3.2.6)

1. **Spatial candidate A** : scan A0, A1 for an MV pointing to the same ref picture
2. **Spatial candidate B** : scan B0, B1, B2 for an MV pointing to the same ref picture
3. If < 2 candidates : **scaling** -- same neighbour but different ref picture, scaled MV
4. If < 2 candidates : **Temporal** -- collocated MV (same process as TMVP)
5. If < 2 candidates : **Zero MV** padding

## Known pitfalls

1. **"Same ref picture"** : the candidate must point to the SAME reference picture
   (same POC), not just the same index
2. **Scaling between ref pictures** : when the neighbour points to a different ref,
   the MV is scaled by the ratio of the POC distances
3. **2 candidates max** : stop as soon as there are 2
4. **Deduplication** : if candidate A == candidate B, keep only one
5. **Modular MV addition** : `mv = (mvp + mvd + 0x10000) % 0x10000` (spec eq 8-94..8-97)

## Audit to do

1. Read S8.5.3.2.6 of the PDF (pages 176-180)
2. Check the "same ref picture" condition (POC comparison, not index)
3. Check the MV scaling in the fallback
4. Check the modular MV + MVD addition
5. Compare the AMVP MVs against HM

## Validation test

```bash
# Log for each AMVP PU:
# "amvp PU(%d,%d): cand[0]=(%d,%d) cand[1]=(%d,%d) mvp_flag=%d mvd=(%d,%d) final=(%d,%d)"
# Compare with HM
```

## Exit criterion

- [ ] Final MV identical to HM for all AMVP PUs of the first P-frame
- [ ] Unit test : modular MV addition (16-bit wrap-around)
- [ ] AMVP scaling verified (case where the neighbour points to a different ref)
