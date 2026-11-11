import { describe, expect, it } from "vitest";
import { frameColorSpace } from "./color-space.js";

const REC709: VideoColorSpaceInit = { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false };

describe("frameColorSpace", () => {
  it("keeps a complete colour space as it is", () => {
    // HLG, as an iPhone records HDR video. TypeScript's DOM types predate the
    // HDR values WebCodecs defines (bt2020, hlg, pq, bt2020-ncl).
    const hlg: VideoColorSpaceInit = {
      primaries: "bt2020" as VideoColorPrimaries,
      transfer: "hlg" as VideoTransferCharacteristics,
      matrix: "bt2020-ncl" as VideoMatrixCoefficients,
      fullRange: false,
    };
    expect(frameColorSpace(hlg)).toEqual(hlg);
  });

  it("fills only the members the config leaves out", () => {
    // Full-range BT.601 with no primaries or transfer, as in remotion-dev/remotion#10841
    expect(frameColorSpace({ matrix: "smpte170m", fullRange: true })).toEqual({
      primaries: "bt709",
      transfer: "bt709",
      matrix: "smpte170m",
      fullRange: true,
    });
  });

  it("treats null members as left out", () => {
    const pq = "pq" as VideoTransferCharacteristics;
    expect(frameColorSpace({ primaries: null, transfer: pq, matrix: null, fullRange: null }))
      .toEqual({ ...REC709, transfer: pq });
  });

  it("gives REC709 when the config has no colour space", () => {
    expect(frameColorSpace(undefined)).toEqual(REC709);
    expect(frameColorSpace({})).toEqual(REC709);
  });
});
