# @hevcjs/core

## 1.2.0

### Minor Changes

- [#108](https://github.com/privaloops/hevc.js/pull/108) [`e96f66b`](https://github.com/privaloops/hevc.js/commit/e96f66b48a167ff3ddd9a4cb53885c7dad34c1f6) Thanks [@privaloops](https://github.com/privaloops)! - Add `prepareInit` to the transcode worker protocol.

  `TranscodeWorkerClient` now exposes `prepareInit(data: Uint8Array): Promise<TranscodedInit>` that mirrors `SegmentTranscoder.prepareInit()` but runs inside the Web Worker. The worker handles the new `{ type: "prepareInit", data, id }` message and replies with `{ type: "initPrepared", id, initSegment, codec }` (transferable ArrayBuffer for the H.264 init segment).

  Required to let transmuxer-style plugins (Shaka Player) hand a synthesized H.264 init segment back to the host player before any media segment has been seen, while keeping the actual HEVC decode + warmup-encode off the main thread.

  No breaking change — purely additive on `TranscodeWorkerClient` and the worker message protocol.

- [#107](https://github.com/privaloops/hevc.js/pull/107) [`0e4bb47`](https://github.com/privaloops/hevc.js/commit/0e4bb47fd91c05dcce08e53bd4235d2b7fd31c63) Thanks [@privaloops](https://github.com/privaloops)! - Add Shaka Player support via the new `@hevcjs/shaka-plugin` package.

  `@hevcjs/shaka-plugin` registers a Shaka `Transmuxer` for `hev1`/`hvc1` mime types that decodes HEVC and re-encodes to H.264 fMP4 via `@hevcjs/core`. The transmuxer exposes the standard `isSupported` / `convertCodecs` hooks so Shaka handles MIME routing natively — applications that want to force the transmuxer even on browsers with native HEVC support can use Shaka's built-in `player.configure({ mediaSource: { forceTransmux: true } })`. The `registerHevcTransmuxer(shaka, config)` second argument forwards `wasmUrl` / `wasmBinaryUrl` (and other `SegmentTranscoderConfig` fields) to the underlying decoder, useful when serving the WASM from a custom path or CDN. Set `workerUrl` to route the HEVC decode + H.264 encode pipeline through a Web Worker (off-main-thread) — recommended for 4K and high-bitrate streams. Bumps the package from a no-op skeleton (0.1.0) to first functional release (0.2.0). Tracks [#101](https://github.com/privaloops/hevc.js/issues/101).

  `@hevcjs/core` exposes a new `SegmentTranscoder.prepareInit()` method that processes an HEVC init segment and immediately returns a matching H.264 fMP4 init segment by warming up the encoder with a single black frame. Required by transmuxer plugins that must hand an init segment back to their host player before any media segment has been seen (Shaka 4.x's `Transmuxer.transmux()` contract).
