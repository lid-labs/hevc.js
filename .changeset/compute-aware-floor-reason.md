---
"@hevcjs/core": minor
"@hevcjs/dashjs-plugin": patch
"@hevcjs/hlsjs-plugin": patch
"@hevcjs/shaka-plugin": patch
---

Compute-aware decider: new `reason: "floor"` when decoding runs below real time but the player is already on the lowest variant, so there is nothing to cap to. It used to report `hold`, which looked the same as a feedback loop that never reacted. No cap is applied on `floor`. Code that switches exhaustively on `reason` needs a case for it; the plugins' `onObservation` now takes the core's `ComputeAwareDecision["reason"]` type.
