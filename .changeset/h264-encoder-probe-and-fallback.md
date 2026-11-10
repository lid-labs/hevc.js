---
"@hevcjs/core": minor
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
first refusal; the two configs differ by `latencyMode` alone. `checkSupport()`
takes optional dimensions, since the codec string depends on resolution;
without them it probes 720p, which is what callers that have not seen a
segment yet can do.

No user-agent test. Measured on an Apple M4 Pro / macOS 26.6, Firefox 155 and
Zen (Gecko 159) both accept `realtime` at 720p, 1080p and 4K, while #380
reports a refusal on Zen under macOS too — so the refusal was not reproduced,
and what flips it is not established. Nothing measured supports a user-agent
test either: the Zen measured here reports `Firefox/159.0`, a string that does
not name Zen, and accepts, as Firefox 155 does.

Bumped minor rather than patch: `checkSupport()` gains an optional parameter and
the class a `latencyMode` getter, which is a compatible addition to a publicly
exported class.
