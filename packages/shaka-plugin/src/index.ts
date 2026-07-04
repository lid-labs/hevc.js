/**
 * Shaka Player HEVC Plugin — public entry point.
 *
 * Usage (main thread, no Worker):
 * ```ts
 * import shaka from 'shaka-player';
 * import { registerHevcTransmuxer } from '@hevcjs/shaka-plugin';
 *
 * registerHevcTransmuxer(shaka, { wasmUrl: '/hevc-decode.js' });
 * const player = new shaka.Player();
 * await player.attach(videoElement);
 * await player.load(manifestUrl);
 * ```
 *
 * Usage (off-main-thread via Web Worker — recommended for 4K / smoothness):
 * ```ts
 * registerHevcTransmuxer(shaka, {
 *   wasmUrl: '/hevc-decode.js',
 *   workerUrl: '/transcode-worker.js',
 * });
 * ```
 *
 * Compute-aware ABR is ON by default — Shaka's bandwidth-based ABR keeps
 * choosing freely while we narrow the ceiling when the device can't keep
 * up. The player is supplied later via `attachComputeAware`:
 * ```ts
 * const handle = registerHevcTransmuxer(shaka, {
 *   wasmUrl: '/hevc-decode.js',
 *   workerUrl: '/transcode-worker.js',
 *   // adaptiveCompute is ON by default.
 *   // To opt out: adaptiveCompute: false
 *   // To tune:    adaptiveCompute: { targetSpeedX: 1.5, lowerAfter: 1 }
 * });
 * const player = new shaka.Player();
 * handle.attachComputeAware(player);  // wire the feedback loop
 * await player.load(manifestUrl);
 * // ...
 * handle();                            // unregister + detach (callable)
 * ```
 *
 * To force the transmuxer even on browsers with native HEVC support
 * (Safari, recent Chrome on macOS), use Shaka's built-in config rather
 * than patching MSE yourself:
 *
 * ```ts
 * player.configure({ mediaSource: { forceTransmux: true } });
 * ```
 */

import { HevcTransmuxer } from "./transmuxer.js";
import type { HevcTransmuxerConfig } from "./transmuxer.js";
import { attachShakaComputeAware } from "./compute-aware.js";
import type { ShakaComputeAwareOptions } from "./compute-aware.js";

export { HevcTransmuxer } from "./transmuxer.js";
export type { TransmuxOutput, HevcTransmuxerConfig } from "./transmuxer.js";
export { attachShakaComputeAware } from "./compute-aware.js";
export type { ShakaComputeAwareOptions } from "./compute-aware.js";
// Re-export the perf-bus surface so consumers can subscribe to per-segment
// transcode stats (speedX, frames, resolution) without depending on
// @hevcjs/core directly.
export { subscribeSegmentStat } from "@hevcjs/core";
export type { SegmentPerfStat } from "@hevcjs/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaPlayer = any;

/**
 * Plugin configuration. Forwarded as-is to `HevcTransmuxer`. Supports the
 * `SegmentTranscoderConfig` fields (`wasmUrl`, `wasmBinaryUrl`, `fps`,
 * `bitrate`) plus an optional `workerUrl` that, when set, routes the
 * HEVC decode + H.264 encode pipeline through a Web Worker, plus an
 * optional `adaptiveCompute` flag/config to enable the compute-aware
 * ABR feedback loop.
 */
export interface HevcShakaPluginConfig extends HevcTransmuxerConfig {
  /**
   * Compute-aware ABR feedback. The returned handle exposes
   * `attachComputeAware(player)` that wires the host Shaka player to the
   * transcode perf bus and caps variants when the device can't keep up.
   *
   * - **On by default** (undefined or `true`) — sensible defaults.
   * - Pass an object to tune the decider knobs (`targetSpeedX`, etc.).
   * - Pass `false` to opt out: `attachComputeAware` becomes a silent no-op.
   *
   * `attachComputeAware(player)` must still be called explicitly because
   * the player instance isn't available at register time.
   */
  adaptiveCompute?: boolean | ShakaComputeAwareOptions;
}

/**
 * Return shape of `registerHevcTransmuxer`. Callable for backwards compat
 * (`handle()` unregisters the transmuxer, same as before). Methods are
 * attached as properties when `adaptiveCompute` is enabled so the existing
 * `const cleanup = registerHevcTransmuxer(...)` pattern still works.
 */
export interface HevcShakaPluginHandle {
  (): void;
  /** Explicit alias for the callable form. */
  unregister(): void;
  /**
   * Attach the compute-aware feedback loop to a Shaka player.
   * Active by default; becomes a silent no-op only when the registration
   * config explicitly passed `adaptiveCompute: false`.
   *
   * Options passed here are merged on top of any options passed at
   * register time, which is convenient when the telemetry sink
   * (`onObservation`) is only available once the UI exists.
   *
   * @returns cleanup function — detaches the perf-bus listener.
   */
  attachComputeAware(player: ShakaPlayer, options?: ShakaComputeAwareOptions): () => void;
}

