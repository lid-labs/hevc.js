# @hevcjs/core

## 1.4.2

### Patch Changes

- [#227](https://github.com/lid-labs/hevc.js/pull/227) [`cd71bce`](https://github.com/lid-labs/hevc.js/commit/cd71bceb80e2458bb57b516348db1422785d2745) Thanks [@privaloops](https://github.com/privaloops)! - Dequantize in 32-bit arithmetic on the common path.

  `perform_dequant` computed every coefficient through `int64_t`, which costs
  noticeably more than 32-bit arithmetic in WebAssembly. It was the second hottest
  function in a WASM profile of 1080p decoding, at 8% of samples.

  The width is only needed for the `<< qpPer` step: `coeff * m * scale` always fits
  in `int32` (at worst 32768 _ 255 _ 72, about 6.0e8). Dividing numerator and
  denominator by 2^qpPer rewrites

      ((X << qpPer) + (1 << (bdShift-1))) >> bdShift

  as `(X + (1 << (s-1))) >> s` with `s = bdShift - qpPer`, which stays in 32 bits.
  `s == 0` degenerates to `X`. When `qpPer > bdShift` — reachable, since `bdShift`
  is as low as 5 for 4x4 at 8-bit while `qpPer` reaches 8 — the original 64-bit
  path still runs.

  Output is byte-identical: the full suite (146 tests, oracle MD5 comparisons
  included) passes, and a build comparing the folded result against the reference
  formula for every coefficient reports no divergence across all fixtures and the
  1080p and 4K streams in full.

  Measured in WASM (emcc 6.0.8, single-threaded, A/B interleaved with the order
  swapped each round to cancel thermal drift): 1080p averages 82.9 -> 86.3 fps,
  about 4%, winning all six rounds.

- [#229](https://github.com/lid-labs/hevc.js/pull/229) [`e30e3e7`](https://github.com/lid-labs/hevc.js/commit/e30e3e79c3c5511f1aa47ec7d7a5299ab2a3e58d) Thanks [@privaloops](https://github.com/privaloops)! - Ship a WASM binary that is actually built from the current sources.

  The published package carries `wasm/hevc-decode.wasm`, a file committed to the
  repository. Nothing kept it in sync: `release.yml` only ran `pnpm build:js`, and
  `build:wasm` copied its output to `packages/core/dist/wasm/` — a directory that
  `tsup` then wiped (`clean: true`) and repopulated from the stale committed copy.
  So even a full `pnpm build` could not update it.

  The binary in 1.4.1 was built in April. Every release since then shipped it,
  including the decoder optimizations announced in 1.4.1 changelogs, none of which
  were in the published artifact.

  Fixed at both ends: `build:wasm` now writes to `packages/core/wasm/`, the source
  of truth, and `release.yml` builds the WASM before publishing.

  The toolchain also moved from emsdk 3.1.51 (late 2023) to 6.0.8, across every
  workflow. Measured on 1080p, A/B with the order swapped each round:

  - 3.1.51: 79.4 / 79.1 / 73.8 / 78.5 fps, 286,695 bytes
  - 6.0.8: 87.1 / 86.1 / 85.8 / 86.0 fps, 267,136 bytes

  That is about 9% faster and 7% smaller with no source change, and the ranges do
  not overlap. 3.1.51 also rejected `HEAPU16` in `EXPORTED_RUNTIME_METHODS`, an
  export the code relies on; 6.0.8 accepts it without warning.

  Verified with 28 end-to-end browser tests (hls.js, dash.js, Shaka, core, native
  playback and bugfix validation), the 146-test C++ suite and the JS unit tests.

  Documented binary size corrected from 236KB to 261KB across the READMEs and the
  site — the previous figure had not matched any shipped build for some time.

- [#230](https://github.com/lid-labs/hevc.js/pull/230) [`9605ca0`](https://github.com/lid-labs/hevc.js/commit/9605ca0795828ba65e8d017bb82f81492c020dc3) Thanks [@privaloops](https://github.com/privaloops)! - Fix two SAO fast-path gates and bound the band-offset table index.

  Follow-ups from a review of the SAO work landed earlier this week.

  **Band offset was gated on neighbourhood uniformity, which does not apply to
  it.** Edge offset reads two neighbours, so it genuinely needs the cross-slice /
  cross-tile check to be provably unnecessary. Band offset (§8.7.3.3) reads no
  neighbour at all, so no such check can ever fire — gating it on `ctbUniform`
  dropped every multi-slice and multi-tile stream onto the slow loop for nothing.
  The two paths now have their own gates.

  **`ctbHasPcmOrBypass` was recomputed once per component.** It scans the CU grid
  on luma coordinates, so all three components get the same answer; it is now
  computed once per CTB, next to the uniformity check it should have accompanied.
  Unexpectedly measurable on the benchmark stream — the guard was being evaluated
  three times per CTB rather than once.

  **The band-offset table was indexed without a bound.** `bandOffs[sample >>
bandShift]` trusted `sample <= maxVal`; the slow loop it replaced was
  structurally immune thanks to its `bandIdx < 4` test. Masking with `& 31` is a
  no-op while the invariant holds and keeps a corrupt plane or an inconsistent
  chroma bit depth from reading past a stack array.

  Output is byte-identical: 146/146 including the oracle MD5 comparisons.

  Measured in WASM (emcc 6.0.8, A/B with the order swapped each round), 1080p:
  78.7 / 81.0 / 81.6 before, 84.5 / 84.5 / 84.4 after.

## 1.4.1

### Patch Changes

- [#222](https://github.com/lid-labs/hevc.js/pull/222) [`24dc3bd`](https://github.com/lid-labs/hevc.js/commit/24dc3bde1e741ceefe11b8695a9ebcaaa1e68ce8) Thanks [@privaloops](https://github.com/privaloops)! - Speed up the SAO in-loop filter in the WASM decoder.

  `apply_sao` ran the cross-slice / cross-tile boundary test for every sample of
  every picture: the guard gating it (`ctx.slice_idx != nullptr`) was always true,
  because the decoder assigns that pointer unconditionally. The test can only
  change the outcome on a one-pixel CTB border, yet every sample paid four integer
  divisions plus the slice-header lookups.

  The neighbourhood is now checked once per CTB. When it is uniform (single slice,
  no tiles, or an interior CTB) and the CTB has no PCM / transquant-bypass CU, the
  edge- and band-offset loops run with no divisions, no per-sample bounds tests and
  no branch on the offset value. Otherwise the original path runs unchanged.

  Decoded output is byte-identical — the full suite (146 tests, including the
  pixel-perfect oracle MD5 comparisons) passes, and a build with bounds assertions
  enabled reports no out-of-range access.

  Measured in WASM (emcc 6.0.8, single-threaded, best of 3 x 3 runs):

  - 1080p, SAO on: 67.0 → 79.7 fps (1.19x)
  - 4K, SAO on: 18.5 → 21.5 fps (1.16x)
  - 1080p, SAO off: unchanged, as expected — the filter does no work on those
    streams, so this optimization does nothing for them

- [#223](https://github.com/lid-labs/hevc.js/pull/223) [`792b489`](https://github.com/lid-labs/hevc.js/commit/792b48949a916434bdeb6755a2f254ed4961a820) Thanks [@privaloops](https://github.com/privaloops)! - Index the CU / intra-mode / CTB grids with shifts instead of integer divisions.

  `cu_at`, `intra_mode_at`, `chroma_mode_at` and the deblocking boundary
  derivations divided sample coordinates by a power-of-two grid size whose value
  is only known at run time, so the compiler could not turn the division into a
  shift. These accessors sit on the hottest paths of the decoder, and WebAssembly
  has no cheap `i32.div_s`.

  All the coordinates involved are non-negative — picture-boundary edges return
  earlier, and the two decremented call sites are guarded — which makes the shift
  exactly equivalent. That precondition is now asserted in the accessors: it costs
  nothing in release builds, and a negative coordinate would otherwise turn a
  harmless truncation into an out-of-bounds index.

  Decoded output is byte-identical: the full suite (146 tests, oracle MD5
  comparisons included) passes, in a release build and in a build with assertions
  enabled.

  Measured in WASM (emcc 6.0.8, single-threaded, best of 3 x 3 runs):

  - 1080p: 79.7 → 85.2 fps (1.07x)
  - 4K: 21.5 → 22.0 fps (1.02x)

  The gain is larger here than the −3 % reported for the same change on native
  x86, which matches the expectation that divisions cost more in WebAssembly.

## 1.4.0

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

- [#209](https://github.com/lid-labs/hevc.js/pull/209) [`3751d83`](https://github.com/lid-labs/hevc.js/commit/3751d832ed615885e90630ec7f39ae260677af65) Thanks [@privaloops](https://github.com/privaloops)! - Fix regex precedence in HEVC codec detection (`/^hev1|hvc1/` matched `hvc1` anywhere in the codec string instead of only at the start) and remove dead code flagged by CodeQL (`transcodeMedia`, `getInitResult`, unused bindings and import).

- [#207](https://github.com/lid-labs/hevc.js/pull/207) [`4d09a13`](https://github.com/lid-labs/hevc.js/commit/4d09a13555f15d5f16238b6026fa0223b710af19) Thanks [@privaloops](https://github.com/privaloops)! - Harden SPS, PPS and slice header parsing against malicious bitstreams: validate picture dimensions against H.265 level 6.2 limits (§A.4.1), block sizes, bit depths, parameter set ids, reference picture set counts and indices, ref list sizes and entry point counts (§7.4.3.2.1, §7.4.3.3.1, §7.4.7.1, §7.4.8) before any allocation, array write or index. Prevents integer overflows in grid allocations, out-of-bounds reads/writes during parse, and attacker-controlled oversized allocations. Rejections are now logged under the PARSE debug category.

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
