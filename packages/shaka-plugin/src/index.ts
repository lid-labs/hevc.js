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

export { HevcTransmuxer } from "./transmuxer.js";
export type { TransmuxOutput, HevcTransmuxerConfig } from "./transmuxer.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaNamespace = any;

/**
 * Plugin configuration. Forwarded as-is to `HevcTransmuxer`. Supports the
 * `SegmentTranscoderConfig` fields (`wasmUrl`, `wasmBinaryUrl`, `fps`,
 * `bitrate`) plus an optional `workerUrl` that, when set, routes the
 * HEVC decode + H.264 encode pipeline through a Web Worker.
 */
export type HevcShakaPluginConfig = HevcTransmuxerConfig;

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
 * @param config forwarded to `HevcTransmuxer` (wasmUrl, wasmBinaryUrl, fps, bitrate, workerUrl)
 * @returns A cleanup function that unregisters the transmuxer.
 */
export function registerHevcTransmuxer(
  shaka: ShakaNamespace,
  config: HevcShakaPluginConfig = {},
): () => void {
  const engine = shaka?.transmuxer?.TransmuxerEngine;
  if (!engine || typeof engine.registerTransmuxer !== "function") {
    console.warn(
      "[hevc.js/shaka] shaka.transmuxer.TransmuxerEngine.registerTransmuxer not found. " +
        "Make sure shaka-player >= 4.0 is loaded before calling registerHevcTransmuxer().",
    );
    return () => {};
  }

  // External (application-supplied) plugins should register at the
  // APPLICATION priority so they override any built-in fallback. Values in
  // shaka.transmuxer.TransmuxerEngine.PluginPriority: FALLBACK=1,
  // PREFERRED_SECONDARY=2, PREFERRED=3, APPLICATION=4.
  const priority =
    engine.PluginPriority?.APPLICATION ??
    engine.PluginPriority?.PREFERRED ??
    4;

  for (const mimeType of HEVC_MIME_TYPES) {
    engine.registerTransmuxer(
      mimeType,
      () => new HevcTransmuxer(mimeType, config),
      priority,
    );
  }

  return () => {
    if (typeof engine.unregisterTransmuxer === "function") {
      for (const mimeType of HEVC_MIME_TYPES) {
        // unregisterTransmuxer keys on `${mime}-${priority}` so the
        // priority used at register time must be passed back here.
        engine.unregisterTransmuxer(mimeType, priority);
      }
    }
  };
}
