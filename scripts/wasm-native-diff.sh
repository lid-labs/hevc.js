#!/bin/bash
# wasm-native-diff.sh — decode the same streams with the native decoder and the
# WASM build, and fail if any picture differs.
#
# Every other decoder check runs the native build, while @hevcjs/core ships the
# WASM one, compiled by another compiler (emscripten, -msimd128). A miscompile, an
# undefined-behaviour difference or a WASM-only code path would show here and
# nowhere else (#298).
#
# Usage: wasm-native-diff.sh <native-decoder> <wasm-dir> [stream...]
#
# <wasm-dir> holds hevc-decode.js and hevc-decode.wasm. With no streams given,
# uses the same set as decoder-output-diff.sh: every conformance fixture plus the
# demo streams. Writes a markdown report to stdout.
#
# Exit status:
#   0  every stream compared decodes identically
#   1  at least one stream differs, or decodes on one side only. Unlike
#      decoder-output-diff.sh this is never a legitimate change: both sides are
#      built from the same sources
#   2  the comparison did not happen: a decoder is missing, or no stream decoded
#      on both sides

set -uo pipefail

NATIVE="${1:?usage: wasm-native-diff.sh <native-decoder> <wasm-dir> [stream...]}"
WASM_DIR="${2:?usage: wasm-native-diff.sh <native-decoder> <wasm-dir> [stream...]}"
shift 2

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -gt 0 ]; then
  STREAMS=("$@")
else
  # Named rather than globbed, as in decoder-output-diff.sh: a missing stream is
  # reported instead of silently shrinking the comparison.
  STREAMS=("$PROJECT_DIR"/tests/conformance/fixtures/*.265)
  for demo in bbb4k_singleslice bbb1080_singleslice bbb720_singleslice full_qcif_10f; do
    STREAMS+=("$PROJECT_DIR/demo/$demo.265")
  done
fi

if [ ! -x "$NATIVE" ]; then
  echo "error: $NATIVE is not an executable decoder" >&2
  exit 2
fi
for f in hevc-decode.js hevc-decode.wasm; do
  if [ ! -f "$WASM_DIR/$f" ]; then
    echo "error: $WASM_DIR/$f not found" >&2
    exit 2
  fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

sha() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -c1-12
  else
    shasum -a 256 "$1" | cut -c1-12
  fi
}

hash_of() { # native|wasm, stream -> hash, or decode-failed / no-output
  local side="$1" stream="$2" out="$WORK/$1.yuv" status
  rm -f "$out"
  if [ "$side" = native ]; then
    "$NATIVE" -o "$out" "$stream" > /dev/null 2>&1
  else
    node "$PROJECT_DIR/tools/wasm_decode.cjs" "$WASM_DIR" "$stream" "$out" > /dev/null 2>&1
  fi
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "decode-failed"
  elif [ ! -s "$out" ]; then
    echo "no-output"
  else
    sha "$out"
  fi
}

is_failure() { case "$1" in decode-failed|no-output) return 0 ;; *) return 1 ;; esac; }

differ=0
same=0
undecodable=""
missing=""
rows=""

for stream in "${STREAMS[@]}"; do
  name="${stream#"$PROJECT_DIR"/}"
  if [ ! -e "$stream" ]; then
    missing="$missing $name"
    continue
  fi

  native_hash=$(hash_of native "$stream")
  wasm_hash=$(hash_of wasm "$stream")

  if is_failure "$native_hash" && is_failure "$wasm_hash"; then
    undecodable="$undecodable $name"
  elif [ "$native_hash" = "$wasm_hash" ]; then
    same=$((same + 1))
  else
    differ=$((differ + 1))
    rows="$rows| \`$name\` | $native_hash | $wasm_hash |"$'\n'
  fi
done

as_list() { echo "$1" | tr ' ' '\n' | sed '/^$/d;s/^/- `/;s/$/`/'; }

report_gaps() {
  if [ -n "$undecodable" ]; then
    echo
    echo "Decoded by neither build, so not compared:"
    as_list "$undecodable"
  fi
  if [ -n "$missing" ]; then
    echo
    echo "Not present, so not compared:"
    as_list "$missing"
  fi
}

plural() { [ "$1" -eq 1 ] && echo "stream" || echo "streams"; }

compared=$((differ + same))

if [ "$compared" -eq 0 ]; then
  echo "**Nothing was compared.** No stream decoded with both the native and the WASM build."
  report_gaps
  exit 2
fi

if [ "$differ" -eq 0 ]; then
  echo "**$compared $(plural "$compared") decode identically** with the native and the WASM build."
  report_gaps
  exit 0
fi

echo "**$differ of $compared $(plural "$compared") decode differently** with the WASM build."
echo
echo "| Stream | Native | WASM |"
echo "|---|---|---|"
printf '%s' "$rows"
echo
echo "Both builds come from the same sources, so any difference is a bug: a"
echo "miscompile, undefined behaviour, or a code path only one build takes."
echo "\`decode-failed\` means the decoder returned non-zero, \`no-output\` that it"
echo "wrote nothing."
report_gaps
exit 1
