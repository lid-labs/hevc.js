/**
 * Player tuning for HEVC playback through the transmuxer.
 *
 * Shaka 4.x's `Transmuxer.transmux()` returns one `Uint8Array` per segment,
 * so the buffered range can only grow in whole-segment jumps. When WASM
 * transcoding runs near real time, the playback head skirts the edge of that
 * range and playback stutters even though the buffer is contiguous and no
 * spec is violated. A deeper buffer gives transcoding room to stay ahead.
 *
 * See the "Performance & tuning" section of the plugin README.
 */

/** A fragment of Shaka player configuration, for `player.configure()`. */
export interface ShakaBufferConfig {
  streaming: {
    /** Seconds of content to buffer ahead. Shaka's default is 10. */
    bufferingGoal: number;
  };
}

/** The buffer fragment above, plus the ABR reactivity the cap needs. */
export interface ShakaPlayerConfig extends ShakaBufferConfig {
  abr: {
    /**
     * Seconds Shaka may wait before acting on a changed cap. Shaka's default
     * is 8.
     */
    switchInterval: number;
  };
}

/**
 * Buffer settings recommended when transcoding HEVC through this plugin.
 *
 * @deprecated Use {@link recommendedPlayerConfig}, which adds the ABR
 * reactivity a compute-aware cap needs. This function is unchanged and still
 * returns buffer settings only, so existing callers keep exactly what they
 * had.
 *
 * Merge into the player configuration before `load()`:
 *
 * ```ts
 * player.configure(recommendedBufferConfig());
 * ```
 *
 * Only `bufferingGoal` is touched, deliberately. `rebufferingGoal` decides
 * whether Shaka gates playback on buffer depth at all: it defaults to 0 on
 * Shaka 5, where 0 means the buffer poller never starts and the playback rate
 * is never held back. Raising it would switch that behaviour on, and on a
 * device transcoding at around real time — the case this config exists for —
 * a brief dip would then freeze playback until several seconds had been
 * re-accumulated. That trades a stutter for a longer hard stall, so leave it
 * at whatever the application has set.
 */
export function recommendedBufferConfig(): ShakaBufferConfig {
  return {
    streaming: {
      // 30s covers ~15 two-second segments: enough that a stretch of
      // slower-than-real-time transcoding drains the buffer instead of
      // letting the playback head catch up with it. Shaka's default is 10.
      bufferingGoal: 30,
    },
  };
}

/**
 * Player settings recommended when transcoding HEVC through this plugin:
 * the buffer depth above, plus the ABR reactivity a compute-aware cap needs.
 *
 * ```ts
 * player.configure(recommendedPlayerConfig());   // before load()
 * ```
 *
 * `abr.switchInterval` is Shaka's gate on ABR decisions, 8 seconds by default.
 * The compute-aware cap narrows `abr.restrictions`, which Shaka honours at its
 * next decision, so at the default a cap that fired on time sits unapplied for
 * several segments — each transcoded at the resolution the cap just rejected.
 * Measured against one deployment at ~0.4x transcode, six runs per setting: the
 * played variant obeyed the cap after 9.3-9.9s at 8, against 3.3-6.9s at 2.
 *
 * This is deliberately yours to apply rather than something the plugin sets
 * behind your back: `switchInterval` governs network-driven ABR too, not just
 * the cap. What remains at 2s is how fast segments arrive — ~5s for 2s of media
 * at 0.4x — so a lower value buys nothing.
 */
export function recommendedPlayerConfig(): ShakaPlayerConfig {
  return {
    ...recommendedBufferConfig(),
    abr: {
      // About one segment for this pipeline.
      switchInterval: 2,
    },
  };
}
