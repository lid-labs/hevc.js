---
"@hevcjs/core": patch
---

Decoder: streams with PCM coding units decode correctly — PCM samples on fewer bits than the bit depth, PCM samples starting on a byte boundary, and PCM units next to the loop filters all used to decode wrong.
