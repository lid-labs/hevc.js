---
"@hevcjs/core": patch
---

Speed up the SAO in-loop filter in the WASM decoder.

`apply_sao` ran the cross-slice / cross-tile boundary test for every sample of
every picture: the guard gating it (`ctx.slice_idx != nullptr`) was always true,
because the decoder assigns that pointer unconditionally. The test can only
change the outcome on a one-pixel CTB border, yet every sample paid four integer
divisions plus the slice-header lookups.

The neighbourhood is now checked once per CTB. When it is uniform (single slice,
no tiles, or an interior CTB) and the CTB has no PCM / transquant-bypass CU, the
edge- and band-offset loops run with no divisions, no per-sample bounds tests and
no branch on the offset value. Otherwise the original path runs unchanged.

Decoded output is byte-identical — the full suite (146 tests, including the
pixel-perfect oracle MD5 comparisons) passes, and a build with bounds assertions
enabled reports no out-of-range access.

Measured in WASM (emcc 6.0.8, single-threaded, best of 3 x 3 runs):

- 1080p, SAO on: 67.0 → 79.7 fps (1.19x)
- 4K, SAO on: 18.5 → 21.5 fps (1.16x)
- 1080p, SAO off: unchanged, as expected — the filter does no work on those
  streams, so this optimization does nothing for them
