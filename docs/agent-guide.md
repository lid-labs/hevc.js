# Agent Guide — HEVC Torture

Condensed guide for coding agents. Read this file BEFORE coding.

## Order of operations

Each phase is **sequential**. Do not start phase N+1 until phase N passes its tests.

```
Phase 2 (Bitstream/NAL) → Phase 3 (Parsing) → Phase 4 (Intra) → Phase 5 (Inter) → Phase 6 (Filters)
```

## Before coding a phase

1. Read `BACKLOG.md` — progress, remaining tasks
2. Read `docs/phases/phase-XX-*.md` — detailed tasks
3. Read the "Pièges de conformité" (conformance pitfalls) section of `MASTER-PLAN.md` — the known mistakes
4. Read `DECISIONS.md` — architecture conventions
5. Read the existing headers (`src/`) — the interfaces are already defined
6. Read the spec PDF whenever in doubt: `pdftotext -f <page> -l <page> docs/spec/pdf/T-REC-H.265-202108-S.pdf -`

## Code layout

```
src/bitstream/   → BitstreamReader, NAL parser (Phase 2)
src/syntax/      → VPS, SPS, PPS, SliceHeader (Phase 3)
src/decoding/    → CABAC, Intra, Inter, Transform (Phase 4-5)
src/filters/     → Deblocking, SAO (Phase 6)
src/common/      → Types, Picture, debug logging
```

## Conventions

- Name functions after the spec: `decode_inter_prediction_samples` → spec §8.5.3
- Comment each function: `// Spec §8.5.3.2 — Luma sample interpolation`
- One source file per major section of the spec
- `Pixel = uint16_t` everywhere (AD-001)
- Picture in planar layout, separate Y/Cb/Cr (AD-002)
- Parameter sets stored by ID in `std::array<std::optional<T>>` (AD-003)

## Debug logging

Use `HEVC_LOG(CATEGORY, "format", args...)` to trace intermediate values.

```cpp
#include "common/debug.h"

HEVC_LOG(CABAC, "decode_decision ctxIdx=%d pStateIdx=%d valMps=%d → bin=%d",
         ctx_idx, ctx.pStateIdx, ctx.valMps, bin_val);
HEVC_LOG(INTRA, "pred mode=%d block %dx%d at (%d,%d)",
         mode, w, h, x0, y0);
HEVC_LOG(TRANSFORM, "coeff[%d][%d] = %d (after dequant)", row, col, val);
```

Categories: BITSTREAM, NAL, PARSE, CABAC, TREE, INTRA, INTER, TRANSFORM, QUANT, FILTER, RECON, DPB.

Runtime filtering: `HEVC_DEBUG_FILTER=CABAC,INTRA ./hevc-decode input.265`

## How to debug an oracle FAIL

When the MD5 of the YUV does not match:

```bash
# 1. Decode with hevc-decode
./build/hevc-decode tests/conformance/fixtures/i_64x64_qp22.265 -o /tmp/test.yuv

# 2. Decode the reference with ffmpeg
ffmpeg -y -i tests/conformance/fixtures/i_64x64_qp22.265 -pix_fmt yuv420p /tmp/ref.yuv

# 3. Compare pixel by pixel
python3 tools/oracle_compare.py /tmp/ref.yuv /tmp/test.yuv 64 64

# 4. Enable debug output for the suspect category
HEVC_DEBUG_FILTER=CABAC,INTRA ./build/hevc-decode input.265 -o /tmp/test.yuv 2>/tmp/debug.log

# 5. Look for the first wrong pixel in the log
# The PSNR and the position of the first mismatch point to the faulty CTU/CU
```

## Typical mistakes per phase

### Phase 2 — Bitstream
- Forgetting the emulation prevention bytes in the RBSP
- A suffix SEI creating a false AU boundary (it belongs to the same AU)
- `more_rbsp_data()` must NOT just check "are there bits left"

### Phase 3 — Parsing
- Forgetting the derived values after parsing the SPS (call `derive()`)
- Short-term RPS: the delta_poc values are cumulative, not absolute
- Scaling list fallback: the default 8x8+ matrices are NOT flat 16

### Phase 4 — Intra (the hardest)
- **CABAC `sig_coeff_flag` context** (§9.3.4.2.8) — the context depends on the position in the sub-block AND on the `coded_sub_block_flag` of the neighbours. This is bug #1.
- **Adaptive `cRiceParam`** — starts at 0 per sub-block, increments when `baseLevel > 3 * (1 << cRiceParam)`. Without it, large coefficients = mismatch.
- **Transform inter-pass clipping** — after the vertical pass, clip to [-32768, 32767]. Without it = overflow in the horizontal pass.
- **Angular transposition** — modes 2-17 must transpose the reference samples, apply the mirrored mode, then transpose the result.
- **`end_of_slice_segment_flag`** — decoded with `decode_terminate()` after EVERY CTU.
- **PCM byte alignment** — align the bitstream reader before reading the PCM samples.
- **`cabac_init_flag`** — swaps the P↔B init tables.
- **QP derivation** — the QP predictor is the average of the QPs of the neighbouring CUs (left and above), NOT the QP of the previous CU.

### Phase 5 — Inter
- **MV scaling** for temporal candidates (TMVP) — do not forget the POC scale factor.
- **Interpolation shifts** — the shifts are fixed by the spec, not by the sample bit depth.
- **`HandleCraAsBlaFlag`** — needed for random access.

### Phase 6 — Filters
- **Bi-pred boundary strength** — the formula for B-frames differs from the one for P-frames.
- **SAO edge offset** — the 4 edge classes use signed offsets.

## Tests

```bash
# Debug build
cmake -B build -DCMAKE_BUILD_TYPE=Debug && cmake --build build

# Unit tests
cd build && ctest --output-on-failure

# Oracle per phase
ctest -L phase4 --output-on-failure
ctest -L phase5 --output-on-failure
ctest -L oracle --output-on-failure

# All tests
ctest --output-on-failure
```

## CABAC reference data

To generate CABAC test data from a bitstream:

```bash
python3 tools/extract_cabac_reference.py tests/conformance/fixtures/i_64x64_qp22.265
# Produces tests/conformance/reference_data/i_64x64_qp22.h
# Holds the RBSP bytes of each NAL unit, ready for the unit tests
```

## Toy bitstreams (ultra-simple)

To generate 16x16 bitstreams for step-by-step debugging:

```bash
bash tools/gen_toy_bitstreams.sh
# Produces tests/conformance/fixtures/toy_*.265
```

These bitstreams have a single CTU, which makes CABAC/intra debugging much simpler.
