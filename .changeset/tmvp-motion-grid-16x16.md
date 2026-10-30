---
"@hevcjs/core": patch
---

Each decoded picture keeps its motion field for TMVP on a 16x16 grid instead of a
4x4 one. §8.5.3.2.9 masks the collocated position down to a 16x16 grid before
reading it, so fifteen sixteenths of the copy every picture carried were entries
no reader could reach.

What this buys is mostly memory, which matters more for the WASM build than the
instruction count does: peak resident size over a decode drops 22% at 4K (551 to
429 MiB) and 15% at 1080p (287 to 244 MiB), because every picture the DPB holds
carries 5.8 MB less at 4K.

Measured on one thread on an Apple M4 Pro, 2026-10-30, two binaries alternated,
min of 3 rounds, `hevc-bench -n 5` under `/usr/bin/time -l`. Native: instructions
retired −0.39% on `bbb4k_25f.265` and −0.31% on `bbb1080_50f.265`, cycles −0.56%
and −1.23%. WASM, instructions retired of the `node` process running
`tools/bench_wasm.cjs`: −0.23% and −0.42%.

Decoded output is unchanged: 147/147 conformance streams, the 51-stream
WASM/native diff and 220 ctest.
