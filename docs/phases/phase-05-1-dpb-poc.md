# 5.1 -- DPB + POC Derivation

## Goal

Check that the DPB (Decoded Picture Buffer) correctly manages the decoded pictures
and that the POC (Picture Order Count) is derived correctly for each frame.

## Spec refs

- S8.3.1: POC derivation (MSB/LSB wrap-around)
- S8.1: General decoding process (NoRaslOutputFlag, HandleCraAsBlaFlag)
- C.5: DPB management (output, bumping, removal)
- Annex A: MaxDpbSize per level

## Existing code

`src/decoding/dpb.cpp` (437 lines) -- already implemented, to be audited.

## Critical points to check

### POC derivation (S8.3.1)
- MSB wrap-around when the LSB wraps (eq 8-1, 8-2)
- `prevTid0Pic`: only the last slice with `TemporalId == 0` and not RASL/RADL serves
  as the reference for the previous MSB/LSB
- IDR: reset `prevPicOrderCntLsb = 0, prevPicOrderCntMsb = 0`

### DPB sizing
- `MaxDpbSize` = min(MaxDecPicBuffering, 16) per level
- Bumping process when the DPB is full

### NoRaslOutputFlag (S8.1)
- First IRAP: `NoRaslOutputFlag = 1`
- IDR: always `NoRaslOutputFlag = 1`
- CRA after IDR: `NoRaslOutputFlag = 1` too (HandleCraAsBlaFlag)

## Audit to perform

1. Read S8.3.1 of the PDF (pages 139-141) and compare with `dpb.cpp`
2. Check the `prevTid0Pic` condition (often buggy)
3. Check the MSB wrap-around with sequences > 256 frames
4. Compare POC vs HM on 10 frames of `p_qcif_10f.265`

## Validation test

```bash
# Add a POC log for each frame in the decoder
# Compare with ffmpeg:
ffprobe -show_frames -select_streams v tests/conformance/fixtures/p_qcif_10f.265 2>/dev/null | grep coded_picture_number
```

Unit test:
- POC for sequence [IDR, P, P, P, P, P, P, P, P, P] with incremental poc_lsb
- POC for sequence with wrap-around (poc_lsb_bits = 4, 16 frames)

## Exit criterion

- [ ] Correct POC for the 10 frames of `p_qcif_10f.265` (compared vs ffprobe)
- [ ] Correct POC for the 10 frames of `b_qcif_10f.265`
- [ ] Wrap-around POC unit test
