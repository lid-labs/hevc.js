---
"@hevcjs/core": patch
---

Decoder: fixes three conformance defects. Pictures after a non-reference picture or a CRA with a nonzero POC could be output in the wrong order; an IDR or BLA with `no_output_of_prior_pics_flag` dropped pictures that should have been output; and streams whose minimum transform size is above 4x4 decoded to wrong pictures.
