---
"@hevcjs/core": patch
---

Fix two reference-picture defects that survive a mid-stream start, which is how
the segment transcoder always begins.

`perform_inter_prediction` read its prediction buffers whether or not a reference picture
existed: a null entry in a reference list left `predFlagLX` set, and weighted
prediction then read all samples of an 8 KB stack buffer nothing had written.
Output was undefined and varied between runs. Missing references now clear the
flag, and a PU with no reference at all is concealed with neutral grey instead
of reaching the bi-prediction branch with two untouched buffers.

Long-term references signalled through the SPS were dropped: the slice header
parser left `PocLsbLt` and `UsedByCurrPicLt` at zero for the `num_long_term_sps`
entries whose values §7.4.7.1 derives from the SPS tables, while the DPB read
those same arrays for every index. Such a reference landed in `PocLtFoll`,
never reached the reference lists, and made the parser's `NumPicTotalCurr`
disagree with the DPB's.

Also rejects `chroma_format_idc` 2 and 3 at SPS parse. Neither was supported —
the inter chroma buffers are sized for 4:2:0 and would have been overrun by
either — and nothing else in the decoder turned them away.

Two adjacent defects the above made reachable: `DeltaPocMsbCycleLt` is now
accumulated across each run of long-term entries per §7.4.7.1 instead of read as
the raw syntax element, and `DPB::ref_pic_list0/1` reject a negative index
rather than reading one element before the vector.
