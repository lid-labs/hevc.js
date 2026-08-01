import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSegmentStatBus,
  publishSegmentStat,
} from "@hevcjs/core";
import type { SegmentPerfStat } from "@hevcjs/core";
import { attachShakaComputeAware } from "./compute-aware.js";

// Minimal Shaka player surface the adapter touches.
interface MockVariant {
  active: boolean;
  height?: number;
  videoBandwidth?: number;
  bandwidth?: number;
  videoCodec?: string;
}

function makePlayer(variants: MockVariant[]) {
  return {
    getVariantTracks: vi.fn(() => variants),
    configure: vi.fn(),
  };
}

// Build a perf stat with a given speedX (segDurMs/totalMs ratio).
function statAt(speedX: number, height = 1080): SegmentPerfStat {
  return {
    totalMs: 1000 / speedX,
    segDurMs: 1000,
    speedX,
    frames: 25,
    width: 1920,
    height,
  };
}

// Fire N stats with the same speedX onto the bus.
function fireN(speedX: number, n: number, height = 1080) {
  for (let i = 0; i < n; i++) publishSegmentStat(statAt(speedX, height));
}

describe("attachShakaComputeAware", () => {
  beforeEach(() => {
    _resetSegmentStatBus();
  });
  afterEach(() => {
    _resetSegmentStatBus();
  });

  it("does nothing when the manifest hasn't loaded yet (empty ladder)", () => {
    const player = makePlayer([]);
    const detach = attachShakaComputeAware(player, { lowerAfter: 1, measureWindow: 2 });
    fireN(0.5, 20);
    expect(player.configure).not.toHaveBeenCalled();
    detach();
  });

  it("caps maxHeight + maxBandwidth when speedX stays below 1.0", () => {
    const player = makePlayer([
      { active: false, height: 360, videoBandwidth: 500_000 },
      { active: false, height: 720, videoBandwidth: 2_000_000 },
      { active: true, height: 1080, videoBandwidth: 5_000_000 },
    ]);
    const detach = attachShakaComputeAware(player, {
      measureWindow: 2,
      lowerAfter: 1,
    });

    fireN(0.5, 20);

    expect(player.configure).toHaveBeenCalled();
    // First cap from currentIdx (2) → 1, applies 720p
    const firstCall = player.configure.mock.calls[0]![0];
    expect(firstCall).toEqual({
      abr: { restrictions: { maxBandwidth: 2_000_000, maxHeight: 720 } },
    });
    detach();
  });

  it("falls back to maxBandwidth when the manifest has no heights", () => {
    const player = makePlayer([
      { active: false, videoBandwidth: 500_000 },
      { active: true, videoBandwidth: 5_000_000 },
    ]);
    const detach = attachShakaComputeAware(player, {
      measureWindow: 2,
      lowerAfter: 1,
    });
    fireN(0.5, 20);

    expect(player.configure).toHaveBeenCalled();
    const restrictions = player.configure.mock.calls[0]![0].abr.restrictions;
    expect(restrictions.maxBandwidth).toBe(500_000);
    expect(restrictions.maxHeight).toBeUndefined();
    detach();
  });

  it("deduplicates variants that share the same height", () => {
    // Common case: multiple audio tracks paired with the same video heights
    // produce duplicated variant tracks at each video height.
    const player = makePlayer([
      { active: false, height: 720, videoBandwidth: 2_000_000 },
      { active: false, height: 720, videoBandwidth: 2_000_000 }, // dup
      { active: true, height: 1080, videoBandwidth: 5_000_000 },
      { active: false, height: 1080, videoBandwidth: 5_000_000 }, // dup
    ]);
    const detach = attachShakaComputeAware(player, {
      measureWindow: 2,
      lowerAfter: 1,
    });
    fireN(0.5, 20);
    // Ladder is [720, 1080] (size 2). Cap from current (1080, idx 1) → idx 0 = 720.
    const restrictions = player.configure.mock.calls[0]![0].abr.restrictions;
    expect(restrictions.maxHeight).toBe(720);
    detach();
  });

  it("unsubscribes on cleanup", () => {
    const player = makePlayer([
      { active: false, height: 720, videoBandwidth: 2_000_000 },
      { active: true, height: 1080, videoBandwidth: 5_000_000 },
    ]);
    const detach = attachShakaComputeAware(player, {
      measureWindow: 2,
      lowerAfter: 1,
    });
    detach();
    fireN(0.5, 20);
    expect(player.configure).not.toHaveBeenCalled();
  });

  it("invokes onObservation telemetry on every stat (not just cap changes)", () => {
    const player = makePlayer([
      { active: true, height: 1080, videoBandwidth: 5_000_000 },
    ]);
    const onObservation = vi.fn();
    const detach = attachShakaComputeAware(player, {
      measureWindow: 4,
      onObservation,
    });
    fireN(1.2, 3);
    expect(onObservation).toHaveBeenCalledTimes(3);
    detach();
  });

  it("reverts the decider when player.configure throws", () => {
    const player = {
      getVariantTracks: vi.fn(() => [
        { active: false, height: 720, videoBandwidth: 2_000_000 },
        { active: true, height: 1080, videoBandwidth: 5_000_000 },
      ]),
      // Annotated: an always-throwing impl would infer `() => never`, which
      // rejects the non-throwing mockImplementation swapped in below.
      configure: vi.fn<() => void>(() => {
        throw new Error("player destroyed");
      }),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const detach = attachShakaComputeAware(player, {
      measureWindow: 2,
      lowerAfter: 1,
      raiseAfter: 1,
      targetSpeedX: 1.3,
    });

    // Trigger a lower decision — configure() will throw.
    fireN(0.5, 20);
    expect(player.configure).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    // Make configure stop throwing, then drive a HIGH sequence. Because
    // the previous decision was reverted, the decider should be back in
    // the "never lowered" (capIndex === null) state — meaning it cannot
    // raise (cold start guard) and configure should NOT be re-called.
    player.configure.mockImplementation(() => {});
    player.configure.mockClear();
    fireN(2.0, 20);
    expect(player.configure).not.toHaveBeenCalled();

    detach();
    warnSpy.mockRestore();
  });

  it("ignores audio-only variant tracks", () => {
    const player = makePlayer([
      // Audio-only: no height, no videoBandwidth, no videoCodec → skip
      { active: false, bandwidth: 128_000 },
      { active: true, height: 1080, videoBandwidth: 5_000_000 },
    ]);
    const detach = attachShakaComputeAware(player, {
      measureWindow: 2,
      lowerAfter: 1,
    });
    fireN(0.5, 20);
    // Ladder has only the one video variant → can't lower (already at 0).
    // No cap should be applied.
    expect(player.configure).not.toHaveBeenCalled();
    detach();
  });
});