const HEVC_MIME_TYPES = [
  'video/mp4; codecs="hev1"',
  'video/mp4; codecs="hvc1"',
];

/**
 * Register the HEVC transmuxer with Shaka's TransmuxerEngine.
 *
 * Must be called before `player.load()`. Registers a factory for both
 * `hev1` and `hvc1` MIME types at APPLICATION priority so Shaka picks
 * our transmuxer over any default fallback.
 *
 * @param shaka the global `shaka` namespace (import or window.shaka)
 * @param config forwarded to `HevcTransmuxer` (wasmUrl, wasmBinaryUrl, fps, bitrate, workerUrl, adaptiveCompute)
 * @returns A handle that is both callable (unregisters) and exposes
 *   `attachComputeAware(player)` when `adaptiveCompute` is enabled.
 */
export function registerHevcTransmuxer(
  shaka: ShakaNamespace,
  config: HevcShakaPluginConfig = {},
): HevcShakaPluginHandle {
  const engine = shaka?.transmuxer?.TransmuxerEngine;
  if (!engine || typeof engine.registerTransmuxer !== "function") {
    console.warn(
      "[hevc.js/shaka] shaka.transmuxer.TransmuxerEngine.registerTransmuxer not found. " +
        "Make sure shaka-player >= 4.0 is loaded before calling registerHevcTransmuxer().",
    );
    return makeHandle(() => {}, undefined);
  }

  // External (application-supplied) plugins should register at the
  // APPLICATION priority so they override any built-in fallback. Values in
  // shaka.transmuxer.TransmuxerEngine.PluginPriority: FALLBACK=1,
  // PREFERRED_SECONDARY=2, PREFERRED=3, APPLICATION=4.
  const priority =
    engine.PluginPriority?.APPLICATION ??
    engine.PluginPriority?.PREFERRED ??
    4;

  const { adaptiveCompute, ...transmuxerConfig } = config;

  for (const mimeType of HEVC_MIME_TYPES) {
    engine.registerTransmuxer(
      mimeType,
      () => new HevcTransmuxer(mimeType, transmuxerConfig),
      priority,
    );
  }

  const unregister = () => {
    if (typeof engine.unregisterTransmuxer === "function") {
      for (const mimeType of HEVC_MIME_TYPES) {
        // unregisterTransmuxer keys on `${mime}-${priority}` so the
        // priority used at register time must be passed back here.
        engine.unregisterTransmuxer(mimeType, priority);
      }
    }
  };

  return makeHandle(unregister, adaptiveCompute);
}

/**
 * Build the callable+methods handle. Keeping the callable form preserves
 * the pre-existing `const cleanup = registerHevcTransmuxer(...); cleanup();`
 * pattern; the `attachComputeAware` property is added only when the feature
 * is enabled, but a no-op is always present so consumers can call it
 * unconditionally without a type guard.
 *
 * Unified cleanup: invoking the handle (or `unregister()`) tears down both
 * the transmuxer registration AND any active compute-aware listener, so the
 * caller doesn't have to remember a separate detach. Matches the dash.js
 * plugin's `attachHevcSupport` cleanup behaviour.
 */
function makeHandle(
  unregister: () => void,
  adaptive: boolean | ShakaComputeAwareOptions | undefined,
): HevcShakaPluginHandle {
  let activeDetach: (() => void) | null = null;

  const tearDown = () => {
    activeDetach?.();
    activeDetach = null;
    unregister();
  };

  const fn = (() => tearDown()) as HevcShakaPluginHandle;
  fn.unregister = tearDown;
  fn.attachComputeAware = (
    player: ShakaPlayer,
    runtimeOpts?: ShakaComputeAwareOptions,
  ): () => void => {
    // Explicit opt-out is the only path that disables the feature.
    // `undefined` (no flag) → on; `true` → on; object → on with options.
    if (adaptive === false) return () => {};
    // Re-attaching replaces any previous listener — keep the handle's
    // tearDown able to free the *current* one.
    activeDetach?.();
    // Merge register-time options with attach-time options; attach-time
    // wins on conflicts so the caller can override defaults set early
    // (typical case: onObservation is only known once the UI exists).
    const registerOpts = typeof adaptive === "object" ? adaptive : {};
    const opts = { ...registerOpts, ...(runtimeOpts ?? {}) };
    const detach = attachShakaComputeAware(player, opts);
    activeDetach = detach;
    return () => {
      detach();
      if (activeDetach === detach) activeDetach = null;
    };
  };
  return fn;
}
