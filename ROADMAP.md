# Roadmap

What's coming next, roughly in priority order. Open a
[Discussion](https://github.com/lid-labs/hevc.js/discussions) or an issue if
you'd like to influence it — real-world usage reports carry the most weight.

Open issues carry a priority label, which is the finer-grained view of the same
ordering: [high](https://github.com/lid-labs/hevc.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22priority%3A+high%22),
[medium](https://github.com/lid-labs/hevc.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22priority%3A+medium%22),
[low](https://github.com/lid-labs/hevc.js/issues?q=is%3Aissue+is%3Aopen+label%3A%22priority%3A+low%22).

## Near term

- **Fix micro-stalls on 1080p+ ABR (Shaka)** — batched transmuxer output can
  starve the buffer on quality switches. Tracked in
  [#126](https://github.com/lid-labs/hevc.js/issues/126).
- **hls.js plugin — next steps** — `@hevcjs/hlsjs-plugin` is published on
  npm and covers fMP4 HLS: video-only, demuxed-audio and muxed audio+video
  renditions, with compute-aware ABR wired to `hls.autoLevelCapping`.
  Still open: HEVC-in-TS validation, out-of-buffer seeks on muxed streams,
  and moving the muxed A/V path off the main thread (the worker fast path
  stays video-only).
- **Muxed A/V for the Shaka transmuxer** — the Shaka path still reports
  muxed audio+video HEVC mimes as unsupported; the two-track muxer already
  in the intercept path needs to be wired into it.
- **Broader JS test coverage** — extend the vitest setup from
  `@hevcjs/core` to the plugin packages.

## Correctness and robustness

Decoder defects found by review rather than by playback, so none of them has a
fixture: they need one written before they can be fixed.

- **Long-term references from the SPS are dropped** — the slice header parser
  never copies them in, so the DPB cannot see them.
  [#249](https://github.com/lid-labs/hevc.js/issues/249).
- **Uninitialized prediction buffers on a null reference** — reachable whenever
  decoding starts mid-stream, which is what the segment transcoder does.
  [#250](https://github.com/lid-labs/hevc.js/issues/250).
- **`pic_output_flag` is ignored** — honouring it requires reworking how the
  transcoder maps output pictures to timestamps.
  [#243](https://github.com/lid-labs/hevc.js/issues/243).
- **No fixture uses tiles** — the `pps.TileId` branches in SAO and deblocking are
  executed by nothing, which already let one defect through.
  [#233](https://github.com/lid-labs/hevc.js/issues/233).

## Tooling and release

- **The committed WASM binary is never regenerated** — `packages/core/wasm/`
  ships a decoder that drifts from the sources; releases rebuild it, the repo
  does not.
  [#254](https://github.com/lid-labs/hevc.js/issues/254).
- **npm publishing still uses a 2FA-bypass token** — npm is retiring the
  mechanism in January 2027; OIDC trusted publishing needs no stored secret.
  [#226](https://github.com/lid-labs/hevc.js/issues/226).
- **`tools/bench_wasm.mjs` is broken under emcc 6.x** — the working `.cjs` does
  the same job; the two need to stop disagreeing.
  [#234](https://github.com/lid-labs/hevc.js/issues/234).

## Performance

- **Parallel tile decoding** — tiles are currently parsed but decoded
  sequentially; decoding them in parallel is the next big lever for 4K.
- **Decoder hot-path optimizations** — known bottlenecks (plane stride
  handling, RBSP extraction) identified during profiling, not yet exploited.
  A WASM profile of the remaining hot spots, with what has been ruled out and
  why, is in [#232](https://github.com/lid-labs/hevc.js/issues/232).
