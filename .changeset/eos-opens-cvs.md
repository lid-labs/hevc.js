---
"@hevcjs/core": patch
---

Decoder: an end-of-sequence NAL now opens a new coded video sequence at the next IRAP, as §8.1 requires. That IRAP's RASL pictures are no longer output, and the pictures of the previous sequence still pending output are dropped when `NoOutputOfPriorPicsFlag` is 1 — always after an EOS on a CRA, and on an IDR or BLA that sets `no_output_of_prior_pics_flag` — matching ffmpeg frame for frame. Dropped pictures are reported by `takeSuppressedPictures()`, so timestamps stay aligned. `cvsId` now also increments on a CRA that opens a sequence, so a stream starting on a CRA numbers its sequences from 1 instead of 0; ordering is unchanged.
