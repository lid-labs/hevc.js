/**
 * Is an fMP4 media segment decodable on its own?
 *
 * A worker pool hands consecutive segments to different decoder instances, and
 * that is only sound for a segment the HEVC spec lets a decoder start on. The
 * test is the type of its first VCL NAL:
 *
 * - **IDR** (`IDR_W_RADL`, `IDR_N_LP`) and **BLA** (`BLA_W_LP`, `BLA_W_RADL`,
 *   `BLA_N_LP`) carry `NoRaslOutputFlag = 1` by type (§8.1). POC restarts at
 *   them, the pictures held for reference are discarded, and the leading
 *   pictures that cannot be decoded are not output. Any decoder instance
 *   produces the same frames from such a segment.
 * - A **CRA** carries `NoRaslOutputFlag = 1` only when it opens the bitstream or
 *   follows an end-of-sequence NAL. Mid-stream, its RASL pictures reference the
 *   previous segment, which is still in the DPB of the instance that decoded it
 *   — `DPB::flush()` bumps pictures for output but does not evict them. Handed
 *   to another instance, those RASL pictures would be decoded against whatever
 *   unrelated pictures that instance holds: plausible-looking, wrong frames,
 *   not an error. So a CRA-led segment stays on the instance that decoded its
 *   predecessor.
 *
 * Hence this check, run on the main thread before a segment is dispatched and
 * before its buffer is transferred to a worker.
 */

/** NAL unit types that start a coded video sequence on their own (§8.1). */
const SELF_CONTAINED_NAL_TYPES = new Set([
  16, // BLA_W_LP
  17, // BLA_W_RADL
  18, // BLA_N_LP
  19, // IDR_W_RADL
  20, // IDR_N_LP
]);

/** The VCL range of HEVC NAL unit types (§7.4.2.2); 32 and up are non-VCL. */
const MAX_VCL_NAL_TYPE = 31;

/**
 * The type of the first VCL NAL unit of a segment, or null when the segment
 * cannot be walked: no `mdat`, a length prefix that overruns it, or no VCL NAL
 * in the bytes examined. A null is not a verdict on the stream, only on what
 * could be read, and callers treat it as "not known to be self-contained".
 *
 * Only the start of `mdat` is walked, which is the first sample: the parameter
 * sets, the access unit delimiter and the SEI messages that may precede the
 * slice are skipped by type. Walking further would mean parsing `trun` for
 * sample sizes, and the answer is already settled by the first sample.
 */
export function leadingVclNalType(segment: Uint8Array, nalLengthSize = 4): number | null {
  // The bytes come off the network and the caller is the player's own
  // appendBuffer: an exception here would break playback, and every reason to
  // throw is a reason to answer "not known to be self-contained". A detached
  // buffer — one already transferred to a worker — makes the DataView throw.
  try {
    return walkToFirstVcl(segment, nalLengthSize);
  } catch {
    return null;
  }
}

function walkToFirstVcl(segment: Uint8Array, nalLengthSize: number): number | null {
  const mdat = findMdat(segment);
  if (!mdat) return null;

  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  let offset = mdat.start;
  // A sample holds a handful of NAL units at most before its first slice.
  for (let seen = 0; seen < 16; seen++) {
    if (offset + nalLengthSize + 2 > mdat.end) return null;
    const length = readLength(view, offset, nalLengthSize);
    if (length === null) return null;
    offset += nalLengthSize;
    // A prefix that runs past the box is a length size we guessed wrong, or a
    // segment we do not understand. Either way: no answer rather than a wrong one.
    if (length < 2 || offset + length > mdat.end) return null;
    const nalType = (view.getUint8(offset) >> 1) & 0x3f;
    if (nalType <= MAX_VCL_NAL_TYPE) return nalType;
    offset += length;
  }
  return null;
}

/**
 * True when the segment starts on a picture that resets the decoder by type, so
 * that any decoder instance decodes it to the same frames. False for a CRA-led
 * (open GOP) segment, for a segment starting on a trailing picture, and
 * whenever the segment could not be read.
 */
export function isSelfContainedSegment(segment: Uint8Array, nalLengthSize = 4): boolean {
  const nalType = leadingVclNalType(segment, nalLengthSize);
  return nalType !== null && SELF_CONTAINED_NAL_TYPES.has(nalType);
}

function readLength(view: DataView, offset: number, nalLengthSize: number): number | null {
  switch (nalLengthSize) {
    case 1: return view.getUint8(offset);
    case 2: return view.getUint16(offset);
    case 4: return view.getUint32(offset);
    default: return null;
  }
}

/** Walk the top-level boxes for `mdat`, returning the span of its payload. */
function findMdat(segment: Uint8Array): { start: number; end: number } | null {
  const view = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
  let offset = 0;
  while (offset + 8 <= segment.byteLength) {
    let size = view.getUint32(offset);
    let headerSize = 8;
    if (size === 1) {
      // 64-bit size: the high word is beyond anything a segment reaches, and a
      // value past 2^53 would lose precision, so a large one ends the walk.
      if (offset + 16 > segment.byteLength) return null;
      const high = view.getUint32(offset + 8);
      if (high !== 0) return null;
      size = view.getUint32(offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      // "To the end of the file" (§4.2).
      size = segment.byteLength - offset;
    }
    if (size < headerSize || offset + size > segment.byteLength) return null;
    const type = String.fromCharCode(
      view.getUint8(offset + 4), view.getUint8(offset + 5),
      view.getUint8(offset + 6), view.getUint8(offset + 7),
    );
    if (type === "mdat") return { start: offset + headerSize, end: offset + size };
    offset += size;
  }
  return null;
}
