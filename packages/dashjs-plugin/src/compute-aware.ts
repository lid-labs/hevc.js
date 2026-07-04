/**
 * Compute-aware ABR adapter for dash.js.
 *
 * Mirrors the Shaka adapter: subscribes to `@hevcjs/core`'s perf bus,
 * feeds `speedX` to the shared `ComputeAwareDecider`, and caps dash.js
 * variants via its public settings API. Never replaces dash.js's own ABR
 * controller — only narrows the bitrate ceiling it's allowed to pick from.
 *
 * dash.js differences vs Shaka:
 *   - Cap is expressed as `maxBitrate` in **kbps** (not bps).
 *   - Ladder comes from `player.getBitrateInfoListFor('video')` which is
 *     ordered by ascending bitrate and exposes a stable `qualityIndex`.
 *   - The currently-active variant index is `player.getQualityFor('video')`.
 */
import {
  ComputeAwareDecider,
  subscribeSegmentStat,
} from "@hevcjs/core";
import type {
  ComputeAwareConfig,
  SegmentPerfStat,
} from "@hevcjs/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DashPlayer = any;

interface LadderRank {
  /** Video bandwidth in bits/sec. */
  bandwidth: number;
  height?: number;
}

export interface DashComputeAwareOptions extends ComputeAwareConfig {
  /**
   * Per-observation telemetry sink. Called even when no cap change occurs.
   * `reason` is the decider's verdict:
   * `init` | `hold` | `lower` | `raise`.
   */
  onObservation?: (
    stat: SegmentPerfStat,
    avgSpeedX: number,
    capIndex: number | null,
    reason: "init" | "hold" | "lower" | "raise",
  ) => void;
}

/**
 * Attach the compute-aware feedback loop to a dash.js MediaPlayer.
 *
 * Safe to call before or after `player.initialize()`. The ladder is read
 * lazily as segments arrive, so it picks up post-MPD-load variants.
 *
 * @returns cleanup — unsubscribes the perf-bus listener. Does NOT clear
 *   any cap already applied; call
 *   `player.updateSettings({ streaming: { abr: { maxBitrate: { video: -1 }}}})`
 *   afterwards if you want to release the ceiling.
 */
export function attachDashComputeAware(
  player: DashPlayer,
  options: DashComputeAwareOptions = {},
): () => void {
  const { onObservation, ...deciderConfig } = options;
  const decider = new ComputeAwareDecider(deciderConfig);

  const unsubscribe = subscribeSegmentStat((stat: SegmentPerfStat) => {
    const ladder = readLadder(player);
    if (ladder.length === 0) return; // MPD not parsed yet, or audio-only

    decider.setLadderSize(ladder.length);
    const currentIdx = readCurrentIndex(player, ladder);
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
        applyCap(player, ladder, decision.capIndex!);
      } catch (err) {
        // Same guard as the Shaka adapter: keep the decider state aligned
        // with what's actually on the player when applying the cap throws.
        decider.revertLastDecision();
        // eslint-disable-next-line no-console
        console.warn("[hevc.js/dash] applyCap failed, reverted decider:", err);
      }
    }
  });

  return unsubscribe;
}

/**
 * Build the ladder from `getBitrateInfoListFor`. The returned list is
 * already ordered ascending by bitrate in dash.js, so the cap-index
 * mapping is direct (no resort needed).
 */
function readLadder(player: DashPlayer): LadderRank[] {
  const infos = player.getBitrateInfoListFor?.("video") ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return infos.map((info: any) => ({
    bandwidth: info.bitrate as number,
    height: info.height ?? undefined,
  }));
}

function readCurrentIndex(player: DashPlayer, ladder: LadderRank[]): number {
  const idx = player.getQualityFor?.("video");
  if (typeof idx === "number" && idx >= 0 && idx < ladder.length) return idx;
  return ladder.length - 1;
}

function applyCap(player: DashPlayer, ladder: LadderRank[], capIndex: number): void {
  const cap = ladder[capIndex];
  if (!cap || typeof player.updateSettings !== "function") return;

  // dash.js takes kbps. Round up so we never accidentally cap *below* the
  // variant we want to allow (the comparison is `representationBitrate > maxBitrate`).
  const maxKbps = Math.ceil(cap.bandwidth / 1000);
  player.updateSettings({
    streaming: { abr: { maxBitrate: { video: maxKbps } } },
  });
}
