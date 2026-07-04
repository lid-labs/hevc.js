/**
 * Compute-aware ABR adapter for Shaka Player.
 *
 * Subscribes to the per-segment perf bus published by `@hevcjs/core` and,
 * when transcode throughput drifts away from a healthy `speedX`, narrows
 * the variants Shaka's own ABR controller is allowed to choose from. The
 * host ABR algorithm is never replaced — we just move the upper bound via
 * the public `player.configure({ abr: { restrictions } })` API.
 *
 * Why this exists: a variant that's reachable from a network-bandwidth
 * standpoint can still saturate the device's WASM-decode + WebCodecs-encode
 * budget, draining the buffer without Shaka's ABR ever noticing. Mainstream
 * ABR algorithms only look at network because fetch+parse+MSE-append is
 * essentially free in their world. With our transcode pipeline, it isn't.
 */
import {
  ComputeAwareDecider,
  subscribeSegmentStat,
} from "@hevcjs/core";
import type {
  ComputeAwareConfig,
  SegmentPerfStat,
} from "@hevcjs/core";

// Loose typing while we don't pull `shaka.extern.*` into the build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaPlayer = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaVariantTrack = any;

/**
 * One entry of the ladder we feed to the decider. Heights are optional —
 * some manifests only differ in bandwidth (audio-only ladders excluded).
 */
interface LadderRank {
  height?: number;
  /** Per-variant video bandwidth in bits/sec (preferred), else total bandwidth. */
  bandwidth: number;
}

export interface ShakaComputeAwareOptions extends ComputeAwareConfig {
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
 * Attach the compute-aware ABR feedback loop to a Shaka player.
 *
 * Must be called after `new shaka.Player()`. Safe to call before
 * `player.load()`: variants are looked up lazily as segments arrive.
 *
 * @returns cleanup function — unsubscribes the perf-bus listener.
 *   Does NOT clear any restriction already applied to the player. If you
 *   want to restore an unbounded ABR, call
 *   `player.configure({ abr: { restrictions: { maxHeight: Infinity, maxBandwidth: Infinity }}})`
 *   after detaching.
 */
export function attachShakaComputeAware(
  player: ShakaPlayer,
  options: ShakaComputeAwareOptions = {},
): () => void {
  const { onObservation, ...deciderConfig } = options;
  const decider = new ComputeAwareDecider(deciderConfig);

  const unsubscribe = subscribeSegmentStat((stat: SegmentPerfStat) => {
    const ladder = readLadder(player);
    if (ladder.length === 0) return; // manifest not loaded yet, or audio-only

    decider.setLadderSize(ladder.length);
    const currentIdx = findCurrentIndex(player, ladder);
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
        // Player may be in a destroyed/invalid state. Rolling back the
        // decider keeps it in sync with what the player actually has
        // configured — otherwise the next decision thinks the cap is
        // already lower (or higher) than it really is.
        decider.revertLastDecision();
        // eslint-disable-next-line no-console
        console.warn("[hevc.js/shaka] applyCap failed, reverted decider:", err);
      }
    }
  });

  return unsubscribe;
}

/**
 * Build a deduplicated, ascending ladder from `player.getVariantTracks()`.
 * Dedup key prefers `height` (the natural quality axis), falls back to
 * `videoBandwidth` for height-less manifests.
 */
function readLadder(player: ShakaPlayer): LadderRank[] {
  const variants: ShakaVariantTrack[] = player.getVariantTracks?.() ?? [];
  const seen = new Map<string, LadderRank>();

  for (const v of variants) {
    // Skip audio-only / text variants. Anything with a height or a video
    // bandwidth/codec qualifies as a video variant.
    const hasVideo =
      v.height != null ||
      v.videoBandwidth != null ||
      (v.videoCodec != null && v.videoCodec !== "");
    if (!hasVideo) continue;

    const bw = (v.videoBandwidth ?? v.bandwidth ?? 0) as number;
    const key = v.height != null ? `h:${v.height}` : `b:${bw}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      height: v.height ?? undefined,
      bandwidth: bw,
    });
  }

  const ladder = Array.from(seen.values());
  ladder.sort((a, b) => {
    if (a.height != null && b.height != null) return a.height - b.height;
    return a.bandwidth - b.bandwidth;
  });
  return ladder;
}

function findCurrentIndex(player: ShakaPlayer, ladder: LadderRank[]): number {
  const variants: ShakaVariantTrack[] = player.getVariantTracks?.() ?? [];
  const active = variants.find((t) => t.active);
  if (!active) return ladder.length - 1;

  if (active.height != null) {
    const idx = ladder.findIndex((v) => v.height === active.height);
    if (idx >= 0) return idx;
  }
  const bw = (active.videoBandwidth ?? active.bandwidth ?? 0) as number;
  const idx = ladder.findIndex((v) => v.bandwidth === bw);
  return idx >= 0 ? idx : ladder.length - 1;
}

function applyCap(player: ShakaPlayer, ladder: LadderRank[], capIndex: number): void {
  const cap = ladder[capIndex];
  if (!cap || typeof player.configure !== "function") return;

  // Always cap by bandwidth (universal). Add maxHeight when the manifest
  // exposes heights — gives Shaka a more direct signal than bytes/sec.
  const restrictions: Record<string, number> = {
    maxBandwidth: cap.bandwidth,
  };
  if (cap.height != null) restrictions.maxHeight = cap.height;

  player.configure({ abr: { restrictions } });
}
