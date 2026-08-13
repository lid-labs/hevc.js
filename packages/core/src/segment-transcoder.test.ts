import { describe, it, expect, vi } from "vitest";
import { SegmentTranscoder, rebaseSamplesToTfdt } from "./segment-transcoder.js";

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
    const samples = mk([9000, 9600, 10200]);
    const base = rebaseSamplesToTfdt(samples, 9000);
    expect(base).toBe(9000);
    expect(samples.map((s) => s.dts)).toEqual([9000, 9600, 10200]);
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
