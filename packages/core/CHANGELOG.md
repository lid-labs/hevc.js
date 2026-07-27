# @hevcjs/core

## 1.3.2

### Patch Changes

- [#186](https://github.com/privaloops/hevc.js/pull/186) [`0852568`](https://github.com/privaloops/hevc.js/commit/085256818fb9e04a9f9924e341d6f1aa57e5ff3f) Thanks [@privaloops](https://github.com/privaloops)! - Fix iPhone Safari: detect native HEVC via ManagedMediaSource and stop crashing when classic MediaSource is absent

  iPhone Safari only exposes `ManagedMediaSource` (iOS 17.1+). The dash.js plugin
  misdetected "no native HEVC support" there, then threw an unhandled
  `ReferenceError` inside `installMSEIntercept`, killing playback before
  `player.initialize()`. Native HEVC detection now checks
  `MediaSource ?? ManagedMediaSource` (new `getMediaSourceConstructor` export),
  and `installMSEIntercept` safely no-ops with a warning when classic
  `MediaSource` is unavailable.

## 1.3.1

### Patch Changes

- [#159](https://github.com/privaloops/hevc.js/pull/159) [`bfab7a0`](https://github.com/privaloops/hevc.js/commit/bfab7a0edf30772b2f4b2fbe5278c229e867e945) Thanks [@privaloops](https://github.com/privaloops)! - Bump the mp4box runtime dependency to ^2.4.1 so published installs pick up the updated demuxer.

## 1.3.0

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

## 1.2.1

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

## 1.2.0

### Minor Changes

- [#108](https://github.com/privaloops/hevc.js/pull/108) [`e96f66b`](https://github.com/privaloops/hevc.js/commit/e96f66b48a167ff3ddd9a4cb53885c7dad34c1f6) Thanks [@privaloops](https://github.com/privaloops)! - Add `prepareInit` to the transcode worker protocol.

  `TranscodeWorkerClient` now exposes `prepareInit(data: Uint8Array): Promise<TranscodedInit>` that mirrors `SegmentTranscoder.prepareInit()` but runs inside the Web Worker. The worker handles the new `{ type: "prepareInit", data, id }` message and replies with `{ type: "initPrepared", id, initSegment, codec }` (transferable ArrayBuffer for the H.264 init segment).

  Required to let transmuxer-style plugins (Shaka Player) hand a synthesized H.264 init segment back to the host player before any media segment has been seen, while keeping the actual HEVC decode + warmup-encode off the main thread.

  No breaking change — purely additive on `TranscodeWorkerClient` and the worker message protocol.

- [#107](https://github.com/privaloops/hevc.js/pull/107) [`0e4bb47`](https://github.com/privaloops/hevc.js/commit/0e4bb47fd91c05dcce08e53bd4235d2b7fd31c63) Thanks [@privaloops](https://github.com/privaloops)! - Add Shaka Player support via the new `@hevcjs/shaka-plugin` package.

  `@hevcjs/shaka-plugin` registers a Shaka `Transmuxer` for `hev1`/`hvc1` mime types that decodes HEVC and re-encodes to H.264 fMP4 via `@hevcjs/core`. The transmuxer exposes the standard `isSupported` / `convertCodecs` hooks so Shaka handles MIME routing natively — applications that want to force the transmuxer even on browsers with native HEVC support can use Shaka's built-in `player.configure({ mediaSource: { forceTransmux: true } })`. The `registerHevcTransmuxer(shaka, config)` second argument forwards `wasmUrl` / `wasmBinaryUrl` (and other `SegmentTranscoderConfig` fields) to the underlying decoder, useful when serving the WASM from a custom path or CDN. Set `workerUrl` to route the HEVC decode + H.264 encode pipeline through a Web Worker (off-main-thread) — recommended for 4K and high-bitrate streams. Bumps the package from a no-op skeleton (0.1.0) to first functional release (0.2.0). Tracks [#101](https://github.com/privaloops/hevc.js/issues/101).

  `@hevcjs/core` exposes a new `SegmentTranscoder.prepareInit()` method that processes an HEVC init segment and immediately returns a matching H.264 fMP4 init segment by warming up the encoder with a single black frame. Required by transmuxer plugins that must hand an init segment back to their host player before any media segment has been seen (Shaka 4.x's `Transmuxer.transmux()` contract).
