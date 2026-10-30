---
"@hevcjs/core": patch
---

Faster decoding: a picture whose luma and chroma are both 8 bits is now stored
one byte per sample instead of two, so motion compensation, the loop filters and
the SAO backup copy move half the bytes. With it come an int16-lane default
weighted prediction for 8-bit pictures, a `derive_bs` shortcut when both sides of
an edge carry the same motion, vectorised motion-compensation copies, one
deblocking instance per edge direction and lane-shuffled transform transposes.

On one thread on an Apple M4 Pro, 2026-10-30: 6-18% fewer instructions retired
and 11-25% fewer cycles across the four reference streams; 135 → 145 fps on
`bbb1080_50f.265`, 29.7 → 32.5 fps on `bbb4k_25f.265` and 39.5 → 45.2 fps on
`bbb4k_singleslice.265` under Node 24.4.1. Decoded output is unchanged: the 147
streams of the JCT-VC HEVC v1 conformance suite still match their reference MD5,
and the WASM build decodes the 50-stream set exactly like the native one.

The WASM binary grows from 290 418 to 336 019 bytes (116 139 with `gzip -9`),
the price of the two sample-type instances of each templated kernel; Main 10
keeps its 16-bit path. `HEVCFrame` gains `bytes_per_sample` in the C struct, and
the JS side widens an 8-bit plane into the `Uint16Array` planes it already
returned, so the JavaScript API is unchanged.
