---
"@hevcjs/core": patch
---

Faster WASM decoding: SIMD inter-prediction interpolation, inverse transforms, SAO and deblocking, transforms and dequantization bounded to the nonzero coefficients, and a faster CABAC engine. Measured under Node 24 on an Apple M4 Pro: 91 to 135 fps on a 1080p stream, 23.8 to 29.7 and 30.8 to 40 fps on two 4K streams. Decoded output is unchanged, bit for bit.
