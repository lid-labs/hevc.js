---
"@hevcjs/core": patch
---

Ship a WASM binary that is actually built from the current sources.

The published package carries `wasm/hevc-decode.wasm`, a file committed to the
repository. Nothing kept it in sync: `release.yml` only ran `pnpm build:js`, and
`build:wasm` copied its output to `packages/core/dist/wasm/` — a directory that
`tsup` then wiped (`clean: true`) and repopulated from the stale committed copy.
So even a full `pnpm build` could not update it.

The binary in 1.4.1 was built in April. Every release since then shipped it,
including the decoder optimizations announced in 1.4.1 changelogs, none of which
were in the published artifact.

Fixed at both ends: `build:wasm` now writes to `packages/core/wasm/`, the source
of truth, and `release.yml` builds the WASM before publishing.

The toolchain also moved from emsdk 3.1.51 (late 2023) to 6.0.8, across every
workflow. Measured on 1080p, A/B with the order swapped each round:

- 3.1.51: 79.4 / 79.1 / 73.8 / 78.5 fps, 286,695 bytes
- 6.0.8: 87.1 / 86.1 / 85.8 / 86.0 fps, 267,136 bytes

That is about 9% faster and 7% smaller with no source change, and the ranges do
not overlap. 3.1.51 also rejected `HEAPU16` in `EXPORTED_RUNTIME_METHODS`, an
export the code relies on; 6.0.8 accepts it without warning.

Verified with 28 end-to-end browser tests (hls.js, dash.js, Shaka, core, native
playback and bugfix validation), the 146-test C++ suite and the JS unit tests.

Documented binary size corrected from 236KB to 261KB across the READMEs and the
site — the previous figure had not matched any shipped build for some time.
