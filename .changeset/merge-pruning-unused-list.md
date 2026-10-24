---
"@hevcjs/core": patch
---

Decoder: merge candidate pruning compares only the reference lists a candidate uses. Next to an 8x4 or 4x8 prediction unit whose bi-prediction had been turned into uni-prediction, a duplicate candidate was kept and later merge indices selected the wrong motion, corrupting B pictures. The JCT-VC scaling list conformance streams now decode bit-exactly.
