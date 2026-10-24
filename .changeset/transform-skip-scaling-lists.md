---
"@hevcjs/core": patch
---

Fix decoding of streams that use transform skip or scaling lists sent in the bitstream: transform-skip residuals were scaled 4 times too small, and explicit scaling list coefficients were applied at the wrong positions. Streams using neither tool decode exactly as before.
