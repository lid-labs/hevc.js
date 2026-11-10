#!/usr/bin/env python3
"""Rewrite EXTINF and EXT-X-TARGETDURATION from what the segments actually hold.

ffmpeg's HLS fMP4 muxer derives EXTINF from presentation timestamps without
accounting for B-frame reorder delay, so with B-frames it overstates segments
by the reorder depth. Measured with ffmpeg 9.0.2: a 1.84s segment is announced
as 2.00s, which mediastreamvalidator rejects ("Playlist vs segment duration
mismatch") and hls.js reads as bufferAppendNoProgress -- it treats a fragment
as buffered only once `duration - coverage <= 0.05`, and 0.16s blows past that.
Encoding without B-frames also fixes it, at the cost of no longer exercising
reorder in the demo and its e2e runs.

Durations come from the trun sample durations, in the mdhd timescale of the
init segment. Apple's authoring spec also wants one target duration across a
master, so every playlist gets the highest one.

Usage: fix_hls_durations.py <master.m3u8>
"""
import re
import struct
import sys
from pathlib import Path

# Boxes we descend into on the way to mdhd / trun.
CONTAINERS = {"moov", "trak", "mdia", "moof", "traf"}


def walk(buf, start, end, visit):
    offset = start
    while offset + 8 <= end:
        size = struct.unpack_from(">I", buf, offset)[0]
        kind = buf[offset + 4:offset + 8].decode("latin1")
        header = 8
        if size == 1:
            size = struct.unpack_from(">Q", buf, offset + 8)[0]
            header = 16
        elif size == 0:
            size = end - offset
        if size < header:
            return
        visit(kind, offset + header)
        if kind in CONTAINERS:
            walk(buf, offset + header, offset + size, visit)
        offset += size


def timescale(init_path):
    buf = init_path.read_bytes()
    found = []

    def visit(kind, body):
        if kind == "mdhd" and not found:
            version = buf[body]
            found.append(struct.unpack_from(">I", buf, body + (20 if version == 1 else 12))[0])

    walk(buf, 0, len(buf), visit)
    if not found:
        raise SystemExit(f"{init_path}: no mdhd, cannot read the timescale")
    return found[0]


def segment_duration(path, scale):
    """Sum of sample durations, in seconds."""
    buf = path.read_bytes()
    total = 0
    # tf_flags order is duration (0x08), size (0x10), then flags (0x20).
    default_duration = [0]

    def visit(kind, body):
        nonlocal total
        if kind == "tfhd":
            flags = struct.unpack_from(">I", buf, body)[0] & 0xFFFFFF
            cursor = body + 8
            if flags & 0x01:
                cursor += 8
            if flags & 0x02:
                cursor += 4
            default_duration[0] = struct.unpack_from(">I", buf, cursor)[0] if flags & 0x08 else 0
        elif kind == "trun":
            flags = struct.unpack_from(">I", buf, body)[0] & 0xFFFFFF
            count = struct.unpack_from(">I", buf, body + 4)[0]
            cursor = body + 8
            if flags & 0x001:
                cursor += 4
            if flags & 0x004:
                cursor += 4
            for _ in range(count):
                if flags & 0x100:
                    total += struct.unpack_from(">I", buf, cursor)[0]
                    cursor += 4
                else:
                    total += default_duration[0]
                for bit in (0x200, 0x400, 0x800):
                    if flags & bit:
                        cursor += 4

    walk(buf, 0, len(buf), visit)
    if total == 0:
        raise SystemExit(f"{path}: no sample durations found")
    return total / scale


def media_playlists(master_path):
    """Media playlist URIs of a master: variants plus EXT-X-MEDIA renditions."""
    uris, lines = [], master_path.read_text().splitlines()
    for index, line in enumerate(lines):
        if line.startswith("#EXT-X-MEDIA"):
            found = re.search(r'URI="([^"]+)"', line)
            if found:
                uris.append(found.group(1))
        elif line.startswith("#EXT-X-STREAM-INF"):
            for following in lines[index + 1:]:
                if following and not following.startswith("#"):
                    uris.append(following)
                    break
    return list(dict.fromkeys(uris))


def retime(playlist_path):
    """Rewrite EXTINF from the segments. Returns the target duration it needs."""
    base = playlist_path.parent
    lines = playlist_path.read_text().splitlines(keepends=True)
    scale = None
    out, longest = [], 0
    pending = None
    for line in lines:
        found = re.match(r'#EXT-X-MAP:URI="([^"]+)"', line.strip())
        if found:
            scale = timescale(base / found.group(1))
            out.append(line)
            continue
        if line.startswith("#EXTINF:"):
            pending = len(out)
            out.append(line)
            continue
        stripped = line.strip()
        if pending is not None and stripped and not stripped.startswith("#"):
            if scale is None:
                raise SystemExit(f"{playlist_path}: segment before EXT-X-MAP")
            seconds = segment_duration(base / stripped, scale)
            out[pending] = f"#EXTINF:{seconds:.6f},\n"
            longest = max(longest, seconds)
            pending = None
        out.append(line)
    playlist_path.write_text("".join(out))
    return round(longest)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    master = Path(sys.argv[1])
    playlists = [master.parent / uri for uri in media_playlists(master)]
    if not playlists:
        raise SystemExit(f"{master}: no media playlist found")
    target = max(retime(path) for path in playlists)
    for path in playlists:
        text = re.sub(r"^#EXT-X-TARGETDURATION:\d+$", f"#EXT-X-TARGETDURATION:{target}",
                      path.read_text(), flags=re.M)
        path.write_text(text)
    print(f"  {master.parent.name}: EXTINF retimed, target duration {target}s "
          f"across {len(playlists)} playlist(s)")


if __name__ == "__main__":
    main()
