#!/bin/bash
# Generate the HLS demo streams by repackaging the DASH ones (-c copy).
# The DASH streams (gen_dash_streams.sh + the checked-in BBB ABR set) are the
# source of truth; HLS carries the exact same HEVC/AAC bitstreams so the two
# demos can't drift apart. Output mirrors the four DASH presets:
#   hls_abr   — Big Buck Bunny 30s, HEVC 480p/720p/1080p ABR + demuxed AAC
#   hls_720p  — animated test pattern, 10s + audio
#   hls_1080p — animated test pattern, 5s + audio
#   hls_4k    — animated test pattern, 5s + audio
# Usage: ./tools/gen_hls_streams.sh   (requires ffmpeg)

set -euo pipefail
STREAMS="demo/streams"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Concatenate a DASH representation (init + numbered segments) into one mp4.
# Args: output, init file, segment glob prefix (numeric suffixes, unpadded ok)
concat_rep() {
  local out=$1 init=$2 prefix=$3
  cat "$init" > "$out"
  local i=1
  while [ -f "${prefix}${i}.m4s" ]; do
    cat "${prefix}${i}.m4s" >> "$out"
    i=$((i + 1))
  done
  # Zero-padded numbering (seg_0_001.m4s style) — only when the unpadded
  # loop matched nothing, so a >99-segment unpadded set can't be
  # concatenated twice (100-999 would match both conventions).
  if [ "$i" -eq 1 ]; then
    for f in "${prefix}"[0-9][0-9][0-9].m4s; do
      [ -f "$f" ] || continue
      cat "$f" >> "$out"
    done
  fi
}


# ffmpeg's hls muxer can't reconstruct codec strings under -c copy, so the
# master playlists come out without a CODECS attribute — and hls.js then
# skips its isTypeSupported level pre-filtering (the very path the hevc.js
# plugin patches). Inject CODECS from the DASH manifest, the source of
# truth, mapping variants by resolution. hev1 -> hvc1 follows the -tag:v.
add_codecs() {
  local master=$1 mpd=$2
  python3 - "$master" "$mpd" <<'PY'
import re, sys
master_path, mpd_path = sys.argv[1], sys.argv[2]
mpd = open(mpd_path).read()
by_width = {}
for rep in re.finditer(r'<Representation[^>]*>', mpd):
    tag = rep.group(0)
    codecs = re.search(r'codecs="([^"]+)"', tag)
    width = re.search(r'\bwidth="(\d+)"', tag)
    if codecs and width:
        by_width[width.group(1)] = codecs.group(1).replace("hev1", "hvc1")
audio = re.search(r'<AdaptationSet[^>]*(?:audio|mp4a)[^>]*codecs="([^"]+)"', mpd)
audio_codec = audio.group(1) if audio else "mp4a.40.2"
out = []
for line in open(master_path):
    m = re.search(r'RESOLUTION=(\d+)x\d+', line)
    if line.startswith("#EXT-X-STREAM-INF") and "CODECS=" not in line and m:
        video_codec = by_width.get(m.group(1))
        if video_codec:
            line = line.rstrip("\n") + f',CODECS="{video_codec},{audio_codec}"\n'
    out.append(line)
open(master_path, "w").writelines(out)
PY
}

