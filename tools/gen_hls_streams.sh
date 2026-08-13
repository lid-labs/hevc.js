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

set -e
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
  # Zero-padded numbering (seg_0_001.m4s style)
  for f in $(ls "${prefix}"[0-9][0-9][0-9].m4s 2>/dev/null | sort); do
    cat "$f" >> "$out"
  done
}

# --- hls_abr: BBB 30s, 3 HEVC variants + demuxed AAC audio group ------------
gen_abr() {
  local dir="$STREAMS/hls_abr" src="$STREAMS/dash_abr"
  rm -rf "$dir" && mkdir -p "$dir"

  for rep in 480p 720p 1080p audio; do
    concat_rep "$TMP/abr_${rep}.mp4" \
      "$src/bbb_${rep}_dashinit.mp4" "$src/bbb_${rep}_dash"
  done

  ffmpeg -y -loglevel error \
    -i "$TMP/abr_480p.mp4" -i "$TMP/abr_720p.mp4" -i "$TMP/abr_1080p.mp4" \
    -i "$TMP/abr_audio.mp4" \
    -map 0:v -map 1:v -map 2:v -map 3:a -c copy \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename "init_%v.mp4" \
    -hls_segment_filename "$dir/seg_%v_%03d.m4s" \
    -var_stream_map "v:0,agroup:aud,name:480p v:1,agroup:aud,name:720p v:2,agroup:aud,name:1080p a:0,agroup:aud,name:audio,default:yes" \
    -master_pl_name "master.m3u8" \
    "$dir/media_%v.m3u8"

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
    -map 0:v -map 1:a -c copy \
    -f hls -hls_time "$seg" -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename "init_%v.mp4" \
    -hls_segment_filename "$dir/seg_%v_%03d.m4s" \
    -var_stream_map "v:0,agroup:aud,name:video a:0,agroup:aud,name:audio,default:yes" \
    -master_pl_name "master.m3u8" \
    "$dir/media_%v.m3u8"

  echo "✓ hls_${name} ← dash_${name} ($(du -sh "$dir" | cut -f1))"
}

gen_abr
gen_mire 720p 2
gen_mire 1080p 1
gen_mire 4k 1

echo "Done. Entry points: $STREAMS/hls_*/master.m3u8"
