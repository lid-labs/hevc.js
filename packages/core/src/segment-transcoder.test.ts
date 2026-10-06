import { describe, it, expect, vi, afterEach } from "vitest";
import { SegmentTranscoder, DisplayPtsAssigner, extractTfdt, rebaseSamplesToTfdt } from "./segment-transcoder.js";
import { FMP4Demuxer } from "./fmp4-demuxer.js";

/**
 * Re-calling prepareInit() must reset the per-stream runtime state.
 *
 * Regression for the Shaka ABR adaptation bug: Shaka feeds a fresh HEVC
 * init segment when the variant switches resolution. Without the reset,
 * `_encoder` stayed configured at the previous resolution —
 * `processMediaSegment` would then encode new-dimension frames through the
 * previous-dimension encoder and ship broken H.264 to MSE. The parameter-set
 * re-arm now belongs to `processInitSegment`, stubbed out here and covered by
 * its own suite below.
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

  it("closes the previous encoder before re-processing the init", async () => {
    const t = new SegmentTranscoder();
    stubInternals(t);

    const close = vi.fn();
    (t as any)._encoder = { close };
    (t as any)._initResult = { initSegment: new Uint8Array(), codec: "avc1.42" };

    // The rest of prepareInit (warmup encoder, mux) still fails because we
    // don't run a real WASM pipeline — but the reset block runs first and
    // that's what we're asserting.
    await expect(t.prepareInit(new Uint8Array(8))).rejects.toBeDefined();

    expect(close).toHaveBeenCalledTimes(1);
    expect((t as any)._encoder).toBeNull();
    expect((t as any)._initResult).toBeNull();
  });

  it("closes an encoder that still matches the new init's dimensions", async () => {
    // Unlike processInitSegment's dimension-guarded drop: prepareInit rebuilds
    // the H.264 init segment from a warmup frame, so the encoder that matched
    // the previous one is stale whatever its dimensions.
    const t = new SegmentTranscoder();
    stubInternals(t);

    const close = vi.fn();
    (t as any)._encoder = { close };

    await expect(t.prepareInit(new Uint8Array(8))).rejects.toBeDefined();

    expect(close).toHaveBeenCalledTimes(1);
    expect((t as any)._encoder).toBeNull();
  });

  it("is a no-op reset on the very first call (clean instance)", async () => {
    const t = new SegmentTranscoder();
    stubInternals(t);

    expect((t as any)._encoder).toBeNull();
    expect((t as any)._initResult).toBeNull();

    await expect(t.prepareInit(new Uint8Array(8))).rejects.toBeDefined();

    expect((t as any)._encoder).toBeNull();
    expect((t as any)._initResult).toBeNull();
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

/**
 * The same reset, on the path prepareInit() does not cover.
 *
 * dash.js and hls.js go through mse-intercept, which calls
 * processInitSegment() directly: on an ABR switch the player appends a new
 * HEVC init segment, the new dimensions land in `_width`/`_height`, and the
 * dim-change check in `_prepareEncoder` then compares the incoming frames
 * against dims that already match. The encoder stayed configured for the
 * previous variant and the picture never left the lower rendition (#258).
 */
