/** Decoded YUV frame — planes are copied out of WASM heap */
export interface HEVCFrame {
  /** Luma plane (packed, no stride) */
  y: Uint16Array;
  /** Chroma Cb plane */
  cb: Uint16Array;
  /** Chroma Cr plane */
  cr: Uint16Array;
  /** Luma width (display, after conformance crop) */
  width: number;
  /** Luma height (display) */
  height: number;
  /** Chroma plane width */
  chromaWidth: number;
  /** Chroma plane height */
  chromaHeight: number;
  /** Bit depth (8 or 10) */
  bitDepth: number;
  /** Picture Order Count — display order within one coded video sequence */
  poc: number;
  /**
   * Coded video sequence, incremented at each IRAP that opens one — IDR, BLA,
   * or a CRA first in the stream or after an end-of-sequence NAL. POC restarts
   * there, so display order across a whole stream is (cvsId, poc), not poc alone.
   */
  cvsId: number;
}

/**
 * A decoded picture that is never output: PicOutputFlag = 0 (§C.3.1, §8.1),
 * or emptied from the DPB without output by a new sequence (§C.5.2.2).
 * Ordered the way output pictures are.
 */
export interface SuppressedPicture {
  cvsId: number;
  poc: number;
}

/** Stream metadata — available after first decode */
export interface HEVCStreamInfo {
  width: number;
  height: number;
  bitDepth: number;
  /** 0=mono, 1=4:2:0, 2=4:2:2, 3=4:4:4 */
  chromaFormat: number;
  /** Profile IDC (1=Main, 2=Main10) */
  profile: number;
  /** Level IDC (e.g. 93 = Level 3.1) */
  level: number;
}

/** Result of a decode call */
export interface DecodeResult {
  frames: HEVCFrame[];
  info: HEVCStreamInfo | null;
}

/** Options for creating a decoder */
export interface DecoderOptions {
  /** URL to the hevc-decode.js WASM glue file. Auto-resolved if omitted. */
  wasmUrl?: string;
  /** URL to the .wasm binary. Auto-resolved if omitted. */
  wasmBinaryUrl?: string;
}

/** Worker message types (main → worker) */
export type WorkerRequest =
  | { type: "init"; wasmUrl: string }
  | { type: "decode"; data: ArrayBuffer }
  | { type: "feed"; data: ArrayBuffer }
  | { type: "drain" }
  | { type: "flush" }
  | { type: "destroy" };

/** Worker message types (worker → main) */
export type WorkerResponse =
  | { type: "ready" }
  | { type: "info"; info: HEVCStreamInfo }
  | { type: "frame"; index: number; frame: HEVCFrame }
  | { type: "done"; frameCount: number }
  | { type: "drained"; frames: HEVCFrame[] }
  | { type: "flushed"; frames: HEVCFrame[] }
  | { type: "error"; message: string };
