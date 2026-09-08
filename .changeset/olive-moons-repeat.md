---
"@hevcjs/core": patch
---

Reject the two §8.3.4 bitstream conformance violations that reference list
construction never checked. A P/B slice with `NumPicTotalCurr == 0` sent the
decoder into a non-terminating loop — no allocation, no exception, so the
transcode worker simply stopped producing frames — and an out-of-range
`list_entry_lX` read a reference picture pointer past the end of the list.
