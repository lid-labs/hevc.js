---
"@hevcjs/mediabunny-plugin": minor
---

New package: registers the hevc.js decoder with Mediabunny as a custom video decoder, for HEVC Main and Main 10 tracks WebCodecs cannot decode. `registerHevcDecoder()` leaves the profiles the browser decodes natively to WebCodecs; `force: true` claims them all.
