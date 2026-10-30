import { describe, expect, it } from "vitest";
import { OutputTimestamps } from "./output-timestamps.js";

const slot = (timestamp: number) => ({ timestamp, duration: 1 });

describe("OutputTimestamps", () => {
  it("gives frames the packet timestamps in display order, whatever the decode order", () => {
    const t = new OutputTimestamps();
    // I0 P3 B1 B2, in decode order
    for (const ts of [0, 3, 1, 2]) t.add(slot(ts));
    const out = [0, 1, 2, 3].map(poc => t.next({ cvsId: 0, poc })!.timestamp);
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("drops the slot of a suppressed picture once a frame displayed after it comes out", () => {
    const t = new OutputTimestamps();
    for (const ts of [0, 1, 2]) t.add(slot(ts));
    t.noteSuppressed([{ cvsId: 0, poc: 1 }]);
    expect(t.next({ cvsId: 0, poc: 0 })!.timestamp).toBe(0);
    // POC 1 never comes out: POC 2 must not take its slot
    expect(t.next({ cvsId: 0, poc: 2 })!.timestamp).toBe(2);
  });

  it("orders pictures by sequence before POC", () => {
    const t = new OutputTimestamps();
    for (const ts of [0, 1, 2]) t.add(slot(ts));
    // POC 5 of the first sequence, never output, displays before POC 0 of the next
    t.noteSuppressed([{ cvsId: 0, poc: 5 }]);
    expect(t.next({ cvsId: 0, poc: 4 })!.timestamp).toBe(0);
    expect(t.next({ cvsId: 1, poc: 0 })!.timestamp).toBe(2);
  });

  it("returns null when no packet is left, and nothing after a reset", () => {
    const t = new OutputTimestamps();
    t.add(slot(0));
    t.add(slot(1));
    t.noteSuppressed([{ cvsId: 0, poc: 9 }]);
    t.reset();
    expect(t.next({ cvsId: 0, poc: 0 })).toBeNull();
  });
});
