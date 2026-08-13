import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMediaSourceConstructor,
  installMSEIntercept,
  isMuxedHevcMime,
  shouldFlushOnTimestampOffset,
  uninstallMSEIntercept,
} from "./mse-intercept.js";
import { setLogLevel } from "./log.js";

// Node has no MediaSource/ManagedMediaSource — each test stubs what it needs.
afterEach(() => {
  uninstallMSEIntercept();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setLogLevel("info");
});

describe("getMediaSourceConstructor", () => {
  it("returns null when neither MediaSource nor ManagedMediaSource exists", () => {
    expect(getMediaSourceConstructor()).toBeNull();
  });

  it("returns ManagedMediaSource when it is the only MSE flavor (iPhone Safari)", () => {
    class FakeManagedMediaSource {}
    vi.stubGlobal("ManagedMediaSource", FakeManagedMediaSource);
    expect(getMediaSourceConstructor()).toBe(FakeManagedMediaSource);
  });

  it("prefers classic MediaSource when both exist", () => {
    class FakeMediaSource {}
    class FakeManagedMediaSource {}
    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("ManagedMediaSource", FakeManagedMediaSource);
    expect(getMediaSourceConstructor()).toBe(FakeMediaSource);
  });
});

describe("installMSEIntercept without classic MediaSource", () => {
  it("no-ops with a warning instead of throwing (iPhone Safari)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => installMSEIntercept()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[hevc.js]",
      expect.stringContaining("MediaSource is not available"),
    );
    warn.mockRestore();
  });

  it("leaves uninstallMSEIntercept a safe no-op afterwards", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installMSEIntercept();
    expect(() => uninstallMSEIntercept()).not.toThrow();
  });
});

