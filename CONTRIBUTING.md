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
ones moved. `.gitignore` excludes `*.265` apart from the fixtures, so CI sees 18
streams where a local run sees 21 — the report names the missing ones. A stream
moving never fails the build — changing the output is what a decoding fix does — though it does fail when the
comparison could not happen at all, such as no stream decoding at both ends. The
count is worth reading: a fix aimed at one case should move that case and little else.
The same comparison runs locally:

```bash
scripts/decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]
```

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
