# @hevcjs/hlsjs-plugin

## 0.1.11

### Patch Changes

- Updated dependencies [[`e922213`](https://github.com/lid-labs/hevc.js/commit/e92221374d0061885d9c3c10480b5298b7d5364e), [`87bb5a8`](https://github.com/lid-labs/hevc.js/commit/87bb5a82604d474b0cf20ecd0f3493e49e2424e9), [`c847fed`](https://github.com/lid-labs/hevc.js/commit/c847fed4b36f4828f48b19c8b3b6151fb5858fcd), [`efd3868`](https://github.com/lid-labs/hevc.js/commit/efd386812320650d9265cea26fc114be6141e5bf), [`05fdae1`](https://github.com/lid-labs/hevc.js/commit/05fdae1a88ae37cdc0c1a212a9ccec96daef6e2e), [`9e46057`](https://github.com/lid-labs/hevc.js/commit/9e460573797de74c7798857c291827de94955c45), [`141b358`](https://github.com/lid-labs/hevc.js/commit/141b358dc6f2626376b862d8d9be5d9c7931edd8), [`267b7ef`](https://github.com/lid-labs/hevc.js/commit/267b7ef421285312f607aa19b530bfb8d22aed0f), [`c5820d7`](https://github.com/lid-labs/hevc.js/commit/c5820d79227df4c62cf4d62a04d677f8e1243c3a), [`8ebcfb1`](https://github.com/lid-labs/hevc.js/commit/8ebcfb1840cd3677e29def2f2d54312aa9cefd04), [`2a60790`](https://github.com/lid-labs/hevc.js/commit/2a60790756335790d654305b71f67832803e9236), [`4174a7e`](https://github.com/lid-labs/hevc.js/commit/4174a7eb9d845f2c36ce09b0732579b3f8a1e327), [`aa242a8`](https://github.com/lid-labs/hevc.js/commit/aa242a814001274559e6bbab0256ff3695d97b40), [`58e4e5d`](https://github.com/lid-labs/hevc.js/commit/58e4e5dad6a19c2239ec12e790dfac6ac1c39ae0), [`c8100e6`](https://github.com/lid-labs/hevc.js/commit/c8100e6ff39b963dd4a04bfb1b9763397131b6d1), [`770eb45`](https://github.com/lid-labs/hevc.js/commit/770eb45440252a0a6c0db6d7ccc3a61054522d6c), [`d3a0ebf`](https://github.com/lid-labs/hevc.js/commit/d3a0ebf60c2b8b742ff64502dd415cfa5e07a7a3), [`5b23efa`](https://github.com/lid-labs/hevc.js/commit/5b23efafd382c54126e8c823d2c63f9fecf0803d)]:
  - @hevcjs/core@1.6.0

## 0.1.10

### Patch Changes

- [#286](https://github.com/lid-labs/hevc.js/pull/286) [`43d1e25`](https://github.com/lid-labs/hevc.js/commit/43d1e25526afea7690020ffe3bf088db597da48b) Thanks [@privaloops](https://github.com/privaloops)! - Compute-aware decider: new `reason: "floor"` when decoding runs below real time but the player is already on the lowest variant, so there is nothing to cap to. It used to report `hold`, which looked the same as a feedback loop that never reacted. No cap is applied on `floor`. Code that switches exhaustively on `reason` needs a case for it; the plugins' `onObservation` now takes the core's `ComputeAwareDecision["reason"]` type.

- Updated dependencies [[`43d1e25`](https://github.com/lid-labs/hevc.js/commit/43d1e25526afea7690020ffe3bf088db597da48b)]:
  - @hevcjs/core@1.5.0

## 0.1.9

### Patch Changes

- [#281](https://github.com/lid-labs/hevc.js/pull/281) [`cbe7dd2`](https://github.com/lid-labs/hevc.js/commit/cbe7dd26fe462bdfa17234ef1f0df2a14d23035e) Thanks [@privaloops](https://github.com/privaloops)! - Published through npm trusted publishing (OIDC) instead of a stored token, so each release now carries an npm provenance attestation linking it to the GitHub Actions run that built it. No code change.

- Updated dependencies [[`cbe7dd2`](https://github.com/lid-labs/hevc.js/commit/cbe7dd26fe462bdfa17234ef1f0df2a14d23035e)]:
  - @hevcjs/core@1.4.9

## 0.1.8

### Patch Changes

- Updated dependencies [[`1efc4c6`](https://github.com/lid-labs/hevc.js/commit/1efc4c60535fc15647a6158397ff0c6836226d49)]:
  - @hevcjs/core@1.4.8

## 0.1.7

### Patch Changes

- Updated dependencies [[`6489a92`](https://github.com/lid-labs/hevc.js/commit/6489a929b583ddd73e2af4a50f9603f1c6f3d411)]:
  - @hevcjs/core@1.4.7

## 0.1.6

### Patch Changes

- Updated dependencies [[`f768c61`](https://github.com/lid-labs/hevc.js/commit/f768c6158c0764ab91b313b43594ad5943340872), [`b3e5fd7`](https://github.com/lid-labs/hevc.js/commit/b3e5fd73b0bf9d3dff24140a4a6bc21961f57ab5), [`1650d55`](https://github.com/lid-labs/hevc.js/commit/1650d557b9e755e3c2f4195fb2d9438237a331e2), [`b3e5fd7`](https://github.com/lid-labs/hevc.js/commit/b3e5fd73b0bf9d3dff24140a4a6bc21961f57ab5)]:
  - @hevcjs/core@1.4.6

## 0.1.5

### Patch Changes

- Updated dependencies [[`a7b91aa`](https://github.com/lid-labs/hevc.js/commit/a7b91aac413102c7d8843d95df4629bffc3f4442)]:
  - @hevcjs/core@1.4.5

## 0.1.4

### Patch Changes

- Updated dependencies [[`486261b`](https://github.com/lid-labs/hevc.js/commit/486261b042d0acfc758651fa3bcea4c171ebec12)]:
  - @hevcjs/core@1.4.4

## 0.1.3

### Patch Changes

- Updated dependencies [[`dc16558`](https://github.com/lid-labs/hevc.js/commit/dc165583d967a700de6574b64b9221186dcc86f6)]:
  - @hevcjs/core@1.4.3

## 0.1.2

### Patch Changes

- Updated dependencies [[`cd71bce`](https://github.com/lid-labs/hevc.js/commit/cd71bceb80e2458bb57b516348db1422785d2745), [`e30e3e7`](https://github.com/lid-labs/hevc.js/commit/e30e3e79c3c5511f1aa47ec7d7a5299ab2a3e58d), [`9605ca0`](https://github.com/lid-labs/hevc.js/commit/9605ca0795828ba65e8d017bb82f81492c020dc3)]:
  - @hevcjs/core@1.4.2

## 0.1.1

### Patch Changes

- [#225](https://github.com/lid-labs/hevc.js/pull/225) [`cd48c45`](https://github.com/lid-labs/hevc.js/commit/cd48c451531a55790d392aa8ef873c9310ec0089) Thanks [@privaloops](https://github.com/privaloops)! - Fix the documented hls.js setup breaking playback on iPhone Safari.

  The README, the site docs and the demo all recommended constructing hls.js with
  an unconditional `preferManagedMediaSource: false`. That is right wherever
  classic `MediaSource` exists, but iPhone Safari exposes only
  `ManagedMediaSource`: pinning classic MSE there leaves hls.js with no
  MediaSource at all and playback fails outright, in every mode — not just when
  transcoding is forced. dash.js and Shaka were unaffected because nothing told
  them to avoid `ManagedMediaSource`.

  The snippet is now guarded:

  ```js
  const hls = new Hls({
    ...(typeof MediaSource !== "undefined"
      ? { preferManagedMediaSource: false }
      : {}),
  });
  ```

  The claim that "browsers where only ManagedMediaSource exists play HEVC
  natively, so nothing is lost there" was wrong as written: that holds only if
  hls.js is left on its default. The plugin's own warning now prints the guarded
  snippet instead of advice that invites the mistake.

  Transcoding still does not run on iPhone Safari — the intercept patches classic
  `MediaSource`, which is absent there — but playback now falls back to native
  HEVC decoding instead of failing.

- Updated dependencies [[`24dc3bd`](https://github.com/lid-labs/hevc.js/commit/24dc3bde1e741ceefe11b8695a9ebcaaa1e68ce8), [`792b489`](https://github.com/lid-labs/hevc.js/commit/792b48949a916434bdeb6755a2f254ed4961a820)]:
  - @hevcjs/core@1.4.1

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
