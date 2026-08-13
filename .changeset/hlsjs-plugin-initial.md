---
"@hevcjs/hlsjs-plugin": minor
"@hevcjs/core": minor
---

Add `@hevcjs/hlsjs-plugin` — hls.js plugin for HEVC playback via the shared MSE intercept, plus the core support it needs:

- `SourceBuffer.changeType()` is now patched: HEVC mimes are mapped to their H.264 equivalent (hls.js queues `changeType` on codec switches; passing the HEVC mime through throws `NotSupportedError` on browsers without native HEVC).
- New opt-in `strictAppendProgress` intercept config: `updateend` for a media append only fires once that segment's first transcoded chunk has reached the real SourceBuffer, satisfying hls.js's `bufferAppendNoProgress` watchdog. Default off — dash.js/Shaka behavior unchanged.
- The `timestampOffset` seek heuristic now flushes only on a large jump (≥0.5s) with queued segments after a first init segment was parsed, instead of on any change while busy. Fixes spurious pipeline resets on hls.js ≥1.6.6 routine alignment writes and on the initial media-time mapping of playlists starting at `EXT-X-MEDIA-SEQUENCE > 0`.
