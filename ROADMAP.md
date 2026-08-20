# Roadmap

What's coming next, roughly in priority order. Open a
[Discussion](https://github.com/privaloops/hevc.js/discussions) or an issue if
you'd like to influence it — real-world usage reports carry the most weight.

## Near term

- **Fix micro-stalls on 1080p+ ABR (Shaka)** — batched transmuxer output can
  starve the buffer on quality switches. Tracked in
  [#126](https://github.com/privaloops/hevc.js/issues/126).
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

## Performance

- **Parallel tile decoding** — tiles are currently parsed but decoded
  sequentially; decoding them in parallel is the next big lever for 4K.
- **Decoder hot-path optimizations** — known bottlenecks (plane stride
  handling, RBSP extraction) identified during profiling, not yet exploited.
