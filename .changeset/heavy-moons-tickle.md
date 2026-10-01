---
"@hevcjs/core": patch
---

Honour `pic_output_flag`: a picture the bitstream marks as not for output is decoded, may serve as a reference, and is no longer emitted. The decoder reports each suppressed picture as `(cvs_id, poc)`, and the segment transcoder uses it to skip that sample's timestamp instead of shifting every later frame of the segment onto the wrong one. `HEVCFrame` gains `cvsId`, since POC restarts at every IRAP and alone cannot order pictures across one.
