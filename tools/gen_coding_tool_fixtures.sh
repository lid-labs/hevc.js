#!/bin/bash
# gen_coding_tool_fixtures.sh — Generate HEVC bitstreams exercising transform skip and
# explicit scaling lists, two coding tools no other fixture uses (#300):
#
#   tskip_qcif_6f.265         transform_skip_enabled_flag = 1 (x265 --tskip): 4x4 blocks
#                             coded without a transform, whose residual is scaled by
#                             tsShift = 5 + log2(nTbS) (§8.6.4.2)
#   scaling_list_qcif_6f.265  scaling lists sent in the SPS (x265 --scaling-list <file>),
#                             asymmetric so that coefficients stored in the wrong order
#                             (§7.4.5 sends them in up-right diagonal scan) change the output
#
# Requires: x265, ffmpeg, python3
# Output: tests/conformance/fixtures/{tskip,scaling_list}_qcif_6f.265

set -euo pipefail

FIXTURES_DIR="$(cd "$(dirname "$0")/../tests/conformance/fixtures" && pwd)"
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

W=176
H=144
FRAMES=6

# testsrc2 has the sharp edges and flat areas that make the encoder pick transform skip.
ffmpeg -v error -y -f lavfi -i testsrc2=size=${W}x${H}:rate=25 -frames:v $FRAMES \
    -pix_fmt yuv420p "$WORK/input.yuv"

# Scaling lists in the HM text format x265 reads: one raster matrix per name, with a DC
# value for 16x16 and 32x32. The value grows three times faster along x than along y.
python3 - "$WORK/scaling_list.txt" << 'PY'
import sys

kinds = ['INTRA{s}_LUMA', 'INTRA{s}_CHROMAU', 'INTRA{s}_CHROMAV',
         'INTER{s}_LUMA', 'INTER{s}_CHROMAU', 'INTER{s}_CHROMAV']
lines = []
for size_id, size in enumerate(['4X4', '8X8', '16X16', '32X32']):
    n = 4 if size_id == 0 else 8
    for matrix_id, kind in enumerate(kinds):
        name = kind.format(s=size)
        lines.append(f'{name} =')
        for y in range(n):
            lines.append(','.join(str(16 + 3 * x + y + matrix_id) for x in range(n)) + ',')
        if size_id >= 2:
            lines.append(f'{name}_DC =')
            lines.append(f'{20 + matrix_id},')
open(sys.argv[1], 'w').write('\n'.join(lines) + '\n')
PY

echo "=== Generating coding tool bitstreams (${W}x${H}, $FRAMES frames, I + B) ==="

X265_COMMON=(--input "$WORK/input.yuv" --input-res ${W}x${H} --fps 25 --frames $FRAMES
             --preset medium --keyint $FRAMES --bframes 2 --no-wpp --no-info)

x265 "${X265_COMMON[@]}" --tskip -o "$FIXTURES_DIR/tskip_qcif_6f.265" 2>/dev/null
x265 "${X265_COMMON[@]}" --scaling-list "$WORK/scaling_list.txt" \
    -o "$FIXTURES_DIR/scaling_list_qcif_6f.265" 2>/dev/null

for name in tskip_qcif_6f scaling_list_qcif_6f; do
    output="$FIXTURES_DIR/$name.265"
    echo "--- $name.265 ---"

    ffmpeg -y -i "$output" -pix_fmt yuv420p "$WORK/$name.ref.yuv" 2>/dev/null

    if command -v md5sum &>/dev/null; then
        MD5=$(md5sum "$WORK/$name.ref.yuv" | cut -d' ' -f1)
    else
        MD5=$(md5 -q "$WORK/$name.ref.yuv")
    fi

    echo "  Size:   $(wc -c < "$output" | tr -d ' ') bytes"
    echo "  Frames: $(( $(wc -c < "$WORK/$name.ref.yuv") / (W * H * 3 / 2) )) output by ffmpeg"
    echo "  MD5:    $MD5"
done

echo ""
echo "=== Done ==="
