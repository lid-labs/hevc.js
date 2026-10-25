# Phase 3 — Parameter Sets & Slice Header Parsing

## Goal
Parse the complete VPS, SPS, PPS and slice headers, with all derived values.

## Prerequisites
Phase 2 completed (NAL parsing, BitstreamReader with ue/se).

## Spec refs
- §7.3.2: VPS syntax
- §7.3.3: SPS syntax (+ profile_tier_level, scaling_list, short_term_ref_pic_set)
- §7.3.4: PPS syntax
- §7.3.6: Slice segment header
- §7.4.2-7: Corresponding semantics
- Annex A: Profiles, tiers, levels

## Tasks

### 3.1 — Profile/Tier/Level
- [ ] Parsing of `profile_tier_level()`
- [ ] Extraction of the profile, tier, level
- [ ] Validation of the profile constraints

### 3.2 — VPS
- [ ] Complete parsing of `video_parameter_set_rbsp()`
- [ ] Storage by `vps_video_parameter_set_id`
- [ ] Sub-layer ordering info
- [ ] Timing info (optional)

### 3.3 — SPS
- [ ] Complete parsing of `seq_parameter_set_rbsp()`
- [ ] Chroma format + separate_colour_plane_flag
- [ ] Dimensions + conformance window
- [ ] Luma/chroma bit depth
- [ ] Quad-tree config (MinCb, Ctb, MinTb, MaxTb sizes)
- [ ] All derived values (§7.4.3.2.1)
- [ ] Scaling list data with the complete fallback mechanism (§7.4.5):
  - If `scaling_list_enabled_flag == 0`: flat factors = 16 for all sizes
  - If `scaling_list_enabled_flag == 1` and `sps_scaling_list_data_present_flag == 0`: use the default matrices (Tables 7-3, 7-4, 7-5 — **non-flat** for 8x8, 16x16, 32x32)
  - If `scaling_list_pred_mode_flag == 0`: copy from another matrix via `scaling_list_pred_matrix_id_delta`
  - The default matrices are different for intra and inter
- [ ] Short-term reference picture sets (§7.3.7)
- [ ] Long-term reference pics config:
  - `num_long_term_ref_pics_sps` and `lt_ref_pic_poc_lsb_sps[i]`
  - `used_by_curr_pic_lt_sps_flag[i]`
  - These values are referenced in the slice header by index
- [ ] VUI parameters (§E.2, can be stubbed)
- [ ] Tests: each derived value checked

### 3.4 — PPS
- [ ] Complete parsing of `pic_parameter_set_rbsp()`
- [ ] Tiles layout (column widths, row heights)
- [ ] CtbAddr conversion tables (raster<->tile scan)
- [ ] Deblocking filter control
- [ ] Weighted prediction flags
- [ ] QP init + offsets
- [ ] Tests: correct tiles layout

### 3.5 — Slice Header
- [ ] Complete parsing of `slice_segment_header()`
- [ ] Handling of all conditional fields (depends on the active SPS/PPS)
- [ ] Slice type (I/P/B)
- [ ] POC (slice_pic_order_cnt_lsb)
- [ ] Short-term RPS selection/parsing
- [ ] Long-term ref pics (complete parsing):
  - `num_long_term_sps`: number of LT refs coming from the SPS
  - `num_long_term_pics`: number of directly specified LT refs
  - `lt_idx_sps[i]`: index into the SPS table
  - `poc_lsb_lt[i]`: POC LSB for the LTs specified in the slice
  - `used_by_curr_pic_lt_flag[i]`
  - `delta_poc_msb_present_flag[i]` and `delta_poc_msb_cycle_lt[i]`: to disambiguate LTs whose POC LSB wraps
- [ ] Reference picture list modification
- [ ] Pred weight table (`pred_weight_table()`):
  - `luma_log2_weight_denom` (ue)
  - `delta_chroma_log2_weight_denom` (se)
  - For each ref in L0/L1: `luma_weight_l0_flag[i]`, `chroma_weight_l0_flag[i]`
  - If flag=1: `delta_luma_weight_l0[i]` (se), `luma_offset_l0[i]` (se)
  - If flag=0: weight = `1 << luma_log2_weight_denom`, offset = 0 (default values)
  - Chroma: `delta_chroma_weight_l0[i][j]`, `delta_chroma_offset_l0[i][j]`
- [ ] SAO flags
- [ ] Deblocking overrides:
  - `slice_deblocking_filter_disabled_flag`
  - `slice_beta_offset_div2`, `slice_tc_offset_div2`
- [ ] QP delta
- [ ] Entry point offsets (required even in Phase 3 to parse the complete slice header):
  - `num_entry_point_offsets` (ue) — is 0 if no tiles or WPP
  - If > 0: `offset_len_minus1` (ue) and `entry_point_offset_minus1[i]` (u(v))
  - Parsing is necessary to reach the byte alignment correctly
- [ ] Byte alignment
- [ ] Dependent slice segments

### 3.6 — Parameter Set Management
- [ ] Storage of the VPS/SPS/PPS by ID
- [ ] Activation of the current SPS/PPS via the slice header
- [ ] Handling of updates (a new SPS/PPS replaces the old one)

### 3.7 — Improved test CLI
- [ ] `hevc-decode --dump-headers input.265`
- [ ] Complete dump of all parsed fields
- [ ] Tabular format: one field per line, name = value

## Exit criterion

- All fields of the VPS, SPS, PPS, slice headers parsed correctly
- Comparison with ffmpeg: decode a test bitstream and check that the dimensions, chroma format, bit depth, POC, slice type match
- All derived values computed correctly

## Oracle validation
```bash
# Check the parsed dimensions/format against ffprobe
ffprobe -v quiet -show_streams tests/conformance/fixtures/i_64x64_qp22.265
./hevc-decode --dump-headers tests/conformance/fixtures/i_64x64_qp22.265
# Compare width, height, chroma, bit_depth, num_frames
```

## Complexity estimate
High. The SPS and the slice header are very dense. The short-term RPS is the most complex part.
