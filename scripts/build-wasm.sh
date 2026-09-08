#!/usr/bin/env bash
# Build the HEVC decoder to WASM, with or without a local Emscripten SDK.
# Usage: pnpm build:wasm
#        WASM_BUILDER=docker pnpm build:wasm   (force the container route)
#
# Picks a local emcmake when the SDK is on the PATH, otherwise runs the
# emsdk image CI pins. Both write to build-wasm/ and copy the artefacts
# into packages/core/wasm/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build-wasm"
EMSDK_IMAGE="emscripten/emsdk:6.0.8"
CMAKE_ARGS="-B build-wasm -DBUILD_WASM=ON -DCMAKE_BUILD_TYPE=Release"

cd "$PROJECT_DIR"

# --- Pick a builder --------------------------------------------------------
MODE="${WASM_BUILDER:-}"
if [ -z "$MODE" ]; then
  if command -v emcmake >/dev/null 2>&1; then
    MODE=local
  elif command -v docker >/dev/null 2>&1; then
    MODE=docker
  else
    echo "Error: no way to build the WASM decoder." >&2
    echo "  -> install the Emscripten SDK and source its emsdk_env.sh, or" >&2
    echo "  -> install Docker, which pulls $EMSDK_IMAGE on first run" >&2
    exit 1
  fi
fi

if [ "$MODE" = docker ] && ! command -v docker >/dev/null 2>&1; then
  echo "Error: WASM_BUILDER=docker but docker is not in PATH" >&2
  exit 1
fi
if [ "$MODE" = local ] && ! command -v emcmake >/dev/null 2>&1; then
  echo "Error: WASM_BUILDER=local but emcmake is not in PATH" >&2
  echo "  -> source the SDK's emsdk_env.sh first" >&2
  exit 1
fi

# The two routes leave different compiler paths in the CMake cache, and an
# unstamped cache predates this script: reconfigure rather than fail obscurely.
STAMP="$BUILD_DIR/.hevcjs-builder"
if [ -f "$BUILD_DIR/CMakeCache.txt" ] && [ "$(cat "$STAMP" 2>/dev/null || echo unknown)" != "$MODE" ]; then
  echo "Cache was not built by '$MODE', reconfiguring from scratch"
  rm -rf "$BUILD_DIR"
fi

# --- Build -----------------------------------------------------------------
echo "Building WASM decoder ($MODE)"
if [ "$MODE" = local ]; then
  # shellcheck disable=SC2086
  emcmake cmake $CMAKE_ARGS
  cmake --build build-wasm --parallel
else
  docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/src -w /src \
    "$EMSDK_IMAGE" \
    sh -c "emcmake cmake $CMAKE_ARGS && cmake --build build-wasm --parallel"
fi

echo "$MODE" > "$STAMP"

cp build-wasm/hevc-decode.js build-wasm/hevc-decode.wasm packages/core/wasm/
echo "WASM decoder built -> packages/core/wasm/"
