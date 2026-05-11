/**
 * Shaka Player HEVC Plugin — public entry point.
 *
 * Usage:
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
 * To force the transmuxer even on browsers with native HEVC support
 * (Safari, recent Chrome on macOS), use Shaka's built-in config rather
 * than patching MSE yourself:
 *
 * ```ts
 * player.configure({ mediaSource: { forceTransmux: true } });
 * ```
 */

import type { SegmentTranscoderConfig } from "@hevcjs/core";
import { HevcTransmuxer } from "./transmuxer.js";

export { HevcTransmuxer } from "./transmuxer.js";
export type { TransmuxOutput } from "./transmuxer.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaNamespace = any;

/**
 * Plugin configuration. Forwarded as-is to the underlying
 * `SegmentTranscoder`, so `wasmUrl` / `wasmBinaryUrl` let you point the
 * HEVC decoder at custom asset locations (CDN, sub-path, cross-origin).
 *
 * `workerUrl` is intentionally absent: the Shaka transmuxer currently
 * runs the transcode pipeline on the main thread. Adding a Worker is
 * tracked separately.
 */
export type HevcShakaPluginConfig = SegmentTranscoderConfig;

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
 * @param config forwarded to `SegmentTranscoder` (wasmUrl, wasmBinaryUrl, fps, bitrate)
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
