---
"@hevcjs/core": patch
---

Treat the first IRAP that opens decoding as starting a coded video sequence (§8.1).

A decoder handed a segment that opens before its IRAP — what a seek to a segment not aligned on one produces — reached that IRAP with the "first picture" flag already spent on a picture that preceded it. The IRAP took `NoRaslOutputFlag = 0`, so its RASL set was output although nothing before it had been decoded.

Measured on an open-GOP stream cut at its first RASL picture: 4 frames out, pixel-identical to ffmpeg, against 7 before this change and 10 before the §8.1 override shipped in 1.4.7.

Aligned segments are unaffected: a stream opening on an IRAP already took this path.
