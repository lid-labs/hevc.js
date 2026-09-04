import { describe, it, expect, vi } from "vitest";
import { SegmentTranscoder, extractTfdt, rebaseSamplesToTfdt } from "./segment-transcoder.js";

/**
 * Re-calling prepareInit() must reset the per-stream runtime state.
 *
 * Regression for the Shaka ABR adaptation bug: Shaka feeds a fresh HEVC
 * init segment when the variant switches resolution. Without the reset,
 * `_encoder` stayed configured at the previous resolution and
 * `_paramSetsFed` stayed true — `processMediaSegment` would then encode
 * new-dimension frames through the previous-dimension encoder and ship
 * broken H.264 to MSE.
 *
 * We don't drive a real WASM decode here. We simulate the post-first-
 * segment state by poking the private fields, call prepareInit() with
 * an invalid payload, and assert that the reset block at the top of the
 * function ran before the rest of the pipeline failed.
 */
describe("SegmentTranscoder.prepareInit re-call", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Short-circuit the heavy parts of prepareInit so the test isolates the
  // reset block that lives at the top of the function.
  const stubInternals = (t: SegmentTranscoder) => {
    (t as any).processInitSegment = vi.fn().mockResolvedValue(undefined);
    (t as any)._width = 1280;
    (t as any)._height = 720;
  };

  it("closes the previous encoder and clears per-stream flags before re-processing the init", async () => {
    const t = new SegmentTranscoder();
    stubInternals(t);

    const close = vi.fn();
    (t as any)._encoder = { close };
    (t as any)._paramSetsFed = true;
    (t as any)._initResult = { initSegment: new Uint8Array(), codec: "avc1.42" };

    // The rest of prepareInit (warmup encoder, mux) still fails because we
    // don't run a real WASM pipeline — but the reset block runs first and
    // that's what we're asserting.
    await expect(t.prepareInit(new Uint8Array(8))).rejects.toBeDefined();

    expect(close).toHaveBeenCalledTimes(1);
    expect((t as any)._encoder).toBeNull();
    expect((t as any)._paramSetsFed).toBe(false);
    expect((t as any)._initResult).toBeNull();
  });

  it("is a no-op reset on the very first call (clean instance)", async () => {
    const t = new SegmentTranscoder();
    stubInternals(t);

    expect((t as any)._encoder).toBeNull();
    expect((t as any)._paramSetsFed).toBe(false);
    expect((t as any)._initResult).toBeNull();

    await expect(t.prepareInit(new Uint8Array(8))).rejects.toBeDefined();

    expect((t as any)._encoder).toBeNull();
    expect((t as any)._paramSetsFed).toBe(false);
    expect((t as any)._initResult).toBeNull();
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

describe("rebaseSamplesToTfdt", () => {
  const mk = (dts: number[], gap = 0) =>
    dts.map((d) => ({ dts: d, pts: d + gap }));

  it("is a no-op during continuous playback (dts matches tfdt)", () => {
    const samples = mk([9000, 9600, 10200], 100);
    const base = rebaseSamplesToTfdt(samples, 9000);
    expect(base).toBe(9000);
    expect(samples.map((s) => s.dts)).toEqual([9000, 9600, 10200]);
    expect(samples.map((s) => s.pts)).toEqual([9100, 9700, 10300]);
  });

  it("treats tfdt = 0 as a legitimate value (first segment), not as absent", () => {
    const samples = mk([4500, 5100]);
    expect(rebaseSamplesToTfdt(samples, 0)).toBe(0);
    expect(samples.map((s) => s.dts)).toEqual([0, 600]);
  });

  it("shifts samples onto the tfdt after an out-of-buffer seek", () => {
    // mp4box continues the pre-seek clock (5.33s) while the segment's
    // tfdt says 18.08s — the seek scenario hls.js >=1.6.6 exposes.
    const samples = mk([128000, 128600, 129200], 100);
    const base = rebaseSamplesToTfdt(samples, 434000);
    expect(base).toBe(434000);
    expect(samples.map((s) => s.dts)).toEqual([434000, 434600, 435200]);
    // pts keeps its composition offset relative to dts
    expect(samples.map((s) => s.pts)).toEqual([434100, 434700, 435300]);
  });

  it("also corrects backward drift (seek back)", () => {
    const samples = mk([434000, 434600]);
    expect(rebaseSamplesToTfdt(samples, 128000)).toBe(128000);
    expect(samples.map((s) => s.dts)).toEqual([128000, 128600]);
  });

  it("falls back to the first sample dts when there is no tfdt", () => {
    const samples = mk([9000, 9600]);
    expect(rebaseSamplesToTfdt(samples, null)).toBe(9000);
    expect(samples[0].dts).toBe(9000);
  });

  it("handles empty sample lists", () => {
    expect(rebaseSamplesToTfdt([], 42)).toBe(42);
    expect(rebaseSamplesToTfdt([], null)).toBe(0);
  });
});

describe("extractTfdt", () => {
  // ISO BMFF box builder: size(4) + type(4) + payload
  const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
    const size = 8 + payload.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(size);
    new DataView(out.buffer).setUint32(0, size);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let off = 8;
    for (const p of payload) { out.set(p, off); off += p.length; }
    return out;
  };
  const u32 = (v: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v);
    return b;
  };
  const tfdtV0 = (base: number) => box("tfdt", u32(0 /* version 0 + flags */), u32(base));
  const tfdtV1 = (hi: number, lo: number) =>
    box("tfdt", u32(0x01000000 /* version 1 */), u32(hi), u32(lo));
  const concat = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  };

  it("reads a version-0 tfdt from a single-traf moof", () => {
    const seg = concat(box("moof", box("traf", tfdtV0(434000))), box("mdat", u32(0)));
    expect(extractTfdt(seg)).toBe(434000);
  });

  it("reads a 64-bit version-1 tfdt", () => {
    const seg = box("moof", box("traf", tfdtV1(1, 500)));
    expect(extractTfdt(seg)).toBe(0x100000000 + 500);
  });

  it("returns null for muxed A/V segments (two traf boxes)", () => {
    // The first tfdt could belong to the audio track (other timescale) —
    // rebasing video samples with it would corrupt the whole segment.
    const seg = box("moof", box("traf", tfdtV0(48000)), box("traf", tfdtV0(90000)));
    expect(extractTfdt(seg)).toBeNull();
  });

  it("never scans mdat payloads for stray tfdt byte patterns", () => {
    const fakeTfdtBytes = box("tfdt", u32(0), u32(123456));
    const seg = concat(box("moof", box("traf", tfdtV0(9000))), box("mdat", fakeTfdtBytes));
    expect(extractTfdt(seg)).toBe(9000);
    // mdat only — no moof/traf structure around the byte pattern
    expect(extractTfdt(box("mdat", fakeTfdtBytes))).toBeNull();
  });

  it("returns null on truncated version-1 payloads instead of misreading 32 bits", () => {
    // version says 64-bit but only 4 payload bytes follow
    const truncated = box("tfdt", u32(0x01000000), u32(7));
    expect(extractTfdt(box("moof", box("traf", truncated)))).toBeNull();
  });

  it("returns null on unknown tfdt versions", () => {
    const v2 = box("tfdt", u32(0x02000000), u32(9000));
    expect(extractTfdt(box("moof", box("traf", v2)))).toBeNull();
  });

  it("returns null when the 64-bit value exceeds Number.MAX_SAFE_INTEGER", () => {
    const seg = box("moof", box("traf", tfdtV1(0xffffffff, 0xffffffff)));
    expect(extractTfdt(seg)).toBeNull();
  });

  it("stops on malformed box sizes without throwing", () => {
    const bad = new Uint8Array([0, 0, 0, 2, 0x6d, 0x6f, 0x6f, 0x66]); // size 2 < 8
    expect(extractTfdt(bad)).toBeNull();
    expect(extractTfdt(new Uint8Array(0))).toBeNull();
  });
});

