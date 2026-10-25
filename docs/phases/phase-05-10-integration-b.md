# 5.10 -- B-frames Integration

## Goal

Pixel-perfect on `oracle_b_qcif_10f` (B-frames, 176x144, 10 frames).

## Prerequisites

5.9 validated (P-frames pixel-perfect).

## What changes compared to P-frames

### Bi-prediction
- `inter_pred_idc`: PRED_L0 (0), PRED_L1 (1), PRED_BI (2)
- Bi-pred: MC from both lists, averaging (5.8)

### RefPicList1
- Built separately from RefPicList0 (S8.3.3)
- Reverse order of StCurrBefore/StCurrAfter

### Combined bi-pred merge candidates
- Table 8-8 (5.5): only for B-slices
- Takes pairs of L0/L1 candidates from the existing candidates

### Decoding reordering
- B-frames are not decoded in display order
- The DPB must handle output reordering (bumping process)
- Check that the ref pictures are correctly identified by POC

### Hierarchical GOP
- B-frames can reference other B-frames
- The TemporalId determines the hierarchy
- Check the POC distances for MV scaling

## Additional conformance tests

```bash
# Hierarchical B-frame
ctest -R conf_b_hier_qcif --output-on-failure

# B-frame with TMVP
ctest -R conf_b_tmvp_qcif --output-on-failure

# CRA (Clean Random Access)
ctest -R conf_b_cra_qcif --output-on-failure

# Open GOP
ctest -R conf_b_opengop_qcif --output-on-failure

# CABAC init flag (cabac_init_present_flag + cabac_init_flag)
ctest -R conf_b_cabacinit_qcif --output-on-failure
```

## Debugging B-frames

```bash
# Frame order vs decode order:
# If the bitstream has the structure IDR B B P B B P...
# The decode order is: IDR P B B P B B...
# Check that the DPB outputs the right frames at the right time

# Compare the output frame by frame
python3 tools/oracle_compare.py /tmp/ref.yuv /tmp/test.yuv 176 144
```

## Exit criterion

- [ ] `oracle_b_qcif_10f` pixel-perfect (MD5 match)
- [ ] `conf_b_hier_qcif` pixel-perfect
- [ ] `conf_b_tmvp_qcif` pixel-perfect
- [ ] `conf_b_cra_qcif` pixel-perfect
- [ ] `conf_b_opengop_qcif` pixel-perfect
- [ ] `conf_b_cabacinit_qcif` pixel-perfect
