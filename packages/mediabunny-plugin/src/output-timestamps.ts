/** Where a picture sits in display order: by coded video sequence, then POC. */
export interface PictureOrder {
  cvsId: number;
  poc: number;
}

export interface SlotTime {
  /** Seconds */
  timestamp: number;
  /** Seconds */
  duration: number;
}

/**
 * Gives each decoded frame the timestamp of the packet that holds its place
 * in display order.
 *
 * Packets arrive in decode order and frames leave in display order, and
 * Mediabunny passes a custom decoder's samples through unsorted, so the
 * mapping is ours. The decoder only outputs a picture once every picture
 * displayed before it has been decoded (§C.5.2 bumping), so its slot is the
 * smallest timestamp still pending.
 *
 * A picture that is decoded but never output (PicOutputFlag 0, or emptied
 * from the DPB by a new sequence) still consumed its packet: its slot is
 * dropped as soon as a frame displayed after it comes out — the streaming
 * counterpart of `DisplayPtsAssigner` in @hevcjs/core.
 */
export class OutputTimestamps {
  private readonly _pending: SlotTime[] = [];
  private readonly _suppressed: PictureOrder[] = [];

  /** A packet was fed. */
  add(slot: SlotTime): void {
    let i = this._pending.length;
    while (i > 0 && this._pending[i - 1]!.timestamp > slot.timestamp) i--;
    this._pending.splice(i, 0, slot);
  }

  /** Pictures the decoder reported as decoded-but-not-output. */
  noteSuppressed(pictures: PictureOrder[]): void {
    for (const picture of pictures) this._suppressed.push(picture);
  }

  /** The slot of the next output frame, or null if no packet is left to give one. */
  next(frame: PictureOrder): SlotTime | null {
    for (let i = this._suppressed.length - 1; i >= 0; i--) {
      if (displaysBefore(this._suppressed[i]!, frame)) {
        this._suppressed.splice(i, 1);
        this._pending.shift();
      }
    }
    return this._pending.shift() ?? null;
  }

  /** After a flush: nothing left in the decoder can claim a slot. */
  reset(): void {
    this._pending.length = 0;
    this._suppressed.length = 0;
  }
}

function displaysBefore(a: PictureOrder, b: PictureOrder): boolean {
  return a.cvsId !== b.cvsId ? a.cvsId < b.cvsId : a.poc < b.poc;
}
