/**
 * Shaka Player HEVC Plugin — public entry point.
 *
 * Usage (when fully implemented):
 * ```ts
 * import shaka from 'shaka-player';
 * import { registerHevcTransmuxer } from '@hevcjs/shaka-plugin';
 *
 * registerHevcTransmuxer(shaka, { wasmUrl: '/hevc-decode.js' });
 * const player = new shaka.Player();
 * await player.attach(videoElement);
 * await player.load(manifestUrl);
 * ```
 */

import type { MSEInterceptConfig } from "@hevcjs/core";
import { HevcTransmuxer } from "./transmuxer.js";

export { HevcTransmuxer } from "./transmuxer.js";
export type { TransmuxOutput } from "./transmuxer.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShakaNamespace = any;

export interface HevcShakaPluginConfig extends MSEInterceptConfig {
  /**
   * Force HEVC transmuxing even if the browser supports HEVC natively.
   * Useful for testing. Default: false.
   */
  forceTranscode?: boolean;
}

const HEVC_MIME_TYPES = [
  'video/mp4; codecs="hev1"',
  'video/mp4; codecs="hvc1"',
];

/**
 * Register the HEVC transmuxer with Shaka's TransmuxerEngine.
 *
 * Must be called before `player.load()`.
 *
 * SKELETON: registration only. The transmuxer itself is a no-op until the
 * @hevcjs/core integration lands.
 *
 * @param shaka the global `shaka` namespace (import or window.shaka)
 * @param _config plugin configuration (unused for now)
 * @returns A cleanup function that unregisters the transmuxer.
 */
export function registerHevcTransmuxer(
  shaka: ShakaNamespace,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _config: HevcShakaPluginConfig = {},
): () => void {
  const engine = shaka?.transmuxer?.TransmuxerEngine;
  if (!engine || typeof engine.registerTransmuxer !== "function") {
    console.warn(
      "[hevc.js/shaka] shaka.transmuxer.TransmuxerEngine.registerTransmuxer not found. " +
        "Make sure shaka-player >= 4.0 is loaded before calling registerHevcTransmuxer().",
    );
    return () => {};
  }

  const priority =
    engine.PluginPriority?.PREFERRED ??
    engine.PluginPriority?.APPLICATION ??
    2;

  for (const mimeType of HEVC_MIME_TYPES) {
    engine.registerTransmuxer(
      mimeType,
      () => new HevcTransmuxer(mimeType),
      priority,
    );
  }

  return () => {
    if (typeof engine.unregisterTransmuxer === "function") {
      for (const mimeType of HEVC_MIME_TYPES) {
        engine.unregisterTransmuxer(mimeType);
      }
    }
  };
}
