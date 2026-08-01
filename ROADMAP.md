# Roadmap

What's coming next, roughly in priority order. Open a
[Discussion](https://github.com/privaloops/hevc.js/discussions) or an issue if
you'd like to influence it — real-world usage reports carry the most weight.

## Near term

- **Fix micro-stalls on 1080p+ ABR (Shaka)** — batched transmuxer output can
  starve the buffer on quality switches. Tracked in
  [#126](https://github.com/privaloops/hevc.js/issues/126).
- **Broader JS test coverage** — extend the vitest setup from
  `@hevcjs/core` to the plugin packages.

## Performance

- **Parallel tile decoding** — tiles are currently parsed but decoded
  sequentially; decoding them in parallel is the next big lever for 4K.
- **Decoder hot-path optimizations** — known bottlenecks (plane stride
  handling, RBSP extraction) identified during profiling, not yet exploited.

## Exploring — tell us if you need this

- **hls.js plugin** — same software-fallback approach for HLS/fMP4. Not
  started; will be prioritized if demand shows up. 👍 or comment in
  Discussions if this would unblock you.
