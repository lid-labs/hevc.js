import { afterEach, describe, expect, it } from "vitest";
import { HEVCDecoder } from "./decoder.js";

/**
 * The decoder reads a frame out of the WASM heap through a struct whose
 * `bytes_per_sample` field says whether a sample is one byte or two.
 * An 8-bit picture is stored one byte per sample and widened into the
 * `Uint16Array` planes the JS API has always handed out, so a mistake here —
 * reading the wrong heap view, halving a byte pointer, sign-extending a sample —
 * produces plausible-looking pixels rather than an error. These tests fabricate
 * both storage layouts and check the samples that come out.
 */

/** The layout the real module reports: `hevc_frame_layout()` under wasm32. */
const WASM32_LAYOUT: Record<string, number> = {
  y: 0, cb: 4, cr: 8, width: 12, height: 16, stride_y: 20, stride_c: 24,
  chroma_width: 28, chroma_height: 32, bit_depth: 36, poc: 40, cvs_id: 44,
  bytes_per_sample: 48, _size: 52,
};

interface Plane {
  /** Samples row by row, `width` of them per row. */
  rows: number[][];
  /** Row pitch in samples, which the decoder must honour over the width. */
  stride: number;
}

interface Picture {
  luma: Plane;
  chroma: Plane;
  bitDepth: number;
  bytesPerSample: number;
  /** Offset the luma plane by this many bytes, to land it on an odd address. */
  lumaByteSkew?: number;
}

/**
 * A fake Emscripten module holding one picture, enough for `decode()`:
 * a bump-allocated heap, `getValue` over a `DataView`, and `cwrap` handing out
 * the decoder entry points the wrapper asks for.
 */
function fakeModule(picture: Picture, layout: Record<string, number> = WASM32_LAYOUT) {
  const buffer = new ArrayBuffer(4096);
  const HEAPU8 = new Uint8Array(buffer);
  const HEAPU16 = new Uint16Array(buffer);
  const view = new DataView(buffer);
  let cursor = 16;

  const malloc = (size: number) => {
    const ptr = cursor;
    cursor = (cursor + size + 3) & ~3;
    return ptr;
  };

  const writePlane = ({ rows, stride }: Plane, skew = 0) => {
    const height = rows.length;
    const bytes = picture.bytesPerSample * stride * height;
    // The skew lands an 8-bit plane on an odd address: a reader that divided
    // the pointer by two would then be off by half a sample.
    const ptr = malloc(bytes + skew) + skew;
    rows.forEach((row, y) => {
      row.forEach((sample, x) => {
        const index = y * stride + x;
        if (picture.bytesPerSample === 1) HEAPU8[ptr + index] = sample;
        else HEAPU16[(ptr >> 1) + index] = sample;
      });
    });
    return ptr;
  };

  const yPtr = writePlane(picture.luma, picture.lumaByteSkew ?? 0);
  const cbPtr = writePlane(picture.chroma);
  const crPtr = writePlane(picture.chroma);

  const width = picture.luma.rows[0]!.length;
  const height = picture.luma.rows.length;
  const chromaWidth = picture.chroma.rows[0]!.length;
  const chromaHeight = picture.chroma.rows.length;

  const api: Record<string, (...args: number[]) => number | string> = {
    hevc_decoder_create: () => 1,
    hevc_decoder_destroy: () => 0,
    hevc_decoder_decode: () => 0,
    hevc_decoder_get_frame_count: () => 1,
    hevc_decoder_get_frame: (_dec: number, _index: number, framePtr: number) => {
      // Written where this module says the fields are, not where the reader
      // might assume: that is what the shuffled-layout case below checks.
      view.setUint32(framePtr + layout.y!, yPtr, true);
      view.setUint32(framePtr + layout.cb!, cbPtr, true);
      view.setUint32(framePtr + layout.cr!, crPtr, true);
      view.setInt32(framePtr + layout.width!, width, true);
      view.setInt32(framePtr + layout.height!, height, true);
      view.setInt32(framePtr + layout.stride_y!, picture.luma.stride, true);
      view.setInt32(framePtr + layout.stride_c!, picture.chroma.stride, true);
      view.setInt32(framePtr + layout.chroma_width!, chromaWidth, true);
      view.setInt32(framePtr + layout.chroma_height!, chromaHeight, true);
      view.setInt32(framePtr + layout.bit_depth!, picture.bitDepth, true);
      view.setInt32(framePtr + layout.poc!, 7, true);
      view.setInt32(framePtr + layout.cvs_id!, 3, true);
      view.setInt32(framePtr + layout.bytes_per_sample!, picture.bytesPerSample, true);
      return 0;
    },
    hevc_frame_layout: () =>
      Object.entries(layout).map(([name, offset]) => `${name}:${offset}`).join(","),
    hevc_decoder_get_info: (_dec: number, infoPtr: number) => {
      view.setInt32(infoPtr, width, true);
      view.setInt32(infoPtr + 4, height, true);
      view.setInt32(infoPtr + 8, picture.bitDepth, true);
      view.setInt32(infoPtr + 12, 1, true); // 4:2:0
      view.setInt32(infoPtr + 16, picture.bitDepth === 8 ? 1 : 2, true);
      view.setInt32(infoPtr + 20, 120, true); // level 4.0
      return 0;
    },
  };

  return {
    HEAPU8,
    HEAPU16,
    _malloc: malloc,
    _free: () => {},
    getValue: (ptr: number, type: string) =>
      type === "i32" || type === "*" ? view.getInt32(ptr, true) : view.getInt32(ptr, true),
    cwrap: (name: string) => api[name] ?? (() => 0),
  };
}

