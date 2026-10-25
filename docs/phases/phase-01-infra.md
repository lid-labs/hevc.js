# Phase 1 — Infrastructure

## Goal
Set up the project, the toolchain, the CI, and the test oracle.

## Prerequisites
None (first phase).

## Tasks

### 1.1 — Project initialization
- [ ] Folder structure (src/, tests/, tools/, docs/)
- [ ] Main CMakeLists.txt with options:
  - `BUILD_TESTS` (ON by default)
  - `BUILD_WASM` (OFF by default)
  - `HEVC_DEBUG` (ON in Debug)
- [ ] `.gitignore` (build/, *.o, *.wasm, *.yuv)
- [ ] Minimal README.md

### 1.2 — C++ toolchain
- [ ] C++17 standard
- [ ] Clang or GCC as the native compiler
- [ ] Strict warnings: `-Wall -Wextra -Wpedantic -Werror`
- [ ] AddressSanitizer in Debug mode
- [ ] Emscripten toolchain file for WASM

### 1.3 — Google Test
- [ ] FetchContent or submodule for Google Test
- [ ] CMake `add_test` setup
- [ ] First trivial test that passes

### 1.4 — ffmpeg oracle
- [ ] Check that `ffmpeg` is installed (decodes the reference YUV)
- [ ] `tools/oracle_test.sh` script — decodes with hevc-decode, compares the MD5 against the ffmpeg reference
- [ ] `tools/oracle_compare.py` script — pixel-perfect YUV comparison
- [ ] `tools/fetch_conformance.sh` script — downloads test bitstreams

### 1.5 — GitHub Actions CI
- [ ] `build.yml` workflow: native build (Linux, macOS)
- [ ] `build-wasm.yml` workflow: Emscripten build
- [ ] `test.yml` workflow: unit test execution
- [ ] Dependency cache (Google Test, Emscripten)

### 1.6 — Fundamental data structures
- [ ] `BitstreamReader`: bit reading from a buffer
  - `read_bits(n)`, `read_u(n)`, `read_ue()`, `read_se()`, `read_flag()`
  - `byte_aligned()`, `more_rbsp_data()`
  - Complete unit tests
- [ ] Base types: `Pixel` (8/16-bit template), dimensions, coordinates
- [ ] `Picture`: YUV buffer with stride, bit depth, chroma format

## Exit criterion

- The project compiles natively and to WASM without errors
- The tests pass (including the BitstreamReader test)
- The oracle works with a test YUV file
- The CI is green

## Oracle validation
No pixel comparison at this stage. Validation by unit tests only.

## Complexity estimate
Moderate. Mostly setup, but BitstreamReader and Picture are fundamental.
