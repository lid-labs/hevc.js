# Phase 10 -- Multi-Slice Support

## Goal

Correctly decode pictures containing several slice segments (independent and dependent).
The 4 failing tests (`conf_i_multislice_256`, `conf_b_xslice_256`, `oracle_bbb1080_50f`, `oracle_bbb4k_25f`) must pass.

## Prerequisites

Phase 6 completed (working loop filters, single-slice pixel-perfect).
Phase 7.5 completed (working tiles — the boundary exclusion logic is shared).

## Spec refs

- S7.3.6.1 : Slice segment header — `first_slice_segment_in_pic_flag`, `dependent_slice_segment_flag`, `slice_segment_address`
- S7.4.7.1 : Slice segment header semantics — derivation of `SliceAddrRs`, field inheritance for dependent slices
- S7.3.8.1 : Slice segment data — CTU loop `do { coding_tree_unit(); end_of_slice_segment_flag; ... } while(!end_of_slice_segment_flag)`
- S7.3.8.3 : SAO syntax — `leftCtbInSliceSeg = CtbAddrInRs > SliceAddrRs`, `upCtbInSliceSeg = (CtbAddrInRs - PicWidthInCtbsY) >= SliceAddrRs`
- S8.7.2.1 : Deblocking filter — `filterLeftCbEdgeFlag` / `filterTopCbEdgeFlag` set to 0 when the edge is a slice boundary and `slice_loop_filter_across_slices_enabled_flag == 0`
- S8.7.3 : SAO — `slice_sao_luma_flag` / `slice_sao_chroma_flag` per slice
- S9.3.2.1 : CABAC init — reinitialisation per independent slice, context synchronisation for dependent slices (`TableStateIdxDs`, `TableMpsValDs`)

## Why this phase is separate

Multi-slice support touches **4 layers of the decoder**:

1. **Decoding loop** (`decoder.cpp`) : iterate over all the VCL NALs of a picture
2. **Parsing** (`slice_header.cpp`) : field inheritance for dependent slices
3. **Deblocking** (`deblocking.cpp`) : exclusion of edges at inter-slice boundaries
4. **SAO** (`coding_tree.cpp`, `sao.cpp`) : merge and application respecting inter-slice boundaries

The per-slice CTU structure is already correct (`decode_slice_segment_data` respects `slice_segment_address` and `end_of_slice_segment_flag`). The problem is that this function is called only once per picture (first slice only), and that the filters only know the last slice boundary.

## Breakdown into sub-steps (5 steps)

| Step | Topic | Validation | Dependencies |
|-------|-------|------------|-------------|
| **10.1** | Slice index map (per-CTU) | Existing tests do not regress (all CTUs have `slice_idx = 0`) | -- |
| **10.2** | Multi-slice loop in `decode_picture()` | `conf_i_multislice_256` pixel-perfect | 10.1 |
| **10.3** | Dependent slice inheritance | Spec conformance (dependent slices inherit QP, type, ref lists, SAO flags, etc.) | 10.2 |
| **10.4** | Cross-slice deblocking | `conf_b_xslice_256` pixel-perfect | 10.1, 10.2 |
| **10.5** | Cross-slice SAO | `oracle_bbb1080_50f` + `oracle_bbb4k_25f` pixel-perfect | 10.1, 10.2, 10.4 |

## Dependency graph

```
10.1 (Slice index map) ──> 10.2 (Multi-slice loop) ──> 10.3 (Dependent slices)
         │                          │
         │                          v
         └──────────────> 10.4 (Cross-slice deblocking)
                                    │
                                    v
                           10.5 (Cross-slice SAO)
```

10.3 is independent of 10.4/10.5 (can be parallelised after 10.2).

---

### 10.1 -- Slice Index Map

**Spec ref** : S7.4.7.1 — `SliceAddrRs` derivation, S7.3.8.3 — `leftCtbInSliceSeg`, `upCtbInSliceSeg`.

**Context** : The filters (deblocking, SAO) need to know whether two adjacent CTUs belong to different slices. Currently, only the `slice_segment_address` of the last parsed slice is compared — insufficient for 3+ slices. The spec uses `SliceAddrRs`, which is derived per slice, but the filters operate after ALL the slices are decoded. The slice membership of each CTU must therefore be stored.

**Tasks** :
- [ ] Add `std::vector<uint8_t> slice_idx_buf_` in `Decoder` (size = `PicSizeInCtbsY`)
- [ ] Add `uint8_t* slice_idx` + `int slice_idx_stride` in `DecodingContext`
- [ ] Initialise to 0 at the start of a picture (in `decode_picture()`)
- [ ] In `decode_slice_segment_data()`, write the current slice index for each decoded CTU : `ctx.slice_idx[CtbAddrInRs] = current_slice_idx`

