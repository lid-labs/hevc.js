import { beforeEach, describe, expect, it, vi } from "vitest";
import { HevcTransmuxer, isInitSegment } from "./transmuxer.js";

interface MockTranscoder {
  init: ReturnType<typeof vi.fn>;
  processInitSegment: ReturnType<typeof vi.fn>;
  prepareInit: ReturnType<typeof vi.fn>;
  processMediaSegment: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  initResult: { initSegment: Uint8Array; codec: string } | null;
}

let mockTranscoder: MockTranscoder;

vi.mock("@hevcjs/core", async (importOriginal) => ({
  // Real implementations for the pure helpers the transmuxer guards rely on
  ...(await importOriginal<typeof import("@hevcjs/core")>()),
  SegmentTranscoder: vi.fn().mockImplementation(function () { return mockTranscoder; }),
  hevcMimeToH264Codec: vi.fn((mime: string) => {
    if (mime.includes("L120")) return "avc1.64002a";
    if (mime.includes("L150") || mime.includes("L153")) return "avc1.640033";
    return "avc1.640028";
  }),
}));

// ftyp box header: size=32, type='ftyp'
const FTYP_HEADER = new Uint8Array([
  0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0, 0,
]);
// moof box header: size=100, type='moof'
const MOOF_HEADER = new Uint8Array([
  0, 0, 0, 100, 0x6d, 0x6f, 0x6f, 0x66, 0, 0,
]);
// styp box header (segment type, used by some media segments)
const STYP_HEADER = new Uint8Array([
  0, 0, 0, 24, 0x73, 0x74, 0x79, 0x70, 0, 0,
]);

const HEVC_720 = 'video/mp4; codecs="hev1.1.6.L93.B0"';
const HEVC_1080 = 'video/mp4; codecs="hev1.1.6.L120.B0"';
const HEVC_4K = 'video/mp4; codecs="hev1.1.6.L150.B0"';
const HVC1_1080 = 'video/mp4; codecs="hvc1.1.6.L120.B0"';
const AVC = 'video/mp4; codecs="avc1.640028"';

describe("isInitSegment", () => {
  it("returns true for ftyp box", () => {
    expect(isInitSegment(FTYP_HEADER)).toBe(true);
  });

  it("returns false for moof box (media segment)", () => {
    expect(isInitSegment(MOOF_HEADER)).toBe(false);
  });

  it("returns false for styp box (segment type)", () => {
    expect(isInitSegment(STYP_HEADER)).toBe(false);
  });

  it("returns false for buffer shorter than the box header", () => {
    expect(isInitSegment(new Uint8Array([0, 0, 0, 0, 0x66, 0x74]))).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isInitSegment(new Uint8Array(0))).toBe(false);
  });
});

