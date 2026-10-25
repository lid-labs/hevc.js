# Contributing to hevc.js

Thanks for your interest in contributing! Here's how to get started.

## Development setup

### Prerequisites

- Node.js >= 18
- [pnpm](https://pnpm.io/)
- CMake >= 3.16
- C++17 compiler (clang or gcc)
- For WASM builds: Docker, or a local
  [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)

### Build

```bash
# Clone and install
git clone https://github.com/lid-labs/hevc.js.git
cd hevc.js
pnpm install

# Native build (debug + tests)
cmake -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build
cd build && ctest --output-on-failure

# WASM build — local Emscripten SDK if emcmake is on the PATH, Docker otherwise
pnpm build:wasm

# JS packages
pnpm -r build
```

#### Changing the decoder sources

Two copies of the decoder are committed: `packages/core/wasm/hevc-decode.wasm`,
which is what a reader consults to know what the shipped decoder contains, and
`demo/hevc-decode.wasm`, which `pnpm dev:lan` serves as is — it skips the WASM
build on purpose. If you touch anything under `src/`, regenerate both and commit
them with your change:

```bash
pnpm build:wasm && pnpm build:demo:wasm
```

Updating only the package copy leaves every local demo run on the old decoder.

CI rebuilds the decoder on every PR and compares it against both committed
copies, so a stale binary is reported rather than noticed months later. The check does not
fail the build for now: whether a container build and the runner's own Emscripten
produce identical bytes has yet to be confirmed across hosts.

Releases do not depend on you getting this right — `release.yml` rebuilds the WASM
before publishing, so npm always receives a decoder built from the tagged sources.
The committed copy is for readers of the repository.

CI also decodes the conformance fixtures and whichever demo streams are present
with the decoder built at your merge base and at your head, and reports which
ones moved — the conformance fixtures and the demo streams, 21 in all. A stream
missing from the checkout is named in the report rather than silently skipped. A stream
moving never fails the build — changing the output is what a decoding fix does — though it does fail when the
comparison could not happen at all, such as no stream decoding at both ends. The
count is worth reading: a fix aimed at one case should move that case and little else.
The same comparison runs locally:

```bash
scripts/decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]
```

The same streams are also decoded with the native decoder and the WASM build of your
head. Unlike the comparison above, any difference there fails the build: both come
from the same sources, so a WASM picture that differs from the native one is a bug —
a miscompile, undefined behaviour, or a code path only one build takes. Locally, with
a WASM build in `packages/core/wasm/` (`pnpm build:wasm`) and Node:

```bash
scripts/wasm-native-diff.sh <native-decoder> packages/core/wasm [stream...]
```

The JCT-VC HEVC v1 conformance suite — 147 streams, each shipped with the MD5 of the
output of the HM reference decoder — runs with one script. The first run downloads it
from the ITU site, about 140 MB, into the work directory you name:

```bash
tools/run_conformance.sh build/hevc-decode /tmp/hevc-conformance [stream...]
```

It prints PASS or FAIL per stream and the count. Use a Release build; each decode is
allowed 300 s, `CONFORMANCE_TIMEOUT` to change it.

### Running tests

```bash
# C++ unit + oracle tests (160 tests)
pnpm test:native

# E2E browser tests — builds the WASM and demo bundles, then tests the branch
pnpm test:e2e

# Same suite without rebuilding, for quick iterations
pnpm test:e2e:fast

# Against a deployed target instead: a PR preview, or the published site
E2E_BASE_URL=https://<preview>.vercel.app/demo pnpm test:e2e:fast
pnpm test:e2e:prod

# Compute-aware cap: a CPU throttle stands in for hardware that transcodes
# below real time. Default 6x; the test skips with the series it measured when
# that is not enough to drop your machine under 1.0x, so raise it and re-run.
E2E_CPU_THROTTLE=10 npx playwright test --project=local-chromium -g "drops the cap"
```

### Benchmarking

`hevc-bench`, built with the native targets, times the decode alone: each run
decodes the whole stream into a fresh decoder and writes nothing out, unlike
`hevc-decode -o`, whose output phase dominates a profile.

```bash
cmake -B build-rel -DCMAKE_BUILD_TYPE=Release && cmake --build build-rel -j

# Best and median of 10 runs, one batch decode() call per run
build-rel/hevc-bench tests/conformance/fixtures/bbb1080_50f.265 -n 10

# One access unit per feed() call, drained after each, as the WASM worker does
build-rel/hevc-bench demo/bbb4k_singleslice.265 -n 10 --stream

# One thread: WPP rows decode serially, as in the WASM build
HEVC_THREADS=1 build-rel/hevc-bench tests/conformance/fixtures/bbb1080_50f.265
```

`HEVC_THREADS` sets the size of the native decoder's thread pool, the core
count by default; the WASM build has no threads and ignores it. To compare two
builds, alternate their runs rather than running one series after the other:
on a laptop, run-to-run variation can reach several percent.

## Pull request process

1. Fork the repo and create a branch (`feature/xxx` or `fix/xxx`)
2. Make your changes with clear, atomic commits (conventional commits: `feat:`, `fix:`, `docs:`, etc.)
3. Ensure all tests pass
4. Open a PR against `main`

## Versioning and releases

This repo uses [Changesets](https://github.com/changesets/changesets) to manage versioning and publishing of `@hevcjs/core` and `@hevcjs/dashjs-plugin` to npm.

### When your PR changes code in `packages/*/src/`

1. Run `pnpm changeset` and pick the bump type (`patch`, `minor`, or `major`) for each affected package.
2. Write a clear summary of the change — it lands in the per-package `CHANGELOG.md`.
3. Commit the generated `.changeset/<random-name>.md` with your PR.

PRs that only touch docs, CI, tests, or build configuration don't need a changeset.

A CI check (`Changeset present`) fails a PR that changes `src/`, `packages/*/src/` (test files excepted) or `packages/core/wasm/` without adding or modifying a changeset. For a change with no observable effect, such as a pure refactor, run `pnpm changeset --empty`: it records that no release note is needed without bumping any version. The check cannot tell whether a changeset still describes the whole diff — revisit it after every later fix in the same PR.

### Don't

- Don't bump the `version` field in any `package.json` manually — Changesets does that at release time.
- Don't edit a per-package `CHANGELOG.md` by hand — Changesets generates the entries.
- Don't run `pnpm publish` locally for a real publish; the `release.yml` GitHub workflow is the only authority.

### Release cycle

1. Feature/fix PRs with changesets are merged into `main`.
2. The Changesets GitHub Action opens (or updates) a "Release PR" that consolidates all pending changesets.
3. When you're ready to ship, merge the Release PR — the workflow then bumps versions, generates CHANGELOGs, publishes to npm, and creates GitHub releases + tags automatically.

## Code style

- **C++**: C++17, compiled with `-Wall -Wextra -Wpedantic -Werror`
- **TypeScript**: strict mode, ES2020 target, ESM modules
- Variable/function names follow the ITU-T H.265 spec for decoder code

## Reporting bugs

Open an issue at https://github.com/lid-labs/hevc.js/issues with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/OS/architecture
- Sample bitstream if applicable
