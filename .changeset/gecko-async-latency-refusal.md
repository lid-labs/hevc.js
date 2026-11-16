---
"@hevcjs/core": minor
---

See through an asynchronous `latencyMode` refusal.

Gecko answers `true` to `isConfigSupported()`, takes `configure()` without throwing, and then
closes the encoder through its error callback with `EncodingError: The given encoding is not
supported.` Every check was synchronous, so the constructor kept `realtime`, the encoder died a
few milliseconds later, and the failure surfaced from a browser task where no `catch` could
reach it: no fallback, no chunk, no diagnosable error.

`H264Encoder.validateLatencyModes()` configures a real encoder and flushes it empty, which
settles the question without encoding a frame, and memoises the verdict for the realm.
`checkSupport()` goes through it, the error callback records instead of throwing, and `flush()`
rejects naming the mode and the cause.
