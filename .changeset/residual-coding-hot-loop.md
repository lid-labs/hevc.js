---
"@hevcjs/core": patch
---

Faster coefficient parsing in the WASM decoder: `residual_coding` now derives the `sig_coeff_flag` context once per sub-block, reads coefficient levels over the significant positions only, and locates the last significant coefficient directly. Decoded output is unchanged, bit for bit. Measured with the WASM build under Node 24: about 6% less decode time at 1080p and 8–9% at 4K.
