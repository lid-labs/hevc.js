---
"@hevcjs/core": minor
"@hevcjs/hlsjs-plugin": minor
---

Support muxed audio+video HEVC fMP4 (single `audiovideo` track) in the MSE intercept path (hls.js, dash.js), replacing the lot-A refusal.

- Demuxer extracts the audio track (AudioSpecificConfig + raw AAC frames) alongside the video track.
- New two-track muxer path (`generateInitAV` / `muxSegmentAV`): a moov with video (`avc1`) + audio (`mp4a`/`esds`) traks and a moof with two traf, so the transcoded H.264 video and the passed-through AAC audio re-mux into one combined A/V segment.
- The transcoder produces a combined segment when the source init carries an audio track; the intercept advertises the combined `avc1...,mp4a...` mime and creates an A/V proxy instead of refusing.
- Validated end-to-end: the muxed test stream plays with both video and audio (and in-buffer seeks) through hls.js.

Scope: the muxed path runs on the main thread (the worker fast path stays video-only), and only AAC audio pass-through is implemented. Muxed segments have more than one traf, so the per-segment tfdt rebase (used for out-of-buffer seeks on video-only streams) doesn't apply — out-of-buffer seeks on muxed streams are untested. The Shaka transmuxer still reports muxed A/V mimes as unsupported (separate integration path — follow-up).
