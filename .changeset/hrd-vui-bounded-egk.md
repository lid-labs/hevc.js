---
"@hevcjs/core": patch
---

Decoder: streams whose SPS carries HRD parameters in its VUI now decode correctly; they used to decode to garbage. A corrupt or desynchronised stream can no longer make the decoder loop forever while parsing coefficients or motion vector differences.
