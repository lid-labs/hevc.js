# Phase 4B — Coding Tree Structure

## Status: TO VALIDATE

## Goal

Validate that the syntax element tree (split/cbf/residual) is IDENTICAL to HM.
No need to validate the decoded values — just the SEQUENCE and the TYPE of each bin.

## Why it is critical

A missing or extra bin in the tree shifts the WHOLE rest of the bitstream.
This is the **current bug**: 3 missing bins for CU (16,0) 8x8 between our decoder and HM.
The problem is probably in `decode_transform_tree()`: split_transform_flag
or cbf at the wrong depth.

## Spec refs

- §7.3.8.1: slice_segment_data (CTU loop + end_of_slice_segment_flag)
- §7.3.8.2: coding_tree_unit
- §7.3.8.3-5: coding_quadtree, coding_unit, prediction_unit
- §7.3.8.6: transform_tree (recursive split, chroma cbf, luma cbf)
- §7.3.8.7: transform_unit

## Cases to test

### Case 1: CU 16x16, PART_2Nx2N, no TU split
- log2CbSize=4, log2TrafoSize=4
- Chroma TU = 8x8 (log2TrafoSizeC=3)
- Sequence: cbf_cb, cbf_cr, [split_transform_flag?], cbf_luma, residual_coding

### Case 2: CU 8x8, PART_2Nx2N, no TU split
- log2CbSize=3, log2TrafoSize=3
- Chroma TU = 4x4 (log2TrafoSizeC=2, deferred if blkIdx!=3)
- **This is the case that currently causes problems**
- Check: is a split_transform_flag decoded? At what depth?

### Case 3: CU 8x8, PART_NxN (IntraSplitFlag=1)
- 4 PUs of 4x4, TU split forced at trafoDepth=0
- 4 sub-TUs of 4x4 (log2TrafoSize=2)
- Chroma deferred: processChroma only at blkIdx=3
- Sequence: cbf_cb(depth0), cbf_cr(depth0), then 4x [cbf_luma(depth1), residual]

### Case 4: CU 32x32 with TU split
- log2CbSize=5, split_transform_flag=1
- 4 sub-TUs of 16x16, each with its own cbf

## Validation method

### Approach 1: Unit test with syntax element sequence

Create a test that:
1. Decodes a bitstream with our decoder
2. Logs each decoded syntax element: type, position, depth
3. Compares with the same list extracted from HM

Log format:
```
[SYN] split_cu_flag (0,0) depth=0 val=1 bin=0
[SYN] split_cu_flag (0,0) depth=1 val=1 bin=1
[SYN] split_cu_flag (0,0) depth=2 val=0 bin=2
[SYN] part_mode (0,0) 16x16 val=0 bin=3
...
```

### Approach 2: Comparative trace (faster to implement)

1. Add an fprintf in each `decode_*` of `syntax_elements.cpp` with the SE name
2. Add the same in HM (`TDecSbac.cpp`)
3. Compare the two traces with diff
4. The first differing SE points exactly at the bug

### Critical SPS variables to check

```
max_transform_hierarchy_depth_intra  → maxTrafoDepth for intra
max_transform_hierarchy_depth_inter  → maxTrafoDepth for inter
MinTbLog2SizeY                       → split_transform_flag condition
MaxTbLog2SizeY                       → split_transform_flag condition
MinCbLog2SizeY                       → split_cu_flag / part_mode condition
```

## Tasks

- [ ] Add an fprintf trace in each `decode_*` of `syntax_elements.cpp`
- [ ] Add the same trace in HM
- [ ] Compare the traces for i_64x64_qp22 over the first 400 bins
- [ ] Identify the missing or extra SEs
- [ ] Fix the bug(s) in `decode_transform_tree()`
- [ ] Create a unit test that validates the SE sequence for at least 2 CUs

## Exit criterion

- [ ] The syntax element trace (type + bin_number) is IDENTICAL between HM and our decoder for the first 500 bins of i_64x64_qp22
- [ ] Cases 1-4 above are covered by the test bitstream
