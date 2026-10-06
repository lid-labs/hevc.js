---
"@hevcjs/core": patch
---

Frame durations around a picture suppressed by `pic_output_flag`.

- When the suppressed picture was a segment's last, the frame before it kept its own slot's duration and the muxed segment came up a frame short, while the next segment's `tfdt` still starts a full segment later — so the timeline gained a hole at that join. Both transcoder paths now close the last frame on the end of the segment, one slot past the last sample. A frame extrapolated past the sample list has no successor and keeps its nominal duration.
- On the streaming path, the last frame of a full batch fell back to its slot's nominal duration because the frame after it was not decoded yet, so a picture suppressed exactly on a batch boundary (slot 30, 60, …) left that frame a slot short. A batch is now held back until one frame past it is available, which costs one frame of latency and keeps the memory bound.
- `TranscodePipeline` times frames off its own clock rather than off the sample PTS, so a suppressed picture costs it nothing to re-map — but the list the decoder keeps for callers that do is only emptied by reading it, and this one never read it. It now drains it.
