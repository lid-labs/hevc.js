#!/bin/bash
# Check every generated HLS stream against Apple's mediastreamvalidator.
# Usage: ./tools/validate_hls_streams.sh [stream dir ...]   (default: all hls_*)
#
# The validator is the normative authority on HLS conformance, and it caught
# what review and the three players did not: playlists announcing durations the
# segments do not hold, and target durations differing across one master. Both
# made iOS playback stutter while Chrome stayed fine, because hevc.js transcodes
# there and rewrites the timings. So the generators run this before anyone sees
# the output.
#
# macOS only (it ships with Apple's HTTP Live Streaming Tools). Missing, it
# warns and passes, so generating on Linux still works -- the gate is for the
# machine that actually publishes the demo.
set -uo pipefail
STREAMS="demo/streams"

if ! command -v mediastreamvalidator >/dev/null 2>&1; then
  echo "! mediastreamvalidator not found — skipping HLS conformance check."
  echo "  Install Apple's HTTP Live Streaming Tools to enable it:"
  echo "  https://developer.apple.com/documentation/http-live-streaming/using-apple-s-http-live-streaming-tools"
  exit 0
fi

# One work root for the whole run, cleaned up even on interrupt, as the two
# generator scripts next door do.
work_root="$(mktemp -d)"
trap 'rm -rf "$work_root"' EXIT

dirs=("$@")
if [ ${#dirs[@]} -eq 0 ]; then
  dirs=()
  for d in "$STREAMS"/hls_*; do [ -d "$d" ] && dirs+=("$d"); done
fi

failed=0
for dir in "${dirs[@]}"; do
  playlist=""
  for candidate in master.m3u8 playlist.m3u8; do
    [ -f "$dir/$candidate" ] && playlist="$dir/$candidate" && break
  done
  if [ -z "$playlist" ]; then
    echo "✗ $(basename "$dir"): no master.m3u8 or playlist.m3u8"
    failed=1
    continue
  fi

  # The validator always writes validation_data.json into the working
  # directory, so give each run its own and pass the playlist absolute.
  # Resolve the path before the subshell: inside it the cwd is already $work,
  # where a relative $dir no longer exists.
  abs_playlist="$(cd "$dir" && pwd)/$(basename "$playlist")"
  work="$work_root/$(basename "$dir")"
  mkdir -p "$work"
  ( cd "$work" && mediastreamvalidator "$abs_playlist" ) >/dev/null 2>&1
  report="$work/validation_data.json"

  if [ ! -f "$report" ]; then
    echo "✗ $(basename "$dir"): validator produced no report"
    failed=1
    continue
  fi

  if python3 - "$report" "$(basename "$dir")" <<'PY'
import json, sys
report, name = sys.argv[1], sys.argv[2]
messages = []
def collect(node):
    if isinstance(node, dict):
        if "errorComment" in node:
            messages.append((node.get("errorRequirementLevel"),
                             node.get("errorComment"),
                             node.get("errorDetail", "")))
            return
        for value in node.values():
            collect(value)
    elif isinstance(node, list):
        for value in node:
            collect(value)
collect(json.load(open(report)))
if not messages:
    print(f"✓ {name}: conformant")
    sys.exit(0)
print(f"✗ {name}: {len(messages)} message(s)")
for level, comment, detail in messages:
    print(f"    [level {level}] {comment}" + (f" — {detail}" if detail else ""))
sys.exit(1)
PY
  then :; else failed=1; fi
done

[ "$failed" -eq 0 ] || echo "HLS conformance check failed."
exit "$failed"
