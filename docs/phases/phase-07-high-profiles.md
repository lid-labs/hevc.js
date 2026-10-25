# Phase 7 — Higher Profiles (Main 10, 4:2:2, 4:4:4)

## Goal
Extend the decoder beyond the Main profile to support 4K@60fps.

## Prerequisites
Phase 6 completed (Main profile pixel-perfect).

## Spec refs
- Annex A : Profiles, tiers, levels (Tables A.1-A.8)
- §7.3.3.1 : SPS range extension flags
- Bit depth changes in §8.5, §8.6, §8.7

## Tasks

### 7.1 — Main 10 (10-bit 4:2:0)
- [ ] Extend all buffers from 8-bit to 16-bit (template or runtime)
- [ ] Adapt `BitDepthY`, `BitDepthC` = 10
- [ ] Adapt `QpBdOffsetY`, `QpBdOffsetC` = 12
- [ ] Check all shifts/rounding in:
  - Intra prediction
  - Inter prediction (interpolation filters)
  - Inverse transform
  - Dequantization
  - Deblocking (beta, tC tables with offset)
  - SAO
- [ ] 10-bit YUV output (2 bytes per sample, little-endian)
- [ ] Pixel-perfect tests on Main 10 bitstreams

### 7.2 — Main 4:2:2 10
- [ ] Support `chroma_format_idc == 2`
- [ ] `SubWidthC = 2`, `SubHeightC = 1`
- [ ] Adapt chroma interpolation (MV derivation changes)
- [ ] Adapt chroma deblocking (horizontal edges change)
- [ ] Adapt chroma SAO (chroma CTU size changes)
- [ ] Adapt the chroma buffer dimensions
- [ ] Pixel-perfect tests on 4:2:2 bitstreams

### 7.3 — Main 4:4:4
- [ ] Support `chroma_format_idc == 3`
- [ ] `SubWidthC = 1`, `SubHeightC = 1`
- [ ] Chroma treated as luma (same 8-tap interpolation filters)
- [ ] Chroma intra prediction identical to luma (35 modes)
- [ ] separate_colour_plane_flag (if supported)
- [ ] Pixel-perfect tests

### 7.4 — High levels
- [ ] Level 5.0 : MaxLumaPs = 8,912,896 (4K@30)
- [ ] Level 5.1 : MaxLumaPs = 8,912,896 (4K@60)
- [ ] Correct DPB sizing for these levels
- [ ] Max bitrate : 25-40 Mbps Main tier
- [ ] Check that the buffers do not exceed reasonable memory limits

### 7.5 — Tiles
- [ ] Multi-tile support (already parsed in Phase 3)
- [ ] Correct CtbAddrRs -> CtbAddrTs scan order
- [ ] CABAC independence between tiles
- [ ] Entry point offsets
- [ ] loop_filter_across_tiles_enabled_flag

### 7.6 — WPP (Wavefront Parallel Processing)
- [ ] entropy_coding_sync_enabled_flag
- [ ] Save/restore of the CABAC contexts at the start of a CTU row
- [ ] Entry point offsets
- [ ] Preparation for WASM parallelism (Phase 9)

### 7.7 — Scaling Lists (if not done in Phase 4)
- [ ] Complete parsing of the scaling lists (§7.3.4)
- [ ] Application in the scaling process (§8.6.2)
- [ ] Default matrices for each size

## Exit criterion

- Pixel-perfect on Main 10 conformance bitstreams
- Pixel-perfect on 4:2:2 bitstreams (if bitstreams are available)
- Pixel-perfect on 4:4:4 bitstreams (if bitstreams are available)
- Working decoding of 4K content (Level 5.0/5.1)

## Complexity estimate
Moderate. Most of the code already exists (Main profile). The changes are mainly bit depth and chroma format adaptations.
