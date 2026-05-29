/**
 * Compute-aware ABR decider — player-agnostic.
 *
 * Maintains a rolling window of per-segment `speedX = segDurMs / totalMs`
 * measurements and decides whether the variant cap should move up, down,
 * or stay put. Hysteresis (different counters + a wider raise threshold
 * than the lower threshold) prevents the cap from oscillating.
 *
 * Plug into a host player (Shaka, dash.js) by:
 *   1. Subscribing to `perf-bus.subscribeSegmentStat`.
 *   2. On each stat, calling `decider.observe(stat.speedX, currentVariantIdx)`.
 *   3. When the returned `reason` is "lower" or "raise", applying
 *      `decision.capIndex` to the player via its public restriction API.
 *
 * The decider knows nothing about heights, bandwidths, or the host player.
 * It works purely on a ladder represented as `0..ladderSize-1` (ascending
 * by quality). The adapter is responsible for the mapping in both directions.
 */
export interface ComputeAwareConfig {
  /** Require this much headroom over real-time before raising the cap. Default 1.3 (= 30% headroom). */
  targetSpeedX?: number;
  /** Number of consecutive `avg > targetSpeedX` windows before raising. Default 6. */
  raiseAfter?: number;
  /** Number of consecutive `avg < 1.0` windows before lowering. Default 1. */
  lowerAfter?: number;
  /** Rolling-window size for smoothing. Default 2. */
  measureWindow?: number;
}

export interface ComputeAwareDecision {
  /**
   * New cap index in the ladder (0 = lowest quality variant, ladderSize-1 = highest).
   * `null` means no cap has ever been applied yet (cold start).
   */
  capIndex: number | null;
  /** Smoothed speedX over the rolling window. */
  avgSpeedX: number;
  /**
   * - `init`  — not enough data yet, or ladder unknown
   * - `lower` — cap was just lowered
   * - `raise` — cap was just raised
   * - `hold`  — no change this observation
   */
  reason: "init" | "lower" | "raise" | "hold";
}

// Defaults are tuned for compute-aware: the cost of reacting too slowly
// (buffer underrun -> frozen playback) is much worse than the cost of an
// occasional unnecessary cap drop (brief quality dip). Smaller window
// + lowerAfter=1 react in ~2 segments; raiseAfter=6 keeps hysteresis
// wide so we don't yo-yo back up at the first hint of headroom.
const DEFAULTS: Required<ComputeAwareConfig> = {
  targetSpeedX: 1.3,
  raiseAfter: 6,
  lowerAfter: 1,
  measureWindow: 2,
};

export class ComputeAwareDecider {
  private readonly cfg: Required<ComputeAwareConfig>;
  private window: number[] = [];
  private consecutiveLow = 0;
  private consecutiveHigh = 0;
  private capIndex_: number | null = null;
  private ladderSize_ = 0;
  // Snapshot of the previous state, taken right before each commit, so
  // an adapter can revertLastDecision() if applying the cap to the host
  // player threw. Without this, a player.configure() crash leaves the
  // decider believing it lowered the cap while the player is still on
  // the previous variant.
  private prevCapIndex_: number | null = null;
  private prevWindow_: number[] = [];
  private prevConsecutiveLow_ = 0;
  private prevConsecutiveHigh_ = 0;
  private hasRevertablePoint_ = false;

  constructor(config: ComputeAwareConfig = {}) {
    this.cfg = {
      targetSpeedX: config.targetSpeedX ?? DEFAULTS.targetSpeedX,
      raiseAfter: config.raiseAfter ?? DEFAULTS.raiseAfter,
      lowerAfter: config.lowerAfter ?? DEFAULTS.lowerAfter,
      measureWindow: config.measureWindow ?? DEFAULTS.measureWindow,
    };
    if (this.cfg.targetSpeedX <= 1.0) {
      throw new Error("targetSpeedX must be > 1.0 (need headroom over real-time to raise)");
    }
    if (this.cfg.measureWindow < 1) throw new Error("measureWindow must be >= 1");
    if (this.cfg.raiseAfter < 1 || this.cfg.lowerAfter < 1) {
      throw new Error("raiseAfter / lowerAfter must be >= 1");
    }
  }

  /** Set or update the number of available variants. Must be called at least once before observe(). */
  setLadderSize(n: number): void {
    if (n < 1) throw new Error("ladderSize must be >= 1");
    this.ladderSize_ = n;
    // Ladder shrunk under our current cap → clamp.
    if (this.capIndex_ != null && this.capIndex_ >= n) {
      this.capIndex_ = n - 1;
    }
  }

