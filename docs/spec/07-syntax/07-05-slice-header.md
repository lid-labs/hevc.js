# §7.3.6 — Slice Segment Header

Spec ref: §7.3.6.1 (syntax), §7.4.7 (semantics)

## Complexity

The slice header is the most complex structure to parse because it depends heavily on the active SPS/PPS and contains many conditional fields.

## Spec pseudo-code (critical elements)

```
slice_segment_header() {
    first_slice_segment_in_pic_flag               u(1)
    if(nal_unit_type >= BLA_W_LP && nal_unit_type <= RSV_IRAP_VCL23)
        no_output_of_prior_pics_flag              u(1)
    slice_pic_parameter_set_id                    ue(v)
    if(!first_slice_segment_in_pic_flag) {
        if(dependent_slice_segments_enabled_flag)
            dependent_slice_segment_flag          u(1)
        slice_segment_address                     u(v)  // Ceil(Log2(PicSizeInCtbsY)) bits
    }
    if(!dependent_slice_segment_flag) {
        // slice_reserved_flag[i] for num_extra_slice_header_bits
        slice_type                                ue(v)
        // 0=B, 1=P, 2=I
        if(output_flag_present_flag)
            pic_output_flag                       u(1)
        if(separate_colour_plane_flag == 1)
            colour_plane_id                       u(2)
        if(!IdrPicFlag) {
            slice_pic_order_cnt_lsb               u(v)  // log2_max_pic_order_cnt_lsb_minus4+4 bits
            short_term_ref_pic_set_sps_flag       u(1)
            if(!short_term_ref_pic_set_sps_flag)
                st_ref_pic_set(num_short_term_ref_pic_sets)
            else if(num_short_term_ref_pic_sets > 1)
                short_term_ref_pic_set_idx        u(v)
            // Long-term ref pics
            if(long_term_ref_pics_present_flag) {
                // ... lt_ref_pic parsing
            }
            if(sps_temporal_mvp_enabled_flag)
                slice_temporal_mvp_enabled_flag    u(1)
        }
        // SAO
        if(sample_adaptive_offset_enabled_flag) {
            slice_sao_luma_flag                   u(1)
            if(ChromaArrayType != 0)
                slice_sao_chroma_flag             u(1)
        }
        // Reference picture list modification
        if(slice_type == P || slice_type == B) {
            num_ref_idx_active_override_flag       u(1)
            if(num_ref_idx_active_override_flag) {
                num_ref_idx_l0_active_minus1       ue(v)
                if(slice_type == B)
                    num_ref_idx_l1_active_minus1   ue(v)
            }
            // ref_pic_lists_modification()
            // mvd_l1_zero_flag (B slices)
            // cabac_init_flag
            // collocated_from_l0_flag, collocated_ref_idx
            // pred_weight_table() if weighted pred
        }
        five_minus_max_num_merge_cand              ue(v)
        // QP
        slice_qp_delta                             se(v)
        // ... cb/cr qp offset, deblocking params, etc.
    }
    // byte_alignment()
}
```

## Critical derived values (§7.4.7.1)

```cpp
// Slice type
enum SliceType { B = 0, P = 1, I = 2 };

// QP
SliceQpY = 26 + pps.init_qp_minus26 + slice_qp_delta

// Number of active ref idx
if (num_ref_idx_active_override_flag) {
    NumRefIdxL0Active = num_ref_idx_l0_active_minus1 + 1;
    NumRefIdxL1Active = (slice_type == B) ? num_ref_idx_l1_active_minus1 + 1 : 0;
} else {
    NumRefIdxL0Active = pps.num_ref_idx_l0_default_active_minus1 + 1;
    NumRefIdxL1Active = (slice_type == B) ? pps.num_ref_idx_l1_default_active_minus1 + 1 : 0;
}

// Merge candidates
MaxNumMergeCand = 5 - five_minus_max_num_merge_cand

// POC derivation (§8.3.1)
// Complex: depends on the NAL type, the previous POC, MSB wrapping
```

## Short-Term Reference Picture Set — §7.3.7

Complex, recursive structure (can reference a previous RPS).

```
st_ref_pic_set(stRpsIdx) {
    if(stRpsIdx != 0)
        inter_ref_pic_set_prediction_flag    u(1)
    if(inter_ref_pic_set_prediction_flag) {
        // Delta prediction from an existing RPS
        if(stRpsIdx == num_short_term_ref_pic_sets)
            delta_idx_minus1                 ue(v)
        delta_rps_sign                       u(1)
        abs_delta_rps_minus1                 ue(v)
        for(j = 0; j <= NumDeltaPocs[RefRpsIdx]; j++) {
            used_by_curr_pic_flag[j]         u(1)
            if(!used_by_curr_pic_flag[j])
                use_delta_flag[j]            u(1)
        }
    } else {
        // Explicit definition
        num_negative_pics                    ue(v)
        num_positive_pics                    ue(v)
        for(i = 0; i < num_negative_pics; i++) {
            delta_poc_s0_minus1[i]           ue(v)
            used_by_curr_pic_s0_flag[i]      u(1)
        }
        for(i = 0; i < num_positive_pics; i++) {
            delta_poc_s1_minus1[i]           ue(v)
            used_by_curr_pic_s1_flag[i]      u(1)
        }
    }
}
```

### List derivation (§7.4.8)

```cpp
struct ShortTermRPS {
    int NumNegativePics;
    int NumPositivePics;
    int NumDeltaPocs;  // = NumNeg + NumPos
    int DeltaPocS0[16];   // Negative POC deltas
    int DeltaPocS1[16];   // Positive POC deltas
    bool UsedByCurrPicS0[16];
    bool UsedByCurrPicS1[16];
};
```

## Checklist

- [ ] Complete slice header parsing (all conditional fields)
- [ ] SliceType enum and derivation
- [ ] POC derivation (§8.3.1)
- [ ] Short-term RPS parsing (including inter-prediction mode)
- [ ] Long-term ref pic parsing
- [ ] Reference picture list construction
- [ ] Pred weight table parsing
- [ ] Deblocking filter overrides
- [ ] Byte alignment
- [ ] Tests: compare slice header fields with libde265
