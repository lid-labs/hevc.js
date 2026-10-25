# Phase 5 -- Inter Prediction (P/B frames)

## Goal

Decode P and B frames: motion compensation, interpolation, bi-prediction.
Pixel-perfect vs ffmpeg on `p_qcif_10f` and `b_qcif_10f` (without deblocking/SAO).

## Prerequisites

Phase 4 completed (I-frames pixel-perfect, including multi-CTU non-64-aligned).

## Spec refs

- S8.3 : Reference picture management (DPB, RPS, ref lists)
- S8.5.3 : Inter prediction (motion compensation)
- S7.3.8.6 : prediction_unit syntax (merge, AMVP)
- S8.5.3.2 : Luma interpolation (8-tap)
- S8.5.3.3 : Chroma interpolation (4-tap)
- S8.5.3.4 : Weighted prediction

## Breakdown into sub-steps (10 steps + 1 preliminary)

Inspired by the success of Phase 4 (6 sub-phases with independent validation).
Principle: **one test per step, do not move to the next one while it fails**.

| Step | File | Validation | Dependencies |
|-------|---------|------------|-------------|
| **5.0** | `phase-05-0-fix-multictu.md` | I-frame QCIF 176x144 pixel-perfect | Phase 4 |
| **5.1** | `phase-05-1-dpb-poc.md` | Correct POC for 10 frames | -- |
| **5.2** | `phase-05-2-rps-reflists.md` | RefPicList0/1 vs HM per slice | 5.1 |
| **5.3** | `phase-05-3-merge-spatial.md` | 5 spatial candidates vs HM on 5 PUs | -- |
| **5.4** | `phase-05-4-tmvp.md` | Temporal MV vs HM on first P-frame | 5.1, 5.2 |
| **5.5** | `phase-05-5-merge-full.md` | Complete merge list vs HM (spatial+temp+combined+zero) | 5.3, 5.4 |
| **5.6** | `phase-05-6-amvp-mvd.md` | Final MV vs HM for AMVP PUs | 5.2 |
| **5.7** | `phase-05-7-interp-luma.md` | 8-tap unit test (H, V, 2D-H, 2D-V) | -- |
| **5.8** | `phase-05-8-interp-chroma-bipred.md` | 4-tap chroma unit test + bi-pred averaging | 5.7 |
| **5.9** | `phase-05-9-integration-p.md` | `oracle_p_qcif_10f` pixel-perfect | 5.0-5.8 |
| **5.10** | `phase-05-10-integration-b.md` | `oracle_b_qcif_10f` pixel-perfect | 5.9 |

## Dependency graph

```
5.0 (Fix multi-CTU) ────────────────────────────────────────────┐
                                                                 │
5.1 (DPB+POC) ──> 5.2 (RPS+RefLists) ──> 5.6 (AMVP+MVD) ──────┤
                       │                                         │
                       v                                         │
5.3 (Merge spatial) ──> 5.4 (TMVP) ──> 5.5 (Merge full) ───────┤
                                                                 │
5.7 (Interp luma) ──> 5.8 (Interp chroma+bipred) ──────────────┤
                                                                 │
                                                          5.9 (P-frames)
                                                                 │
                                                          5.10 (B-frames)
```

5.0, 5.1, 5.3, 5.7 are independent (can be parallelised).

## Lessons from Phase 4+5 applied

1. **Audit the spec BEFORE the code** -- read the spec PDF, transcribe directly
2. **List ALL invoked processes** -- each spec section invokes other processes (e.g. §7.3.8.11 invokes §9.3.4.3.6). Forgetting them = silent bug
3. **Validate each layer in isolation** before integration
4. **Never "simplify" the spec** -- transcribe the formulas as they are
5. **Systematic audit > incremental debugging** -- audit all the code before tracing
6. **Max 2 debug iterations** -- after 2 failures, re-read the spec instead of adding traces

## Spec checklist per step

Before coding each step, read these PDF sections IN FULL:

| Step | Spec sections (read in the PDF, not the summaries) |
|-------|---------------------------------------------------|
| **5.0** | §9.3.4.3.1-6 (COMPLETE CABAC engine — init, decision, renorm, bypass, terminate, **alignment §9.3.4.3.6**) |
| **5.1** | §8.3.1 (POC), §8.3.2 (RPS) |
| **5.2** | §8.3.4 (RefPicList construction) |
| **5.3** | §8.5.3.2.2-3 (merge spatial), §6.4.2 (PU availability) |
| **5.4** | §8.5.3.2.8-9 (TMVP collocated MV), §8.5.3.2.12 (MV scaling) |
| **5.5** | §8.5.3.2.4 (combined bi-pred), §8.5.3.2.5 (zero MV) |
| **5.6** | §8.5.3.2.6-7 (AMVP), §7.3.8.6 (prediction_unit syntax) |
| **5.7** | §8.5.3.3.3 (luma 8-tap interp, chroma 4-tap), §8.5.3.3.2 (chroma MV derivation) |
| **5.8** | §8.5.3.3.4 (weighted prediction — default + explicit) |
| **5.9** | §7.3.8.1 (slice_segment_data — CTU loop + end_of_slice), §9.2.2 (WPP context) |
| **5.10** | §8.3.5 (collocated picture, NoBackwardPredFlag) |

## Current state of the code

The Phase 5 code already exists (5A-5D implemented). Bugs fixed this session:
- **§9.3.4.3.6** : bypass alignment (`ivlCurrRange = 256`) missing before `coeff_sign_flag` and `coeff_abs_level_remaining` — caused bypass bin desync from the 14th bin
- **WPP** : `entropy_coding_sync` boundary handling missing (end_of_subset + byte align + context save/restore)
- **numNeg** : floor division for the negative extension of the angular references

Source files:
- `inter_prediction.cpp` (~660 lines) : merge, AMVP, TMVP, MC
- `interpolation.cpp` (~300 lines) : 8-tap/4-tap filters
- `dpb.cpp` (~440 lines) : DPB, POC, RPS, ref lists

Remaining work: **audit the existing code against the spec (with the checklist above), fix the bugs, validate with oracle tests**.