async function decodeOnePicture(picture: Picture, layout?: Record<string, number>) {
  // The wrapper prefers a module factory on globalThis over a dynamic import.
  (globalThis as Record<string, unknown>).HEVCDecoderModule = () =>
    Promise.resolve(fakeModule(picture, layout));
  const decoder = await HEVCDecoder.create();
  try {
    const { frames } = decoder.decode(new Uint8Array([0, 0, 0, 1]));
    expect(frames).toHaveLength(1);
    return frames[0]!;
  } finally {
    decoder.destroy();
  }
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).HEVCDecoderModule;
});

describe("HEVCDecoder frame export", () => {
  it("widens an 8-bit picture stored one byte per sample", async () => {
    const frame = await decodeOnePicture({
      // Stride wider than the width: the padding bytes must not come out.
      luma: { rows: [[16, 200, 255], [0, 128, 17]], stride: 5 },
      chroma: { rows: [[64, 192]], stride: 3 },
      bitDepth: 8,
      bytesPerSample: 1,
    });

    expect(frame.y).toBeInstanceOf(Uint16Array);
    expect([...frame.y]).toEqual([16, 200, 255, 0, 128, 17]);
    expect([...frame.cb]).toEqual([64, 192]);
    expect([...frame.cr]).toEqual([64, 192]);
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(2);
    expect(frame.chromaWidth).toBe(2);
    expect(frame.bitDepth).toBe(8);
    expect(frame.poc).toBe(7);
    expect(frame.cvsId).toBe(3);
  });

  it("reads an 8-bit plane at an odd address", async () => {
    const frame = await decodeOnePicture({
      luma: { rows: [[1, 2, 3, 4]], stride: 4 },
      chroma: { rows: [[5, 6]], stride: 2 },
      bitDepth: 8,
      bytesPerSample: 1,
      lumaByteSkew: 1,
    });

    expect([...frame.y]).toEqual([1, 2, 3, 4]);
  });

  it("reads a 10-bit picture stored two bytes per sample", async () => {
    const frame = await decodeOnePicture({
      luma: { rows: [[1023, 512, 3], [64, 900, 0]], stride: 4 },
      chroma: { rows: [[1000, 1]], stride: 2 },
      bitDepth: 10,
      bytesPerSample: 2,
    });

    expect([...frame.y]).toEqual([1023, 512, 3, 64, 900, 0]);
    expect([...frame.cb]).toEqual([1000, 1]);
    expect(frame.bitDepth).toBe(10);
  });

  it("reads the fields where the module says they are", async () => {
    // Every field moved and the struct grown, which only the module's own
    // report can tell the reader: against hardcoded offsets this picture comes
    // out as a pointer read off a width, and the planes as whatever the heap
    // holds at offset 0.
    const shuffled: Record<string, number> = {
      bytes_per_sample: 0, cvs_id: 4, poc: 8, bit_depth: 12, chroma_height: 16,
      chroma_width: 20, stride_c: 24, stride_y: 28, height: 32, width: 36,
      cr: 40, cb: 44, y: 48, _size: 64,
    };
    const frame = await decodeOnePicture(
      {
        luma: { rows: [[11, 22, 33], [44, 55, 66]], stride: 4 },
        chroma: { rows: [[77, 88]], stride: 2 },
        bitDepth: 8,
        bytesPerSample: 1,
      },
      shuffled,
    );

    expect([...frame.y]).toEqual([11, 22, 33, 44, 55, 66]);
    expect([...frame.cb]).toEqual([77, 88]);
    expect(frame.width).toBe(3);
    expect(frame.height).toBe(2);
    expect(frame.bitDepth).toBe(8);
    expect(frame.poc).toBe(7);
    expect(frame.cvsId).toBe(3);
  });
});
