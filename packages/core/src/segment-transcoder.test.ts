import { describe, it, expect, vi } from "vitest";
import { SegmentTranscoder } from "./segment-transcoder.js";

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
