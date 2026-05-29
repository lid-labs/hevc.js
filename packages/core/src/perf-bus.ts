/**
 * Segment-level perf bus.
 *
 * The transcoder publishes one `SegmentPerfStat` per fully transcoded media
 * segment so that plugin-level features (e.g. compute-aware ABR in the Shaka
 * and dash.js plugins) can react to transcode throughput without reaching
 * into the transcoder internals or the worker postMessage protocol.
 *
 * Producers: `SegmentTranscoder.processMediaSegment` (main-thread path) and
 * `TranscodeWorkerClient` on receipt of the worker's `transcoded` message.
 * The worker itself does not publish — listeners always live on the main
 * thread so the bus stays a single-thread broadcast.
 */
export interface SegmentPerfStat {
  /** Wall-clock time spent in demux + decode + encode (ms). */
  totalMs: number;
  /** Intrinsic duration of the source segment in media time (ms). */
  segDurMs: number;
  /** segDurMs / totalMs — > 1 means transcode runs faster than real-time. */
  speedX: number;
  /** Number of frames produced (display-order). */
  frames: number;
  /** Decoded frame width in pixels. */
  width: number;
  /** Decoded frame height in pixels. */
  height: number;
}

type Listener = (stat: SegmentPerfStat) => void;

// Listeners are module-level: every subscriber receives every stat
// regardless of which transcoder produced it. This is fine for the
// expected single-player-per-page deployment. When multiple player
// instances share the same bundle, listeners should filter by their
// own tracker (e.g. on resolution or a wrapping closure) — there's no
// per-transcoder routing here.
const listeners = new Set<Listener>();

export function publishSegmentStat(stat: SegmentPerfStat): void {
  for (const l of listeners) {
    // A buggy listener must not crash the producer (which is the transcode
    // hot path). Swallow + log to keep the pipeline alive.
    try {
      l(stat);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[hevc.js/perf-bus] listener threw:", err);
    }
  }
}

export function subscribeSegmentStat(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Test-only — drop all subscribers. */
export function _resetSegmentStatBus(): void {
  listeners.clear();
}
