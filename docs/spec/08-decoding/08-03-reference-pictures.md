# 8.3 — Reference Picture Management

Spec ref: 8.3.1 (POC derivation), 8.3.2 (RPS derivation), 8.3.3 (ref pic list construction), 8.3.4 (DPB marking)

## 8.3.1 — Picture Order Count derivation

The POC is the display order identifier of each frame.

### Spec pseudo-code

```
// For each picture with a slice header:
if (IRAP picture && NoRaslOutputFlag)
    prevPicOrderCntLsb = 0
    prevPicOrderCntMsb = 0
else
    // Use the values of the previous slice that is not RASL/RADL/sub-layer-non-ref

// MSB derivation (wrap-around detection)
if (slice_pic_order_cnt_lsb < prevPicOrderCntLsb &&
    prevPicOrderCntLsb - slice_pic_order_cnt_lsb >= MaxPicOrderCntLsb / 2)
    PicOrderCntMsb = prevPicOrderCntMsb + MaxPicOrderCntLsb
else if (slice_pic_order_cnt_lsb > prevPicOrderCntLsb &&
         slice_pic_order_cnt_lsb - prevPicOrderCntLsb > MaxPicOrderCntLsb / 2)
    PicOrderCntMsb = prevPicOrderCntMsb - MaxPicOrderCntLsb
else
    PicOrderCntMsb = prevPicOrderCntMsb

PicOrderCntVal = PicOrderCntMsb + slice_pic_order_cnt_lsb
```

### C++ translation

```cpp
int32_t derive_poc(const SliceHeader& sh, const SPS& sps, DecoderState& state) {
    int32_t max_poc_lsb = 1 << (sps.log2_max_pic_order_cnt_lsb_minus4 + 4);
    int32_t poc_msb;

    if (is_irap_nal(sh.nal_unit_type) && state.no_rasl_output_flag) {
        poc_msb = 0;
        state.prev_poc_lsb = 0;
        state.prev_poc_msb = 0;
    } else {
        int32_t prev_lsb = state.prev_poc_lsb;
        int32_t prev_msb = state.prev_poc_msb;
        int32_t cur_lsb = sh.slice_pic_order_cnt_lsb;

        if (cur_lsb < prev_lsb && (prev_lsb - cur_lsb) >= max_poc_lsb / 2)
            poc_msb = prev_msb + max_poc_lsb;
        else if (cur_lsb > prev_lsb && (cur_lsb - prev_lsb) > max_poc_lsb / 2)
            poc_msb = prev_msb - max_poc_lsb;
        else
            poc_msb = prev_msb;
    }

    return poc_msb + sh.slice_pic_order_cnt_lsb;
}
```

## NoRaslOutputFlag derivation (§8.1)

`NoRaslOutputFlag` controls the behavior at random access points. Its derivation is critical for the POC and the DPB.

```cpp
bool derive_no_rasl_output_flag(uint8_t nal_unit_type, bool first_picture_in_bitstream,
                                 bool HandleCraAsBlaFlag) {
    if (is_idr_nal(nal_unit_type) || is_bla_nal(nal_unit_type))
        return true;   // Always true for IDR and BLA

    if (is_cra_nal(nal_unit_type)) {
        if (first_picture_in_bitstream)
            return true;   // First picture of the bitstream
        if (HandleCraAsBlaFlag)
            return true;   // Random access point: CRA handled as BLA
        return false;      // Normal CRA in sequential playback
    }

    return false;  // Non-IRAP: not applicable
}
```

### HandleCraAsBlaFlag

This flag is signalled by the application (not in the bitstream). It is set to `true` when the decoder starts decoding at a CRA point (random access). In that case:
- The associated RASL pics are skipped (not decoded, not displayed)
- The POC is reset
- The DPB is emptied

**Pitfall**: Forgetting to set `HandleCraAsBlaFlag` on a seek causes visual artifacts (the RASL pics reference pictures that do not exist).

## 8.3.2 — Reference Picture Set derivation

The RPS determines which frames are references (short-term/long-term) and which frames must be removed from the DPB.

### Derived lists

```
After deriving the RPS for the current picture:

RefPicSetStCurrBefore[] — ST ref pics before the current picture (POC < current)
RefPicSetStCurrAfter[]  — ST ref pics after the current picture (POC > current)
RefPicSetStFoll[]       — ST ref pics not used by the current picture
RefPicSetLtCurr[]       — LT ref pics in use
RefPicSetLtFoll[]       — LT ref pics not in use

NumPocStCurrBefore, NumPocStCurrAfter, NumPocStFoll
NumPocLtCurr, NumPocLtFoll
```

### Process

```cpp
void derive_reference_picture_set(const SliceHeader& sh, const SPS& sps, DPB& dpb) {
    // 1. Build the POC lists from the active Short-Term RPS
    auto& rps = sh.short_term_ref_pic_set_sps_flag
                ? sps.st_rps[sh.short_term_ref_pic_set_idx]
                : sh.st_rps;

    // 2. For each entry in DeltaPocS0 (negative):
    //    POC = PicOrderCntVal + DeltaPocS0[i]
    //    If UsedByCurrPicS0[i] -> StCurrBefore, otherwise -> StFoll

    // 3. For each entry in DeltaPocS1 (positive):
    //    POC = PicOrderCntVal + DeltaPocS1[i]
    //    If UsedByCurrPicS1[i] -> StCurrAfter, otherwise -> StFoll

    // 4. Long-term ref pics (if present in the slice header)

    // 5. Mark the pictures in the DPB as "used for reference" or "unused"
    //    Pictures that are in no list -> mark "unused for reference"
}
```

