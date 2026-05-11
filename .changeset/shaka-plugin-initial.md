---
"@hevcjs/core": minor
"@hevcjs/shaka-plugin": minor
---

Add Shaka Player support via the new `@hevcjs/shaka-plugin` package.

`@hevcjs/shaka-plugin` registers a Shaka `Transmuxer` for `hev1`/`hvc1` mime types that decodes HEVC and re-encodes to H.264 fMP4 via `@hevcjs/core`. Provides a `forceTranscode` option that patches `MediaSource.isTypeSupported` so Shaka routes through the plugin even on platforms where the browser supports HEVC natively (useful for Mac/Safari where verifying the transcode pipeline manually would otherwise be impossible). Bumps the package from a no-op skeleton (0.1.0) to first functional release (0.2.0). Tracks #101.

`@hevcjs/core` exposes a new `SegmentTranscoder.prepareInit()` method that processes an HEVC init segment and immediately returns a matching H.264 fMP4 init segment by warming up the encoder with a single black frame. Required by transmuxer plugins that must hand an init segment back to their host player before any media segment has been seen (Shaka 4.x's `Transmuxer.transmux()` contract).
