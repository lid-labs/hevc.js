---
"@hevcjs/core": patch
---

Build the reference lists on intra slices too (`decoder.cpp`).

`construct_ref_pic_lists` was called only for P and B slices, although it handles an I slice by clearing the lists and returning. The lists are read unconditionally right after decoding — each picture's reference POCs are stored for TMVP scaling — so on an IRAP they were read as the previous picture had left them, while that IRAP had just unmarked every reference of the sequence ending and `alloc_picture()` had evicted them. AddressSanitizer reports a heap-use-after-free on the first picture of the second sequence.

Reachable when inter pictures precede the IRAP of a second sequence — a segment spanning a mid-stream IDR.
