#!/bin/bash
# gen_open_gop_fixtures.sh — Generate open-GOP HEVC bitstreams carrying RASL pictures
#
# §8.1 ends the derivation of PicOutputFlag with an override: a RASL picture whose
# associated IRAP has NoRaslOutputFlag = 1 is not output, because the references it
# needs precede that IRAP in decode order and were never decoded. Covering that clause
# needs two bitstreams, and no fixture in the suite carried a RASL picture at all:
#
#   opengop_qcif_12f.265        CRA mid-stream, NoRaslOutputFlag = 0 — RASL are output
#   opengop_qcif_cra_first.265  the same stream cut at its second CRA, so that CRA opens
#                               the bitstream and takes NoRaslOutputFlag = 1 — its three
#                               RASL pictures must not be output
#
# The cut is what makes the clause reachable: x265 only ever emits a CRA mid-stream, and
# a CRA that follows a decodable sequence has NoRaslOutputFlag = 0.
#
# Requires: x265, ffmpeg, python3
# Output: tests/conformance/fixtures/opengop_*.265

set -euo pipefail

FIXTURES_DIR="$(cd "$(dirname "$0")/../tests/conformance/fixtures" && pwd)"
WORK=$(mktemp -d)
trap "rm -rf $WORK" EXIT

W=176
H=144
FRAMES=12

# Raw YUV420: a luma gradient translated 4 px per frame. Real motion, so the encoder
# produces B pictures worth referencing; flat chroma keeps the fixture small.
python3 -c "
import sys
w, h, n = $W, $H, $FRAMES
out = sys.stdout.buffer
for f in range(n):
    out.write(bytes(((y * 3 + x + f * 4) % 256) for y in range(h) for x in range(w)))
    out.write(b'\x80' * (w // 2 * h // 2) * 2)
" > "$WORK/input.yuv"

echo "=== Generating open-GOP bitstreams (${W}x${H}, $FRAMES frames, CRA + RASL) ==="

# --open-gop turns the periodic key frames into CRA rather than IDR; --bframes gives
# each CRA the trailing B pictures that become its RASL set. keyint 4 keeps the stream
# short while still producing two CRA, the second of which is the cut point.
x265 --input "$WORK/input.yuv" --input-res ${W}x${H} --fps 25 --frames $FRAMES \
    --preset medium --qp 22 --no-wpp --no-info \
    --keyint 4 --min-keyint 4 --open-gop --bframes 3 \
    -o "$FIXTURES_DIR/opengop_qcif_12f.265" 2>/dev/null

python3 - "$FIXTURES_DIR" << 'PY'
import pathlib, sys

CRA_NUT = 21
fixtures = pathlib.Path(sys.argv[1])
data = (fixtures / 'opengop_qcif_12f.265').read_bytes()

# Start code offsets, keeping the leading zero of a 4-byte one so the cut stays parsable
nals = []
i = 0
while True:
    i = data.find(b'\x00\x00\x01', i)
    if i < 0:
        break
    start = i - 1 if i > 0 and data[i - 1] == 0 else i
    nals.append((start, (data[i + 3] >> 1) & 0x3F))
    i += 3

# Everything before the first VCL unit is VPS/SPS/PPS (and any SEI): the cut stream
# needs them, since it starts at a picture rather than at the top of the bitstream.
first_vcl = next(start for start, nal_type in nals if nal_type < 32)
cras = [start for start, nal_type in nals if nal_type == CRA_NUT]
if len(cras) < 2:
    sys.exit(f'expected at least two CRA, found {len(cras)}')

(fixtures / 'opengop_qcif_cra_first.265').write_bytes(data[:first_vcl] + data[cras[1]:])
PY

for name in opengop_qcif_12f opengop_qcif_cra_first; do
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
