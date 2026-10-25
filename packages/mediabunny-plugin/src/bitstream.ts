/**
 * What the decoder needs from a Mediabunny HEVC decoder config, and the
 * conversion of its packets to the Annex B byte stream `HEVCDecoder.feed()`
 * reads.
 *
 * Packet format follows the WebCodecs HEVC codec registration, which
 * Mediabunny adopts: with a `description` (an HEVCDecoderConfigurationRecord,
 * ISO/IEC 14496-15 §8.3.3.1), each NAL unit is prefixed by its length on
 * `lengthSizeMinusOne + 1` bytes and the parameter sets live in the record;
 * without one, packets are already Annex B.
 */

export interface HevcStreamConfig {
  /** general_profile_idc, or null when neither the record nor the codec string gives it */
  profileIdc: number | null;
  /** chroma_format_idc, known only from the record */
  chromaFormatIdc: number | null;
  /** luma bit depth, known only from the record */
  bitDepthLuma: number | null;
  /** Byte length of the NAL size prefix, or 0 for Annex B packets */
  nalLengthSize: number;
  /** VPS/SPS/PPS/SEI arrays of the record, as Annex B */
  parameterSets: Uint8Array | null;
}

export function readStreamConfig(codecString: string, description?: AllowSharedBufferSource): HevcStreamConfig {
  if (!description) {
    return {
      profileIdc: profileFromCodecString(codecString),
      chromaFormatIdc: null,
      bitDepthLuma: null,
      nalLengthSize: 0,
      parameterSets: null,
    };
  }

  const record = toUint8Array(description);
  if (record.byteLength < 23) throw new Error("HEVC decoder config description is too short");

  const nalUnits: Uint8Array[] = [];
  const numArrays = record[22]!;
  let off = 23;
  for (let a = 0; a < numArrays; a++) {
    if (off + 3 > record.byteLength) throw new Error("Truncated HEVC decoder config description");
    const numNalus = (record[off + 1]! << 8) | record[off + 2]!;
    off += 3;
    for (let n = 0; n < numNalus; n++) {
      if (off + 2 > record.byteLength) throw new Error("Truncated HEVC decoder config description");
      const size = (record[off]! << 8) | record[off + 1]!;
      off += 2;
      if (off + size > record.byteLength) throw new Error("Truncated HEVC decoder config description");
      nalUnits.push(record.subarray(off, off + size));
      off += size;
    }
  }

  return {
    profileIdc: record[1]! & 0x1f,
    chromaFormatIdc: record[16]! & 0x03,
    bitDepthLuma: (record[17]! & 0x07) + 8,
    nalLengthSize: (record[21]! & 0x03) + 1,
    parameterSets: nalUnits.length > 0 ? joinAnnexB(nalUnits) : null,
  };
}

/** Rewrite a packet as Annex B, or return it as is when it already is. */
export function packetToAnnexB(data: Uint8Array, nalLengthSize: number): Uint8Array {
  if (nalLengthSize === 0) return data;

  const nalUnits: Uint8Array[] = [];
  let off = 0;
  while (off + nalLengthSize <= data.byteLength) {
    let size = 0;
    for (let i = 0; i < nalLengthSize; i++) size = size * 256 + data[off + i]!;
    off += nalLengthSize;
    if (off + size > data.byteLength) throw new Error("NAL unit overruns its packet");
    nalUnits.push(data.subarray(off, off + size));
    off += size;
  }
  return joinAnnexB(nalUnits);
}

/**
 * general_profile_idc from an RFC 6381 HEVC codec string such as
 * `hev1.1.6.L93.90` or `hvc1.A2.4.L120.B0`: the second field, after an
 * optional general_profile_space letter.
 */
export function profileFromCodecString(codec: string): number | null {
  const match = /^(?:hev1|hvc1)\.[A-C]?(\d+)\./i.exec(codec);
  return match ? Number(match[1]) : null;
}

function joinAnnexB(nalUnits: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(nalUnits.reduce((sum, n) => sum + 4 + n.byteLength, 0));
  let off = 0;
  for (const nal of nalUnits) {
    out[off + 3] = 1;
    out.set(nal, off + 4);
    off += 4 + nal.byteLength;
  }
  return out;
}

function toUint8Array(source: AllowSharedBufferSource): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source);
}
