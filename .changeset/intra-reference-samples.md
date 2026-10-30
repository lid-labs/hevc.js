---
"@hevcjs/core": patch
---

Building the intra reference samples got two cheaper steps.

The samples were read one at a time through `Picture::get()`, which tests the
picture's sample width on every one of them. Availability is already decided per
4x4 block, so the reads run in runs along a row of the top edge or a column of
the left edge: the width is now resolved once per run, and the row case
vectorises.

The Z-scan address §6.4.1 compares for same-CTB availability was an eight-step
bit-interleave loop, run once per 4x4 block tested. It is now one lookup per
coordinate in a 256-entry spread table built at compile time.

Measured on one thread on an Apple M4 Pro, 2026-10-30, two binaries alternated,
min of 3 rounds. Native instructions retired (`hevc-bench -n 5` under
`/usr/bin/time -l`): −1.59% on `bbb4k_25f.265`, −1.66% on `bbb1080_50f.265`,
−2.48% on `full_qcif_10f.265`, which is all-intra. WASM, instructions retired of
the `node` process running `tools/bench_wasm.cjs`: −0.87% and −0.69%. Cycles
land between −1.34% and +0.24%, i.e. flat on a loaded machine.

Decoded output is unchanged: 147/147 conformance streams, the 51-stream
WASM/native diff and 220 ctest.
