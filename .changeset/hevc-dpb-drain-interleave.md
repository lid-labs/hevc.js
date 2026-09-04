---
"@hevcjs/core": patch
---

Bound decoder memory during a transcode, and fix the §C.5.2.2 bumping conditions it relies on.

Both transcoder paths now drain the decoder after every feed instead of feeding a whole segment and draining once. Deferring the drain retained one DPB picture per frame — about 24 MB each at 4K, which overran the 2 GB WASM ceiling on a 2s segment. Memory is now bounded by the DPB itself, not by segment length. `processMediaSegmentStreaming` additionally ships each full batch as it is encoded, so the JS heap stays bounded too.

Draining per picture put `DPB::drain` on the hot path, which exposed two defects in its §C.5.2.2 conditions: they included the current picture (the process runs before it is stored), and DPB fullness counted every stored picture rather than the occupied storage buffers, so the condition could never clear and drained the whole DPB in decode order. On streams with B-frames this emitted pictures out of display order. Both are fixed and pinned against the batched path on the B-frame fixtures.

Also: `pic_output_flag` from the slice header is no longer overwritten, so pictures the bitstream marks as not for output are neither emitted nor retained.
