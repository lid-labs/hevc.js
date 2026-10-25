# 5.2 -- RPS + Reference Picture Lists

## Goal

Verify that the Reference Picture Sets (RPS) are derived correctly and that
RefPicList0/RefPicList1 are built as expected for each slice.

## Spec refs

- S8.3.2 : RPS derivation (short-term, long-term, delta_rps, inter-prediction)
- S8.3.3 : Reference picture list construction
- S8.3.4 : Decoding process for reference picture marking
- S7.3.6.2 : ref_pic_lists_modification

## Existing code

`src/decoding/dpb.cpp` : `derive_rps()`, `construct_ref_pic_lists()`

## Critical points to verify

### RPS derivation (S8.3.2)
- st_ref_pic_set parsing with inter_ref_pic_set_prediction_flag
- Computation of DeltaPocS0/S1 and UsedByCurrPicS0/S1
- Long-term refs (poc_lsb_lt, delta_poc_msb_present)

### RefPicList construction (S8.3.3)
- P-slice : RefPicList0 = RefPicListTemp0 (unless modified)
- B-slice : RefPicList0 and RefPicList1 are built separately
- Order in RefPicListTemp : RefPicSetStCurrBefore, StCurrAfter, LtCurr
- `ref_pic_list_modification` overrides the positions

### Reference picture marking (S8.3.4)
- "no reference picture" for missing indices
- Handling of lost pictures

## Audit to do

1. Read S8.3.2-8.3.4 of the PDF (pages 141-145)
2. Add a RefPicList0/1 log per slice : `[ref_idx] POC=X`
3. Compare with HM, which also logs the ref lists

## Validation test

```cpp
// Unit test:
// - P-only sequence (10 frames) : RefPicList0 = [poc-1, poc-2, ...]
// - Hierarchical B sequence : check RefPicList0 and 1 for each frame type
// - ref_pic_list_modification active
```

Automated comparison:
```bash
# Our decoder logs the ref lists
HEVC_DEBUG=DPB ./build/hevc-decode tests/conformance/fixtures/p_qcif_10f.265 -o /dev/null 2>&1 | grep "RefPicList"

# HM also logs the ref lists (to be checked)
```

## Exit criterion

- [ ] RefPicList0 identical to HM for each P-slice of `p_qcif_10f.265`
- [ ] RefPicList0 and RefPicList1 identical to HM for each B-slice of `b_qcif_10f.265`
- [ ] Unit test with ref_pic_list_modification
