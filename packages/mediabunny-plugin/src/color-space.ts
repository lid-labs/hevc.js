/**
 * The colour space of a track's decoded frames: the one in its decoder config,
 * which Mediabunny reads from the container's `colr` box and, for whatever
 * that box leaves out, from the SPS VUI.
 *
 * A frame given no colour space is taken as REC709 (BT.709, limited range) by
 * both `VideoFrame` and Mediabunny's `VideoSample`, which washes out HLG and PQ
 * video and clips the shadows and highlights of full-range video. Members the
 * config leaves out take REC709's values, as Mediabunny does for the configs it
 * gives WebCodecs on Chromium: an incomplete colour space can be dropped whole,
 * losing the members that were known (remotion-dev/remotion#10841).
 */
export function frameColorSpace(colorSpace: VideoColorSpaceInit | undefined): VideoColorSpaceInit {
  return {
    primaries: colorSpace?.primaries ?? "bt709",
    transfer: colorSpace?.transfer ?? "bt709",
    matrix: colorSpace?.matrix ?? "bt709",
    fullRange: colorSpace?.fullRange ?? false,
  };
}
