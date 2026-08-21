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
The donor is any mp4 of the same bitstream carrying a populated hvcC.
"""

import struct
import sys

CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"stsd"}


def find_box(data, path, start=0, end=None):
    """Byte range (start, size) of the first box named path[-1], following path."""
    end = len(data) if end is None else end
    want = path[0]
    p = start
    while p + 8 <= end:
        size = struct.unpack(">I", data[p : p + 4])[0]
        typ = data[p + 4 : p + 8]
        if size == 0:
            size = end - p
        if size < 8:
            return None
        if typ == want:
            if len(path) == 1:
                return (p, size)
            inner = p + 8
            # stsd has an 8-byte header (version/flags + entry count) before its
            # child boxes; sample entries then hold their own 78-byte preamble.
            if typ == b"stsd":
                inner += 8 + 78
            return find_box(data, path[1:], inner, p + size)
        p += size
    return None


def ancestors_of(data, target_off):
    """Offsets of every container box enclosing target_off, outermost first."""
    found = []

    def walk(start, end):
        p = start
        while p + 8 <= end:
            size = struct.unpack(">I", data[p : p + 4])[0]
            typ = data[p + 4 : p + 8]
            if size == 0:
                size = end - p
            if size < 8:
                return
            if p < target_off < p + size:
                if typ in CONTAINERS or typ in (b"hvc1", b"hev1"):
                    found.append(p)
                inner = p + 8
                if typ == b"stsd":
                    inner += 8
                walk(inner, p + size)
                return
            p += size

    walk(0, len(data))
    return found


def donor_hvcc(path):
    data = open(path, "rb").read()
    at = data.find(b"hvcC")
    if at < 4:
        raise SystemExit(f"{path}: no hvcC box found")
    start = at - 4
    size = struct.unpack(">I", data[start : start + 4])[0]
    if size <= 8:
        raise SystemExit(f"{path}: donor hvcC is empty ({size} bytes)")
    return data[start : start + size]


def patch(target, hvcc):
    data = bytearray(open(target, "rb").read())
    at = data.find(b"hvcC")
    if at < 4:
        raise SystemExit(f"{target}: no hvcC box to replace")
    start = at - 4
    old_size = struct.unpack(">I", bytes(data[start : start + 4]))[0]
    if old_size == len(hvcc):
        print(f"  {target}: already {old_size} bytes, unchanged")
        return

    parents = ancestors_of(bytes(data), start)
    delta = len(hvcc) - old_size
    data[start : start + old_size] = hvcc

    # Grow every enclosing box by the same delta, innermost first so the offsets
    # collected before the splice stay valid.
    for off in sorted(parents, reverse=True):
        size = struct.unpack(">I", bytes(data[off : off + 4]))[0]
        struct.pack_into(">I", data, off, size + delta)

    open(target, "wb").write(bytes(data))
    print(f"  {target}: hvcC {old_size} -> {len(hvcc)} bytes "
          f"({len(parents)} enclosing boxes resized)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    box = donor_hvcc(sys.argv[1])
    print(f"donor hvcC: {len(box)} bytes")
    for t in sys.argv[2:]:
        patch(t, box)
