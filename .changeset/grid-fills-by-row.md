---
"@hevcjs/core": patch
---

The filter grids are filled a row at a time. `decode_coding_unit` and the
transform tree wrote `log2_tu_size_grid`, `cbf_luma_grid` and the edge flags one
4x4 block at a time, deriving each index with `(x0 + dx) / 4` — a signed division
the compiler has to spell out, since it cannot know the operand is non-negative.
A CU or TU row is contiguous in those grids, so it is one store of up to 8 bytes,
and the coordinates become shifts.

Rows are filled with `memcpy` of a constant size rather than `memset`: for a size
the compiler cannot see, the WASM build emits a call, and a 2- or 4-byte call per
row costs more than the loop it replaces. Measured — the `memset` version came out
at −0.86% to −2.47% of native instructions but −0.27% to +0.68% in WASM, while the
version shipped here gains on both.

Measured on one thread on an Apple M4 Pro, 2026-10-30, two binaries alternated,
min of 3 rounds. Native, instructions retired (`hevc-bench -n 5` under
`/usr/bin/time -l`): −1.60% on `bbb1080_50f.265`, −2.34% on
`demo/bbb1080_singleslice.265`, −1.41% on `bbb4k_25f.265`, −2.20% on
`demo/bbb4k_singleslice.265`. WASM, instructions retired of the `node` process
running `tools/bench_wasm.cjs`: −0.89%, −0.70% and −0.64% on the first three.
Native cycles land between −0.89% and +0.67%, which is flat: the machine was
loaded, where cycles move by several percent between rounds and only instruction
counts are stable.

Decoded output is unchanged: 147/147 conformance streams, the 51-stream
WASM/native diff and 220 ctest.
