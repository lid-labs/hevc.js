---
"@hevcjs/core": patch
---

Honour `pic_output_flag`: a picture the bitstream marks as not for output is decoded, may serve as a reference, and is no longer emitted. The decoder reports the POC of each suppressed picture, and the segment transcoder uses it to skip that sample's timestamp instead of shifting every later frame of the segment onto the wrong one.
