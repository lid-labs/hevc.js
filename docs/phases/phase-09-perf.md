# Phase 9 — Performance & Optimisation

## Goal
Reach real-time playback in the browser. Target: 1080p@30 minimum, 4K@60 as a stretch goal.

## Prerequisites
Phase 8 completed (working WASM). Phase 7 for the 10-bit profiles.

## Time budget per frame

| Resolution | FPS | Budget/frame |
|------------|-----|-------------|
| 720p@30 | 30 | 33ms |
| 1080p@30 | 30 | 33ms |
| 1080p@60 | 60 | 16.6ms |
| 4K@30 | 30 | 33ms |
| 4K@60 | 60 | 16.6ms |

Reference: an optimised C decoder (libde265, ffmpeg) decodes 1080p@30 in ~5ms on desktop. WASM is ~2-3x slower, so ~10-15ms — feasible.

## Tasks

### 9.1 — Profiling
- [ ] Profile the native build (perf, Instruments)
- [ ] Profile the WASM build (Chrome DevTools Performance)
- [ ] Identify the top 5 hotspots (probably: interpolation, CABAC, transform, deblocking, SAO)
- [ ] Measure the WASM/native time ratio

### 9.2 — WASM SIMD
WASM supports 128-bit SIMD instructions (since 2021, supported by all modern browsers).

- [ ] 8-tap luma interpolation : vectorise the horizontal/vertical filter
- [ ] 4-tap chroma interpolation : same
- [ ] Inverse transform : SIMD partial butterfly
- [ ] Deblocking : vectorise the filter over the sample lines
- [ ] SAO : vectorise the edge offset comparisons
- [ ] Reconstruction : SIMD addition + clipping

```cpp
// Example: horizontal luma interpolation with SIMD
#include <wasm_simd128.h>

void luma_filter_h_simd(const uint8_t* src, int16_t* dst, int width, int frac) {
    v128_t coeffs = wasm_i16x8_make(
        luma_filter[frac][0], luma_filter[frac][1],
        luma_filter[frac][2], luma_filter[frac][3],
        luma_filter[frac][4], luma_filter[frac][5],
        luma_filter[frac][6], luma_filter[frac][7]
    );
    // Process 8 pixels at a time...
}
```

Compile with: `emcc -msimd128`

### 9.3 — Threading (Web Workers)
- [ ] Decoding pipeline : Worker 1 parses CABAC, Worker 2 does the reconstruction
- [ ] Tile parallelism : each tile decoded in a separate Worker
- [ ] WPP : CTU row parallelism (diagonal dependency)
- [ ] SharedArrayBuffer to share the DPB between workers
- [ ] Requires the COOP/COEP headers:
  ```
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  ```

### 9.4 — Algorithmic optimisations
- [ ] Lookup tables for CABAC (rangeTabLps precomputed as shifts)
- [ ] Fast path for skipped CUs (no residual = no transform)
- [ ] Fast path for constant QP (simplified scaling)
- [ ] Cache-friendly memory layout for the pictures
- [ ] Avoid divisions (replace with shifts)

### 9.5 — Memory
- [ ] Pool allocator for CU/PU/TU (avoid malloc per block)
- [ ] Reuse the frame buffers (ring buffer in the DPB)
- [ ] Minimise copies (zero-copy between CABAC and reconstruction)
- [ ] Memory alignment for SIMD (16-byte aligned)

### 9.6 — Benchmarks
- [ ] Reproducible benchmark suite:
  - 720p I-only @QP22
  - 1080p IPB @QP22
  - 4K IPB @QP22
- [ ] Measurement : FPS, ms/frame, peak memory
- [ ] CI tracking : alert on regression > 10%
- [ ] Compare with libde265 WASM (if available) and ffmpeg WASM

## Exit criterion

| Target | Criterion | Status |
|-------|---------|--------|
| Minimum | 720p@30 real-time in Chrome | Required |
| Goal | 1080p@30 real-time in Chrome | Desired |
| Stretch | 1080p@60 real-time | Nice to have |
| Stretch++ | 4K@30 real-time | Ambitious |
| Stretch+++ | 4K@60 real-time | Very ambitious |

## Complexity estimate
High. SIMD optimisation is technical and tedious. WASM threading adds complexity (synchronisation, COOP/COEP headers).