**Known pitfalls:**
- The stride is `PicWidthInCtbsY`, not `PicWidthInMinCbsY` — the granularity is CTB, not min-CB
- The index must be passed to `decode_slice_segment_data()` as a parameter (or via `DecodingContext`)
- Single-slice pictures will have all CTUs at 0 — no regression possible

**Exit criterion** :
- [ ] Build OK, all existing tests pass (0 regression)

---

### 10.2 -- Multi-Slice Loop in `decode_picture()`

**Spec ref** : S7.3.8.1 — slice_segment_data (CTU loop), S8.1.3 — decoding process per coded picture.

**Context** : `decode_picture()` currently only processes `nals[first_vcl_idx]`. The following VCL NALs (slices 2, 3, ...) are ignored in the `decode()` loop (lines 34-43 of `decoder.cpp`). We need to:
1. Collect all the VCL NALs of the same picture
2. Loop over each NAL : parse the slice header, advance the bitstream, call `decode_slice_segment_data()`
3. Apply the filters once at the end

**Tasks** :
- [ ] Modify `decode()` to collect the range `[first_vcl_idx, last_vcl_idx)` of the VCL NALs of a same picture (checking `first_slice_segment_in_pic_flag == 0` for the following NALs)
- [ ] Pass this range to `decode_picture()`
- [ ] In `decode_picture()`, loop over each VCL NAL of the range:
  - Parse the slice header (with inheritance if dependent — see 10.3)
  - Update `ctx.sh` to point to the header of the current slice
  - Create a `BitstreamReader` on the RBSP of the current NAL
  - Advance the bitstream after the slice header (re-parse to skip)
  - Byte-align
  - Call `decode_slice_segment_data(ctx, bs)` with the current `slice_idx`
- [ ] Build the ref pic lists from the **first** independent slice header (S8.3.4 — the ref lists are per-picture, not per-slice)
- [ ] POC derived from the first slice only (S8.3.1)
- [ ] Filters (deblocking + SAO) applied **once** after all the slices

**Known pitfalls:**
- `SliceQpY` can vary between independent slices — `ctx.sh` must point to the right header while decoding each slice
- Entry point offsets (WPP, tiles) are per-slice — `decode_slice_segment_data` already uses them correctly
- The CABAC engine must be reinitialised for each independent slice (already handled in `decode_slice_segment_data` via the `!sh.dependent_slice_segment_flag` check)
- The SAO params are parsed in the CTU loop of each slice — they are written to `sao_params_buf_` at the right positions thanks to `slice_segment_address`

**Exit criterion** :
- [ ] `conf_i_multislice_256` pixel-perfect (I-frame, 4 independent slices)
- [ ] Non-regression : all single-slice tests still pass

---

### 10.3 -- Dependent Slice Inheritance

**Spec ref** : S7.4.7.1 — "dependent_slice_segment_flag equal to 1 specifies that the value of each slice segment header syntax element that is not present is inferred to be equal to the value of the corresponding slice segment header syntax element in the slice header."

**Context** : When `dependent_slice_segment_flag == 1`, the slice header only contains `slice_segment_address`. All the other fields (slice_type, SliceQpY, SAO flags, ref lists, deblocking params, weighted pred, etc.) must be inherited from the previous independent slice. Currently, `slice_header.cpp` (lines 141-143) returns `true` without copying any field — the values stay at their default initialisation (0).

**Spec ref for CABAC** : S9.3.2.1 — when `CtbAddrInRs == slice_segment_address && dependent_slice_segment_flag == 1`, the CABAC contexts are synchronised from `TableStateIdxDs` / `TableMpsValDs` (saved at the end of the previous slice). This mechanism is already implemented in `decode_slice_segment_data()`.

**Tasks** :
- [ ] Modify `SliceHeader::parse()` to accept an optional parameter `const SliceHeader* prev_independent_sh`
- [ ] When `dependent_slice_segment_flag == 1` : copy all the fields of `prev_independent_sh` BEFORE the `return true`, preserving `first_slice_segment_in_pic_flag`, `slice_segment_address`, and `dependent_slice_segment_flag` (which have just been parsed)
- [ ] In `decode_picture()` (loop of 10.2), keep a pointer to the last parsed independent `SliceHeader`, and pass it to `parse()` for dependent slices
- [ ] Check : `SliceAddrRs` derivation — for a dependent slice, `SliceAddrRs` is inherited from the independent slice containing the CTB preceding `slice_segment_address` (S7.4.7.1). This affects the SAO checks `leftCtbInSliceSeg` / `upCtbInSliceSeg`

