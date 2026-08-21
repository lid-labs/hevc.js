---
"@hevcjs/core": patch
---

Index the CU / intra-mode / CTB grids with shifts instead of integer divisions.

`cu_at`, `intra_mode_at`, `chroma_mode_at` and the deblocking boundary
derivations divided sample coordinates by a power-of-two grid size whose value
is only known at run time, so the compiler could not turn the division into a
shift. These accessors sit on the hottest paths of the decoder, and WebAssembly
has no cheap `i32.div_s`.

All the coordinates involved are non-negative — picture-boundary edges return
earlier, and the two decremented call sites are guarded — which makes the shift
exactly equivalent. That precondition is now asserted in the accessors: it costs
nothing in release builds, and a negative coordinate would otherwise turn a
harmless truncation into an out-of-bounds index.

Decoded output is byte-identical: the full suite (146 tests, oracle MD5
comparisons included) passes, in a release build and in a build with assertions
enabled.

Measured in WASM (emcc 6.0.8, single-threaded, best of 3 x 3 runs):

- 1080p: 79.7 → 85.2 fps (1.07x)
- 4K: 21.5 → 22.0 fps (1.02x)

The gain is larger here than the −3 % reported for the same change on native
x86, which matches the expectation that divisions cost more in WebAssembly.
