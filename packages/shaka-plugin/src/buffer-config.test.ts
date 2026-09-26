import { describe, it, expect } from "vitest";
import { recommendedBufferConfig, recommendedPlayerConfig } from "./buffer-config.js";

describe("recommendedBufferConfig", () => {
  it("buffers deeper than Shaka's default", () => {
    // bufferingGoal defaults to 10 on both Shaka 4.x and 5.x. A value at or
    // below that would leave the stutter this config exists to avoid.
    expect(recommendedBufferConfig().streaming.bufferingGoal).toBeGreaterThan(10);
  });

  it("does not touch rebufferingGoal", () => {
    // rebufferingGoal decides whether Shaka gates playback on buffer depth at
    // all — it is 0 by default on Shaka 5, where the buffer poller never runs
    // (player.js: `if (this.config_.streaming.rebufferingGoal)`). Setting it
    // would turn that on, and a device transcoding at ~1x would then freeze
    // until the goal was re-accumulated: a longer stall than the stutter we
    // are fixing. Guarded by a test because the value looks tempting to add.
    expect(recommendedBufferConfig().streaming)
      .not.toHaveProperty("rebufferingGoal");
  });

  it("shapes the object as a player.configure() fragment", () => {
    // Anything beyond `streaming` would reach unrelated player configuration.
    expect(Object.keys(recommendedBufferConfig())).toEqual(["streaming"]);
    expect(Object.keys(recommendedBufferConfig().streaming)).toEqual(["bufferingGoal"]);
  });

  it("returns a fresh object each call, so callers can mutate it", () => {
    const a = recommendedBufferConfig();
    a.streaming.bufferingGoal = 60;
    expect(recommendedBufferConfig().streaming.bufferingGoal).toBe(30);
  });
});

describe("recommendedPlayerConfig", () => {
  it("keeps the buffer settings", () => {
    expect(recommendedPlayerConfig().streaming).toEqual(recommendedBufferConfig().streaming);
  });

  it("shortens abr.switchInterval below Shaka's default of 8", () => {
    // Shaka honours abr.restrictions at its next ABR decision and declines to
    // take one inside switchInterval, so at 8 a compute-aware cap waits.
    expect(recommendedPlayerConfig().abr.switchInterval).toBeLessThan(8);
  });

  it("stays at or above one segment, since ABR decisions ride on segment arrivals", () => {
    // 2s segments are this pipeline's common shape, and a decision cannot
    // happen between two arrivals. A lower value would only look reactive.
    expect(recommendedPlayerConfig().abr.switchInterval).toBeGreaterThanOrEqual(2);
  });

  it("touches only streaming and abr", () => {
    expect(Object.keys(recommendedPlayerConfig()).sort()).toEqual(["abr", "streaming"]);
    expect(Object.keys(recommendedPlayerConfig().abr)).toEqual(["switchInterval"]);
  });

  it("leaves recommendedBufferConfig() untouched for existing callers", () => {
    // The deprecated function must keep returning buffer settings only:
    // widening it would change ABR behaviour for callers who never asked.
    expect(Object.keys(recommendedBufferConfig())).toEqual(["streaming"]);
  });

  it("returns a fresh object each call", () => {
    const a = recommendedPlayerConfig();
    a.abr.switchInterval = 99;
    expect(recommendedPlayerConfig().abr.switchInterval).toBe(2);
  });
});
