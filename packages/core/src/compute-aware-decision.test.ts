import { describe, expect, it } from "vitest";
import { ComputeAwareDecider } from "./compute-aware-decision.js";

// Feed N identical speedX values, return the last decision.
function feed(d: ComputeAwareDecider, speedX: number, n: number, currentIdx: number) {
  let decision;
  for (let i = 0; i < n; i++) {
    decision = d.observe(speedX, currentIdx);
  }
  return decision!;
}

// Feed up to `maxN` measurements, stop as soon as a decision matches
// `reason`. Returns the matching decision, or throws if not seen.
function feedUntil(
  d: ComputeAwareDecider,
  speedX: number,
  currentIdx: number,
  reason: "lower" | "raise",
  maxN = 200,
) {
  for (let i = 0; i < maxN; i++) {
    const dec = d.observe(speedX, currentIdx);
    if (dec.reason === reason) return dec;
  }
  throw new Error(`Decision "${reason}" not reached after ${maxN} observations`);
}

describe("ComputeAwareDecider", () => {
  it("returns init until the window is full", () => {
    const d = new ComputeAwareDecider({ measureWindow: 8 });
    d.setLadderSize(4);
    for (let i = 0; i < 7; i++) {
      const r = d.observe(0.5, 3);
      expect(r.reason).toBe("init");
      expect(r.capIndex).toBeNull();
    }
  });

  it("holds when speedX is in the deadband [1.0, targetSpeedX]", () => {
    const d = new ComputeAwareDecider({ targetSpeedX: 1.3, lowerAfter: 1, raiseAfter: 1 });
    d.setLadderSize(4);
    // Fill window with deadband values
    const decision = feed(d, 1.15, 16, 3);
    expect(decision.reason).toBe("hold");
    expect(decision.capIndex).toBeNull();
  });

  it("lowers cap after `lowerAfter` consecutive low windows, subtractive from current variant", () => {
    const d = new ComputeAwareDecider({
      measureWindow: 4,
      lowerAfter: 2,
      raiseAfter: 6,
    });
    d.setLadderSize(4); // 0..3
    // Player is currently on top (index 3). speedX = 0.5 → can't keep up.
    // Need 2 full consecutive windows below 1.0 to trigger.
    const decision = feedUntil(d, 0.5, 3, "lower");
    expect(decision.capIndex).toBe(2); // 3 → 2
  });

  it("raises cap after `raiseAfter` consecutive high windows, but only if previously lowered", () => {
    const d = new ComputeAwareDecider({
      measureWindow: 4,
      lowerAfter: 1,
      raiseAfter: 2,
      targetSpeedX: 1.3,
    });
    d.setLadderSize(4);
    // First, lower the cap from 3 → 2
    feedUntil(d, 0.5, 3, "lower");
    expect(d.currentCap).toBe(2);
    // Now speed back up — accumulate high windows until raise triggers
    const decision = feedUntil(d, 2.0, 2, "raise");
    expect(decision.capIndex).toBe(3);
  });

  it("never raises above ladderSize - 1", () => {
    const d = new ComputeAwareDecider({
      measureWindow: 2,
      lowerAfter: 1,
      raiseAfter: 1,
    });
    d.setLadderSize(3);
    feedUntil(d, 0.5, 2, "lower");
    expect(d.currentCap).toBe(1);
    feedUntil(d, 2.0, 1, "raise");
    expect(d.currentCap).toBe(2);
    // Try to raise again — should hold at top
    const decision = feed(d, 2.0, 50, 2);
    expect(decision.reason).toBe("hold");
    expect(d.currentCap).toBe(2);
  });

  it("never lowers below 0", () => {
    const d = new ComputeAwareDecider({
      measureWindow: 2,
      lowerAfter: 1,
    });
    d.setLadderSize(3);
    feedUntil(d, 0.1, 2, "lower");
    expect(d.currentCap).toBe(1);
    feedUntil(d, 0.1, 1, "lower");
    expect(d.currentCap).toBe(0);
    const decision = feed(d, 0.1, 50, 0);
    expect(decision.reason).toBe("hold");
    expect(d.currentCap).toBe(0);
  });

  it("does NOT raise from null cap (cold start, never lowered)", () => {
    const d = new ComputeAwareDecider({
      measureWindow: 2,
      raiseAfter: 1,
    });
    d.setLadderSize(4);
    // Never lowered. Even with sustained high speedX, we shouldn't apply a
    // raise — the host ABR is already free to pick the top variant.
    const decision = feed(d, 5.0, 10, 3);
    expect(decision.reason).toBe("hold");
    expect(d.currentCap).toBeNull();
  });

  it("does not oscillate when measurements alternate within deadband", () => {
    const d = new ComputeAwareDecider({
      measureWindow: 8,
      lowerAfter: 2,
      raiseAfter: 6,
      targetSpeedX: 1.3,
    });
    d.setLadderSize(4);
    // Alternating 1.0 / 1.2 → avg ≈ 1.1, in deadband → no change
    let last;
    for (let i = 0; i < 40; i++) {
      last = d.observe(i % 2 === 0 ? 1.0 : 1.2, 3);
    }
    expect(last!.reason).toBe("hold");
    expect(d.currentCap).toBeNull();
  });

  it("clamps capIndex when ladder shrinks below current cap", () => {
    const d = new ComputeAwareDecider({ measureWindow: 2, lowerAfter: 1 });
    d.setLadderSize(5);
    feedUntil(d, 0.5, 4, "lower");
    expect(d.currentCap).toBe(3);
    d.setLadderSize(3); // ladder shrunk under our cap
    expect(d.currentCap).toBe(2);
  });

  it("validates config", () => {
    expect(() => new ComputeAwareDecider({ targetSpeedX: 0.9 })).toThrow();
    expect(() => new ComputeAwareDecider({ measureWindow: 0 })).toThrow();
    expect(() => new ComputeAwareDecider({ lowerAfter: 0 })).toThrow();
  });

  it("revertLastDecision() undoes the last lower/raise", () => {
    const d = new ComputeAwareDecider({ measureWindow: 2, lowerAfter: 1 });
    d.setLadderSize(4);
    feedUntil(d, 0.5, 3, "lower");
    expect(d.currentCap).toBe(2);
    d.revertLastDecision();
    // After revert, the cap should be back to where it was right before
    // the decision (here: null, the cold-start state).
    expect(d.currentCap).toBeNull();
  });

  it("revertLastDecision() is a no-op before any decision", () => {
    const d = new ComputeAwareDecider({ measureWindow: 2, lowerAfter: 1 });
    d.setLadderSize(3);
    expect(() => d.revertLastDecision()).not.toThrow();
    expect(d.currentCap).toBeNull();
  });

  it("revertLastDecision() can only revert one step (no stack)", () => {
    const d = new ComputeAwareDecider({ measureWindow: 2, lowerAfter: 1 });
    d.setLadderSize(4);
    feedUntil(d, 0.5, 3, "lower"); // 3 → 2
    feedUntil(d, 0.5, 2, "lower"); // 2 → 1
    expect(d.currentCap).toBe(1);
    d.revertLastDecision(); // back to 2
    expect(d.currentCap).toBe(2);
    d.revertLastDecision(); // second call has no snapshot — should no-op
    expect(d.currentCap).toBe(2);
  });

  it("reset() clears state but keeps config", () => {
    const d = new ComputeAwareDecider({ measureWindow: 2, lowerAfter: 1 });
    d.setLadderSize(3);
    feedUntil(d, 0.5, 2, "lower");
    expect(d.currentCap).toBe(1);
    d.reset();
    expect(d.currentCap).toBeNull();
    // Still functional after reset
    feedUntil(d, 0.5, 2, "lower");
    expect(d.currentCap).toBe(1);
  });
});
