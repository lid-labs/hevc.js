---
"@hevcjs/core": patch
---

Do not output RASL pictures that cannot be reconstructed (§8.1).

§8.1 ends the derivation of `PicOutputFlag` with an override the decoder never applied: a RASL picture whose associated IRAP has `NoRaslOutputFlag = 1` is set to 0. Such a picture references pictures preceding that IRAP in decode order, which were never decoded — it was being decoded against whatever the DPB held, concealed to neutral grey by the missing-reference path, and muxed like any other frame.

The transcoder starts a decoder mid-stream on every segment, so a segment opening on a CRA with RASL pictures — a plain open GOP — hit this at startup and after every seek. Measured on the new fixture, which opens on its CRA: 7 frames out where ffmpeg outputs 4.

A RASL picture decoded before any IRAP is suppressed too: with no IRAP decoded there are no references at all. This is what a segment not aligned on an IRAP produces.

Open-GOP streams therefore emit fewer frames per segment than before. The timestamps follow: each suppressed picture is reported as `(cvs_id, poc)` and consumes its display slot, the machinery already in place for `pic_output_flag`, so the muxed segment starts on the first frame actually output instead of three frames early.