  get currentCap(): number | null {
    return this.capIndex_;
  }

  get ladderSize(): number {
    return this.ladderSize_;
  }

  /**
   * Feed one speedX measurement plus the player's currently-active variant
   * index (used as the starting point on first activation, per the
   * "subtractive only on first activation" rule).
   *
   * Returns the decision: a `capIndex` plus the reason. The adapter applies
   * the cap to the player only when `reason` is "lower" or "raise".
   */
  observe(speedX: number, currentVariantIdx: number): ComputeAwareDecision {
    if (this.ladderSize_ === 0) {
      return { capIndex: this.capIndex_, avgSpeedX: speedX, reason: "init" };
    }

    this.window.push(speedX);
    if (this.window.length > this.cfg.measureWindow) this.window.shift();

    // Wait for a full window before reacting. Single bad/good segments
    // (a complex GOP, a thermal spike) shouldn't move the cap.
    if (this.window.length < this.cfg.measureWindow) {
      return { capIndex: this.capIndex_, avgSpeedX: avg(this.window), reason: "init" };
    }

    const avgSpeed = avg(this.window);

    if (avgSpeed < 1.0) {
      this.consecutiveLow++;
      this.consecutiveHigh = 0;
      if (this.consecutiveLow >= this.cfg.lowerAfter) {
        // First-activation rule: start from the variant the player is
        // currently playing (set by network ABR), then go subtractive.
        const base = this.capIndex_ ?? clamp(currentVariantIdx, 0, this.ladderSize_ - 1);
        if (base > 0) {
          this.snapshotForRevert();
          this.capIndex_ = base - 1;
          this.resetAfterChange();
          return { capIndex: this.capIndex_, avgSpeedX: avgSpeed, reason: "lower" };
        }
        // Already at the lowest variant — nothing we can do. Reset counter
        // so we don't keep firing.
        this.consecutiveLow = 0;
      }
    } else if (avgSpeed > this.cfg.targetSpeedX) {
      this.consecutiveHigh++;
      this.consecutiveLow = 0;
      if (this.consecutiveHigh >= this.cfg.raiseAfter) {
        // Raising never goes above what the manifest offers. Also never
        // raises before we ever lowered — if we never capped, the host
        // ABR is already free to pick the top variant.
        if (this.capIndex_ != null && this.capIndex_ < this.ladderSize_ - 1) {
          this.snapshotForRevert();
          this.capIndex_ = this.capIndex_ + 1;
          this.resetAfterChange();
          return { capIndex: this.capIndex_, avgSpeedX: avgSpeed, reason: "raise" };
        }
        this.consecutiveHigh = 0;
      }
    } else {
      // In the deadband [1.0, targetSpeedX] — reset both counters so we
      // don't drift toward a change based on stale streaks.
      this.consecutiveLow = 0;
      this.consecutiveHigh = 0;
    }

    return { capIndex: this.capIndex_, avgSpeedX: avgSpeed, reason: "hold" };
  }

  /**
   * Roll back the most recent "lower" or "raise" decision. Adapters call
   * this when applying the cap to the host player throws — so the decider
   * state stays in sync with what's actually configured on the player.
   * Safe to call when no decision has happened yet (no-op).
   */
  revertLastDecision(): void {
    if (!this.hasRevertablePoint_) return;
    this.capIndex_ = this.prevCapIndex_;
    this.window = [...this.prevWindow_];
    this.consecutiveLow = this.prevConsecutiveLow_;
    this.consecutiveHigh = this.prevConsecutiveHigh_;
    this.hasRevertablePoint_ = false;
  }

  /** Test/debug — reset everything except the configured thresholds. */
  reset(): void {
    this.window = [];
    this.consecutiveLow = 0;
    this.consecutiveHigh = 0;
    this.capIndex_ = null;
    this.hasRevertablePoint_ = false;
  }

  private snapshotForRevert(): void {
    this.prevCapIndex_ = this.capIndex_;
    this.prevWindow_ = [...this.window];
    this.prevConsecutiveLow_ = this.consecutiveLow;
    this.prevConsecutiveHigh_ = this.consecutiveHigh;
    this.hasRevertablePoint_ = true;
  }

  private resetAfterChange(): void {
    // Drop the window so the next decision waits for fresh measurements
    // under the new cap. Without this, the old high/low samples would
    // immediately push us back the other way.
    this.window = [];
    this.consecutiveLow = 0;
    this.consecutiveHigh = 0;
  }
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
