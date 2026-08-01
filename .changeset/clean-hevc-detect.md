---
"@hevcjs/core": patch
---

Fix regex precedence in HEVC codec detection (`/^hev1|hvc1/` matched `hvc1` anywhere in the codec string instead of only at the start) and remove dead code flagged by CodeQL (`transcodeMedia`, `getInitResult`, unused bindings and import).
