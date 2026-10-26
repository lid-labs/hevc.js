import type { HEVCFrame } from "@hevcjs/core/decoder";

/** A decoded frame, its three planes contiguous in the layout VideoFrame expects. */
export interface PackedFrame {
  format: "I420" | "I420P10";
  data: Uint8Array | Uint16Array;
  width: number;
  height: number;
  /** Display order: by coded video sequence, then POC */
  cvsId: number;
  poc: number;
}

/**
 * Packs a frame as I420, or I420P10 for a 10-bit frame when VideoFrame
 * accepts it; other bit depths are scaled down to 8 bits.
 */
export function packFrame(frame: HEVCFrame, i420p10: boolean): PackedFrame {
  const ySize = frame.y.length;
  const cSize = frame.cb.length;
  const { width, height, cvsId, poc } = frame;

  if (frame.bitDepth === 10 && i420p10) {
    const data = new Uint16Array(ySize + 2 * cSize);
    data.set(frame.y);
    data.set(frame.cb, ySize);
    data.set(frame.cr, ySize + cSize);
    return { format: "I420P10", data, width, height, cvsId, poc };
  }

  const data = new Uint8Array(ySize + 2 * cSize);
  if (frame.bitDepth > 8) {
    const shift = frame.bitDepth - 8;
    let off = 0;
    for (const plane of [frame.y, frame.cb, frame.cr]) {
      for (let i = 0; i < plane.length; i++) data[off + i] = plane[i]! >> shift;
      off += plane.length;
    }
  } else {
    // 8-bit samples fit a byte: set() converts them as they are copied
    data.set(frame.y);
    data.set(frame.cb, ySize);
    data.set(frame.cr, ySize + cSize);
  }
  return { format: "I420", data, width, height, cvsId, poc };
}
