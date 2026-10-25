import { describe, expect, it } from "vitest";
import { packetToAnnexB, profileFromCodecString, readStreamConfig } from "./bitstream.js";

/** A minimal HEVCDecoderConfigurationRecord: Main 10, 4:2:0, 4-byte NAL lengths, one VPS and one SPS. */
function record(): Uint8Array {
  const header = new Uint8Array(23);
  header[0] = 1; // configurationVersion
  header[1] = 0x02; // profile_space 0, tier 0, profile_idc 2
  header[16] = 0xfc | 1; // chroma_format_idc 1
  header[17] = 0xf8 | 2; // bit_depth_luma_minus8 2
  header[18] = 0xf8 | 2;
  header[21] = 0x0f; // lengthSizeMinusOne 3
  header[22] = 2; // numOfArrays
  const vps = [0x20, 0x01, 0xaa];
  const sps = [0x21, 0x02, 0xbb, 0xcc];
  return new Uint8Array([
    ...header,
    0x20, 0x00, 0x01, 0x00, vps.length, ...vps,
    0x21, 0x00, 0x01, 0x00, sps.length, ...sps,
  ]);
}

describe("readStreamConfig", () => {
  it("reads profile, chroma format, bit depth, NAL length size and parameter sets from the record", () => {
    const config = readStreamConfig("hvc1.2.4.L120.B0", record());
    expect(config.profileIdc).toBe(2);
    expect(config.chromaFormatIdc).toBe(1);
    expect(config.bitDepthLuma).toBe(10);
    expect(config.nalLengthSize).toBe(4);
    expect(Array.from(config.parameterSets!)).toEqual([
      0, 0, 0, 1, 0x20, 0x01, 0xaa,
      0, 0, 0, 1, 0x21, 0x02, 0xbb, 0xcc,
    ]);
  });

  it("accepts the record as an ArrayBuffer", () => {
    expect(readStreamConfig("hvc1.2.4.L120.B0", record().buffer).profileIdc).toBe(2);
  });

  it("falls back to the codec string and Annex B packets without a record", () => {
    const config = readStreamConfig("hev1.1.6.L93.90");
    expect(config).toEqual({
      profileIdc: 1,
      chromaFormatIdc: null,
      bitDepthLuma: null,
      nalLengthSize: 0,
      parameterSets: null,
    });
  });

  it("rejects a truncated record instead of reading past it", () => {
    expect(() => readStreamConfig("hvc1.2.4.L120.B0", record().subarray(0, 30))).toThrow(/Truncated/);
  });
});

describe("packetToAnnexB", () => {
  it("replaces each length prefix with a start code", () => {
    const packet = new Uint8Array([0, 0, 0, 2, 0x26, 0x01, 0, 0, 0, 1, 0x02]);
    expect(Array.from(packetToAnnexB(packet, 4))).toEqual([0, 0, 0, 1, 0x26, 0x01, 0, 0, 0, 1, 0x02]);
  });

  it("reads 2-byte length prefixes", () => {
    const packet = new Uint8Array([0, 1, 0x02, 0, 1, 0x03]);
    expect(Array.from(packetToAnnexB(packet, 2))).toEqual([0, 0, 0, 1, 0x02, 0, 0, 0, 1, 0x03]);
  });

  it("passes Annex B packets through", () => {
    const packet = new Uint8Array([0, 0, 0, 1, 0x26]);
    expect(packetToAnnexB(packet, 0)).toBe(packet);
  });

  it("rejects a NAL unit that overruns its packet", () => {
    expect(() => packetToAnnexB(new Uint8Array([0, 0, 0, 9, 0x26]), 4)).toThrow(/overruns/);
  });
});

describe("profileFromCodecString", () => {
  it.each([
    ["hev1.1.6.L93.90", 1],
    ["hvc1.2.4.L120.B0", 2],
    ["hvc1.A1.6.L93.B0", 1],
    ["avc1.64001f", null],
  ])("%s → %s", (codec, profile) => {
    expect(profileFromCodecString(codec)).toBe(profile);
  });
});
