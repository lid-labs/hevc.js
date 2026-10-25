---
"@hevcjs/core": patch
---

Decoder: streams with long-term reference pictures decode correctly with TMVP, and a PPS sent before the SPS it refers to is no longer rejected. With this, all 147 streams of the JCT-VC HEVC v1 conformance suite decode bit-exactly.
