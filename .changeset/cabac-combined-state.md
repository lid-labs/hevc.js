---
"@hevcjs/core": patch
---

Faster CABAC: a context variable is one byte. §9.3.2.2 keeps `pStateIdx` and
`valMps` apart, and the decoder held them in two bytes; they are now the
combined state `pStateIdx << 1 | valMps`, as ffmpeg does. That is one load and
one store per bin instead of two, and the `valMps` swap §9.3.4.3.2 prescribes at
`pStateIdx` 0 comes out of the LPS transition table rather than a branch and a
second store. The three state-indexed tables are built at compile time from
Tables 9-48 to 9-50, which stay the single source of truth.

Measured on one thread on an Apple M4 Pro, 2026-10-30, two binaries alternated
over three rounds, minimum of each: instructions retired 46.411 → 45.763G on
`bbb4k_25f.265` (−1.40%), where the residual coding is about 29% of cycles, and
25.380 → 25.180G on `bbb1080_50f.265` (−0.79%); cycles 5.408 → 5.300G on the
latter, while the 4K cycle reading moved within its noise. Decoded output is
unchanged: 147/147 conformance streams, the 50-stream WASM/native diff, and the
219 unit tests.

The WASM binary grows from 336 019 to 343 134 bytes (117 442 with `gzip -9`),
768 of which are the new tables; the docs restate it as 335 KB, ~115 KB
gzip-compressed.
