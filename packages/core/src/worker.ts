import type { WorkerRequest, WorkerResponse, HEVCFrame, HEVCStreamInfo } from "./types.js";
import { parseFrameLayout, type FrameLayout } from "./frame-layout.js";

/**
 * Emscripten module interface
 */
interface EmscriptenModule {
  cwrap(name: string, returnType: string | null, argTypes: string[]): Function;
  _malloc(size: number): number;
  _free(ptr: number): void;
  getValue(ptr: number, type: string): number;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
}

interface DecoderAPI {
  create: () => number;
  destroy: (dec: number) => void;
  decode: (dec: number, ptr: number, size: number) => number;
  getFrameCount: (dec: number) => number;
  getFrame: (dec: number, index: number, framePtr: number) => number;
  getInfo: (dec: number, infoPtr: number) => number;
  frameLayout: () => string;
}

let decoder: {
  m: EmscriptenModule;
  api: DecoderAPI;
  dec: number;
  /** Where HEVCFrame's fields sit, as the module itself reports them. */
  layout: FrameLayout;
} | null = null;

function post(msg: WorkerResponse, transfer?: Transferable[]): void {
  if (transfer) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { type } = e.data;

  try {
    if (type === "init") {
      importScripts(e.data.wasmUrl);
      const ModuleFactory = (self as unknown as Record<string, unknown>).HEVCDecoderModule as (
        opts?: Record<string, unknown>,
      ) => Promise<EmscriptenModule>;
      const m = await ModuleFactory();

      const api: DecoderAPI = {
        create: m.cwrap("hevc_decoder_create", "number", []) as () => number,
        destroy: m.cwrap("hevc_decoder_destroy", null, ["number"]) as (dec: number) => void,
        decode: m.cwrap("hevc_decoder_decode", "number", ["number", "number", "number"]) as (dec: number, ptr: number, size: number) => number,
        getFrameCount: m.cwrap("hevc_decoder_get_frame_count", "number", ["number"]) as (dec: number) => number,
        getFrame: m.cwrap("hevc_decoder_get_frame", "number", ["number", "number", "number"]) as (dec: number, index: number, framePtr: number) => number,
        getInfo: m.cwrap("hevc_decoder_get_info", "number", ["number", "number"]) as (dec: number, infoPtr: number) => number,
        frameLayout: m.cwrap("hevc_frame_layout", "string", []) as () => string,
      };

      const dec = api.create();
      if (!dec) throw new Error("Failed to create decoder");

      decoder = { m, api, dec, layout: parseFrameLayout(api.frameLayout()) };
      post({ type: "ready" });

    } else if (type === "decode") {
      if (!decoder) throw new Error("Decoder not initialized");
      const { m, api, dec } = decoder;
      const data = new Uint8Array(e.data.data);

      const ptr = m._malloc(data.length);
      m.HEAPU8.set(data, ptr);
      const ret = api.decode(dec, ptr, data.length);
      m._free(ptr);

      if (ret !== 0) throw new Error("Decode failed");

      // Stream info
      const infoPtr = m._malloc(24);
      if (api.getInfo(dec, infoPtr) === 0) {
        post({
          type: "info",
          info: {
            width:        m.getValue(infoPtr, "i32"),
            height:       m.getValue(infoPtr + 4, "i32"),
            bitDepth:     m.getValue(infoPtr + 8, "i32"),
            chromaFormat: m.getValue(infoPtr + 12, "i32"),
            profile:      m.getValue(infoPtr + 16, "i32"),
            level:        m.getValue(infoPtr + 20, "i32"),
          },
        });
      }
      m._free(infoPtr);

      // Frames
      const count = api.getFrameCount(dec);
      const at = decoder.layout.offset;
      const framePtr = m._malloc(decoder.layout.size);

      for (let i = 0; i < count; i++) {
        if (api.getFrame(dec, i, framePtr) !== 0) continue;

        const yPtr    = m.getValue(framePtr + at.y, "*");
        const cbPtr   = m.getValue(framePtr + at.cb, "*");
        const crPtr   = m.getValue(framePtr + at.cr, "*");
        const width   = m.getValue(framePtr + at.width, "i32");
        const height  = m.getValue(framePtr + at.height, "i32");
        const strideY = m.getValue(framePtr + at.stride_y, "i32");
        const strideC = m.getValue(framePtr + at.stride_c, "i32");
        const cw      = m.getValue(framePtr + at.chroma_width, "i32");
        const ch      = m.getValue(framePtr + at.chroma_height, "i32");
        const bd      = m.getValue(framePtr + at.bit_depth, "i32");
        const poc     = m.getValue(framePtr + at.poc, "i32");
        const cvsId   = m.getValue(framePtr + at.cvs_id, "i32");

        const bps     = m.getValue(framePtr + at.bytes_per_sample, "i32");

        const y  = copyPlane(m, yPtr, width, height, strideY, bps);
        const cb = copyPlane(m, cbPtr, cw, ch, strideC, bps);
        const cr = copyPlane(m, crPtr, cw, ch, strideC, bps);

        post(
          {
            type: "frame",
            index: i,
            frame: { y, cb, cr, width, height, chromaWidth: cw, chromaHeight: ch, bitDepth: bd, poc, cvsId },
          },
          [y.buffer, cb.buffer, cr.buffer],
        );
      }

      m._free(framePtr);
      post({ type: "done", frameCount: count });

    } else if (type === "destroy") {
      if (decoder) {
        decoder.api.destroy(decoder.dec);
        decoder = null;
      }
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

// bytesPerSample 1: an 8-bit picture, one byte per sample; set() widens it
function copyPlane(m: EmscriptenModule, ptr: number, width: number, height: number, stride: number,
                   bytesPerSample: number): Uint16Array {
  const out = new Uint16Array(width * height);
  const heap = bytesPerSample === 1 ? m.HEAPU8 : m.HEAPU16;
  const base = bytesPerSample === 1 ? ptr : ptr >> 1;
  for (let y = 0; y < height; y++) {
    out.set(heap.subarray(base + y * stride, base + y * stride + width), y * width);
  }
  return out;
}
