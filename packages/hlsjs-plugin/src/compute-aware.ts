/**
 * Compute-aware ABR adapter for hls.js.
 *
 * Subscribes to the per-segment perf bus published by `@hevcjs/core` and,
 * when transcode throughput drifts away from a healthy `speedX`, narrows
 * the levels hls.js's own ABR controller is allowed to choose from. The
 * host ABR algorithm is never replaced — we just move the upper bound via
 * the public `hls.autoLevelCapping` API.
 *
 * Why this exists: a level that's reachable from a network-bandwidth
 * standpoint can still saturate the device's WASM-decode + WebCodecs-encode
 * budget, draining the buffer without hls.js's ABR ever noticing. Mainstream
 * ABR algorithms only look at network because fetch+parse+MSE-append is
 * essentially free in their world. With our transcode pipeline, it isn't.
 *
 * This is the simplest of the three player adapters: `hls.levels` is
 * already an ascending ladder and the cap is a plain level index.
 */
import {
  ComputeAwareDecider,
  subscribeSegmentStat,
} from "@hevcjs/core";
import type {
  ComputeAwareConfig,
  SegmentPerfStat,
} from "@hevcjs/core";

// Loose typing while we don't pull hls.js types into the build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HlsInstance = any;

export interface HlsComputeAwareOptions extends ComputeAwareConfig {
  /**
   * Optional sink for telemetry — called on every observation, not just
   * cap changes. Useful for plotting speedX over time in a demo.
   *
   * `reason` is the decider's verdict on this observation:
   * `init` (window not full yet) | `hold` (no change) |
   * `lower` (cap stepped down) | `raise` (cap stepped up).
   */
  onObservation?: (
    stat: SegmentPerfStat,
    avgSpeedX: number,
    capIndex: number | null,
    reason: "init" | "hold" | "lower" | "raise",
  ) => void;
}

/**
 * Attach the compute-aware ABR feedback loop to an Hls instance.
 *
 * Safe to call before `loadSource()`: levels are looked up lazily as
 * segments arrive.
 *
 * @returns cleanup function — unsubscribes the perf-bus listener.
 *   Does NOT clear any cap already applied. To restore an unbounded ABR
 *   after detaching, set `hls.autoLevelCapping = -1`.
 */
export function attachHlsComputeAware(
  hls: HlsInstance,
  options: HlsComputeAwareOptions = {},
): () => void {
  const { onObservation, ...deciderConfig } = options;
  const decider = new ComputeAwareDecider(deciderConfig);

  const unsubscribe = subscribeSegmentStat((stat: SegmentPerfStat) => {
    const levels: unknown[] = hls?.levels ?? [];
    if (levels.length === 0) return; // manifest not loaded yet

    decider.setLadderSize(levels.length);
    const currentIdx =
      typeof hls.currentLevel === "number" && hls.currentLevel >= 0
        ? hls.currentLevel
        : levels.length - 1;
    const decision = decider.observe(stat.speedX, currentIdx);

    if (onObservation) {
      try {
        onObservation(stat, decision.avgSpeedX, decision.capIndex, decision.reason);
      } catch {
        // a buggy telemetry sink must not break ABR
      }
    }

    if (decision.reason === "lower" || decision.reason === "raise") {
      try {
        // hls.js semantics: autoLevelCapping is the max auto level index,
        // -1 means uncapped.
        hls.autoLevelCapping = decision.capIndex ?? -1;
      } catch (err) {
        // Instance may be destroyed. Rolling back keeps the decider in
        // sync with what hls.js actually has configured.
        decider.revertLastDecision();
        // eslint-disable-next-line no-console
        console.warn("[hevc.js/hls] applying autoLevelCapping failed, reverted decider:", err);
      }
    }
  });

  return unsubscribe;
}
