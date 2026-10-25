# 5.9 -- P-frame Integration

## Goal

Pixel-perfect on `oracle_p_qcif_10f` (P-frames only, 176x144, 10 frames).

## Prerequisites

All steps 5.0 to 5.8 validated independently.

## Complete pipeline

For each P-frame:
1. Parse slice header (type=P)
2. Construct RefPicList0 (5.2)
3. For each CU:
   a. Parse cu_skip_flag, pred_mode_flag
   b. If MODE_INTER : parse prediction_unit (merge or AMVP)
   c. Derive MV (merge list or AMVP + MVD) (5.3/5.5/5.6)
   d. Motion compensation : luma + chroma interpolation (5.7/5.8)
   e. If residual : parse transform tree + residual_coding
   f. Reconstruction : pred + residual, clip
4. Store picture in DPB (5.1)

## Integration points to verify

### Inter CU parsing (S7.3.8.5)
- `cu_skip_flag` : merge without residual
- `pred_mode_flag` : 0=INTER, 1=INTRA (careful : INTRA in a P-slice is possible !)
- `rqt_root_cbf` : parsed only if NOT (PART_2Nx2N && merge_flag)
- If `rqt_root_cbf == 0` : no transform tree

### Inter partition modes
- PART_2Nx2N : 1 PU = whole CU
- PART_2NxN, PART_Nx2N : 2 PUs
- PART_NxN : 4 PUs (only at min CU size)
- AMP (if amp_enabled) : PART_2NxnU/nD, PART_nLx2N/nRx2N

### Inter reconstruction
```cpp
// Inter : the prediction is already written to the picture buffer by MC
// If residual (rqt_root_cbf=1) :
//   1. Parse transform tree
//   2. For each TU : parse coefficients, dequant, IDCT
//   3. Add residual to the prediction : sample = pred + residual
//   4. Clip to [0, maxVal]
// If no residual : the MC prediction is the final result
```

### Intra CU in a P-slice
- Possible ! `pred_mode_flag=1` in a P-slice means INTRA
- Use the same intra pipeline as Phase 4

## Debugging

If the MD5 does not match:
```bash
# Compare frame by frame
python3 tools/oracle_compare.py /tmp/ref.yuv /tmp/test.yuv 176 144

# If frame 0 (I-frame) fails : it is a 5.0 bug
# If frame 1+ fails : it is an inter bug
# Identify the first wrong pixel → locate the CU
# Check whether it is the MV, the interpolation, or the residual
```

## Exit criterion

- [ ] `oracle_p_qcif_10f` pixel-perfect (MD5 match)
- [ ] Frame 0 (I-frame) pixel-perfect (Phase 4 regression)
- [ ] Frame 1 pixel-perfect (first P-frame)
- [ ] 10/10 frames pixel-perfect
