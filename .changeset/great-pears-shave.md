---
"@hevcjs/core": patch
---

Dequantize in 32-bit arithmetic on the common path.

`perform_dequant` computed every coefficient through `int64_t`, which costs
noticeably more than 32-bit arithmetic in WebAssembly. It was the second hottest
function in a WASM profile of 1080p decoding, at 8% of samples.

The width is only needed for the `<< qpPer` step: `coeff * m * scale` always fits
in `int32` (at worst 32768 * 255 * 72, about 6.0e8). Dividing numerator and
denominator by 2^qpPer rewrites

    ((X << qpPer) + (1 << (bdShift-1))) >> bdShift

as `(X + (1 << (s-1))) >> s` with `s = bdShift - qpPer`, which stays in 32 bits.
`s == 0` degenerates to `X`. When `qpPer > bdShift` — reachable, since `bdShift`
is as low as 5 for 4x4 at 8-bit while `qpPer` reaches 8 — the original 64-bit
path still runs.

Output is byte-identical: the full suite (146 tests, oracle MD5 comparisons
included) passes, and a build comparing the folded result against the reference
formula for every coefficient reports no divergence across all fixtures and the
1080p and 4K streams in full.

Measured in WASM (emcc 6.0.8, single-threaded, A/B interleaved with the order
swapped each round to cancel thermal drift): 1080p averages 82.9 -> 86.3 fps,
about 4%, winning all six rounds.