**Known pitfalls:**
- Do NOT copy `slice_segment_address` — it is the only field specific to the dependent slice
- `no_output_of_prior_pics_flag` is not present for dependent slices (IRAP + first_slice only)
- `SliceAddrRs` for a dependent slice ≠ `slice_segment_address` — it is the `SliceAddrRs` of the parent independent slice. This widens the "in slice" area for the SAO merge checks

**Exit criterion** :
- [ ] A bitstream with dependent slices decodes correctly (if a test bitstream is available)
- [ ] Non-regression : the 4 multi-slice bitstreams (which use independent slices) still pass

---

### 10.4 -- Cross-Slice Deblocking

**Spec ref** : S8.7.2.1 — derivation of `filterLeftCbEdgeFlag` and `filterTopCbEdgeFlag` :
> "The left boundary of the current luma coding block is the left boundary of the slice and `slice_loop_filter_across_slices_enabled_flag` is equal to 0" → `filterLeftCbEdgeFlag = 0`
> (same for `filterTopCbEdgeFlag` with "top boundary")

**Context** : The spec uses "boundary of the slice" — i.e. the boundary between any two slices, not only the boundary of the last slice. The current implementation (`deblocking.cpp:96-113`) compares `addr < sh.slice_segment_address` — it only works for the boundary between the first and the last slice. With the slice index map (10.1), we can test `slice_idx[addr_p] != slice_idx[addr_q]`.

**Tasks** :
- [ ] Replace the logic of `is_boundary_excluded()` for the slice check:
  - Old : `addr_p < sh.slice_segment_address && addr_q >= sh.slice_segment_address`
  - New : `ctx.slice_idx[ts_p] != ctx.slice_idx[ts_q]` (note: use the RS address, not TS — the slice index map is in raster scan)
- [ ] Handle the per-slice flag : `slice_loop_filter_across_slices_enabled_flag` can vary between slices. The spec says "for the slice that contains sample q0,0" — use the flag of the slice that contains the Q side of the edge
- [ ] To do so, store `slice_loop_filter_across_slices_enabled_flag` per-CTU (or per-slice-idx) in addition to the slice index

**Spec precision** : S8.7.2.5.3 (eq 8-348, 8-350) — `slice_beta_offset_div2` and `slice_tc_offset_div2` are those "for the slice that contains sample q0,0". The parameters of the right slice must be used for each edge. With multi-slice, the deblocking offsets can vary between slices.

**Known pitfalls:**
- The address in `slice_idx` is in raster scan (not tile scan) — consistent with `CtbAddrInRs`
- `slice_deblocking_filter_disabled_flag` is per-slice — a slice can have deblocking disabled while its neighbour has it enabled. The spec only filters "When `slice_deblocking_filter_disabled_flag` of the current slice is equal to 0" — the "current slice" is the one of the CTU containing the current CU
- Do not confuse `slice_loop_filter_across_slices_enabled_flag` (controls inter-slice edges) and `slice_deblocking_filter_disabled_flag` (controls intra-slice deblocking)

**Exit criterion** :
- [ ] `conf_b_xslice_256` pixel-perfect (B-frames, 4 slices, cross-slice deblocking + SAO)
- [ ] Non-regression : single-slice tests and `conf_i_multislice_256`

---

### 10.5 -- Cross-Slice SAO

**Spec ref** : S7.3.8.3 — SAO syntax :
```
leftCtbInSliceSeg = CtbAddrInRs > SliceAddrRs
upCtbInSliceSeg = ( CtbAddrInRs - PicWidthInCtbsY ) >= SliceAddrRs
```

**Spec ref** : S8.7.3 — SAO application :
> "When `slice_sao_luma_flag` of the current slice is equal to 1, the CTB modification process [...] is invoked"

**Context** : The SAO parsing (`sao()` in the CTU loop) uses `SliceAddrRs` to determine whether the left/up neighbour CTU is in the same slice segment. Since `decode_slice_segment_data` decodes the CTUs in the order of each slice, and `SliceAddrRs` is derived correctly per slice, the SAO **parsing** is already correct with the loop of 10.2.

The problem is in the SAO **application** (`sao.cpp`) : the samples at inter-slice boundaries must not be read/written across slices if `slice_loop_filter_across_slices_enabled_flag == 0`. The current implementation does no cross-slice check for the SAO application.

