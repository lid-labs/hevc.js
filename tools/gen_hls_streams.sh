#!/bin/bash
# Generate HEVC HLS test streams (fMP4, video-only) from the demo .265 masters.
# Re-encodes with a 1s IDR cadence (keyint=25 @ 25fps) so the HLS muxer can
# cut clean 1-second segments — the raw masters don't all carry per-second
# IDRs (bbb4k.265 has a single IDR), which -c copy can't segment.
# Usage: ./tools/gen_hls_streams.sh   (requires ffmpeg with libx265)
# Output: demo/streams/bbb{720,1080,4k}/playlist.m3u8

set -e
STREAMS="demo/streams"

gen() {
  local name=$1 src=$2 bitrate=$3
  local dir="$STREAMS/${name}"
  rm -rf "$dir" && mkdir -p "$dir"

  ffmpeg -y -loglevel error \
    -r 25 -i "demo/${src}" \
    -c:v libx265 -preset fast -b:v "$bitrate" \
    -x265-params "keyint=25:min-keyint=25:scenecut=0" \
    -pix_fmt yuv420p -tag:v hvc1 \
    -f hls -hls_time 1 -hls_playlist_type vod \
    -hls_segment_type fmp4 \
    -hls_fmp4_init_filename init.mp4 \
    -hls_segment_filename "$dir/seg_%03d.m4s" \
    "$dir/playlist.m3u8"

  echo "✓ $name ← demo/$src → $(grep -c EXTINF "$dir/playlist.m3u8") segments, $(du -sh "$dir" | cut -f1)"
}

gen bbb720  bbb720_singleslice.265 2500k
gen bbb1080 bbb1080.265 4500k
gen bbb4k   bbb4k.265 15000k

echo "Done. Serve with: python3 ../tests/cors-server.py 8090 (from demo/)"
