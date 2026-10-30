import { afterEach, describe, expect, it } from "vitest";
import { HEVCDecoder } from "./decoder.js";

/**
 * The decoder reads a frame out of the WASM heap through a 52-byte struct whose
 * `bytes_per_sample` field (offset 48) says whether a sample is one byte or two.
 * An 8-bit picture is stored one byte per sample and widened into the
 * `Uint16Array` planes the JS API has always handed out, so a mistake here —
 * reading the wrong heap view, halving a byte pointer, sign-extending a sample —
 * produces plausible-looking pixels rather than an error. These tests fabricate
 * both storage layouts and check the samples that come out.
 */

const FRAME_STRUCT_BYTES = 52;

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
function fakeModule(picture: Picture) {
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

  const api: Record<string, (...args: number[]) => number> = {
    hevc_decoder_create: () => 1,
    hevc_decoder_destroy: () => 0,
    hevc_decoder_decode: () => 0,
    hevc_decoder_get_frame_count: () => 1,
    hevc_decoder_get_frame: (_dec: number, _index: number, framePtr: number) => {
      view.setUint32(framePtr, yPtr, true);
      view.setUint32(framePtr + 4, cbPtr, true);
      view.setUint32(framePtr + 8, crPtr, true);
      view.setInt32(framePtr + 12, width, true);
      view.setInt32(framePtr + 16, height, true);
      view.setInt32(framePtr + 20, picture.luma.stride, true);
      view.setInt32(framePtr + 24, picture.chroma.stride, true);
      view.setInt32(framePtr + 28, chromaWidth, true);
      view.setInt32(framePtr + 32, chromaHeight, true);
      view.setInt32(framePtr + 36, picture.bitDepth, true);
      view.setInt32(framePtr + 40, 7, true); // poc
      view.setInt32(framePtr + 44, 3, true); // cvsId
      view.setInt32(framePtr + 48, picture.bytesPerSample, true);
      return 0;
    },
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
    /** The struct the wrapper allocates for a frame, as a size assertion. */
    frameStructBytes: FRAME_STRUCT_BYTES,
  };
}

async function decodeOnePicture(picture: Picture) {
  // The wrapper prefers a module factory on globalThis over a dynamic import.
  (globalThis as Record<string, unknown>).HEVCDecoderModule = () =>
    Promise.resolve(fakeModule(picture));
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
});
