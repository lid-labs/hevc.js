---
"@hevcjs/core": patch
---

Decoder: an SPS or PPS whose scaling list data is out of the ranges of §7.4.5 is now rejected. A malformed `scaling_list_pred_matrix_id_delta` could make the decoder read past its scaling list tables. Conforming streams decode as before.
