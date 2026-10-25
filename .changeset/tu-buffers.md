---
"@hevcjs/core": patch
---

Decoder: about 5% faster at 1080p and 9% at 4K in WebAssembly, by no longer zeroing large scratch buffers for every transform unit. Output is unchanged.
