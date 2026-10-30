/**
 * `@hevcjs/core/decoder`: the WASM decoder alone, for callers that demux
 * themselves. The main entry point also carries the MSE transcoding
 * pipeline, which imports mp4box, and bundlers keep that import even when
 * nothing uses it: mp4box does not declare itself free of side effects.
 */
export { HEVCDecoder } from "./decoder.js";
export type { HEVCFrame, HEVCStreamInfo, DecodeResult, DecoderOptions, SuppressedPicture } from "./types.js";