describe("transcoding proxy", () => {
  // Minimal MSE surface the proxy touches. Accessors live on the prototype
  // because the proxy reads them via Object.getOwnPropertyDescriptor(
  // SourceBuffer.prototype, ...).
  class FakeSourceBuffer {
    mime: string;
    changeTypeCalls: string[] = [];
    private _tsOffset = 0;
    constructor(mime = "") { this.mime = mime; }
    get updating(): boolean { return false; }
    get timestampOffset(): number { return this._tsOffset; }
    set timestampOffset(v: number) { this._tsOffset = v; }
    appendBuffer(_data: BufferSource): void {}
    abort(): void {}
    remove(_start: number, _end: number): void {}
    changeType(type: string): void { this.changeTypeCalls.push(type); }
    addEventListener(): void {}
    removeEventListener(): void {}
  }

  class FakeMediaSource {
    static isTypeSupported(_mime: string): boolean { return true; }
    createdSBs: FakeSourceBuffer[] = [];
    addSourceBuffer(mime: string): FakeSourceBuffer {
      const sb = new FakeSourceBuffer(mime);
      this.createdSBs.push(sb);
      return sb;
    }
  }

  function setup(config = {}): { ms: FakeMediaSource; sb: FakeSourceBuffer } {
    vi.stubGlobal("MediaSource", FakeMediaSource);
    vi.stubGlobal("SourceBuffer", FakeSourceBuffer);
    // Silence the (expected) main-thread transcoder init failure in Node.
    vi.spyOn(console, "error").mockImplementation(() => {});
    installMSEIntercept({ logLevel: "debug", ...config });
    const ms = new FakeMediaSource();
    // hls.js-style mime: no space, no quotes around the codec.
    const sb = ms.addSourceBuffer(
      "video/mp4;codecs=hvc1.1.6.L120.90",
    ) as unknown as FakeSourceBuffer;
    return { ms, sb };
  }

  it("creates the underlying SourceBuffer with the mapped H.264 mime", () => {
    const { ms } = setup();
    expect(ms.createdSBs).toHaveLength(1);
    expect(ms.createdSBs[0].mime).toBe('video/mp4; codecs="avc1.64002a"');
  });

  it("maps HEVC mimes in changeType() to their H.264 equivalent", () => {
    const { sb } = setup();
    sb.changeType("video/mp4;codecs=hvc1.1.6.L153.B0");
    expect(sb.changeTypeCalls).toEqual(['video/mp4; codecs="avc1.640033"']);
  });

  it("passes non-HEVC mimes through changeType() untouched", () => {
    const { sb } = setup();
    sb.changeType("audio/mp4;codecs=mp4a.40.2");
    expect(sb.changeTypeCalls).toEqual(["audio/mp4;codecs=mp4a.40.2"]);
  });

  // Park the proxy in its "processing" state: append an init segment; the
  // transcoder init poll waits on a setTimeout that fake timers never fire.
  async function makeBusy(sb: FakeSourceBuffer): Promise<void> {
    const ftyp = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
    sb.appendBuffer(ftyp);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("does not flush the initial offset write made before the first init is parsed", async () => {
    // hls.js maps media time to presentation 0 (e.g. EXT-X-MEDIA-SEQUENCE > 0)
    // by writing a large timestampOffset BEFORE the first media append —
    // flushing there would discard the queued init segment.
    vi.useFakeTimers();
    const { sb } = setup();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeBusy(sb);

    sb.timestampOffset = -3;

    expect(sb.timestampOffset).toBe(-3);
    const messages = logSpy.mock.calls.map((c) => c.join(" "));
    expect(messages.some((m) => m.includes("flushing queue"))).toBe(false);
    vi.useRealTimers();
  });

  it("passes small timestampOffset adjustments through without flushing", async () => {
    vi.useFakeTimers();
    const { sb } = setup();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeBusy(sb);

    // hls.js >=1.6.6 writes sub-threshold alignments in the nominal
    // append path (tolerance 1e-6) — must not reset the pipeline.
    sb.timestampOffset = 0.05;

    expect(sb.timestampOffset).toBe(0.05);
    const messages = logSpy.mock.calls.map((c) => c.join(" "));
    expect(messages.some((m) => m.includes("flushing queue"))).toBe(false);
    expect(messages.some((m) => m.includes("pass-through"))).toBe(true);
    vi.useRealTimers();
  });

  it("strictAppendProgress defers updateend until real data lands", async () => {
    vi.useFakeTimers();
    const { sb } = setup({ strictAppendProgress: true });

    const events: string[] = [];
    (sb as unknown as SourceBuffer).addEventListener("updateend", () => events.push("updateend"));
    // ftyp init: parks in the transcoder-init poll under fake timers, so the
    // only updateend that could fire here is the eager pre-transcode release.
    const ftyp = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
    sb.appendBuffer(ftyp);
    await vi.advanceTimersByTimeAsync(0);

    // Eager release would have fired updateend synchronously; strict mode
    // holds it (transcode never completes in Node) and reports updating.
    expect(events).toEqual([]);
    expect((sb as unknown as SourceBuffer).updating).toBe(true);
    vi.useRealTimers();
  });

  it("eager release still fires updateend immediately without the flag", () => {
    // Fake timers park the transcoder-init poll so no async work leaks
    // past the test — the assertion itself is synchronous.
    vi.useFakeTimers();
    const { sb } = setup();
    const events: string[] = [];
    (sb as unknown as SourceBuffer).addEventListener("updateend", () => events.push("updateend"));
    const media = new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66]);
    sb.appendBuffer(media);
    expect(events).toEqual(["updateend"]);
  });

  it("does not flush on timestampOffset writes while idle", () => {
    const { sb } = setup();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    sb.timestampOffset = 42;

    expect(sb.timestampOffset).toBe(42);
    const messages = logSpy.mock.calls.map((c) => c.join(" "));
    expect(messages.some((m) => m.includes("flushing queue"))).toBe(false);
  });
});

describe("shouldFlushOnTimestampOffset", () => {
  it("flushes on a large jump with queued segments after init parsed (seek without abort)", () => {
    expect(shouldFlushOnTimestampOffset(30, true, true)).toBe(true);
    expect(shouldFlushOnTimestampOffset(-3, true, true)).toBe(true);
  });

  it("ignores sub-threshold alignment deltas (hls.js nominal append path)", () => {
    expect(shouldFlushOnTimestampOffset(0.000001, true, true)).toBe(false);
    expect(shouldFlushOnTimestampOffset(-0.49, true, true)).toBe(false);
  });

  it("never flushes without queued segments — nothing stale to drop", () => {
    // Covers both idle and mid-transcode-only: hls.js writes offsets from
    // within our updateend dispatch (next op runs synchronously), so the
    // in-flight segment alone must not trigger a flush.
    expect(shouldFlushOnTimestampOffset(30, false, true)).toBe(false);
  });

  it("never flushes before the first init segment is parsed (startup mapping)", () => {
    expect(shouldFlushOnTimestampOffset(-3, true, false)).toBe(false);
  });
});

