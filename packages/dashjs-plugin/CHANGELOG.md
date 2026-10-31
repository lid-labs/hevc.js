# @hevcjs/dashjs-plugin

## 1.1.15

### Patch Changes

- [#372](https://github.com/lid-labs/hevc.js/pull/372) [`16fff82`](https://github.com/lid-labs/hevc.js/commit/16fff829fc4e0155afdbd10346eff7f8ca349da8) Thanks [@privaloops](https://github.com/privaloops)! - Transcode several segments at once. `installMSEIntercept({ poolSize })` keeps up
  to `poolSize` transcode workers, each with its own WASM decoder, so segments
  transcode in parallel while the SourceBuffer is still fed in segment order.
  Default: 2 from four hardware threads up, 1 below; `poolSize: 1` is the previous
  behaviour, one segment at a time.
  
  Measured in Chromium through Playwright on an Apple M4 Pro, 2026-10-30, on the
  30s ABR DASH preset with transcoding forced: time to buffer 28s of media, three
  alternated rounds, 10.6s with one worker against 8.1s with two — 1.31x. The
  whole pipeline does not scale with the pool, since demuxing, the appends and the
  player's own work stay on one thread and the WebCodecs encode was already
  asynchronous.
  
  A segment goes to a second worker only when it starts on an IDR or a BLA
  picture, which resets the decoder by type. A CRA-led (open GOP) segment stays on
  the worker that decoded its predecessor: its RASL pictures reference that
  predecessor, which is in that worker's DPB and in no other, so another worker
  would decode them against unrelated pictures — wrong frames rather than an
  error. Where a stream is segmented that way, the pool therefore has no effect
  rather than a wrong one.
  
  Fixes found while building it:
  
  - Nothing is dispatched while an init segment is being parsed. `initParsed` only
    flips when the parse finishes, so on a re-sent init — an ABR switch — the
    dispatch could hand a media segment to a transcoder in the middle of parsing
    other parameter sets; on the main-thread path that is a reentrant call on the
    one instance parsing them.
  - `TranscodeWorkerClient.processInitSegment()` waits for the init segment it was
    given. It returned the promise a previous init had already resolved, so a
    re-sent init came back before the worker had seen the message, and a caller
    that awaited it was told the new parameter sets were parsed when they were not.
  
  - `TranscodeWorkerClient.abort()` no longer restarts its segment id count. The
    worker can still be inside a streaming segment when the abort reaches it, and
    a late `streamingDone` from the abandoned segment matched the handler of a new
    segment that had been given the same id, resolving it before its data had
    arrived. Ids stay monotonic, so a late message matches nothing.
  - `@hevcjs/dashjs-plugin` forwards `logLevel` and `poolSize` to the intercept.
    `logLevel` was accepted and dropped before, so the documented option did
    nothing on that plugin.
- Updated dependencies [[`aeaca00`](https://github.com/lid-labs/hevc.js/commit/aeaca00476718082cbc1c015255b771f1bfd1db9), [`4019420`](https://github.com/lid-labs/hevc.js/commit/40194201645bc3124be980b4294fc60855902953), [`f26d42f`](https://github.com/lid-labs/hevc.js/commit/f26d42f0ff33a7df53c4299e758cf28d8583f1ff), [`aa43064`](https://github.com/lid-labs/hevc.js/commit/aa430646d070fec3cdea4cc4884003c3b3548b83), [`0bc5147`](https://github.com/lid-labs/hevc.js/commit/0bc5147f114d798e802d0355907cda3697b2f630), [`ed384b8`](https://github.com/lid-labs/hevc.js/commit/ed384b8186195310b43820384b22007b4f685279), [`16fff82`](https://github.com/lid-labs/hevc.js/commit/16fff829fc4e0155afdbd10346eff7f8ca349da8), [`eb2a753`](https://github.com/lid-labs/hevc.js/commit/eb2a753d0695a42142ac808631dbc99bd0a93c2b)]:
  - @hevcjs/core@1.7.0

## 1.1.14

### Patch Changes

- Updated dependencies [[`e922213`](https://github.com/lid-labs/hevc.js/commit/e92221374d0061885d9c3c10480b5298b7d5364e), [`87bb5a8`](https://github.com/lid-labs/hevc.js/commit/87bb5a82604d474b0cf20ecd0f3493e49e2424e9), [`c847fed`](https://github.com/lid-labs/hevc.js/commit/c847fed4b36f4828f48b19c8b3b6151fb5858fcd), [`efd3868`](https://github.com/lid-labs/hevc.js/commit/efd386812320650d9265cea26fc114be6141e5bf), [`05fdae1`](https://github.com/lid-labs/hevc.js/commit/05fdae1a88ae37cdc0c1a212a9ccec96daef6e2e), [`9e46057`](https://github.com/lid-labs/hevc.js/commit/9e460573797de74c7798857c291827de94955c45), [`141b358`](https://github.com/lid-labs/hevc.js/commit/141b358dc6f2626376b862d8d9be5d9c7931edd8), [`267b7ef`](https://github.com/lid-labs/hevc.js/commit/267b7ef421285312f607aa19b530bfb8d22aed0f), [`c5820d7`](https://github.com/lid-labs/hevc.js/commit/c5820d79227df4c62cf4d62a04d677f8e1243c3a), [`8ebcfb1`](https://github.com/lid-labs/hevc.js/commit/8ebcfb1840cd3677e29def2f2d54312aa9cefd04), [`2a60790`](https://github.com/lid-labs/hevc.js/commit/2a60790756335790d654305b71f67832803e9236), [`4174a7e`](https://github.com/lid-labs/hevc.js/commit/4174a7eb9d845f2c36ce09b0732579b3f8a1e327), [`aa242a8`](https://github.com/lid-labs/hevc.js/commit/aa242a814001274559e6bbab0256ff3695d97b40), [`58e4e5d`](https://github.com/lid-labs/hevc.js/commit/58e4e5dad6a19c2239ec12e790dfac6ac1c39ae0), [`c8100e6`](https://github.com/lid-labs/hevc.js/commit/c8100e6ff39b963dd4a04bfb1b9763397131b6d1), [`770eb45`](https://github.com/lid-labs/hevc.js/commit/770eb45440252a0a6c0db6d7ccc3a61054522d6c), [`d3a0ebf`](https://github.com/lid-labs/hevc.js/commit/d3a0ebf60c2b8b742ff64502dd415cfa5e07a7a3), [`5b23efa`](https://github.com/lid-labs/hevc.js/commit/5b23efafd382c54126e8c823d2c63f9fecf0803d)]:
  - @hevcjs/core@1.6.0

## 1.1.13

### Patch Changes

- [#286](https://github.com/lid-labs/hevc.js/pull/286) [`43d1e25`](https://github.com/lid-labs/hevc.js/commit/43d1e25526afea7690020ffe3bf088db597da48b) Thanks [@privaloops](https://github.com/privaloops)! - Compute-aware decider: new `reason: "floor"` when decoding runs below real time but the player is already on the lowest variant, so there is nothing to cap to. It used to report `hold`, which looked the same as a feedback loop that never reacted. No cap is applied on `floor`. Code that switches exhaustively on `reason` needs a case for it; the plugins' `onObservation` now takes the core's `ComputeAwareDecision["reason"]` type.

- Updated dependencies [[`43d1e25`](https://github.com/lid-labs/hevc.js/commit/43d1e25526afea7690020ffe3bf088db597da48b)]:
  - @hevcjs/core@1.5.0

## 1.1.12

### Patch Changes

- [#281](https://github.com/lid-labs/hevc.js/pull/281) [`cbe7dd2`](https://github.com/lid-labs/hevc.js/commit/cbe7dd26fe462bdfa17234ef1f0df2a14d23035e) Thanks [@privaloops](https://github.com/privaloops)! - Published through npm trusted publishing (OIDC) instead of a stored token, so each release now carries an npm provenance attestation linking it to the GitHub Actions run that built it. No code change.

- Updated dependencies [[`cbe7dd2`](https://github.com/lid-labs/hevc.js/commit/cbe7dd26fe462bdfa17234ef1f0df2a14d23035e)]:
  - @hevcjs/core@1.4.9

## 1.1.11

### Patch Changes

- Updated dependencies [[`1efc4c6`](https://github.com/lid-labs/hevc.js/commit/1efc4c60535fc15647a6158397ff0c6836226d49)]:
  - @hevcjs/core@1.4.8

## 1.1.10

### Patch Changes

- Updated dependencies [[`6489a92`](https://github.com/lid-labs/hevc.js/commit/6489a929b583ddd73e2af4a50f9603f1c6f3d411)]:
  - @hevcjs/core@1.4.7

## 1.1.9

### Patch Changes

- Updated dependencies [[`f768c61`](https://github.com/lid-labs/hevc.js/commit/f768c6158c0764ab91b313b43594ad5943340872), [`b3e5fd7`](https://github.com/lid-labs/hevc.js/commit/b3e5fd73b0bf9d3dff24140a4a6bc21961f57ab5), [`1650d55`](https://github.com/lid-labs/hevc.js/commit/1650d557b9e755e3c2f4195fb2d9438237a331e2), [`b3e5fd7`](https://github.com/lid-labs/hevc.js/commit/b3e5fd73b0bf9d3dff24140a4a6bc21961f57ab5)]:
  - @hevcjs/core@1.4.6

## 1.1.8

### Patch Changes

- Updated dependencies [[`a7b91aa`](https://github.com/lid-labs/hevc.js/commit/a7b91aac413102c7d8843d95df4629bffc3f4442)]:
  - @hevcjs/core@1.4.5

## 1.1.7

### Patch Changes

- Updated dependencies [[`486261b`](https://github.com/lid-labs/hevc.js/commit/486261b042d0acfc758651fa3bcea4c171ebec12)]:
  - @hevcjs/core@1.4.4

## 1.1.6

### Patch Changes

- Updated dependencies [[`dc16558`](https://github.com/lid-labs/hevc.js/commit/dc165583d967a700de6574b64b9221186dcc86f6)]:
  - @hevcjs/core@1.4.3

## 1.1.5

### Patch Changes

- Updated dependencies [[`cd71bce`](https://github.com/lid-labs/hevc.js/commit/cd71bceb80e2458bb57b516348db1422785d2745), [`e30e3e7`](https://github.com/lid-labs/hevc.js/commit/e30e3e79c3c5511f1aa47ec7d7a5299ab2a3e58d), [`9605ca0`](https://github.com/lid-labs/hevc.js/commit/9605ca0795828ba65e8d017bb82f81492c020dc3)]:
  - @hevcjs/core@1.4.2

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
