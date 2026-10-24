#!/bin/bash
# gen_merge_fixture.sh — Generate an HEVC bitstream whose B pictures exercise merge
# candidate pruning (§8.5.3.2.3) next to 8x4 and 4x8 prediction units (#302):
#
#   merge_8x4_480p_16f.265  8x8 CUs split into 2NxN / Nx2N, up to 5 merge candidates.
#                           The 8x4/4x8 bi-to-uni restriction (§8.5.3.2.2) leaves such a
#                           prediction unit with an unused L1 motion vector; a decoder that
#                           compares it when pruning keeps a duplicate candidate, and every
#                           later merge index picks the wrong one.
#
# Few encodes hit the case: of the settings tried, this one did, at 832x480 and 16
# pictures, from Big Buck Bunny (demo/bbb720_singleslice.265) scaled down.
#
# Requires: x265, ffmpeg
# Output: tests/conformance/fixtures/merge_8x4_480p_16f.265

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES_DIR="$ROOT/tests/conformance/fixtures"
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

W=832
H=480
FRAMES=16
OUTPUT="$FIXTURES_DIR/merge_8x4_480p_16f.265"

ffmpeg -v error -y -i "$ROOT/demo/bbb720_singleslice.265" -vf scale=${W}:${H} -frames:v $FRAMES \
    -pix_fmt yuv420p "$WORK/input.yuv"

echo "=== Generating merge pruning bitstream (${W}x${H}, $FRAMES frames, I + P + B) ==="

x265 --input "$WORK/input.yuv" --input-res ${W}x${H} --fps 25 --frames $FRAMES \
     --keyint $FRAMES --preset slower --rect --min-cu-size 8 --max-merge 5 \
     --b-adapt 0 --bframes 4 --qp 24 --no-wpp --no-info -o "$OUTPUT" 2>/dev/null

ffmpeg -y -i "$OUTPUT" -pix_fmt yuv420p "$WORK/ref.yuv" 2>/dev/null

if command -v md5sum &>/dev/null; then
    MD5=$(md5sum "$WORK/ref.yuv" | cut -d' ' -f1)
else
    MD5=$(md5 -q "$WORK/ref.yuv")
fi

echo "  Size:   $(wc -c < "$OUTPUT" | tr -d ' ') bytes"
echo "  Frames: $(( $(wc -c < "$WORK/ref.yuv") / (W * H * 3 / 2) )) output by ffmpeg"
echo "  MD5:    $MD5"
