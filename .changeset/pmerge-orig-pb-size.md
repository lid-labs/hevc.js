---
"@hevcjs/core": patch
---

Decoder: streams with a parallel merge level above 2 decode correctly. The bi-to-uni restriction of 8x4 and 4x8 prediction units was skipped in 8x8 coding units sharing a merge list, which corrupted B pictures.
