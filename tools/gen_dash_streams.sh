#!/bin/bash
# Generate HEVC DASH test streams (animated mires + audio)
# Usage: ./tools/gen_dash_streams.sh
# Output: demo/streams/dash_{720p,1080p,4k}/

set -e
STREAMS="demo/streams"

gen() {
  local name=$1 w=$2 h=$3 dur=$4 seg=$5
  local dir="$STREAMS/dash_${name}"
  rm -rf "$dir" && mkdir -p "$dir"

  # bframes=0 is what makes these streams play on iOS at all. With B-frames the
  # first PTS lands at 0.08s instead of 0, and the edit list that would correct
  # that is ignored by MSE, per spec. hls.js then sees a hole at the head, jumps
  # to 0.18s, and WebKit cannot reconfigure its decoder at that point:
  # MEDIA_ERR_DECODE, the MediaSource closes, hls.js recovers and the picture
  # blacks out — over and over. Measured on an iPhone 16 / iOS 27: the same mire
  # with the same audio and the same packaging plays without B-frames and fails
  # with them.
  #
  # The hls_abr pack keeps its B-frames and plays, because its samples carry
  # VPS/SPS/PPS in band and WebKit can reconfigure after the jump. That is not
  # reachable here: ffmpeg strips parameter sets out of the samples whenever it
  # writes an MP4 it encoded itself, in hev1 as in hvc1, and an Annex B round
  # trip does not bring them back either. Reorder stays covered by hls_abr,
  # which the e2e suite also exercises, and by the 147 conformance streams.
  # Side benefit: with no composition offset, ffmpeg's EXTINF values are exact.
  #
  # -tag:v hvc1 is what makes ffmpeg write a usable codecs string. Without it,
  # ffmpeg 9.0.2 emits codecs="" for HEVC video in a DASH manifest; dash.js can
  # make nothing of an empty string, drops the video representation and fetches
  # audio only, which failed 7 e2e specs. The sample entry becomes hvc1 rather
  # than hev1, which Safari needs as well since it does not play hev1. The hvcC
  # still carries VPS/SPS/PPS, verified — the empty-hvcC trap the HLS generator
  # documents applies to re-tagging an encoded stream under -c copy, not here.
  #
  # info=0 stops x265 emitting its "user data unregistered" SEI, the one holding
  # its build string and every encoding parameter. ffmpeg files that SEI into the
  # hvcC as a fourth array, 2317 bytes of it, where the box is meant to carry
  # VPS/SPS/PPS and nothing else. The hls_abr preset escaped it only because
  # patch_hvcc.py rebuilds its hvcC from a donor, and it is the one preset that
  # played on iOS while these three stuttered.
  #
  # scenecut=0 keeps IDRs strictly periodic. Without it x265 adds scene-change
  # IDRs to the testsrc2 pattern, and since ffmpeg may only split video at an
  # IDR while it splits audio freely, the two playlists end up with different
  # TARGETDURATION values and EXTINF values that overstate the segments.
  # mediastreamvalidator rejects both, and hls.js reads the EXTINF mismatch as
  # bufferAppendNoProgress.
  ffmpeg -y \
    -f lavfi -i "testsrc2=size=${w}x${h}:rate=25:duration=${dur}" \
    -f lavfi -i "sine=frequency=1000:sample_rate=48000:duration=${dur}" \
    -c:v libx265 -preset fast -x265-params "keyint=25:min-keyint=25:scenecut=0:info=0:bframes=0" -pix_fmt yuv420p -tag:v hvc1 \
    -c:a aac -b:a 128k \
    -f dash -seg_duration "$seg" \
    -adaptation_sets "id=0,streams=v id=1,streams=a" \
    -init_seg_name 'init_$RepresentationID$.mp4' \
    -media_seg_name 'seg_$RepresentationID$_$Number%03d$.m4s' \
    "$dir/manifest.mpd" 2>&1 | tail -3

  echo "✓ $name: ${w}x${h}, ${dur}s, seg=${seg}s → $dir/"
}

gen 720p  1280  720 10 2
gen 1080p 1920 1080  5 1
gen 4k    3840 2160  5 1

echo "Done. Serve with: npx serve demo/"
