# Phase 4 — Intra Prediction (I-frames)

## Goal

Decode complete I-only frames: CABAC + quad-tree + intra prediction + transform + reconstruction.
Pixel-perfect vs ffmpeg on `i_64x64_qp22.265`.

## Prerequisites

Phase 3 completed (parameter sets and slice headers parsed).
HM reference decoder compiled in `/tmp/HM` with per-bin tracing.

## Spec refs

- §9: CABAC (the whole chapter)
- §7.3.8-13: Slice data syntax (CTU, CU, PU, TU, residual_coding)
- §8.4: Intra prediction (35 modes)
- §8.6: Inverse transform + scaling (dequant)

## Split into sub-phases

Phase 4 is split into **6 independently verifiable sub-phases**.
Each sub-phase has its own unit tests that validate WITHOUT depending on the full-frame oracle.

| Sub-phase | File | Status | Exit criterion |
|------------|---------|--------|-------------------|
| 4A — CABAC Engine | `phase-04a-cabac.md` | **Done** | 7 unit tests pass |
| 4B — Coding Tree | `phase-04b-coding-tree.md` | **To validate** | Syntax element sequence identical to HM |
| 4C — Residual Contexts | `phase-04c-residual-contexts.md` | **To validate** | All `derive_*_ctx()` match HM |
| 4D — Coefficient Parsing | `phase-04d-coefficient-parsing.md` | **To validate** | TU coefficients identical to HM |
| 4E — Transform + Dequant | `phase-04e-transform-dequant.md` | **Done** | Tests on known matrices |
| 4F — Prediction + Recon | `phase-04f-prediction-recon.md` | **Done** | 3 pixel-perfect toy tests |

## Execution order

```
4A (CABAC)  ──→  4B (Coding Tree)  ──→  4C (Residual Contexts)
                                              │
                                              ▼
                                        4D (Coefficient Parsing)
                                              │
                 4E (Transform) ◄─────────────┘
                       │
                       ▼
                 4F (Prediction + Recon)
                       │
                       ▼
                 Oracle: i_64x64_qp22 pixel-perfect
```

## Principle: validate each layer BEFORE integrating

The pitfall of Phase 4 is coupling: a CABAC context error corrupts the arithmetic state, which makes ALL the following bins diverge. Debugging at the oracle level (pixel-perfect YUV) is then extremely slow.

The solution: validate each layer in isolation with unit tests that compare directly with HM, BEFORE running the full decode.

## Final exit criterion

- `oracle_i_64x64_qp22` passes (MD5 match)
- All the sub-phase unit tests pass
- `ctest -L phase4 --output-on-failure`: 0 failures
