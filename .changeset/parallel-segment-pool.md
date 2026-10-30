---
"@hevcjs/core": minor
"@hevcjs/dashjs-plugin": patch
---

Transcode several segments at once. `installMSEIntercept({ poolSize })` keeps up
to `poolSize` transcode workers, each with its own WASM decoder, so segments
transcode in parallel while the SourceBuffer is still fed in segment order.
Default: 2 from four hardware threads up, 1 below; `poolSize: 1` is the previous
behaviour, one segment at a time.

Measured in Chromium through Playwright on an Apple M4 Pro, 2026-10-30, on the
30s ABR DASH preset with transcoding forced: time to buffer 28s of media, three
alternated rounds, 10.6s with one worker against 8.1s with two — 1.31x. The
whole pipeline does not scale with the pool, since demuxing, the appends and the
player's own work stay on one thread and the WebCodecs encode was already
asynchronous.

A segment goes to a second worker only when it starts on an IDR or a BLA
picture, which resets the decoder by type. A CRA-led (open GOP) segment stays on
the worker that decoded its predecessor: its RASL pictures reference that
predecessor, which is in that worker's DPB and in no other, so another worker
would decode them against unrelated pictures — wrong frames rather than an
error. Where a stream is segmented that way, the pool therefore has no effect
rather than a wrong one.

Fixes found while building it:

- Nothing is dispatched while an init segment is being parsed. `initParsed` only
  flips when the parse finishes, so on a re-sent init — an ABR switch — the
  dispatch could hand a media segment to a transcoder in the middle of parsing
  other parameter sets; on the main-thread path that is a reentrant call on the
  one instance parsing them.
- `TranscodeWorkerClient.processInitSegment()` waits for the init segment it was
  given. It returned the promise a previous init had already resolved, so a
  re-sent init came back before the worker had seen the message, and a caller
  that awaited it was told the new parameter sets were parsed when they were not.

- `TranscodeWorkerClient.abort()` no longer restarts its segment id count. The
  worker can still be inside a streaming segment when the abort reaches it, and
  a late `streamingDone` from the abandoned segment matched the handler of a new
  segment that had been given the same id, resolving it before its data had
  arrived. Ids stay monotonic, so a late message matches nothing.
- `@hevcjs/dashjs-plugin` forwards `logLevel` and `poolSize` to the intercept.
  `logLevel` was accepted and dropped before, so the documented option did
  nothing on that plugin.