## 8.3.3 — Reference picture list construction

```
// List L0 (always built for P and B slices)
RefPicList0 = RefPicSetStCurrBefore ++ RefPicSetStCurrAfter ++ RefPicSetLtCurr
// Repeat cyclically up to NumRefIdxL0Active entries

// List L1 (B slices only)
RefPicList1 = RefPicSetStCurrAfter ++ RefPicSetStCurrBefore ++ RefPicSetLtCurr
// Repeat cyclically up to NumRefIdxL1Active entries

// Then apply ref_pic_list_modification if present
```

## 8.3.6 — MV Scaling (§8.5.3.2.12)

When a reference's motion vector is used to predict a block whose reference is at a different POC distance, the MV must be scaled.

```cpp
// §8.5.3.2.12 — Temporal MV scaling
int32_t scale_mv(int32_t mv, int32_t td, int32_t tb) {
    // td = POC distance between the source (co-located) and its reference
    // tb = POC distance between the current picture and its reference

    td = Clip3(-128, 127, td);
    tb = Clip3(-128, 127, tb);

    int tx = (16384 + (abs(td) >> 1)) / td;  // division with rounding
    int distScaleFactor = Clip3(-4096, 4095, (tb * tx + 32) >> 6);

    return Clip3(-32768, 32767,
        Sign(distScaleFactor * mv) *
        ((Abs(distScaleFactor * mv) + 127) >> 8));
}
```

MV scaling is used in:
1. **Temporal merge candidate** (§8.5.3.2.3): the co-located block's MV scaled to the current ref
2. **Temporal AMVP candidate** (§8.5.3.2.7): same
3. **Implicit bi-prediction**: when the L0/L1 distances are asymmetric

### Pitfall

The division `16384 / td` is an **integer division with rounding**. Use the exact formula above. A rounding error here propagates to all temporal MVs.

## TMVP — Temporal Motion Vector Prediction (§8.5.3.2.9)

The temporal candidate (used in merge and AMVP) requires:

### 1. Co-located picture selection

```cpp
// The co-located picture is determined by the slice header:
Picture* colPic;
if (slice_type == B && !collocated_from_l0_flag)
    colPic = RefPicList1[collocated_ref_idx];
else
    colPic = RefPicList0[collocated_ref_idx];
```

### 2. Co-located block selection

```cpp
// Two candidate positions in the co-located picture:
// Position 1: bottom-right of the current PU + (1,1)
int xColBr = xPb + nPbW;  // bottom-right x
int yColBr = yPb + nPbH;  // bottom-right y

// Position 2: center of the current PU
int xColCtr = xPb + (nPbW >> 1);
int yColCtr = yPb + (nPbH >> 1);

// Try bottom-right first, then center if not available
// "Not available" if: outside the picture, outside the slice/tile, or in an intra CU
bool brAvail = is_available(colPic, xColBr, yColBr);
MV colMv;
if (brAvail) {
    colMv = get_mv(colPic, xColBr, yColBr, refIdxCol);
} else {
    colMv = get_mv(colPic, xColCtr, yColCtr, refIdxCol);
}
```

### 3. Co-located MV scaling

```cpp
// Scale the co-located picture's MV to the current picture's reference
int td = DiffPicOrderCnt(colPic, colRefPic);   // distance in the co-located picture
int tb = DiffPicOrderCnt(currentPic, targetRefPic);  // current distance
MV scaledMv = scale_mv(colMv, td, tb);
```

### 4. Enabling conditions

- `slice_temporal_mvp_enabled_flag` must be set
- The co-located picture must be available in the DPB
- The co-located block must not be intra

## 8.3.4 — DPB (Decoded Picture Buffer)

```cpp
struct DecodedPictureBuffer {
    struct Entry {
        int32_t poc;
        bool used_for_reference;
        bool needed_for_output;
        std::shared_ptr<Picture> picture;
    };

    std::vector<Entry> entries;
    size_t max_size;  // derived from the level (Annex A)

    // C.5.2.2 — Picture output process
    void bump(int32_t current_poc);

    // C.5.2.3 — Removal process
    void remove_unused();

    // Add a decoded picture
    void add(int32_t poc, std::shared_ptr<Picture> pic, bool output_flag);
};
```

## Known pitfalls

1. **POC wrap-around**: The MSB wrap is the source of many bugs. Test with long sequences.
2. **IRAP handling**: IDR resets the POC to 0. CRA does not always do so (depends on NoRaslOutputFlag).
3. **DPB bumping**: The output order is not the decode order. Bumping must follow POC order.
4. **Temporal sub-layers**: Pictures of higher sub-layers are not references for lower sub-layers.

## Checklist

- [ ] POC derivation with correct wrap-around
- [ ] Short-term RPS derivation (from SPS and from slice header)
- [ ] Long-term ref pic derivation
- [ ] RefPicList0/List1 construction with modification
- [ ] DPB management (add, bump, remove)
- [ ] DPB sizing according to the level
- [ ] NoRaslOutputFlag derivation
- [ ] HandleCraAsBlaFlag handling for random access/seek
- [ ] MV scaling (temporal distance compensation)
- [ ] TMVP: co-located picture selection
- [ ] TMVP: co-located block selection (bottom-right then center)
- [ ] TMVP: co-located MV scaling
- [ ] Tests: sequence with B-frame reordering, check the POC order
