import type { PackedFrame } from "./frames.js";
import type { PictureOrder } from "./output-timestamps.js";

/** Page → decode worker. Messages are handled one at a time, in order. */
export type ToWorker =
  | {
      type: "init";
      /** Emscripten glue, loaded with importScripts() */
      wasmUrl: string;
      wasmBinaryUrl: string;
      /** Byte length of the NAL size prefix of the packets, or 0 for Annex B */
      nalLengthSize: number;
      /** VPS/SPS/PPS of the decoder config, as Annex B */
      parameterSets: Uint8Array | null;
      /** Whether the page's VideoFrame accepts I420P10 */
      i420p10: boolean;
    }
  | { type: "decode"; data: ArrayBuffer }
  | { type: "flush" }
  | { type: "close" };

/** Decode worker → page. */
export type FromWorker =
  | { type: "ready" }
  /** One per "decode": the pictures it suppressed, then the frames it released */
  | { type: "output"; suppressed: PictureOrder[]; frames: PackedFrame[] }
  | { type: "flushed"; frames: PackedFrame[] }
  | { type: "error"; message: string };
