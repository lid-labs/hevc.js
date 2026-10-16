---
"@hevcjs/core": patch
"@hevcjs/dashjs-plugin": patch
"@hevcjs/hlsjs-plugin": patch
"@hevcjs/shaka-plugin": patch
---

Published through npm trusted publishing (OIDC) instead of a stored token, so each release now carries an npm provenance attestation linking it to the GitHub Actions run that built it. No code change.
