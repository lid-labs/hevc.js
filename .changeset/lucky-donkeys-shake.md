---
"@hevcjs/core": patch
---

Re-create the H.264 encoder when an ABR switch changes the source resolution on the MSE-intercept path (dash.js, hls.js).

`processInitSegment` overwrote `_width`/`_height` with the new variant's dimensions while the encoder configured for the previous one kept running. The dimension check in `_prepareEncoder` then compared incoming frames against the freshly written dimensions, found no change, and never rebuilt the encoder — so after an up-switch the picture stayed at the lower rendition for the rest of the stream while the player reported the higher one. Measured on the ABR demo preset: switch to 1080p at t≈2s, `videoHeight` still 480 at t=30s. `prepareInit`, the Shaka path, already reset itself, which is why Shaka was unaffected.

The parameter sets extracted from a new init segment are also re-armed, so the new stream's VPS/SPS/PPS reach the decoder instead of being dropped as already fed.
