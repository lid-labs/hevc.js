# Contributing to hevc.js

Thanks for your interest in contributing! Here's how to get started.

## Development setup

### Prerequisites

- Node.js >= 18
- [pnpm](https://pnpm.io/)
- CMake >= 3.16
- C++17 compiler (clang or gcc)
- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (for WASM builds)

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

# WASM build
source ~/emsdk/emsdk_env.sh
emcmake cmake -B build-wasm -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-wasm

# JS packages
pnpm -r build
```

### Running tests

```bash
# C++ unit + oracle tests (128 tests)
pnpm test:native

# E2E browser tests (requires built WASM + demo bundles)
pnpm build:demo
pnpm test:e2e
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
