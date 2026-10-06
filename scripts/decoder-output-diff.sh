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
# Writes a markdown table to stdout.
#
# Exit status:
#   0  the comparison happened — whether or not streams moved. A decoder PR that
#      changes the output on purpose is the normal case, and a check that goes
#      red on every legitimate fix gets trained away. The interesting output is
#      the list of streams that moved, not a verdict.
#   2  the comparison did not happen: a decoder is missing or not executable, or
#      no stream decoded at both ends. A report of zero streams would otherwise
#      read like a pass.

set -uo pipefail

BASE="${1:?usage: decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]}"
HEAD="${2:?usage: decoder-output-diff.sh <base-decoder> <head-decoder> [stream...]}"
shift 2

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -gt 0 ]; then
  STREAMS=("$@")
else
  # Named rather than globbed: a glob can only report what it found, and a
  # stream missing from the checkout would silently shrink the comparison —
  # which is how this first ran in CI against 18 streams while claiming 21.
  STREAMS=("$PROJECT_DIR"/tests/conformance/fixtures/*.265)
  for demo in bbb4k_singleslice bbb1080_singleslice bbb720_singleslice full_qcif_10f; do
    STREAMS+=("$PROJECT_DIR/demo/$demo.265")
  done
fi

for bin in "$BASE" "$HEAD"; do
  if [ ! -x "$bin" ]; then
    echo "error: $bin is not an executable decoder" >&2
    exit 2
  fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

is_failure() { case "$1" in decode-failed|no-output) return 0 ;; *) return 1 ;; esac; }

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
undecodable=""
missing=""
rows=""

for stream in "${STREAMS[@]}"; do
  name="${stream#"$PROJECT_DIR"/}"
  if [ ! -e "$stream" ]; then
    missing="$missing $name"
    continue
  fi

  base_hash=$(hash_of "$BASE" "$stream")
  head_hash=$(hash_of "$HEAD" "$stream")

  # Neither side produced output: undecodable, whether or not they failed the
  # same way. Testing equality first would call decode-failed vs no-output a
  # move, and counting an identical failure as "same" would let a stream nothing
  # can decode pass for healthy.
  if is_failure "$base_hash" && is_failure "$head_hash"; then
    undecodable="$undecodable $name"
  elif [ "$base_hash" = "$head_hash" ]; then
    same=$((same + 1))
  else
    moved=$((moved + 1))
    rows="$rows| \`$name\` | $base_hash | $head_hash |"$'\n'
  fi
done

as_list() { echo "$1" | tr ' ' '\n' | sed '/^$/d;s/^/- `/;s/$/`/'; }

report_gaps() {
  if [ -n "$undecodable" ]; then
    echo
    echo "Decoded at neither the base nor this head, so compared by neither:"
    as_list "$undecodable"
  fi
  if [ -n "$missing" ]; then
    echo
    echo "Not present, so not compared — the comparison covers fewer streams"
    echo "than it should:"
    as_list "$missing"
  fi
}

plural() { [ "$1" -eq 1 ] && echo "stream" || echo "streams"; }
verb()   { [ "$1" -eq 1 ] && echo "decodes" || echo "decode"; }

compared=$((moved + same))
seen=$((compared + $(set -- $undecodable; echo $#)))

# A report of zero streams reads like a pass. It is the opposite: the globs
# matched nothing, or every stream failed, and nothing was compared at all.
if [ "$compared" -eq 0 ]; then
  echo "**Nothing was compared.** $seen $(plural "$seen") looked at, none decoded at"
  echo "both the base and this head — so this run says nothing about the change."
  report_gaps
  exit 2
fi



if [ "$moved" -eq 0 ]; then
  echo "**$compared $(plural "$compared") $(verb "$compared") identically** at the base and at this head."
  echo
  echo "No stream that already decoded moved."
  report_gaps
  exit 0
fi

echo "**$moved of $compared $(plural "$compared") $(verb "$compared") differently** at this head."
echo
echo "| Stream | Base | Head |"
echo "|---|---|---|"
printf '%s' "$rows"
echo
echo "This is expected when the change fixes decoding — that is what a decoding"
echo "fix does. Worth reading rather than dismissing: a fix aimed at one case"
echo "should move that case and little else. \`decode-failed\` means the decoder"
echo "returned non-zero, \`no-output\` that it wrote nothing."
report_gaps
