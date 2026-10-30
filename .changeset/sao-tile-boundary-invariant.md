---
---

Internal only, no behaviour change: the SAO per-CTB uniformity test no longer
treats a null `slice_idx` as a uniform neighbourhood, which also waived its tile
half. The decoder's only caller always assigns that pointer, so the invariant is
an assertion. Decoded output is unchanged — 147/147 conformance streams and the
51-stream WASM/native diff — and a new fixture, `DBLK_E_VIXS_2`, now covers the
tile boundary tests the change concerns.
