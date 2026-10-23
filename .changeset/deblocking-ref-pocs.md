---
"@hevcjs/core": patch
---

The deblocking filter reads the POCs of the reference picture lists once per picture instead of querying the DPB for every edge segment. Decoded output is unchanged, bit for bit. Measured with the WASM build under Node 24: under 1% less decode time at 1080p and 4K.
