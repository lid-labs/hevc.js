#!/bin/bash
# decoder-output-diff.sh — decode the same streams with two builds of the decoder
# and report which ones moved.
#
# The oracle suite proves the decoder matches a stored reference. It does not
# prove a change leaves the output alone, and those are different questions: a
# PR that changes decoding and updates the reference data in the same commit
# keeps the oracle green while the picture moves. The demo streams are not
# covered by the oracle at all, so a regression visible only at 1080p or 4K
# passes CI today.
#
# Usage: decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]
#
# With no streams given, uses every conformance fixture plus the demo streams.
# Writes a markdown table to stdout. Exit 0 whatever it finds: a decoder PR that
# changes the output on purpose is the normal case, and a job that goes red on
# every legitimate fix gets trained away. The interesting output is the list of
# streams that moved, not a verdict.

set -uo pipefail

BASE="${1:?usage: decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]}"
HEAD="${2:?usage: decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]}"
shift 2

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -gt 0 ]; then
  STREAMS=("$@")
else
  STREAMS=("$PROJECT_DIR"/tests/conformance/fixtures/*.265 "$PROJECT_DIR"/demo/*.265)
fi

for bin in "$BASE" "$HEAD"; do
  if [ ! -x "$bin" ]; then
    echo "error: $bin is not an executable decoder" >&2
    exit 2
  fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

hash_of() { # decoder, stream -> hash, or a word saying why there is none
  local bin="$1" stream="$2" out="$WORK/out.yuv"
  rm -f "$out"
  if ! "$bin" -o "$out" "$stream" > /dev/null 2>&1; then
    echo "decode-failed"
    return
  fi
  if [ ! -s "$out" ]; then
    echo "no-output"
    return
  fi
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$out" | cut -c1-12
  else
    shasum -a 256 "$out" | cut -c1-12
  fi
}

moved=0
same=0
rows=""

for stream in "${STREAMS[@]}"; do
  [ -e "$stream" ] || continue
  name="${stream#"$PROJECT_DIR"/}"

  base_hash=$(hash_of "$BASE" "$stream")
  head_hash=$(hash_of "$HEAD" "$stream")

  if [ "$base_hash" = "$head_hash" ]; then
    same=$((same + 1))
  else
    moved=$((moved + 1))
    rows="$rows| \`$name\` | $base_hash | $head_hash |"$'\n'
  fi
done

total=$((moved + same))
if [ "$moved" -eq 0 ]; then
  echo "**$total streams decode identically** at the base and at this head."
  echo
  echo "No stream that already decoded moved."
  exit 0
fi

echo "**$moved of $total streams decode differently** at this head."
echo
echo "| Stream | Base | Head |"
echo "|---|---|---|"
printf '%s' "$rows"
echo
echo "This is expected when the change fixes decoding — that is what a decoding"
echo "fix does. Worth reading rather than dismissing: a fix aimed at one case"
echo "should move that case and little else. \`decode-failed\` means the decoder"
echo "returned non-zero, \`no-output\` that it wrote nothing."