describe("HevcTransmuxer", () => {
  beforeEach(() => {
    mockTranscoder = {
      init: vi.fn().mockResolvedValue(undefined),
      processInitSegment: vi.fn().mockResolvedValue(undefined),
      prepareInit: vi.fn().mockResolvedValue({
        initSegment: new Uint8Array([0xa, 0xb, 0xc, 0xd]),
        codec: "avc1.640028",
      }),
      processMediaSegment: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      destroy: vi.fn(),
      initResult: null,
    };
  });

  describe("isSupported", () => {
    it("returns true for hev1", () => {
      expect(new HevcTransmuxer(HEVC_720).isSupported(HEVC_720)).toBe(true);
    });

    it("returns true for hvc1", () => {
      expect(new HevcTransmuxer(HVC1_1080).isSupported(HVC1_1080)).toBe(true);
    });

    it("returns false for non-HEVC mime", () => {
      expect(new HevcTransmuxer(HEVC_720).isSupported(AVC)).toBe(false);
    });
  });

  describe("getOriginalMimeType", () => {
    it("returns the mime passed to the constructor", () => {
      expect(new HevcTransmuxer(HEVC_1080).getOriginalMimeType()).toBe(
        HEVC_1080,
      );
    });
  });

  describe("convertCodecs", () => {
    it("maps HEVC mime via hevcMimeToH264Codec", () => {
      const t = new HevcTransmuxer(HEVC_1080);
      expect(t.convertCodecs("video", HEVC_1080)).toBe(
        'video/mp4; codecs="avc1.64002a"',
      );
    });

    it("maps a 4K HEVC mime to High@5.1", () => {
      const t = new HevcTransmuxer(HEVC_4K);
      expect(t.convertCodecs("video", HEVC_4K)).toBe(
        'video/mp4; codecs="avc1.640033"',
      );
    });

    it("leaves non-HEVC mime untouched", () => {
      const t = new HevcTransmuxer(HEVC_720);
      expect(t.convertCodecs("video", AVC)).toBe(AVC);
    });
  });

  describe("transmux", () => {
    it("returns the H.264 init segment as a Uint8Array on the init call", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      const out = await t.transmux(FTYP_HEADER, {}, null, 0, "video");

      expect(out).toBeInstanceOf(Uint8Array);
      expect(mockTranscoder.prepareInit).toHaveBeenCalledTimes(1);
      expect(mockTranscoder.prepareInit.mock.calls[0]![0]).toBe(FTYP_HEADER);
      expect(Array.from(out)).toEqual([0xa, 0xb, 0xc, 0xd]);
      expect(mockTranscoder.init).toHaveBeenCalledTimes(1);
      expect(mockTranscoder.processMediaSegment).not.toHaveBeenCalled();
    });

    it("returns transcoded media bytes for subsequent media segments", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      await t.transmux(FTYP_HEADER, {}, null, 0, "video");

      const out = await t.transmux(MOOF_HEADER, {}, {}, 0, "video");

      expect(out).toBeInstanceOf(Uint8Array);
      expect(mockTranscoder.processMediaSegment).toHaveBeenCalledTimes(1);
      expect(mockTranscoder.processMediaSegment.mock.calls[0]![0]).toBe(
        MOOF_HEADER,
      );
      expect(Array.from(out)).toEqual([1, 2, 3]);
    });

    it("does not re-prepare the init segment on later calls", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      await t.transmux(FTYP_HEADER, {}, null, 0, "video");
      await t.transmux(MOOF_HEADER, {}, {}, 0, "video");

      mockTranscoder.processMediaSegment.mockResolvedValueOnce(
        new Uint8Array([4, 5, 6]),
      );
      const out = await t.transmux(MOOF_HEADER, {}, {}, 0, "video");

      expect(Array.from(out)).toEqual([4, 5, 6]);
      expect(mockTranscoder.prepareInit).toHaveBeenCalledTimes(1);
    });

    it("media segment with no decoded output yields a free-box stub", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      await t.transmux(FTYP_HEADER, {}, null, 0, "video");
      mockTranscoder.processMediaSegment.mockResolvedValueOnce(null);

      const out = await t.transmux(MOOF_HEADER, {}, {}, 0, "video");
      expect(Array.from(out)).toEqual([
        0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65,
      ]);
    });

    it("creates the underlying transcoder lazily and only once", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      await t.transmux(FTYP_HEADER, {}, {}, 0, "video");
      await t.transmux(MOOF_HEADER, {}, {}, 0, "video");
      await t.transmux(MOOF_HEADER, {}, {}, 0, "video");

      expect(mockTranscoder.init).toHaveBeenCalledTimes(1);
    });

    it("awaits transcoder.init() before processing the first segment", async () => {
      let resolveInit!: () => void;
      mockTranscoder.init.mockImplementation(
        () => new Promise<void>((r) => (resolveInit = r)),
      );

      const t = new HevcTransmuxer(HEVC_720);
      const inFlight = t.transmux(FTYP_HEADER, {}, null, 0, "video");

      // Give the microtask queue a turn — init() hasn't resolved yet.
      await Promise.resolve();
      expect(mockTranscoder.prepareInit).not.toHaveBeenCalled();

      resolveInit();
      await inFlight;
      expect(mockTranscoder.prepareInit).toHaveBeenCalledTimes(1);
    });

    it("caches the H.264 init when Shaka resends the exact same HEVC init bytes", async () => {
      const t = new HevcTransmuxer(HEVC_720);

      const first = await t.transmux(FTYP_HEADER, {}, null, 0, "video");
      const second = await t.transmux(FTYP_HEADER, {}, null, 0, "video");

      expect(mockTranscoder.prepareInit).toHaveBeenCalledTimes(1);
      expect(Array.from(first)).toEqual([0xa, 0xb, 0xc, 0xd]);
      expect(Array.from(second)).toEqual([0xa, 0xb, 0xc, 0xd]);
      // Defensive copy: cache must hand out a fresh buffer each time.
      expect(second).not.toBe(first);
    });

    it("calls prepareInit again when the HEVC init bytes change (ABR switch)", async () => {
      // Distinct init bytes for two different representations.
      const initA = new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0xAA]);
      const initB = new Uint8Array([0, 0, 0, 32, 0x66, 0x74, 0x79, 0x70, 0xBB]);

      mockTranscoder.prepareInit
        .mockResolvedValueOnce({ initSegment: new Uint8Array([1]), codec: "avc1.640028" })
        .mockResolvedValueOnce({ initSegment: new Uint8Array([2]), codec: "avc1.640028" });

      const t = new HevcTransmuxer(HEVC_720);
      const a = await t.transmux(initA, {}, null, 0, "video");
      const b = await t.transmux(initB, {}, null, 0, "video");

      expect(mockTranscoder.prepareInit).toHaveBeenCalledTimes(2);
      expect(Array.from(a)).toEqual([1]);
      expect(Array.from(b)).toEqual([2]);
    });

    it("accepts ArrayBuffer input as well as Uint8Array", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      const buf = FTYP_HEADER.buffer.slice(
        FTYP_HEADER.byteOffset,
        FTYP_HEADER.byteOffset + FTYP_HEADER.byteLength,
      );
      const out = await t.transmux(buf, {}, null, 0, "video");
      expect(out).toBeInstanceOf(Uint8Array);
      expect(Array.from(out)).toEqual([0xa, 0xb, 0xc, 0xd]);
    });
  });

  describe("destroy", () => {
    it("delegates to transcoder.destroy when one was created", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      await t.transmux(FTYP_HEADER, {}, {}, 0, "video");
      t.destroy();
      expect(mockTranscoder.destroy).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when no transcoder was ever created", () => {
      const t = new HevcTransmuxer(HEVC_720);
      expect(() => t.destroy()).not.toThrow();
      expect(mockTranscoder.destroy).not.toHaveBeenCalled();
    });

    it("resets internal state so a new transmux call recreates a transcoder", async () => {
      const t = new HevcTransmuxer(HEVC_720);
      await t.transmux(FTYP_HEADER, {}, {}, 0, "video");
      t.destroy();

      // After destroy, a new transmux call should re-init the transcoder
      await t.transmux(FTYP_HEADER, {}, {}, 0, "video");
      expect(mockTranscoder.init).toHaveBeenCalledTimes(2);
    });
  });
});

describe("muxed A/V HEVC refusal", () => {
  it("isSupported answers false for muxed codec lists (audio would be dropped)", () => {
    const t = new HevcTransmuxer('video/mp4; codecs="hvc1"');
    expect(t.isSupported('video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"')).toBe(false);
    expect(t.isSupported('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"')).toBe(false);
    expect(t.isSupported('video/mp4; codecs="hvc1.1.6.L120.90"')).toBe(true);
  });
});
