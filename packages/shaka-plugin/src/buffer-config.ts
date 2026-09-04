/**
 * Buffer tuning for HEVC playback through the transmuxer.
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

/**
 * Buffer settings recommended when transcoding HEVC through this plugin.
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
