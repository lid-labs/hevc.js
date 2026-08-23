#!/usr/bin/env python3
"""Copy a complete hvcC box into an fMP4 init segment that lacks one.

Why: ffmpeg's HLS muxer, fed a `hev1` source whose parameter sets live in-band,
writes an `hvc1` sample entry with an empty hvcC. That combination is invalid —
`hvc1` means the parameter sets are out-of-band, so a native decoder never looks
for them in the segments and cannot start at all.

Only the hvcC box is replaced, and every enclosing box header is resized to
match. Segments, timestamps and segment boundaries are left untouched: rewriting
the elementary stream to rebuild the box would shift keyframe timestamps (Annex B
carries none, so B-frame reordering moves them) and change how the muxer splits.

Usage: patch_hvcc.py <donor.mp4> <target-init.mp4> [<target-init.mp4> ...]
The donor is any mp4 of the same bitstream carrying a populated hvcC. Use one
donor per variant: the SPS carries the frame size, so a 480p hvcC in a 1080p
init would configure the decoder for the wrong resolution.
"""

import struct
import sys

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"stsd"}
SAMPLE_ENTRIES = {b"hvc1", b"hev1"}

# A VisualSampleEntry carries 78 bytes of fixed fields (SampleEntry's 8 plus
# VisualSampleEntry's 70) before its child boxes; stsd carries 8 (version/flags
# plus entry_count).
STSD_HEADER = 8
VISUAL_SAMPLE_ENTRY_HEADER = 78


def read_box_header(data, p, end):
    """(type, size) at offset p, or None when it is not a usable box header."""
    if p + 8 > end:
        return None
    size = struct.unpack(">I", data[p : p + 4])[0]
    typ = data[p + 4 : p + 8]
    if size == 0:
        size = end - p
    elif size == 1:
        # 64-bit largesize. Not produced by the ffmpeg muxer for these init
        # segments, and supporting it would mean rewriting a different header
        # field on resize — refuse rather than silently mis-parse.
        raise SystemExit(f"unsupported 64-bit box size on box {typ!r} at offset {p}")
    if size < 8 or p + size > end:
        return None
    return (typ, size)


def ancestors_of(data, target_off):
    """Offsets of every box enclosing target_off, outermost first."""
    found = []

    def walk(start, end):
        p = start
        while p < end:
            header = read_box_header(data, p, end)
            if header is None:
                return
            typ, size = header
            if p < target_off < p + size:
                if typ in CONTAINERS or typ in SAMPLE_ENTRIES:
                    found.append(p)
                inner = p + 8
                if typ == b"stsd":
                    inner += STSD_HEADER
                elif typ in SAMPLE_ENTRIES:
                    inner += VISUAL_SAMPLE_ENTRY_HEADER
                walk(inner, p + size)
                return
            p += size

    walk(0, len(data))
    return found


def find_hvcc(data, label):
    """(offset, size) of the hvcC box, located by walking the box tree.

    Scanning for the four bytes would also search the mdat, whose compressed
    payload can contain them by chance — donors are full mp4s of several MB.
    """
    result = []

    def walk(start, end):
        p = start
        while p < end and not result:
            header = read_box_header(data, p, end)
            if header is None:
                return
            typ, size = header
            if typ == b"hvcC":
                result.append((p, size))
                return
            if typ in CONTAINERS or typ in SAMPLE_ENTRIES:
                inner = p + 8
                if typ == b"stsd":
                    inner += STSD_HEADER
                elif typ in SAMPLE_ENTRIES:
                    inner += VISUAL_SAMPLE_ENTRY_HEADER
                walk(inner, p + size)
            p += size

    walk(0, len(data))
    if not result:
        raise SystemExit(f"{label}: no hvcC box found")
    return result[0]


def donor_hvcc(path):
    with open(path, "rb") as f:
        data = f.read()
    start, size = find_hvcc(data, path)
    if size <= 8:
        raise SystemExit(f"{path}: donor hvcC is empty ({size} bytes)")
    return data[start : start + size]


def patch(target, hvcc):
    with open(target, "rb") as f:
        data = bytearray(f.read())

    start, old_size = find_hvcc(bytes(data), target)
    if bytes(data[start : start + old_size]) == hvcc:
        print(f"  {target}: hvcC already identical, unchanged")
        return

    parents = ancestors_of(bytes(data), start)
    if not parents:
        # Without the enclosing headers the written file would be corrupt, and
        # silently so — every parent box would understate its own length.
        raise SystemExit(f"{target}: could not locate the boxes enclosing hvcC")

    delta = len(hvcc) - old_size
    data[start : start + old_size] = hvcc

    # Grow every enclosing box by the same delta, innermost first so the offsets
    # collected before the splice stay valid.
    for off in sorted(parents, reverse=True):
        size = struct.unpack(">I", bytes(data[off : off + 4]))[0]
        struct.pack_into(">I", data, off, size + delta)

    with open(target, "wb") as f:
        f.write(bytes(data))
    print(f"  {target}: hvcC {old_size} -> {len(hvcc)} bytes "
          f"({len(parents)} enclosing boxes resized)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    box = donor_hvcc(sys.argv[1])
    print(f"donor hvcC: {len(box)} bytes")
    for t in sys.argv[2:]:
        patch(t, box)
