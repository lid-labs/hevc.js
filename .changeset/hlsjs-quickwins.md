---
"@hevcjs/hlsjs-plugin": minor
"@hevcjs/core": minor
"@hevcjs/shaka-plugin": patch
---

Muxed A/V refusal and compute-aware ABR for hls.js:

- Core: new `isMuxedHevcMime` helper; the MSE intercept now refuses muxed audio+video HEVC mimes (`isTypeSupported`/`decodingInfo` answer unsupported, `addSourceBuffer` passes through with a loud error) instead of silently dropping the audio track. `HEVC_CODEC_RE` no longer swallows the audio codec after a comma.
- Shaka plugin: the transmuxer reports muxed A/V HEVC mimes as unsupported for the same reason.
- hls.js plugin: `attachHevcSupport` now returns a callable handle with `attachComputeAware(hls)` — compute-aware ABR capping `hls.autoLevelCapping` when the device can't transcode in real time (on by default, `adaptiveCompute: false` to opt out). Warns when `ManagedMediaSource` is present and could bypass the intercept.
