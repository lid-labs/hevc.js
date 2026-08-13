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
