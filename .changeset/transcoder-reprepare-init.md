---
"@hevcjs/core": patch
"@hevcjs/shaka-plugin": patch
---

Fix Shaka Player playback stalls on HEVC streams with ABR.

`SegmentTranscoder.prepareInit()` did not reset the per-stream encoder
state on re-call, so a representation switch (e.g. 480p → 720p) would
leave the previous `H264Encoder` running while `_width`/`_height` were
overwritten — new-resolution frames went through the previous encoder
and MSE rendered garbage from the first switch onward.

`HevcTransmuxer` now caches the last HEVC init segment it processed and
short-circuits when Shaka resends the exact same bytes. Without this,
Shaka's periodic transmuxer re-checks (variant probing, init repeat on
every segment in some flows) ran the full `prepareInit` pipeline every
time — closing the live encoder, warming up a throwaway one, and
forcing the next media segment to rebuild the encoder, which produced
a visible stall every few seconds. Real representation switches arrive
with different bytes and still go through the full path.
