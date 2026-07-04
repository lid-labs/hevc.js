import { describe, expect, it } from "vitest";
import { hevcMimeToH264Codec } from "./codec-mapping.js";

describe("hevcMimeToH264Codec", () => {
  it("maps Level 3.1 (≤720p) to High@4.0", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L93.B0")).toBe("avc1.640028");
  });

  it("maps the boundary just below Level 4.0 (L119) to High@4.0", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L119.B0")).toBe("avc1.640028");
  });

  it("maps Level 4.0 (1080p30) to High@4.2", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L120.B0")).toBe("avc1.64002a");
  });

  it("maps Level 4.1 (1080p60) to High@4.2", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L123.B0")).toBe("avc1.64002a");
  });

  it("maps the boundary just below Level 5.0 (L149) to High@4.2", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L149.B0")).toBe("avc1.64002a");
  });

  it("maps Level 5.0 (4K30) to High@5.1", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L150.B0")).toBe("avc1.640033");
  });

  it("maps Level 5.1 (4K60) to High@5.1", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.L153.B0")).toBe("avc1.640033");
  });

  it("accepts the hvc1 codec prefix as well as hev1", () => {
    expect(hevcMimeToH264Codec("hvc1.1.6.L120.B0")).toBe("avc1.64002a");
  });

  it("accepts a full mime type string with codecs param", () => {
    expect(
      hevcMimeToH264Codec('video/mp4; codecs="hev1.1.6.L120.B0"'),
    ).toBe("avc1.64002a");
  });

  it("recognizes High tier (H prefix) at 4K", () => {
    expect(hevcMimeToH264Codec("hev1.1.6.H150.B0")).toBe("avc1.640033");
  });

  it("falls back to High@5.1 when no level field is found", () => {
    expect(hevcMimeToH264Codec("video/mp4")).toBe("avc1.640033");
  });

  it("falls back to High@5.1 on empty input", () => {
    expect(hevcMimeToH264Codec("")).toBe("avc1.640033");
  });

  it("falls back to High@5.1 on non-string input", () => {
    // Defensive: callers from untyped JS may pass null/undefined.
    expect(hevcMimeToH264Codec(null as unknown as string)).toBe("avc1.640033");
    expect(hevcMimeToH264Codec(undefined as unknown as string)).toBe("avc1.640033");
  });

  it("ignores incidental L/H characters not preceded by a dot boundary", () => {
    // Without the `.` anchor, "; profiles=H120" would match before the real
    // level field and produce a wrong result.
    expect(
      hevcMimeToH264Codec('video/mp4; profiles=H120; codecs="hev1.1.6.L93.B0"'),
    ).toBe("avc1.640028");
  });
});
