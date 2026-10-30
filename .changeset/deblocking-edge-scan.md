---
"@hevcjs/core": patch
---

Deblocking skips runs of empty edge positions a word at a time. A 1080p picture
offers about 130k four-sample segment positions and only 44k of them carry an
edge, and the flag grid holds one byte per 4x4 block while the filter walks the
8x8 grid, so one 64-bit read answers "is any of the next eight columns worth
visiting" — masked to the even bytes for a vertical edge, since the odd ones mark
4-pixel-aligned transform boundaries §8.7.2 does not filter.

Measured on one thread on an Apple M4 Pro, 2026-10-30, instructions retired, two
binaries alternated over three rounds: −0.23% on `bbb1080_50f.265`, −0.19% on
`demo/bbb1080_singleslice.265`, −0.25% on `bbb4k_25f.265` and −0.67% on
`demo/bbb4k_singleslice.265`, which is where deblocking weighs most. Decoded
output is unchanged: 147/147 conformance streams and the 50-stream WASM/native
diff.
