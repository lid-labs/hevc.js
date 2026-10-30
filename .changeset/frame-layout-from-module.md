---
"@hevcjs/core": patch
---

The WASM module reports where the fields of its `HEVCFrame` struct sit, through a
new `hevc_frame_layout()` export, and the readers that walk a frame in its memory
ask for it instead of carrying their own copy of the offsets.

Five readers did: this package's `decoder.ts` and `worker.ts`, and the unbundled
`src/wasm/hevc_decoder.js`, `src/wasm/worker.js` and `tools/wasm_decode.cjs`. Only
the first two can share a module — the others load as a script, a worker and a
CommonJS tool — so the offsets were duplicated by construction, and what kept
them honest was a compile-time `offsetof` guard naming the five files. The guard
is gone with the duplication it guarded: a reader now follows the binary it is
actually talking to.

What each reader still names is the **field names**, and a name the module does
not report throws rather than reading `undefined` as an offset. A unit test
fabricates a layout with every field moved and the struct grown, and fails
against hardcoded offsets.

`flush()` allocated 52 bytes for the struct where the other paths asked the
layout for its size; it asks too now. A field added to `HEVCFrame` would
otherwise have had the module write past that allocation.

No behaviour change for a caller of `@hevcjs/core`.
