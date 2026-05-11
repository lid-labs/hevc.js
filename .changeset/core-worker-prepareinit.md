---
"@hevcjs/core": minor
---

Add `prepareInit` to the transcode worker protocol.

`TranscodeWorkerClient` now exposes `prepareInit(data: Uint8Array): Promise<TranscodedInit>` that mirrors `SegmentTranscoder.prepareInit()` but runs inside the Web Worker. The worker handles the new `{ type: "prepareInit", data, id }` message and replies with `{ type: "initPrepared", id, initSegment, codec }` (transferable ArrayBuffer for the H.264 init segment).

Required to let transmuxer-style plugins (Shaka Player) hand a synthesized H.264 init segment back to the host player before any media segment has been seen, while keeping the actual HEVC decode + warmup-encode off the main thread.

No breaking change — purely additive on `TranscodeWorkerClient` and the worker message protocol.
