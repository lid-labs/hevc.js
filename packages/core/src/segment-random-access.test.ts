import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isSelfContainedSegment, leadingVclNalType } from "./segment-random-access.js";

/**
 * These tests build fMP4 segments byte by byte: the point of the helper is to
 * read a layout, and a fixture that went through the muxer would test the muxer
 * too. The NAL unit types are the ones of §7.4.2.2.
 */

const NAL = {
  TRAIL_R: 1,
  RASL_R: 9,
  BLA_W_LP: 16,
  IDR_W_RADL: 19,
  IDR_N_LP: 20,
  CRA_NUT: 21,
  VPS: 32,
  SPS: 33,
  PPS: 34,
  AUD: 35,
  PREFIX_SEI: 39,
};

/** A NAL unit of `type`, length-prefixed on `lengthSize` bytes. */
function nal(type: number, payloadBytes = 4, lengthSize = 4): number[] {
  // Two-byte header: forbidden_zero(1) type(6) layer_id(6) temporal_id_plus1(3).
  const body = [type << 1, 1, ...new Array(payloadBytes).fill(0)];
  const length = body.length;
  const prefix =
    lengthSize === 4 ? [(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]
    : lengthSize === 2 ? [(length >>> 8) & 0xff, length & 0xff]
    : [length & 0xff];
  return [...prefix, ...body];
}

function box(type: string, payload: number[]): number[] {
  const size = 8 + payload.length;
  return [
    (size >>> 24) & 0xff, (size >>> 16) & 0xff, (size >>> 8) & 0xff, size & 0xff,
    ...[...type].map((c) => c.charCodeAt(0)),
    ...payload,
  ];
}

/** moof then mdat, the shape a DASH or HLS media segment arrives in. */
function segment(nals: number[][], opts: { extraBoxes?: number[]; mdatType?: string } = {}): Uint8Array {
  const payload = nals.flat();
  return new Uint8Array([
    ...box("styp", [...[..."msdh"].map((c) => c.charCodeAt(0))]),
    ...(opts.extraBoxes ?? []),
    ...box("moof", box("mfhd", [0, 0, 0, 0, 0, 0, 0, 1])),
    ...box(opts.mdatType ?? "mdat", payload),
  ]);
}

describe("leadingVclNalType", () => {
  it("skips the parameter sets, the delimiter and the SEI before the slice", () => {
    const seg = segment([
      nal(NAL.AUD), nal(NAL.VPS), nal(NAL.SPS), nal(NAL.PPS), nal(NAL.PREFIX_SEI),
      nal(NAL.IDR_N_LP),
      nal(NAL.TRAIL_R),
    ]);
    expect(leadingVclNalType(seg)).toBe(NAL.IDR_N_LP);
  });

  it("reads a two-byte length prefix when told to", () => {
    const seg = segment([nal(NAL.SPS, 4, 2), nal(NAL.CRA_NUT, 4, 2)]);
    expect(leadingVclNalType(seg, 2)).toBe(NAL.CRA_NUT);
  });

  it("returns null rather than a guess when the length size is wrong", () => {
    // Written with 2-byte prefixes, read as 4: the first length comes out huge.
    const seg = segment([nal(NAL.SPS, 4, 2), nal(NAL.IDR_N_LP, 4, 2)]);
    expect(leadingVclNalType(seg, 4)).toBeNull();
  });

  it("returns null on a segment with no mdat", () => {
    const seg = new Uint8Array(box("moof", box("mfhd", [0, 0, 0, 0, 0, 0, 0, 1])));
    expect(leadingVclNalType(seg)).toBeNull();
  });

  it("returns null when a length prefix overruns the mdat", () => {
    const seg = segment([[0x00, 0x00, 0xff, 0xff, NAL.IDR_N_LP << 1, 1]]);
    expect(leadingVclNalType(seg)).toBeNull();
  });

  it("answers null instead of throwing on a detached buffer", () => {
    const seg = segment([nal(NAL.IDR_N_LP)]);
    // What a transfer to a worker leaves behind. structuredClone with a
    // transfer list is how a test detaches a buffer without a worker.
    structuredClone(seg.buffer, { transfer: [seg.buffer] });
    expect(leadingVclNalType(seg)).toBeNull();
    expect(isSelfContainedSegment(seg)).toBe(false);
  });

  it("returns null when the first sample holds no VCL NAL", () => {
    expect(leadingVclNalType(segment([nal(NAL.VPS), nal(NAL.SPS), nal(NAL.PPS)]))).toBeNull();
  });

  it("walks past a box whose size is given on 64 bits", () => {
    const large = [
      0, 0, 0, 1, ...[..."free"].map((c) => c.charCodeAt(0)),
      0, 0, 0, 0, 0, 0, 0, 16 + 4,
      0, 0, 0, 0,
    ];
    const seg = segment([nal(NAL.IDR_W_RADL)], { extraBoxes: large });
    expect(leadingVclNalType(seg)).toBe(NAL.IDR_W_RADL);
  });
});

describe("isSelfContainedSegment", () => {
  it("accepts an IDR-led segment, which resets the decoder by type", () => {
    expect(isSelfContainedSegment(segment([nal(NAL.SPS), nal(NAL.IDR_N_LP)]))).toBe(true);
    expect(isSelfContainedSegment(segment([nal(NAL.IDR_W_RADL)]))).toBe(true);
  });

  it("accepts a BLA-led segment, which also carries NoRaslOutputFlag by type", () => {
    expect(isSelfContainedSegment(segment([nal(NAL.BLA_W_LP)]))).toBe(true);
  });

  it("refuses a CRA-led segment: its RASL pictures reference the previous one", () => {
    expect(isSelfContainedSegment(segment([nal(NAL.SPS), nal(NAL.CRA_NUT)]))).toBe(false);
  });

  it("refuses a segment that starts on a trailing picture", () => {
    expect(isSelfContainedSegment(segment([nal(NAL.TRAIL_R)]))).toBe(false);
    expect(isSelfContainedSegment(segment([nal(NAL.RASL_R)]))).toBe(false);
  });

  it("refuses what it could not read", () => {
    expect(isSelfContainedSegment(new Uint8Array([0, 0, 0, 0]))).toBe(false);
  });
});

describe("against the segments the demo ships", () => {
  // The synthetic segments above fix the helper's reading of a layout; this one
  // fixes the layout itself, on files an encoder produced. The DASH demo streams
  // are IDR-aligned, which is what makes the worker pool useful on them: if that
  // ever changes, the pool quietly stops parallelising and this case says so.
  const repoRoot = resolve(__dirname, "../../..");
  const paths = [
    "demo/streams/dash_abr/bbb_1080p_dash1.m4s",
    "demo/streams/dash_abr/bbb_1080p_dash5.m4s",
    "demo/streams/dash_720p/seg_0_1.m4s",
  ].map((p) => resolve(repoRoot, p)).filter((p) => existsSync(p));

  it("finds at least one demo segment to read", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  for (const path of paths) {
    it(`reads ${path.slice(repoRoot.length + 1)} as self-contained`, () => {
      const segment = new Uint8Array(readFileSync(path));
      expect(leadingVclNalType(segment)).toBe(20); // IDR_N_LP
      expect(isSelfContainedSegment(segment)).toBe(true);
    });
  }
});
