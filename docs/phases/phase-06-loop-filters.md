# Phase 6 — Loop Filters (Deblocking + SAO)

## Goal

Implement the in-loop filters to get a complete Main profile decoder.
This is the project's **major milestone**.

## Prerequisites

Phase 5 completed (working inter prediction, without filters).

## Spec refs

- §8.7.2 : Deblocking filter
- §8.7.3 : Sample Adaptive Offset

## Why this phase is simpler

Unlike phases 4/5, the loop filters are **pure image processing**:
- No CABAC (SAO parsing is already done in Phase 4)
- No cascading error propagation
- Bugs are local: an incorrect filter only corrupts the affected pixels
- Debugging is easy: compare pixel by pixel before/after the filter

## Breakdown into sub-phases

| Sub-phase | Validation |
|------------|------------|
| 6A — Deblocking Luma | Test: compare post-deblock pixels vs ffmpeg (deblock only) |
| 6B — Deblocking Chroma | Test: same for chroma |
| 6C — SAO | Test: compare post-SAO pixels vs ffmpeg (SAO only) |
| 6D — Integration | Pixel-perfect oracle, full Main profile |

## Execution order

```
6A (Deblock Luma) ──→ 6B (Deblock Chroma) ──→ 6C (SAO) ──→ 6D (Integration)
```

Sequential because SAO operates on the post-deblocking samples.

---

### 6A — Deblocking Luma

**Tasks** :
- [ ] Identify the edges to filter (CU/TU/PU boundaries, 8-pixel grid)
- [ ] Boundary Strength derivation (§8.7.2.4) :
  - Bs=2 : intra or PCM
  - Bs=1 : non-zero cbf OR different ref pics OR MV delta >= 4 (1/4-pel)
  - Bs=0 : detailed uni/bi-pred conditions
- [ ] beta and tC tables (Tables 8-16, 8-17)
- [ ] Average QP + offsets (slice_beta_offset_div2, slice_tc_offset_div2)
- [ ] Filtering decision (dp, dq, beta threshold)
- [ ] Strong filter (p0, p1, p2, q0, q1, q2)
- [ ] Weak filter (p0, q0 + optional p1, q1)
- [ ] Order : vertical edges first (whole picture), then horizontal
- [ ] Exclusion : picture/tile/slice edges, across_tiles/across_slices flags

**Known pitfalls:**
- Bi-pred Bs : test BOTH orders (direct and crossed) — see Table §8.7.2.4.5
- V then H order is mandatory (the H pass filters samples already deblocked in V)
- `cu_transquant_bypass_flag == 1` : no filtering for this CU
- `pcm_loop_filter_disabled_flag` : no filtering for PCM edges

**Validation** :
- Unit test : Bs derivation for the intra, inter uni, inter bi cases
- Test : decode a bitstream with `--no-sao` and compare vs ffmpeg

**Exit criterion** :
- [ ] `oracle_i_64x64_deblock` pixel-perfect (I-frame + deblocking)

---

### 6B — Deblocking Chroma

**Tasks** :
- [ ] Filter only if Bs == 2
- [ ] Simple filter (p0, q0 modified)
- [ ] Chroma QP (use the non-linear table)

**Validation** :
- Same bitstream as 6A, check the Cb/Cr planes

**Exit criterion** :
- [ ] Correct chroma pixels in oracle_i_64x64_deblock

---

### 6C — SAO (Sample Adaptive Offset)

**Tasks** :
- [ ] Edge Offset : 4 classes (H, V, diag135, diag45), categorisation, offsets
- [ ] Band Offset : 32 bands, 4 consecutive offsets, band_position
- [ ] SAO merge (left, up) — parameter propagation
- [ ] Picture edges : no EO comparison out of bounds
- [ ] CTU/slice/tile edges : across_slices/across_tiles flags

**Important** : SAO operates on the **post-deblocking** samples :
- Deblocking is applied to the whole picture first
- Then SAO is applied using the deblocked samples
- For EO comparisons at CTU edges, use the samples after deblocking (not after the neighbour's SAO)

**Validation** :
- Test : decode a bitstream with `--no-deblock` and compare vs ffmpeg (SAO only)

**Exit criterion** :
- [ ] `oracle_i_64x64_sao` pixel-perfect (I-frame + SAO)

---

### 6D — Full Main Profile Integration

**Prerequisites** : 6A, 6B, 6C validated.

**Tasks** :
- [ ] Complete pipeline : reconstruction → deblocking V → deblocking H → SAO
- [ ] Test on I-frames, P-frames, B-frames

**Oracle validation** :
```bash
ctest -R oracle_i_64x64_full --output-on-failure
ctest -R oracle_full_qcif_10f --output-on-failure  # Main profile milestone
ctest -R oracle_bbb1080 --output-on-failure         # real-world
```

**Exit criterion** :
- [ ] `oracle_i_64x64_full` pixel-perfect
- [ ] `oracle_full_qcif_10f` pixel-perfect — **complete Main profile**
- [ ] `oracle_bbb1080_50f` pixel-perfect — real-world Big Buck Bunny

## Complexity estimate

Moderate. Deblocking is the most delicate part (Bs combinatorics, edge-case boundaries).
SAO is algorithmically simple. No CABAC error propagation.
