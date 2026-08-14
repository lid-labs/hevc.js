# @hevcjs/hlsjs-plugin

## 0.1.0

### Minor Changes

- [#214](https://github.com/lid-labs/hevc.js/pull/214) [`6743b5f`](https://github.com/lid-labs/hevc.js/commit/6743b5f5b08f0e8cbceaa8921ef9f40a40f6130d) Thanks [@privaloops](https://github.com/privaloops)! - Add `@hevcjs/hlsjs-plugin` — hls.js plugin for HEVC playback via the shared MSE intercept, plus the core support it needs:

  - `SourceBuffer.changeType()` is now patched: HEVC mimes are mapped to their H.264 equivalent (hls.js queues `changeType` on codec switches; passing the HEVC mime through throws `NotSupportedError` on browsers without native HEVC).
  - New opt-in `strictAppendProgress` intercept config: `updateend` for a media append only fires once that segment's first transcoded chunk has reached the real SourceBuffer, satisfying hls.js's `bufferAppendNoProgress` watchdog. Default off — dash.js/Shaka behavior unchanged.
  - The `timestampOffset` seek heuristic now flushes only on a large jump (≥0.5s) with queued segments after a first init segment was parsed, instead of on any change while busy. Fixes spurious pipeline resets on hls.js ≥1.6.6 routine alignment writes and on the initial media-time mapping of playlists starting at `EXT-X-MEDIA-SEQUENCE > 0`.

- [#216](https://github.com/lid-labs/hevc.js/pull/216) [`125c1a7`](https://github.com/lid-labs/hevc.js/commit/125c1a7d996e48c60ebbc42779c725153e65d364) Thanks [@privaloops](https://github.com/privaloops)! - Muxed A/V refusal and compute-aware ABR for hls.js:

  - Core (**behavior change**): the MSE intercept now refuses muxed audio+video HEVC mimes (an HEVC codec alongside an audio codec in the same `codecs` list, e.g. `"hvc1...,mp4a.40.2"`) instead of intercepting the video-only path and silently dropping the audio track. `isTypeSupported`/`decodingInfo` answer unsupported so players that probe the combined mime (dash.js) filter these renditions upfront; `addSourceBuffer` passes the mime through with a loud error for players that probe codecs separately (hls.js). Previously such a mime reported supported and played without audio. New `isMuxedHevcMime` export; `HEVC_CODEC_RE` no longer swallows the audio codec after a comma. `@hevcjs/dashjs-plugin` inherits this refusal through its core dependency bump.
  - Shaka plugin: the transmuxer reports muxed A/V HEVC mimes as unsupported for the same reason.
  - hls.js plugin: `attachHevcSupport` now returns a callable handle with `attachComputeAware(hls)` — compute-aware ABR capping `hls.autoLevelCapping` when the device can't transcode in real time (on by default, `adaptiveCompute: false` to opt out). Warns when `ManagedMediaSource` is present and could bypass the intercept.

- [#217](https://github.com/lid-labs/hevc.js/pull/217) [`31aaf6c`](https://github.com/lid-labs/hevc.js/commit/31aaf6c5315cb47f66272814917f8d65f513387f) Thanks [@privaloops](https://github.com/privaloops)! - Support muxed audio+video HEVC fMP4 (single `audiovideo` track) in the MSE intercept path (hls.js, dash.js), replacing the lot-A refusal.

  - Demuxer extracts the audio track (AudioSpecificConfig + raw AAC frames) alongside the video track.
  - New two-track muxer path (`generateInitAV` / `muxSegmentAV`): a moov with video (`avc1`) + audio (`mp4a`/`esds`) traks and a moof with two traf, so the transcoded H.264 video and the passed-through AAC audio re-mux into one combined A/V segment.
  - The transcoder produces a combined segment when the source init carries an audio track; the intercept advertises the combined `avc1...,mp4a...` mime and creates an A/V proxy instead of refusing.
  - Validated end-to-end: the muxed test stream plays with both video and audio (and in-buffer seeks) through hls.js.

  Scope: the muxed path runs on the main thread (the worker fast path stays video-only), and only AAC audio pass-through is implemented. Muxed segments have more than one traf, so the per-segment tfdt rebase (used for out-of-buffer seeks on video-only streams) doesn't apply — out-of-buffer seeks on muxed streams are untested. The Shaka transmuxer still reports muxed A/V mimes as unsupported (separate integration path — follow-up).

### Patch Changes

- Updated dependencies [[`3751d83`](https://github.com/lid-labs/hevc.js/commit/3751d832ed615885e90630ec7f39ae260677af65), [`6743b5f`](https://github.com/lid-labs/hevc.js/commit/6743b5f5b08f0e8cbceaa8921ef9f40a40f6130d), [`125c1a7`](https://github.com/lid-labs/hevc.js/commit/125c1a7d996e48c60ebbc42779c725153e65d364), [`31aaf6c`](https://github.com/lid-labs/hevc.js/commit/31aaf6c5315cb47f66272814917f8d65f513387f), [`4d09a13`](https://github.com/lid-labs/hevc.js/commit/4d09a13555f15d5f16238b6026fa0223b710af19)]:
  - @hevcjs/core@1.4.0