/**
 * The decoder must not hold a whole segment's worth of pictures.
 *
 * The WASM DPB only reclaims a picture once the caller has bumped it out
 * (`drain()`); feeding every sample of a segment before draining once keeps
 * one picture alive per frame — ~24 MB each at 4K, which overruns the 2 GB
 * WASM ceiling on a 2s segment. `drain()` copies planes into the JS heap, so
 * draining early costs nothing and the frames stay valid across later feeds.
 *
 * The invariant asserted here is the interleaving itself: at most one feed()
 * between two drain() calls.
 */
describe("SegmentTranscoder.processMediaSegment decode/encode interleaving", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const makeFrame = (poc: number) => ({
    y: new Uint16Array(4),
    cb: new Uint16Array(1),
    cr: new Uint16Array(1),
    width: 64,
    height: 64,
    chromaWidth: 32,
    chromaHeight: 32,
    bitDepth: 8,
    poc,
  });

  /**
   * Decoder stub modelling §C.5.2 bumping with a reorder depth of 2.
   *
   * `total` is how many samples the segment carries: on the last one the
   * stub bumps everything, which is what the real decoder does at a closed
   * GOP boundary (measured on bbb1080_50f: 12 frames in, 12 frames out per
   * 12-frame segment, batched and interleaved alike).
   */
  class FakeDecoder {
    calls: string[] = [];
    private _held = 0;
    private _fed = 0;
    private _nextPoc = 0;
    constructor(private _total: number) {}
    feed() {
      this.calls.push("feed");
      this._held++;
      this._fed++;
    }
    drain() {
      this.calls.push("drain");
      const reorder = this._fed >= this._total ? 0 : 2;
      const out = [];
      while (this._held > reorder) {
        this._held--;
        out.push(makeFrame(this._nextPoc++));
      }
      return out;
    }
  }

  const setup = (sampleCount: number) => {
    const t = new SegmentTranscoder();
    const decoder = new FakeDecoder(sampleCount);
    const encoded: { timestampUs: number; keyFrame: boolean }[] = [];

    const samples = Array.from({ length: sampleCount }, (_, i) => ({
      trackId: 1,
      nalUnits: [new Uint8Array([0x26, 0x01])],
      pts: i * 3600,
      dts: i * 3600,
      duration: 3600,
      isKeyframe: i === 0,
    }));

    (t as any)._decoder = decoder;
    (t as any)._demuxer = {
      parseSegment: () => samples,
      drainAudioSamples: () => [],
    };
    (t as any)._muxer = { muxSegment: () => new Uint8Array([1, 2, 3]) };

    // Encoder stub: emits one chunk per encoded frame, like a real
    // VideoEncoder, so the muxing and batch-emit steps actually run.
    let onChunkCb: ((c: unknown) => void) | null = null;
    (t as any)._encoder = {
      encode(_f: unknown, timestampUs: number, keyFrame: boolean) {
        encoded.push({ timestampUs, keyFrame });
        onChunkCb?.({ data: new Uint8Array([0]), duration: 40000, isKeyframe: keyFrame });
      },
      flush: async () => {},
      close: () => {},
      codec: "avc1.42E01E",
      codecDescription: new Uint8Array([1]),
      set onChunk(cb: (c: unknown) => void) {
        onChunkCb = cb;
      },
    };
    (t as any)._width = 64;
    (t as any)._height = 64;
    (t as any)._paramSetsFed = true;
    (t as any)._initResult = { initSegment: new Uint8Array(), codec: "avc1.42" };

    return { t, decoder, encoded, samples };
  };

  /** Longest run of feed() calls with no drain() in between. */
  const maxFeedsWithoutDrain = (calls: string[]) => {
    let run = 0;
    let worst = 0;
    for (const c of calls) {
      if (c === "feed") worst = Math.max(worst, ++run);
      else run = 0;
    }
    return worst;
  };

  it("drains after each feed instead of buffering the whole segment", async () => {
    const { t, decoder } = setup(30);

    await t.processMediaSegment(new Uint8Array(8));

    expect(decoder.calls.filter((c) => c === "feed")).toHaveLength(30);
    expect(maxFeedsWithoutDrain(decoder.calls)).toBe(1);
  });

  it("drains after each feed on the streaming path too", async () => {
    // processMediaSegmentStreaming — not processMediaSegment — is what every
    // video-only stream goes through (mse-intercept routes muxed A/V only to
    // the combined path), so it carries the 4K memory ceiling.
    const { t, decoder } = setup(30);

    const emitted: Uint8Array[] = [];
    await t.processMediaSegmentStreaming(new Uint8Array(8), (h264) => {
      emitted.push(h264);
    });

    expect(decoder.calls.filter((c) => c === "feed")).toHaveLength(30);
    expect(maxFeedsWithoutDrain(decoder.calls)).toBe(1);
    expect(emitted.length).toBeGreaterThan(0);
  });

  it("keeps display-order timestamps and a single keyframe across the interleaved path", async () => {
    const { t, encoded, samples } = setup(30);

    await t.processMediaSegment(new Uint8Array(8));

    // Every frame of the segment is encoded, in display order, exactly as the
    // batched path did — the interleaving must not shift frames into the next
    // segment, where they would pick up that segment's timestamps.
    expect(encoded).toHaveLength(30);
    const expectedUs = samples
      .map((s) => s.pts)
      .sort((a, b) => a - b)
      .map((pts) => Math.round((pts / 90000) * 1_000_000));
    expect(encoded.map((e) => e.timestampUs)).toEqual(expectedUs);
    expect(encoded.filter((e) => e.keyFrame)).toHaveLength(1);
    expect(encoded[0]!.keyFrame).toBe(true);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});
