---
"@hevcjs/shaka-plugin": minor
---

New `recommendedPlayerConfig()`, which returns the buffer depth
`recommendedBufferConfig()` already carried plus `abr.switchInterval: 2`.

Shaka honours the compute-aware cap's `abr.restrictions` at its next ABR
decision, and declines to take one while `abr.switchInterval` has not elapsed —
8s by default. A cap that fired on time therefore sat unapplied for several
segments, each transcoded at the resolution the cap had just rejected. Measured
against one deployment on a device transcoding at ~0.4x, six runs per setting:
the played variant obeyed the cap after 9.3-9.9s at 8, against 3.3-6.9s at 2.

The plugin does not apply this itself: `switchInterval` governs network-driven
ABR too, so it stays the application's call. `attachComputeAware` takes a
`switchInterval` option for callers who would rather it set the value, and only
ever lowers it. `recommendedBufferConfig()` is deprecated in favour of the new
function and is otherwise unchanged, so existing callers keep exactly what they
had.