describe("SegmentTranscoder.processInitSegment re-call", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const stubDemuxer = (width: number, height: number) => {
    vi.spyOn(FMP4Demuxer.prototype, "parseInit").mockResolvedValue(undefined);
    vi.spyOn(FMP4Demuxer.prototype, "videoTrack", "get").mockReturnValue({
      id: 1,
      timescale: 90000,
      width,
      height,
      codec: "hvc1.1.6.L120.90",
      hvcC: new Uint8Array(),
    } as any);
    vi.spyOn(FMP4Demuxer.prototype, "audioTrack", "get").mockReturnValue(null);
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closes the encoder when the new init segment carries different dimensions", async () => {
    const t = new SegmentTranscoder();
    const close = vi.fn();
    (t as any)._encoder = { close };
    (t as any)._width = 848;
    (t as any)._height = 480;
    (t as any)._initResult = { initSegment: new Uint8Array(), codec: "avc1.42" };

    stubDemuxer(1920, 1080);
    await t.processInitSegment(new Uint8Array(8));

    expect(close).toHaveBeenCalledTimes(1);
    expect((t as any)._encoder).toBeNull();
    expect((t as any)._initResult).toBeNull();
    expect((t as any)._width).toBe(1920);
    expect((t as any)._height).toBe(1080);
  });

  it("keeps the encoder when the same init segment is re-parsed (seek)", async () => {
    const t = new SegmentTranscoder();
    const close = vi.fn();
    const initResult = { initSegment: new Uint8Array(), codec: "avc1.42" };
    (t as any)._encoder = { close };
    (t as any)._width = 1920;
    (t as any)._height = 1080;
    (t as any)._initResult = initResult;

    stubDemuxer(1920, 1080);
    await t.processInitSegment(new Uint8Array(8));

    expect(close).not.toHaveBeenCalled();
    expect((t as any)._initResult).toBe(initResult);
  });

  it("re-arms the parameter-set feed so the new stream's VPS/SPS/PPS reach the decoder", async () => {
    const t = new SegmentTranscoder();
    (t as any)._paramSetsFed = true;

    stubDemuxer(1920, 1080);
    // hvcC box holding a single one-byte NAL: fourcc, 22 bytes of header,
    // numOfArrays = 1, then the array (kind byte, count, length, payload).
    const init = new Uint8Array([
      ...[0x68, 0x76, 0x63, 0x43], // 'hvcC'
      ...new Array(22).fill(0),
      1, // numOfArrays
      0x20, // array_completeness + NAL_unit_type (VPS)
      0, 1, // numNalus
      0, 1, // NAL length
      0x40, // NAL payload
    ]);
    await t.processInitSegment(init);

    expect((t as any)._paramSetsFed).toBe(false);
    expect((t as any)._paramSetsBuffer).not.toBeNull();
  });

  it("drops the previous stream's parameter sets when the new hvcC carries none", async () => {
    // Parameter sets may be signalled in band instead, which is spec-legal.
    // Keeping the previous stream's buffer would leave the decoder one
    // re-feed away from being handed the wrong SPS.
    const t = new SegmentTranscoder();
    (t as any)._paramSetsFed = true;
    (t as any)._paramSetsBuffer = new Uint8Array([0, 0, 0, 1, 0x40]);

    stubDemuxer(1920, 1080);
    await t.processInitSegment(new Uint8Array(8)); // no hvcC box

    expect((t as any)._paramSetsFed).toBe(false);
    expect((t as any)._paramSetsBuffer).toBeNull();
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
  const makeFrame = (poc: number, cvsId = 0) => ({
    y: new Uint16Array(4),
    cb: new Uint16Array(1),
    cr: new Uint16Array(1),
    width: 64,
    height: 64,
    chromaWidth: 32,
    chromaHeight: 32,
    bitDepth: 8,
    poc,
    cvsId,
  });

  /**
   * Decoder stub modelling §C.5.2 bumping with a reorder depth of 2.
   *
   * It holds back its reorder frames exactly like the real decoder, which
   * since the §C.5.2.2 fix never bumps the picture it is currently decoding.
   * Emptying that buffer is the caller's job — measured on bbb1080_50f, a
   * 12-frame segment yields 11 frames via drain() and the twelfth only on
   * flush(). Without the flush the segment would ship 11 frames and leak the
   * twelfth into the next one, where it would take that segment's timestamp.
   */
  class FakeDecoder {
    calls: string[] = [];
    /** POCs decoded and waiting to be bumped, in display order. */
    private _queue: number[] = [];
    private _nextPoc = 0;
    private _suppressedReport: { cvsId: number; poc: number }[] = [];

    /** @param suppressed POCs the bitstream marks with PicOutputFlag = 0 */
    constructor(private readonly _suppressed: Set<number> = new Set()) {}

    feed() {
      this.calls.push("feed");
      const poc = this._nextPoc++;
      // A suppressed picture is decoded but never enters the output queue —
      // the decoder reports it instead.
      if (this._suppressed.has(poc)) this._suppressedReport.push({ cvsId: 0, poc });
      else this._queue.push(poc);
    }
    takeSuppressedPictures() {
      const out = this._suppressedReport;
      this._suppressedReport = [];
      return out;
    }
    drain() {
      this.calls.push("drain");
      const out = [];
      while (this._queue.length > 2) out.push(makeFrame(this._queue.shift()!));
      return out;
    }
    flush() {
      this.calls.push("flush");
      const out = [];
      while (this._queue.length > 0) out.push(makeFrame(this._queue.shift()!));
      return out;
    }
  }

  const setup = (sampleCount: number, suppressed: Set<number> = new Set()) => {
    const t = new SegmentTranscoder();
    const decoder = new FakeDecoder(suppressed);
    const encoded: { timestampUs: number; keyFrame: boolean }[] = [];
    const muxed: { samples: { duration: number }[]; baseTime: number }[] = [];

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
    (t as any)._muxer = {
      muxSegment: (muxerSamples: { duration: number }[], baseTime: number) => {
        muxed.push({ samples: muxerSamples, baseTime });
        return new Uint8Array([1, 2, 3]);
      },
    };

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

    return { t, decoder, encoded, muxed, samples };
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
    // The segment must not end with frames still held by the decoder.
    expect(decoder.calls[decoder.calls.length - 1]).toBe("flush");
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
    expect(decoder.calls[decoder.calls.length - 1]).toBe("flush");
    expect(emitted.length).toBeGreaterThan(0);
  });

  it("keeps display-order timestamps and a single keyframe across the interleaved path", async () => {
    const { t, encoded, samples } = setup(30);

    await t.processMediaSegment(new Uint8Array(8));

    // Every frame of the segment is encoded, in display order, exactly as the
    // batched path did — no frame may be left for the next segment, where it
    // would pick up that segment's timestamps.
    expect(encoded).toHaveLength(30);
    const expectedUs = samples
      .map((s) => s.pts)
      .sort((a, b) => a - b)
      .map((pts) => Math.round((pts / 90000) * 1_000_000));
    expect(encoded.map((e) => e.timestampUs)).toEqual(expectedUs);
    expect(encoded.filter((e) => e.keyFrame)).toHaveLength(1);
    expect(encoded[0]!.keyFrame).toBe(true);
  });

  /**
   * A picture with PicOutputFlag = 0 (§C.3.1) is decoded but never output.
   * Its sample's timestamp has no frame to carry it: mapping frames onto
   * timestamps by position would hand it to the next frame, and every frame
   * after the hole would play one slot early.
   */
  it("skips the timestamp of a picture the bitstream marks as not for output", async () => {
    const { t, encoded, samples } = setup(30, new Set([7]));

    await t.processMediaSegment(new Uint8Array(8));

    expect(encoded).toHaveLength(29);
    const expectedUs = samples
      .map((s) => s.pts)
      .sort((a, b) => a - b)
      .filter((_, i) => i !== 7)
      .map((pts) => Math.round((pts / 90000) * 1_000_000));
    expect(encoded.map((e) => e.timestampUs)).toEqual(expectedUs);
  });

  it("skips it on the streaming path too", async () => {
    const { t, encoded, samples } = setup(30, new Set([7]));

    await t.processMediaSegmentStreaming(new Uint8Array(8), () => {});

    expect(encoded).toHaveLength(29);
    const expectedUs = samples
      .map((s) => s.pts)
      .sort((a, b) => a - b)
      .filter((_, i) => i !== 7)
      .map((pts) => Math.round((pts / 90000) * 1_000_000));
    expect(encoded.map((e) => e.timestampUs)).toEqual(expectedUs);
  });

  /**
   * The frame before the hole holds the screen across it — otherwise the
   * muxed segment declares a gap where the suppressed picture would have
   * been, and the timeline drifts short by one frame.
   */
  it("gives the frame before a suppressed picture the gap's duration", async () => {
    const { t, muxed } = setup(10, new Set([4]));

    await t.processMediaSegment(new Uint8Array(8));

    expect(muxed).toHaveLength(1);
    const durations = muxed[0]!.samples.map((s) => s.duration);
    expect(durations).toHaveLength(9);
    // Slot 4 has no frame, so the frame in slot 3 spans two sample durations
    expect(durations[3]).toBe(7200);
    expect(durations.filter((d) => d === 3600)).toHaveLength(8);
    expect(muxed[0]!.baseTime).toBe(0);
  });

  /**
   * §8.1 creates a shape the other cases do not cover: the RASL pictures of an
   * opening CRA are suppressed, and they display *before* it, so the holes sit
   * at the very start of the segment. The first frame actually output must take
   * its own slot — the fourth here — and the muxed base time must follow it,
   * not the segment's first sample. Taking slot 0 instead would place the
   * segment three frames early on the timeline.
   */
  it("starts the segment at the first frame output when the leading slots are suppressed", async () => {
    const { t, muxed, encoded } = setup(10, new Set([0, 1, 2]));

    await t.processMediaSegment(new Uint8Array(8));

    expect(muxed).toHaveLength(1);
    expect(muxed[0]!.samples).toHaveLength(7);
    // Slot 3's PTS, in the 90 kHz timescale the fake samples use
    expect(muxed[0]!.baseTime).toBe(3 * 3600);
    expect(encoded[0]!.timestampUs).toBe(Math.round((3 * 3600 / 90000) * 1_000_000));
    // No frame precedes the holes, so nothing has to span them: every frame
    // keeps one sample duration.
    expect(muxed[0]!.samples.map((s) => s.duration)).toEqual(Array(7).fill(3600));
  });

  /**
   * A suppressed picture landing on a batch boundary is the same defect at a
   * smaller scale: the last frame of the batch is closed by the first frame
   * of the next one, so its duration has to span the hole between them.
   */
  it("spans a suppressed picture that falls on a streaming batch boundary", async () => {
    // BATCH_SIZE is 30, so slot 30 is the first frame of the second batch.
    const { t, muxed } = setup(70, new Set([30]));

    await t.processMediaSegmentStreaming(new Uint8Array(8), () => {});

    expect(muxed.length).toBeGreaterThan(1);
    const first = muxed[0]!.samples.map((s) => s.duration);
    expect(first).toHaveLength(30);
    // Frame 29 is the batch's last; slot 30 has no frame, so it holds the
    // screen until slot 31 — two sample durations, not one.
    expect(first[29]).toBe(7200);
    expect(first.slice(0, 29).every((d) => d === 3600)).toBe(true);
  });

  /**
   * The segment's last picture being the suppressed one is the same hole at
   * the far edge: the last frame must hold the screen to the end of the
   * segment, since the next segment's tfdt starts a full segment later.
   */
  it("runs the last frame to the end of the segment when the final picture is suppressed", async () => {
    const { t, muxed } = setup(10, new Set([9]));

    await t.processMediaSegment(new Uint8Array(8));

    const durations = muxed[0]!.samples.map((s) => s.duration);
    expect(durations).toHaveLength(9);
    // Slot 9 has no frame, so the frame in slot 8 covers both
    expect(durations[8]).toBe(7200);
    expect(durations.slice(0, 8).every((d) => d === 3600)).toBe(true);
    // The whole segment is still covered: 8 * 3600 + 7200
    expect(durations.reduce((a, b) => a + b, 0)).toBe(36000);
  });

  it("does the same on the streaming path", async () => {
    const { t, muxed } = setup(10, new Set([9]));

    await t.processMediaSegmentStreaming(new Uint8Array(8), () => {});

    const durations = muxed.flatMap((m) => m.samples.map((s) => s.duration));
    expect(durations).toHaveLength(9);
    expect(durations[8]).toBe(7200);
    expect(durations.reduce((a, b) => a + b, 0)).toBe(36000);
  });

  /** A suppressed first picture moves the segment's base decode time. */
  it("bases the muxed segment on the first frame actually output", async () => {
    const { t, muxed } = setup(10, new Set([0]));

    await t.processMediaSegment(new Uint8Array(8));

    expect(muxed[0]!.baseTime).toBe(3600);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

describe("DisplayPtsAssigner", () => {
  const pts = [0, 3600, 7200, 10800, 14400];
  /** A display key in the first coded video sequence. */
  const k = (poc: number, cvsId = 0) => ({ cvsId, poc });

  it("hands out the sample timestamps in order when nothing is suppressed", () => {
    const a = new DisplayPtsAssigner(pts, 3600);
    expect([0, 1, 2, 3, 4].map((poc) => a.next(k(poc))!.pts)).toEqual(pts);
  });

  it("consumes the slot of a suppressed picture that displays earlier", () => {
    const a = new DisplayPtsAssigner(pts, 3600);
    expect(a.next(k(0))!.pts).toBe(0);
    a.noteSuppressed([k(1)]);
    // POC 1 took slot 1; POC 2 must land on slot 2, not on slot 1
    expect(a.next(k(2))!.pts).toBe(7200);
    expect(a.next(k(3))!.pts).toBe(10800);
  });

  it("leaves the slot alone for a suppressed picture that displays later", () => {
    const a = new DisplayPtsAssigner(pts, 3600);
    // Decode order can put a higher-POC picture first: it must not consume a
    // slot ahead of the frames that display before it.
    a.noteSuppressed([k(4)]);
    expect(a.next(k(0))!.pts).toBe(0);
    expect(a.next(k(1))!.pts).toBe(3600);
  });

  it("stretches the slot duration across a suppressed picture", () => {
    const a = new DisplayPtsAssigner(pts, 3600);
    a.noteSuppressed([k(1)]);
    const first = a.next(k(0))!;
    const second = a.next(k(2))!;
    // nominalDuration is the slot's own gap; the caller spans the hole by
    // differencing the assigned timestamps, which is what matters here
    expect(second.pts - first.pts).toBe(7200);
    expect(first.nominalDuration).toBe(3600);
  });

  /**
   * The bumping bound counts pictures pending output, so a suppressed picture
   * can be decoded after a frame with a higher POC was already timed. That
   * frame keeps the slot it took; the ones after it must not inherit the
   * error.
   */
  it("does not let a late report shift the frames that follow", () => {
    const a = new DisplayPtsAssigner(pts, 3600);
    expect(a.next(k(0))!.pts).toBe(0);
    // POC 2 is timed before the decoder has seen the suppressed POC 1, so it
    // lands on slot 1 instead of slot 2
    expect(a.next(k(2))!.pts).toBe(3600);
    a.noteSuppressed([k(1)]);
    // POC 3 still lands on its own slot: the error stops there
    expect(a.next(k(3))!.pts).toBe(10800);
    expect(a.next(k(4))!.pts).toBe(14400);
  });

  /**
   * POC restarts at each IRAP, so a segment spanning two coded video
   * sequences repeats its POCs. Comparing POC alone would treat a suppressed
   * picture of the new sequence as displaying before the pictures of the old
   * one still pending output, and consume a slot that is not its own.
   */
  it("orders a suppressed picture by its CVS before its POC", () => {
    const a = new DisplayPtsAssigner(pts, 3600);
    expect(a.next(k(0))!.pts).toBe(0);
    // A new CVS opens and its first picture, POC 0 again, is suppressed
    a.noteSuppressed([k(0, 1)]);
    // POC 8 of the previous CVS is still pending: it displays first, so the
    // suppressed picture must not have eaten its slot
    expect(a.next(k(8, 0))!.pts).toBe(3600);
    // Now the new sequence: its suppressed POC 0 took slot 2
    expect(a.next(k(1, 1))!.pts).toBe(10800);
  });

  it("reports the end of the segment one slot past the last sample", () => {
    expect(new DisplayPtsAssigner(pts, 3600).segmentEnd()).toBe(18000);
    expect(new DisplayPtsAssigner([], 3600).segmentEnd()).toBeNull();
  });

  it("uses the fallback duration on the last slot and returns null past it", () => {
    const a = new DisplayPtsAssigner([0, 3600], 1234);
    expect(a.next(k(0))!.nominalDuration).toBe(3600);
    expect(a.next(k(1))!.nominalDuration).toBe(1234);
    expect(a.next(k(2))).toBeNull();
  });
});
