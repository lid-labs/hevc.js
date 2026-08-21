# @hevcjs/dashjs-plugin

## 1.1.4

### Patch Changes

- Updated dependencies [[`24dc3bd`](https://github.com/lid-labs/hevc.js/commit/24dc3bde1e741ceefe11b8695a9ebcaaa1e68ce8), [`792b489`](https://github.com/lid-labs/hevc.js/commit/792b48949a916434bdeb6755a2f254ed4961a820)]:
  - @hevcjs/core@1.4.1

## 1.1.3

### Patch Changes

- Updated dependencies [[`3751d83`](https://github.com/lid-labs/hevc.js/commit/3751d832ed615885e90630ec7f39ae260677af65), [`6743b5f`](https://github.com/lid-labs/hevc.js/commit/6743b5f5b08f0e8cbceaa8921ef9f40a40f6130d), [`125c1a7`](https://github.com/lid-labs/hevc.js/commit/125c1a7d996e48c60ebbc42779c725153e65d364), [`31aaf6c`](https://github.com/lid-labs/hevc.js/commit/31aaf6c5315cb47f66272814917f8d65f513387f), [`4d09a13`](https://github.com/lid-labs/hevc.js/commit/4d09a13555f15d5f16238b6026fa0223b710af19)]:
  - @hevcjs/core@1.4.0

## 1.1.2

### Patch Changes

- [#186](https://github.com/privaloops/hevc.js/pull/186) [`0852568`](https://github.com/privaloops/hevc.js/commit/085256818fb9e04a9f9924e341d6f1aa57e5ff3f) Thanks [@privaloops](https://github.com/privaloops)! - Fix iPhone Safari: detect native HEVC via ManagedMediaSource and stop crashing when classic MediaSource is absent

  iPhone Safari only exposes `ManagedMediaSource` (iOS 17.1+). The dash.js plugin
  misdetected "no native HEVC support" there, then threw an unhandled
  `ReferenceError` inside `installMSEIntercept`, killing playback before
  `player.initialize()`. Native HEVC detection now checks
  `MediaSource ?? ManagedMediaSource` (new `getMediaSourceConstructor` export),
  and `installMSEIntercept` safely no-ops with a warning when classic
  `MediaSource` is unavailable.

- Updated dependencies [[`0852568`](https://github.com/privaloops/hevc.js/commit/085256818fb9e04a9f9924e341d6f1aa57e5ff3f)]:
  - @hevcjs/core@1.3.2

## 1.1.1

### Patch Changes

- Updated dependencies [[`bfab7a0`](https://github.com/privaloops/hevc.js/commit/bfab7a0edf30772b2f4b2fbe5278c229e867e945)]:
  - @hevcjs/core@1.3.1

## 1.1.0

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

## 1.0.6

### Patch Changes

- Updated dependencies [[`186b4ce`](https://github.com/privaloops/hevc.js/commit/186b4ce3fa54c347c1aa1d8e5ddf5ca86a5098b1)]:
  - @hevcjs/core@1.2.1

## 1.0.5

### Patch Changes

- Updated dependencies [[`e96f66b`](https://github.com/privaloops/hevc.js/commit/e96f66b48a167ff3ddd9a4cb53885c7dad34c1f6), [`0e4bb47`](https://github.com/privaloops/hevc.js/commit/0e4bb47fd91c05dcce08e53bd4235d2b7fd31c63)]:
  - @hevcjs/core@1.2.0
