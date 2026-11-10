---
"@hevcjs/core": patch
---

H264Encoder: probe the configuration that gets used, and fall back from `realtime` to `quality`

`checkSupport()` probed a different configuration from the one the constructor
applies — fixed codec against a resolution-derived one, 640×480 against the real
size, `prefer-software` against `no-preference`, and no `latencyMode` or `avc` at
all. On a backend that encodes H.264 in `quality` but not in `realtime`, the probe
answered yes and `configure()` then threw on the first segment. Both plugins gate
their whole MSE intercept on that probe, so they promised transcoding and failed
once a segment arrived.

Both paths now build the same config through one function, and the constructor
tries `realtime` then `quality` before giving up, rather than throwing on the
first refusal. Falling back changes how the encoder buffers, not the output
format. `checkSupport()` takes optional dimensions, since the codec string
depends on resolution; without them it probes 720p, which is what callers that
have not seen a segment yet can do.

No user-agent test: whether `realtime` is accepted turns out to depend on the
encoder backend rather than the engine — Firefox 155 accepts it on macOS, through
VideoToolbox — so only trying can tell.