# --- hls_abr: BBB 30s, 3 HEVC variants + demuxed AAC audio group ------------
gen_abr() {
  local dir="$STREAMS/hls_abr" src="$STREAMS/dash_abr"
  rm -rf "$dir" && mkdir -p "$dir"

  for rep in 480p 720p 1080p audio; do
    concat_rep "$TMP/abr_${rep}.mp4" \
      "$src/bbb_${rep}_dashinit.mp4" "$src/bbb_${rep}_dash"
  done

  # The DASH source is hev1 with in-band parameter sets and an empty hvcC.
  # HLS needs hvc1, which means "parameter sets out-of-band" — retagging alone
  # produces an init with an empty hvcC that no native decoder can start from
  # (it will not look in-band once the entry says hvc1). Round-tripping through
  # Annex B makes ffmpeg parse VPS/SPS/PPS and write a real hvcC.
  # The other presets are unaffected: their DASH sources already carry them.
  ffmpeg -y -loglevel error \
    -i "$TMP/abr_480p.mp4" -i "$TMP/abr_720p.mp4" -i "$TMP/abr_1080p.mp4" \
    -i "$TMP/abr_audio.mp4" \
    -map 0:v -map 1:v -map 2:v -map 3:a -c copy -tag:v hvc1 \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename "init_%v.mp4" \
    -hls_segment_filename "$dir/seg_%v_%03d.m4s" \
    -var_stream_map "v:0,agroup:aud,name:480p v:1,agroup:aud,name:720p v:2,agroup:aud,name:1080p a:0,agroup:aud,name:audio,default:yes" \
    -master_pl_name "master.m3u8" \
    "$dir/media_%v.m3u8"

  add_codecs "$dir/master.m3u8" "$src/manifest.mpd"

  # The DASH source is hev1 with in-band parameter sets and an empty hvcC, which
  # is valid there. HLS needs hvc1, and -tag:v only relabels the track: the init
  # comes out claiming hvc1 (parameter sets out-of-band) while carrying none, so
  # no native decoder can start — it will not look in-band once the entry says
  # hvc1. Build a donor with a real hvcC and copy just that box across.
  #
  # Only the box is copied. Remuxing the elementary stream to rebuild it would
  # shift keyframe timestamps (Annex B carries none, so B-frame reordering moves
  # them by the reorder depth) and change where the muxer splits segments.
  # One donor per variant: the SPS carries the resolution, so a 480p hvcC in the
  # 1080p init would configure the decoder for the wrong frame size.
  for rep in 480p 720p 1080p; do
    ffmpeg -y -loglevel error -i "$TMP/abr_${rep}.mp4" \
      -c:v copy -bsf:v hevc_mp4toannexb -f hevc "$TMP/donor_${rep}.h265"
    ffmpeg -y -loglevel error -i "$TMP/donor_${rep}.h265" \
      -c:v copy -tag:v hvc1 "$TMP/donor_${rep}.mp4"
    python3 tools/patch_hvcc.py "$TMP/donor_${rep}.mp4" "$dir/init_${rep}.mp4"
  done

  echo "✓ hls_abr ← dash_abr ($(du -sh "$dir" | cut -f1))"
}

# --- hls_{720p,1080p,4k}: test patterns, 1 video variant + audio group ------
# Segment duration follows the DASH source (720p: 2s, 1080p/4k: 1s) — a 2s
# 4K segment is ~50 frames per transcode unit and blows past the WASM
# decoder's 2GB memory ceiling.
gen_mire() {
  local name=$1 seg=$2
  local dir="$STREAMS/hls_${name}" src="$STREAMS/dash_${name}"
  rm -rf "$dir" && mkdir -p "$dir"

  concat_rep "$TMP/${name}_v.mp4" "$src/init_0.mp4" "$src/seg_0_"
  concat_rep "$TMP/${name}_a.mp4" "$src/init_1.mp4" "$src/seg_1_"

  ffmpeg -y -loglevel error \
    -i "$TMP/${name}_v.mp4" -i "$TMP/${name}_a.mp4" \
    -map 0:v -map 1:a -c copy -tag:v hvc1 \
    -f hls -hls_time "$seg" -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename "init_%v.mp4" \
    -hls_segment_filename "$dir/seg_%v_%03d.m4s" \
    -var_stream_map "v:0,agroup:aud,name:video a:0,agroup:aud,name:audio,default:yes" \
    -master_pl_name "master.m3u8" \
    "$dir/media_%v.m3u8"

  add_codecs "$dir/master.m3u8" "$src/manifest.mpd"

  echo "✓ hls_${name} ← dash_${name} ($(du -sh "$dir" | cut -f1))"
}


# --- hls_muxed: a MUXED audio+video HEVC stream (single audiovideo track) ----
# Deliberately unsupported: the transcode pipeline is video-only, so this
# exists to prove the plugin refuses muxed renditions cleanly (clear error,
# no silent audio-less playback) rather than to be played. Encoded from
# lavfi so it stays small and self-contained.
gen_muxed() {
  local dir="$STREAMS/hls_muxed"
  rm -rf "$dir" && mkdir -p "$dir"

  ffmpeg -y -loglevel error \
    -f lavfi -i "testsrc2=size=640x360:rate=25:duration=6" \
    -f lavfi -i "sine=frequency=1000:sample_rate=48000:duration=6" \
    -c:v libx265 -preset ultrafast -x265-params "keyint=25:min-keyint=25:scenecut=0" \
    -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 128k \
    -map 0:v -map 1:a \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename init.mp4 -hls_segment_filename "$dir/seg_%03d.m4s" \
    "$dir/playlist.m3u8"

  echo "✓ hls_muxed (muxed A/V, unsupported by design) — $(du -sh "$dir" | cut -f1)"
}

gen_abr
gen_mire 720p 2
gen_mire 1080p 1
gen_mire 4k 1
gen_muxed

echo "Done. Entry points: $STREAMS/hls_*/master.m3u8"
