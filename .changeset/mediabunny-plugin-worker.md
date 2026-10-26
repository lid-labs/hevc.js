---
"@hevcjs/mediabunny-plugin": minor
---

Decode in a Web Worker with `registerHevcDecoder({ workerUrl })`, serving `dist/decode-worker.js` next to `hevc-decode.js` and `.wasm`. Without a worker, decoding on the page's thread now yields to the event loop about every 50 ms, so decoding flat out no longer freezes the page.