**Tasks** :
- [ ] Check that the SAO parsing (merge left/up) works correctly with the multi-slice loop of 10.2 — `SliceAddrRs` is derived per slice in the header, the `leftCtbInSliceSeg` / `upCtbInSliceSeg` checks must use the `SliceAddrRs` of the current slice (not `slice_segment_address`)
- [ ] In `apply_sao()` (`sao.cpp`), for Edge Offset : when a neighbouring sample is in a CTU of a different slice (via the `slice_idx` map) and `slice_loop_filter_across_slices_enabled_flag == 0` for the current slice, do not use this neighbour for the EO classification
- [ ] Store `slice_sao_luma_flag` and `slice_sao_chroma_flag` per-CTU (or per-slice-idx) to apply SAO only on the CTUs whose slice has the flag active

**Known pitfalls:**
- `SliceAddrRs` for a dependent slice is NOT `slice_segment_address` — it is the `SliceAddrRs` of the independent parent (see 10.3). If parsing with an incorrect `SliceAddrRs`, the SAO merge will be wrong
- SAO EO cross-CTU samples : when two CTUs are at a slice boundary, the EO samples at ±1 pixel from the edge must not cross it if the flag is 0. This concerns the 4 EO classes (H, V, diag135, diag45)
- SAO Band Offset is not affected (no dependency on neighbours)

**Exit criterion** :
- [ ] `oracle_bbb1080_50f` pixel-perfect (real-world 1080p, multi-slice)
- [ ] `oracle_bbb4k_25f` pixel-perfect (real-world 4K, multi-slice)
- [ ] Non-regression : all existing tests pass (126/126)
- [ ] **Milestone** : 126/126 pixel-perfect tests — complete multi-slice decoder

## Spec checklist per step

Before coding each step, read these PDF sections IN FULL:

| Step | Spec sections (read in the PDF, not the summaries) |
|-------|---------------------------------------------------|
| **10.1** | S7.4.7.1 (derivation of `SliceAddrRs`, `slice_segment_address` semantics) |
| **10.2** | S7.3.8.1 (slice_segment_data — complete CTU loop), S8.1.3 (decoding process per coded picture — order of operations), S7.3.6.1 (slice segment header — all the fields) |
| **10.3** | S7.4.7.1 (`dependent_slice_segment_flag` semantics — field inheritance), S9.3.2.1 (CABAC init — dependent slice context synchronisation) |
| **10.4** | S8.7.2.1 (deblocking — `filterLeftCbEdgeFlag`, `filterTopCbEdgeFlag`, slice boundary conditions), S8.7.2.5.3 (filtering decision — `slice_beta_offset_div2`, `slice_tc_offset_div2` "for the slice that contains sample q0,0") |
| **10.5** | S7.3.8.3 (SAO syntax — `leftCtbInSliceSeg`, `upCtbInSliceSeg`), S8.7.3 (SAO application — per-slice `slice_sao_luma_flag`), S8.7.3.2 (CTB modification — samples at boundaries) |

## Required structure data

Summary of the structures to add/modify:

| Structure | Addition | Granularity | Size |
|-----------|-------|-------------|--------|
| `slice_idx_buf_` | `Decoder` | per-CTB | `PicSizeInCtbsY` bytes |
| `slice_idx` | `DecodingContext` | pointer to `slice_idx_buf_` | -- |
| `slice_flags_buf_` | `Decoder` | per-slice (indexed by `slice_idx`) | max 256 entries |
| `slice_flags[i].loop_filter_across_slices` | -- | per-slice | 1 bit |
| `slice_flags[i].sao_luma_flag` | -- | per-slice | 1 bit |
| `slice_flags[i].sao_chroma_flag` | -- | per-slice | 1 bit |
| `slice_flags[i].deblocking_disabled` | -- | per-slice | 1 bit |
| `slice_flags[i].beta_offset` | -- | per-slice | int8_t |
| `slice_flags[i].tc_offset` | -- | per-slice | int8_t |

Alternative : store these flags per-CTU (simpler, slight memory duplication). The choice is to be made at the start of the implementation.

## Complexity estimate

Moderate. Sub-phases 10.1 and 10.2 are the core of the work — modifying the decoding loop and making sure the shared grids (CU info, motion, intra modes) are correctly filled by all the slices. Sub-phases 10.4 and 10.5 are surgical fixes in the filters using the slice index map. 10.3 (dependent slices) is a field copy-paste with a single pitfall (`SliceAddrRs`).

Main risk : the test bitstreams use `--slices 4 --wpp` (x265 enforces WPP with multi-slice). P/B WPP is partially buggy (7.6 in BACKLOG). If the BBB bitstreams are encoded with WPP + multi-slice, P/B WPP may need to be fixed in parallel.
