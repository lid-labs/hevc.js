#!/bin/bash
# run_conformance.sh — Decode the JCT-VC HEVC v1 conformance suite and compare
# each output with the reference MD5 shipped alongside the stream.
#
# Usage: tools/run_conformance.sh <decoder> <work-dir> [stream-name…]
#        (CONFORMANCE_TIMEOUT=<seconds>, default 300, bounds each decode)
#
#   <decoder>   hevc-decode binary (a Release build: the suite is ~150 streams)
#   <work-dir>  where the suite is downloaded (zip/) and extracted (x/); kept
#               between runs, so only the first run downloads (~140 MB)
#   stream-name restrict the run to these streams (zip names without .zip)
#
# Each stream counts as PASS when the MD5 of the decoded YUV equals one of the
# MD5s in the files shipped with it, other than the MD5 of the bitstream itself
# (some streams ship both). When the archive carries the reference YUV instead,
# it is compared with that. Prints one line per stream and a total; exits 0 only
# when every stream passed.

set -uo pipefail

SUITE_URL="https://www.itu.int/wftp3/av-arch/jctvc-site/bitstream_exchange/draft_conformance/HEVC_v1/"

if [ "$#" -lt 2 ]; then
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
fi
DECODER="$1"
WORK="$2"
shift 2

[ -x "$DECODER" ] || { echo "error: $DECODER is not an executable decoder" >&2; exit 2; }
command -v curl >/dev/null || { echo "error: curl not found" >&2; exit 2; }
command -v unzip >/dev/null || { echo "error: unzip not found" >&2; exit 2; }

md5_of() {
    if command -v md5sum >/dev/null; then md5sum "$1" | cut -d' ' -f1; else md5 -q "$1"; fi
}

mkdir -p "$WORK/zip" "$WORK/x" "$WORK/out"

if [ "$#" -gt 0 ]; then
    STREAMS=("$@")
else
    LIST="$WORK/list.txt"
    if [ ! -s "$LIST" ]; then
        curl -sf "$SUITE_URL" | grep -oE 'HEVC_v1/[^"]+\.zip' | sed 's|HEVC_v1/||; s|\.zip$||' \
            | sort -u > "$LIST" || { echo "error: cannot list $SUITE_URL" >&2; exit 2; }
    fi
    mapfile -t STREAMS < "$LIST" 2>/dev/null || STREAMS=($(cat "$LIST"))
fi
[ "${#STREAMS[@]}" -gt 0 ] || { echo "error: no stream to run" >&2; exit 2; }

TIMEOUT="${CONFORMANCE_TIMEOUT:-300}"
# A decoder that loops on one stream must not hold the run; perl's alarm is
# there on macOS, where coreutils' timeout is not.
run_bounded() { perl -e 'alarm shift; exec @ARGV or die' "$TIMEOUT" "$@"; }

PASS=0
FAIL=0
for name in "${STREAMS[@]}"; do
    zip="$WORK/zip/$name.zip"
    dir="$WORK/x/$name"
    if [ ! -d "$dir" ]; then
        [ -s "$zip" ] || curl -sf -o "$zip" "$SUITE_URL$name.zip" \
            || { echo "FAIL  $name  (download failed)"; FAIL=$((FAIL + 1)); continue; }
        mkdir -p "$dir" && unzip -qo "$zip" -d "$dir" \
            || { echo "FAIL  $name  (unzip failed)"; FAIL=$((FAIL + 1)); continue; }
    fi

    bitstream=$(find "$dir" -type f \( -iname '*.bit' -o -iname '*.bin' \) ! -name '._*' | head -1)
    if [ -z "$bitstream" ]; then
        echo "FAIL  $name  (no bitstream in the archive)"; FAIL=$((FAIL + 1)); continue
    fi

    # Reference MD5s: every MD5 in the archive's md5 files except the bitstream's
    bit_md5=$(md5_of "$bitstream")
    refs=$(find "$dir" -type f -iname '*md5*' ! -name '._*' -exec cat {} + 2>/dev/null \
        | grep -oE '[0-9a-fA-F]{32}' | tr 'A-F' 'a-f' | grep -v "^$bit_md5\$" | sort -u)
    ref_yuv=$(find "$dir" -type f -iname '*.yuv' ! -name '._*' | head -1)
    if [ -n "$ref_yuv" ]; then
        refs=$(printf '%s\n%s\n' "$refs" "$(md5_of "$ref_yuv")" | sed '/^$/d' | sort -u)
    fi
    if [ -z "$refs" ]; then
        echo "FAIL  $name  (no reference MD5 in the archive)"; FAIL=$((FAIL + 1)); continue
    fi

    out="$WORK/out/$name.yuv"
    rm -f "$out"
    status=0
    run_bounded "$DECODER" "$bitstream" -o "$out" >/dev/null 2>&1 || status=$?
    if [ "$status" -eq 142 ]; then
        echo "FAIL  $name  (no result after ${TIMEOUT}s)"; FAIL=$((FAIL + 1)); rm -f "$out"; continue
    fi
    if [ "$status" -ne 0 ] || [ ! -s "$out" ]; then
        echo "FAIL  $name  (decoder exit $status)"; FAIL=$((FAIL + 1)); rm -f "$out"; continue
    fi

    got=$(md5_of "$out")
    rm -f "$out"
    if printf '%s\n' "$refs" | grep -qx "$got"; then
        echo "PASS  $name"; PASS=$((PASS + 1))
    else
        echo "FAIL  $name  (MD5 $got)"; FAIL=$((FAIL + 1))
    fi
done

echo
echo "$PASS / $((PASS + FAIL)) streams match their reference MD5"
[ "$FAIL" -eq 0 ]
