---
"@hevcjs/core": patch
---

Fix two SAO fast-path gates and bound the band-offset table index.

Follow-ups from a review of the SAO work landed earlier this week.

**Band offset was gated on neighbourhood uniformity, which does not apply to
it.** Edge offset reads two neighbours, so it genuinely needs the cross-slice /
cross-tile check to be provably unnecessary. Band offset (§8.7.3.3) reads no
neighbour at all, so no such check can ever fire — gating it on `ctbUniform`
dropped every multi-slice and multi-tile stream onto the slow loop for nothing.
The two paths now have their own gates.

**`ctbHasPcmOrBypass` was recomputed once per component.** It scans the CU grid
on luma coordinates, so all three components get the same answer; it is now
computed once per CTB, next to the uniformity check it should have accompanied.
Unexpectedly measurable on the benchmark stream — the guard was being evaluated
three times per CTB rather than once.

**The band-offset table was indexed without a bound.** `bandOffs[sample >>
bandShift]` trusted `sample <= maxVal`; the slow loop it replaced was
structurally immune thanks to its `bandIdx < 4` test. Masking with `& 31` is a
no-op while the invariant holds and keeps a corrupt plane or an inconsistent
chroma bit depth from reading past a stack array.

Output is byte-identical: 146/146 including the oracle MD5 comparisons.

Measured in WASM (emcc 6.0.8, A/B with the order swapped each round), 1080p:
78.7 / 81.0 / 81.6 before, 84.5 / 84.5 / 84.4 after.