describe("muxed A/V HEVC refusal", () => {
  it("isMuxedHevcMime detects an HEVC codec alongside an audio codec", () => {
    expect(isMuxedHevcMime('video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"')).toBe(true);
    expect(isMuxedHevcMime("video/mp4;codecs=hev1.1.6.L93.B0,mp4a.40.2")).toBe(true);
    expect(isMuxedHevcMime('video/mp4; codecs="hvc1.1.6.L120.90,ec-3"')).toBe(true);
    expect(isMuxedHevcMime('video/mp4; codecs="hvc1.1.6.L120.90"')).toBe(false);
    expect(isMuxedHevcMime("video/mp4;codecs=hvc1.1.6.L120.90")).toBe(false);
    expect(isMuxedHevcMime('audio/mp4; codecs="mp4a.40.2"')).toBe(false);
    expect(isMuxedHevcMime('video/mp4; codecs="avc1.640028,mp4a.40.2"')).toBe(false);
  });

  it("isMuxedHevcMime does not flag video-only multi-codec lists (Dolby Vision)", () => {
    // dvh1/dvhe layered with hvc1 is not muxed A/V — no audio would be lost.
    expect(isMuxedHevcMime('video/mp4; codecs="dvh1.05.06,hvc1.2.4.L153.B0"')).toBe(false);
    expect(isMuxedHevcMime('video/mp4; codecs="hvc1.2.4.L153.B0,dvh1.05.06"')).toBe(false);
  });

  it("isMuxedHevcMime bounds an unquoted codecs value at the next mime parameter", () => {
    // The trailing `;foo=a,b` must not leak its comma into the codec list.
    expect(isMuxedHevcMime("video/mp4;codecs=hvc1.1.6.L120.90;foo=a,b")).toBe(false);
  });

  // Reuse the fakes from the transcoding proxy suite via fresh classes —
  // these tests only need isTypeSupported and addSourceBuffer.
  class FakeSB {
    mime: string;
    constructor(mime: string) { this.mime = mime; }
    get updating(): boolean { return false; }
    get timestampOffset(): number { return 0; }
    set timestampOffset(_v: number) {}
    appendBuffer(): void {}
    abort(): void {}
    remove(): void {}
    changeType(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  class FakeMS {
    static isTypeSupported(_m: string): boolean { return true; }
    createdMimes: string[] = [];
    addSourceBuffer(mime: string): FakeSB {
      this.createdMimes.push(mime);
      return new FakeSB(mime);
    }
  }

  function install(logLevel: "silent" | "error" = "silent"): FakeMS {
    vi.stubGlobal("MediaSource", FakeMS);
    vi.stubGlobal("SourceBuffer", FakeSB);
    vi.spyOn(console, "error").mockImplementation(() => {});
    installMSEIntercept({ logLevel });
    return new FakeMS();
  }

  it("isTypeSupported maps muxed HEVC to combined H.264 + audio, keeping the audio codec", () => {
    const probed: string[] = [];
    class ProbingMS extends FakeMS {
      static isTypeSupported(m: string): boolean { probed.push(m); return true; }
    }
    vi.stubGlobal("MediaSource", ProbingMS);
    vi.stubGlobal("SourceBuffer", FakeSB);
    installMSEIntercept({ logLevel: "silent" });

    expect(MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"')).toBe(true);
    // The HEVC codec is mapped to avc1, the audio codec preserved.
    expect(probed[probed.length - 1]).toBe('video/mp4; codecs="avc1.64002a,mp4a.40.2"');
  });

  it("addSourceBuffer creates an A/V proxy with the combined H.264 + AAC mime", () => {
    const ms = install();
    ms.addSourceBuffer('video/mp4; codecs="mp4a.40.2,hvc1.1.6.L120.90"');
    // Real SourceBuffer created with the combined mime (video-first).
    expect(ms.createdMimes).toEqual(['video/mp4; codecs="avc1.64002a,mp4a.40.2"']);
  });

  it("decodingInfo maps muxed HEVC to the combined H.264 + audio type", async () => {
    const original = vi.fn().mockResolvedValue({ supported: true, smooth: true, powerEfficient: true });
    vi.stubGlobal("navigator", { mediaCapabilities: { decodingInfo: original } });
    install();
    await navigator.mediaCapabilities.decodingInfo({
      type: "media-source",
      video: { contentType: 'video/mp4; codecs="hvc1.1.6.L120.90,mp4a.40.2"', width: 1920, height: 1080, bitrate: 1e6, framerate: 25 },
    });
    expect(original).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ contentType: 'video/mp4; codecs="avc1.64002a,mp4a.40.2"' }),
      }),
    );
  });
});
