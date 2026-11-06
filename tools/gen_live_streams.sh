#!/bin/bash
# Publish a *live* HEVC stream — a sliding window whose segments really expire —
# so the dash.js, Shaka and hls.js demos can be pointed at a live edge. See #387.
#
# Committed files cannot stand in for this. A DASH manifest's availabilityStartTime
# is read against the wall clock, so a `type="dynamic"` manifest written to disk goes
# stale minutes later: the live edge walks off the end of its SegmentTimeline. And a
# frozen HLS playlist never slides, so segment expiry — the case worth testing — is
# never exercised at all.
#
# Usage: ./tools/gen_live_streams.sh dash    (or: hls)
#   Runs in the foreground and publishes in real time. Ctrl-C to stop.
#   Then serve demo/ and paste the printed URL into the demo page's URL field.
#
# Output is not committed: it changes every second (see .gitignore).

set -e

# The output paths below are relative, and .gitignore anchors its live_* patterns at the
# repository root. Run from anywhere else and the script would write a ./demo/streams/
# tree that Git does track — segments changing every second, ready to be committed by
# accident. So move to the root rather than trust the caller's directory.
cd "$(git rev-parse --show-toplevel)" || exit 1

MODE=${1:-}
STREAMS="demo/streams"

# 2s segments, 5 in the manifest, 2 more kept on disk. A segment is therefore
# deleted roughly 14s after it is published, which is what makes expiry
# observable within one sitting.
SEG=2
WINDOW=5
EXTRA=2

# One IDR per segment (50 frames at 25fps): every segment is self-contained, which
# is what lets the transcode pool hand segments to parallel workers. Without it the
# live test would also be testing the open-GOP continuity path.
X265_PARAMS="keyint=50:min-keyint=50"

# ultrafast, because this has to keep up with wall-clock time on the machine that
# is also running the browser, the WASM decoder and the H.264 encoder.
PRESET=ultrafast

# -re paces the synthetic source at wall-clock speed. Without it ffmpeg writes the
# whole window as fast as the CPU allows, and there is no live edge to be at.
SRC_V=(-re -f lavfi -i "testsrc2=size=1280x720:rate=25")
SRC_A=(-re -f lavfi -i "sine=frequency=1000:sample_rate=48000")
# -tag:v hvc1 is not cosmetic here. Measured with ffmpeg 9.0.2: the dash and hls
# muxers write codecs="" for HEVC unless the track is tagged hvc1 — with the default
# hev1 tag, or with -tag:v hev1, the field comes out empty, while libx264 fills it
# either way. Shaka then rejects the stream outright with error 4032
# (CONTENT_UNSUPPORTED_BY_BROWSER); dash.js is more forgiving and plays it anyway.
ENC=(-c:v libx265 -preset "$PRESET" -x265-params "$X265_PARAMS" -pix_fmt yuv420p
     -tag:v hvc1 -c:a aac -b:a 128k)

case "$MODE" in
  dash)
    DIR="$STREAMS/live_dash"
    rm -rf "$DIR" && mkdir -p "$DIR"
    echo "Publishing live DASH to $DIR/ — Ctrl-C to stop"
    echo "URL for the dash.js and Shaka demo pages: streams/live_dash/manifest.mpd"
    exec ffmpeg -y -loglevel warning \
      "${SRC_V[@]}" "${SRC_A[@]}" "${ENC[@]}" \
      -f dash -seg_duration "$SEG" \
      -window_size "$WINDOW" -extra_window_size "$EXTRA" \
      -use_timeline 1 -update_period "$SEG" \
      -adaptation_sets "id=0,streams=v id=1,streams=a" \
      -init_seg_name 'init_$RepresentationID$.mp4' \
      -media_seg_name 'seg_$RepresentationID$_$Number%03d$.m4s' \
      "$DIR/manifest.mpd"
    ;;
  hls)
    DIR="$STREAMS/live_hls"
    rm -rf "$DIR" && mkdir -p "$DIR"
    echo "Publishing live HLS to $DIR/ — Ctrl-C to stop"
    echo "URL for the hls.js demo page: streams/live_hls/playlist.m3u8"
    # fmp4, not mpegts: the hls.js plugin covers fMP4 HLS, and HEVC-in-TS is still
    # unvalidated (ROADMAP.md), so a TS segment would test the wrong thing.
    # delete_segments is what makes a segment actually disappear from disk once it
    # drops out of the playlist.
    # hvc1 comes from ENC above, which the committed HLS streams also use
    # (gen_hls_streams.sh): HLS wants hvc1, and ffmpeg warns when it writes hev1.
    exec ffmpeg -y -loglevel warning \
      "${SRC_V[@]}" "${SRC_A[@]}" "${ENC[@]}" \
      -f hls -hls_time "$SEG" -hls_list_size "$WINDOW" \
      -hls_flags delete_segments \
      -hls_segment_type fmp4 \
      -hls_fmp4_init_filename "init.mp4" \
      -hls_segment_filename "$DIR/seg_%03d.m4s" \
      "$DIR/playlist.m3u8"
    ;;
  *)
    echo "Usage: $0 dash|hls" >&2
    exit 2
    ;;
esac
