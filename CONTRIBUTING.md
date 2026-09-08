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

### Running tests

```bash
# C++ unit + oracle tests (153 tests)
pnpm test:native

# E2E browser tests — builds the WASM and demo bundles, then tests the branch
pnpm test:e2e

# Same suite without rebuilding, for quick iterations
pnpm test:e2e:fast

# Against a deployed target instead: a PR preview, or the published site
E2E_BASE_URL=https://<preview>.vercel.app/demo pnpm test:e2e:fast
pnpm test:e2e:prod
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
