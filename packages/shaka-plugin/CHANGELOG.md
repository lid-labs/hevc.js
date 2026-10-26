# @hevcjs/shaka-plugin

## 0.5.5

### Patch Changes

- Updated dependencies [[`e922213`](https://github.com/lid-labs/hevc.js/commit/e92221374d0061885d9c3c10480b5298b7d5364e), [`87bb5a8`](https://github.com/lid-labs/hevc.js/commit/87bb5a82604d474b0cf20ecd0f3493e49e2424e9), [`c847fed`](https://github.com/lid-labs/hevc.js/commit/c847fed4b36f4828f48b19c8b3b6151fb5858fcd), [`efd3868`](https://github.com/lid-labs/hevc.js/commit/efd386812320650d9265cea26fc114be6141e5bf), [`05fdae1`](https://github.com/lid-labs/hevc.js/commit/05fdae1a88ae37cdc0c1a212a9ccec96daef6e2e), [`9e46057`](https://github.com/lid-labs/hevc.js/commit/9e460573797de74c7798857c291827de94955c45), [`141b358`](https://github.com/lid-labs/hevc.js/commit/141b358dc6f2626376b862d8d9be5d9c7931edd8), [`267b7ef`](https://github.com/lid-labs/hevc.js/commit/267b7ef421285312f607aa19b530bfb8d22aed0f), [`c5820d7`](https://github.com/lid-labs/hevc.js/commit/c5820d79227df4c62cf4d62a04d677f8e1243c3a), [`8ebcfb1`](https://github.com/lid-labs/hevc.js/commit/8ebcfb1840cd3677e29def2f2d54312aa9cefd04), [`2a60790`](https://github.com/lid-labs/hevc.js/commit/2a60790756335790d654305b71f67832803e9236), [`4174a7e`](https://github.com/lid-labs/hevc.js/commit/4174a7eb9d845f2c36ce09b0732579b3f8a1e327), [`aa242a8`](https://github.com/lid-labs/hevc.js/commit/aa242a814001274559e6bbab0256ff3695d97b40), [`58e4e5d`](https://github.com/lid-labs/hevc.js/commit/58e4e5dad6a19c2239ec12e790dfac6ac1c39ae0), [`c8100e6`](https://github.com/lid-labs/hevc.js/commit/c8100e6ff39b963dd4a04bfb1b9763397131b6d1), [`770eb45`](https://github.com/lid-labs/hevc.js/commit/770eb45440252a0a6c0db6d7ccc3a61054522d6c), [`d3a0ebf`](https://github.com/lid-labs/hevc.js/commit/d3a0ebf60c2b8b742ff64502dd415cfa5e07a7a3), [`5b23efa`](https://github.com/lid-labs/hevc.js/commit/5b23efafd382c54126e8c823d2c63f9fecf0803d)]:
  - @hevcjs/core@1.6.0

## 0.5.4

### Patch Changes

- [#286](https://github.com/lid-labs/hevc.js/pull/286) [`43d1e25`](https://github.com/lid-labs/hevc.js/commit/43d1e25526afea7690020ffe3bf088db597da48b) Thanks [@privaloops](https://github.com/privaloops)! - Compute-aware decider: new `reason: "floor"` when decoding runs below real time but the player is already on the lowest variant, so there is nothing to cap to. It used to report `hold`, which looked the same as a feedback loop that never reacted. No cap is applied on `floor`. Code that switches exhaustively on `reason` needs a case for it; the plugins' `onObservation` now takes the core's `ComputeAwareDecision["reason"]` type.

- Updated dependencies [[`43d1e25`](https://github.com/lid-labs/hevc.js/commit/43d1e25526afea7690020ffe3bf088db597da48b)]:
  - @hevcjs/core@1.5.0

## 0.5.3

### Patch Changes

- [#281](https://github.com/lid-labs/hevc.js/pull/281) [`cbe7dd2`](https://github.com/lid-labs/hevc.js/commit/cbe7dd26fe462bdfa17234ef1f0df2a14d23035e) Thanks [@privaloops](https://github.com/privaloops)! - Published through npm trusted publishing (OIDC) instead of a stored token, so each release now carries an npm provenance attestation linking it to the GitHub Actions run that built it. No code change.

- Updated dependencies [[`cbe7dd2`](https://github.com/lid-labs/hevc.js/commit/cbe7dd26fe462bdfa17234ef1f0df2a14d23035e)]:
  - @hevcjs/core@1.4.9

## 0.5.2

### Patch Changes

- Updated dependencies [[`1efc4c6`](https://github.com/lid-labs/hevc.js/commit/1efc4c60535fc15647a6158397ff0c6836226d49)]:
  - @hevcjs/core@1.4.8

## 0.5.1

### Patch Changes

- Updated dependencies [[`6489a92`](https://github.com/lid-labs/hevc.js/commit/6489a929b583ddd73e2af4a50f9603f1c6f3d411)]:
  - @hevcjs/core@1.4.7

## 0.5.0

### Minor Changes

- [#266](https://github.com/lid-labs/hevc.js/pull/266) [`759b8b8`](https://github.com/lid-labs/hevc.js/commit/759b8b83cb93efba7aba7726ee380850c62c4286) Thanks [@privaloops](https://github.com/privaloops)! - New `recommendedPlayerConfig()`, which returns the buffer depth
  `recommendedBufferConfig()` already carried plus `abr.switchInterval: 2`.

  Shaka honours the compute-aware cap's `abr.restrictions` at its next ABR
  decision, and declines to take one while `abr.switchInterval` has not elapsed —
  8s by default. A cap that fired on time therefore sat unapplied for several
  segments, each transcoded at the resolution the cap had just rejected. Measured
  against one deployment on a device transcoding at ~0.4x, six runs per setting:
  the played variant obeyed the cap after 9.3-9.9s at 8, against 3.3-6.9s at 2.

  The plugin does not apply this itself: `switchInterval` governs network-driven
  ABR too, so it stays the application's call. `attachComputeAware` takes a
  `switchInterval` option for callers who would rather it set the value, and only
  ever lowers it. `recommendedBufferConfig()` is deprecated in favour of the new
  function and is otherwise unchanged, so existing callers keep exactly what they
  had.

### Patch Changes

- Updated dependencies [[`f768c61`](https://github.com/lid-labs/hevc.js/commit/f768c6158c0764ab91b313b43594ad5943340872), [`b3e5fd7`](https://github.com/lid-labs/hevc.js/commit/b3e5fd73b0bf9d3dff24140a4a6bc21961f57ab5), [`1650d55`](https://github.com/lid-labs/hevc.js/commit/1650d557b9e755e3c2f4195fb2d9438237a331e2), [`b3e5fd7`](https://github.com/lid-labs/hevc.js/commit/b3e5fd73b0bf9d3dff24140a4a6bc21961f57ab5)]:
  - @hevcjs/core@1.4.6

## 0.4.2

### Patch Changes

- Updated dependencies [[`a7b91aa`](https://github.com/lid-labs/hevc.js/commit/a7b91aac413102c7d8843d95df4629bffc3f4442)]:
  - @hevcjs/core@1.4.5

## 0.4.1

### Patch Changes

- Updated dependencies [[`486261b`](https://github.com/lid-labs/hevc.js/commit/486261b042d0acfc758651fa3bcea4c171ebec12)]:
  - @hevcjs/core@1.4.4

## 0.4.0

### Minor Changes

- [#245](https://github.com/lid-labs/hevc.js/pull/245) [`d556420`](https://github.com/lid-labs/hevc.js/commit/d5564202831b4c5ec61848354bcb68c9dbef13c9) Thanks [@privaloops](https://github.com/privaloops)! - Add `recommendedBufferConfig()`, buffer settings for HEVC playback through the transmuxer.

  Shaka 4.x's `Transmuxer.transmux()` returns one `Uint8Array` per segment, so the buffered range grows in whole-segment jumps. Where WASM transcoding runs near real time, the playback head skirts the edge of that range and playback stutters in a few-second rhythm — contiguous buffer, nothing out of spec, but visible. The dash.js path does not show it, because it appends transcoded chunks to MSE progressively.

  `player.configure(recommendedBufferConfig())` raises `bufferingGoal` to 30s, against Shaka's default of 10, so a slower-than-real-time stretch drains the buffer instead of stalling playback. It returns a config fragment rather than applying itself: the plugin is handed `shaka`, not the player, and silently rewriting a player's configuration would be a surprise.

  `rebufferingGoal` is deliberately left alone. It decides whether Shaka gates playback on buffer depth at all, and defaults to 0 on Shaka 5 — the buffer poller never starts and the playback rate is never held back. Raising it would switch that on, so a device transcoding at around real time would freeze until the goal was re-accumulated: a longer stall than the stutter being fixed.

  Headroom, not a cure — see the README's "Performance & tuning" section for what else helps when `speedX` stays below 1.

### Patch Changes

- Updated dependencies [[`dc16558`](https://github.com/lid-labs/hevc.js/commit/dc165583d967a700de6574b64b9221186dcc86f6)]:
  - @hevcjs/core@1.4.3

## 0.3.5

### Patch Changes

- Updated dependencies [[`cd71bce`](https://github.com/lid-labs/hevc.js/commit/cd71bceb80e2458bb57b516348db1422785d2745), [`e30e3e7`](https://github.com/lid-labs/hevc.js/commit/e30e3e79c3c5511f1aa47ec7d7a5299ab2a3e58d), [`9605ca0`](https://github.com/lid-labs/hevc.js/commit/9605ca0795828ba65e8d017bb82f81492c020dc3)]:
  - @hevcjs/core@1.4.2

## 0.3.4

### Patch Changes

- Updated dependencies [[`24dc3bd`](https://github.com/lid-labs/hevc.js/commit/24dc3bde1e741ceefe11b8695a9ebcaaa1e68ce8), [`792b489`](https://github.com/lid-labs/hevc.js/commit/792b48949a916434bdeb6755a2f254ed4961a820)]:
  - @hevcjs/core@1.4.1

## 0.3.3

### Patch Changes

- [#216](https://github.com/lid-labs/hevc.js/pull/216) [`125c1a7`](https://github.com/lid-labs/hevc.js/commit/125c1a7d996e48c60ebbc42779c725153e65d364) Thanks [@privaloops](https://github.com/privaloops)! - Muxed A/V refusal and compute-aware ABR for hls.js:

  - Core (**behavior change**): the MSE intercept now refuses muxed audio+video HEVC mimes (an HEVC codec alongside an audio codec in the same `codecs` list, e.g. `"hvc1...,mp4a.40.2"`) instead of intercepting the video-only path and silently dropping the audio track. `isTypeSupported`/`decodingInfo` answer unsupported so players that probe the combined mime (dash.js) filter these renditions upfront; `addSourceBuffer` passes the mime through with a loud error for players that probe codecs separately (hls.js). Previously such a mime reported supported and played without audio. New `isMuxedHevcMime` export; `HEVC_CODEC_RE` no longer swallows the audio codec after a comma. `@hevcjs/dashjs-plugin` inherits this refusal through its core dependency bump.
  - Shaka plugin: the transmuxer reports muxed A/V HEVC mimes as unsupported for the same reason.
  - hls.js plugin: `attachHevcSupport` now returns a callable handle with `attachComputeAware(hls)` — compute-aware ABR capping `hls.autoLevelCapping` when the device can't transcode in real time (on by default, `adaptiveCompute: false` to opt out). Warns when `ManagedMediaSource` is present and could bypass the intercept.

- Updated dependencies [[`3751d83`](https://github.com/lid-labs/hevc.js/commit/3751d832ed615885e90630ec7f39ae260677af65), [`6743b5f`](https://github.com/lid-labs/hevc.js/commit/6743b5f5b08f0e8cbceaa8921ef9f40a40f6130d), [`125c1a7`](https://github.com/lid-labs/hevc.js/commit/125c1a7d996e48c60ebbc42779c725153e65d364), [`31aaf6c`](https://github.com/lid-labs/hevc.js/commit/31aaf6c5315cb47f66272814917f8d65f513387f), [`4d09a13`](https://github.com/lid-labs/hevc.js/commit/4d09a13555f15d5f16238b6026fa0223b710af19)]:
  - @hevcjs/core@1.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [[`0852568`](https://github.com/privaloops/hevc.js/commit/085256818fb9e04a9f9924e341d6f1aa57e5ff3f)]:
  - @hevcjs/core@1.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [[`bfab7a0`](https://github.com/privaloops/hevc.js/commit/bfab7a0edf30772b2f4b2fbe5278c229e867e945)]:
  - @hevcjs/core@1.3.1

## 0.3.0

### Minor Changes

- [#137](https://github.com/privaloops/hevc.js/pull/137) [`6c2bf32`](https://github.com/privaloops/hevc.js/commit/6c2bf32c7ae704a9f341d95a407bb58313dee955) Thanks [@privaloops](https://github.com/privaloops)! - Add compute-aware ABR feedback for the Shaka and dash.js plugins. **On by default.**

  Mainstream player ABR algorithms pick a variant from network bandwidth
  alone — in a normal pipeline, fetch + parse + MSE append is essentially
  free compared to the network. With these plugins we add a real
  client-side cost: WASM HEVC decode + WebCodecs H.264 encode. A variant
  can be perfectly reachable from a bandwidth standpoint and still saturate
  the device's transcode budget, draining the buffer without the ABR
  algorithm ever noticing.

  This release adds a player-agnostic decider in `@hevcjs/core`
  (`ComputeAwareDecider`) plus a perf bus (`subscribeSegmentStat`) the
  transcoder publishes to after each segment. Both plugins ship an adapter
  that subscribes to the bus and narrows the variants the host ABR is
  allowed to choose from — via Shaka's
  `player.configure({ abr: { restrictions } })` and dash.js's
  `player.updateSettings({ streaming: { abr: { maxBitrate } } })`. The
  host ABR controller is never replaced.

  Usage (Shaka — needs an extra `attachComputeAware(player)` because the
  player doesn't exist at registration time):

  ```js
  // On by default.
  const handle = registerHevcTransmuxer(shaka, { wasmUrl, workerUrl });
  const player = new shaka.Player();
  handle.attachComputeAware(player);
  // To tune: { adaptiveCompute: { targetSpeedX: 1.5, lowerAfter: 1 } }
  // To opt out: { adaptiveCompute: false }
  ```

  Usage (dash.js — wires directly, the player is already available):

  ```js
  // On by default.
  await attachHevcSupport(player, { wasmUrl, workerUrl });
  // To tune:    { adaptiveCompute: { targetSpeedX: 1.5 } }
  // To opt out: { adaptiveCompute: false }
  ```

  The Shaka handle remains callable for backwards compatibility
  (`handle()` still unregisters the transmuxer), with `unregister()` /
  `attachComputeAware(player)` exposed as methods on the same handle.

  Both plugins now also re-export `subscribeSegmentStat` and
  `SegmentPerfStat` from `@hevcjs/core` so consumers can plug their own
  telemetry on the perf bus without a separate `@hevcjs/core` dependency.

  Closes [#127](https://github.com/privaloops/hevc.js/issues/127).

### Patch Changes

- Updated dependencies [[`6c2bf32`](https://github.com/privaloops/hevc.js/commit/6c2bf32c7ae704a9f341d95a407bb58313dee955)]:
  - @hevcjs/core@1.3.0

## 0.2.2

### Patch Changes

- [#124](https://github.com/privaloops/hevc.js/pull/124) [`186b4ce`](https://github.com/privaloops/hevc.js/commit/186b4ce3fa54c347c1aa1d8e5ddf5ca86a5098b1) Thanks [@privaloops](https://github.com/privaloops)! - Fix Shaka Player playback stalls on HEVC streams with ABR.

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

- Updated dependencies [[`186b4ce`](https://github.com/privaloops/hevc.js/commit/186b4ce3fa54c347c1aa1d8e5ddf5ca86a5098b1)]:
  - @hevcjs/core@1.2.1

## 0.2.1

### Patch Changes

- [#120](https://github.com/privaloops/hevc.js/pull/120) [`dd576f4`](https://github.com/privaloops/hevc.js/commit/dd576f4f0b2465ec7cf7fb63b5047bc98de81233) Thanks [@privaloops](https://github.com/privaloops)! - Fix outdated README that still described the package as an experimental
  skeleton with HEVC → H.264 conversion as a TODO. The transmuxer has been
  fully functional since 0.2.0; the README now reflects the shipped behavior.

## 0.2.0

### Minor Changes

- [#107](https://github.com/privaloops/hevc.js/pull/107) [`0e4bb47`](https://github.com/privaloops/hevc.js/commit/0e4bb47fd91c05dcce08e53bd4235d2b7fd31c63) Thanks [@privaloops](https://github.com/privaloops)! - Add Shaka Player support via the new `@hevcjs/shaka-plugin` package.

  `@hevcjs/shaka-plugin` registers a Shaka `Transmuxer` for `hev1`/`hvc1` mime types that decodes HEVC and re-encodes to H.264 fMP4 via `@hevcjs/core`. The transmuxer exposes the standard `isSupported` / `convertCodecs` hooks so Shaka handles MIME routing natively — applications that want to force the transmuxer even on browsers with native HEVC support can use Shaka's built-in `player.configure({ mediaSource: { forceTransmux: true } })`. The `registerHevcTransmuxer(shaka, config)` second argument forwards `wasmUrl` / `wasmBinaryUrl` (and other `SegmentTranscoderConfig` fields) to the underlying decoder, useful when serving the WASM from a custom path or CDN. Set `workerUrl` to route the HEVC decode + H.264 encode pipeline through a Web Worker (off-main-thread) — recommended for 4K and high-bitrate streams. Bumps the package from a no-op skeleton (0.1.0) to first functional release (0.2.0). Tracks [#101](https://github.com/privaloops/hevc.js/issues/101).

  `@hevcjs/core` exposes a new `SegmentTranscoder.prepareInit()` method that processes an HEVC init segment and immediately returns a matching H.264 fMP4 init segment by warming up the encoder with a single black frame. Required by transmuxer plugins that must hand an init segment back to their host player before any media segment has been seen (Shaka 4.x's `Transmuxer.transmux()` contract).

### Patch Changes

- Updated dependencies [[`e96f66b`](https://github.com/privaloops/hevc.js/commit/e96f66b48a167ff3ddd9a4cb53885c7dad34c1f6), [`0e4bb47`](https://github.com/privaloops/hevc.js/commit/0e4bb47fd91c05dcce08e53bd4235d2b7fd31c63)]:
  - @hevcjs/core@1.2.0
