import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSegmentStatBus,
  publishSegmentStat,
} from "@hevcjs/core";
import type { SegmentPerfStat } from "@hevcjs/core";
import { attachHlsComputeAware } from "./compute-aware.js";

// Minimal Hls surface the adapter touches.
function makeHls(levelCount: number, currentLevel = levelCount - 1) {
  return {
    levels: Array.from({ length: levelCount }, (_, i) => ({ height: [360, 720, 1080][i] })),
    currentLevel,
    autoLevelCapping: -1,
  };
}

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

function fireN(speedX: number, n: number) {
  for (let i = 0; i < n; i++) publishSegmentStat(statAt(speedX));
}

describe("attachHlsComputeAware", () => {
  beforeEach(() => {
    _resetSegmentStatBus();
  });
  afterEach(() => {
    _resetSegmentStatBus();
  });

  it("does nothing when the manifest hasn't loaded yet (no levels)", () => {
    const hls = makeHls(0);
    const detach = attachHlsComputeAware(hls, { lowerAfter: 1, measureWindow: 2 });
    fireN(0.5, 20);
    expect(hls.autoLevelCapping).toBe(-1);
    detach();
  });

  it("caps autoLevelCapping when speedX stays below target", () => {
    const hls = makeHls(3, 2);
    const detach = attachHlsComputeAware(hls, { measureWindow: 2, lowerAfter: 1 });

    fireN(0.5, 20);

    // First cap from currentLevel (2) steps down to 1
    expect(hls.autoLevelCapping).toBeLessThanOrEqual(1);
    expect(hls.autoLevelCapping).toBeGreaterThanOrEqual(0);
    detach();
  });

  it("uses the top level as the current index when hls reports -1 (auto start)", () => {
    const hls = makeHls(3, -1);
    const detach = attachHlsComputeAware(hls, { measureWindow: 2, lowerAfter: 1 });
    fireN(0.5, 20);
    expect(hls.autoLevelCapping).toBeLessThan(2);
    detach();
  });

  it("raises the cap back when speedX recovers", () => {
    const hls = makeHls(3, 2);
    const detach = attachHlsComputeAware(hls, {
      measureWindow: 2,
      lowerAfter: 1,
      raiseAfter: 1,
    });

    fireN(0.5, 20);
    const lowered = hls.autoLevelCapping;
    // hls.js would now be playing at the capped level
    hls.currentLevel = lowered;
    fireN(3.0, 30);

    expect(hls.autoLevelCapping).toBeGreaterThan(lowered);
    detach();
  });

  it("reports observations to the telemetry sink and survives a throwing sink", () => {
    const hls = makeHls(3, 2);
    const onObservation = vi.fn(() => { throw new Error("buggy sink"); });
    const detach = attachHlsComputeAware(hls, {
      measureWindow: 2,
      lowerAfter: 1,
      onObservation,
    });
    fireN(0.5, 5);
    expect(onObservation).toHaveBeenCalled();
    // The throwing sink didn't break the ABR loop
    expect(hls.autoLevelCapping).not.toBe(-1);
    detach();
  });

  it("unsubscribes on cleanup", () => {
    const hls = makeHls(3, 2);
    const detach = attachHlsComputeAware(hls, { measureWindow: 2, lowerAfter: 1 });
    detach();
    fireN(0.5, 20);
    expect(hls.autoLevelCapping).toBe(-1);
  });
});
