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
 * Must be called before `player.load()`. Registers a factory for both
 * `hev1` and `hvc1` MIME types at PREFERRED priority so Shaka picks our
 * transmuxer over any default fallback.
 *
 * When `config.forceTranscode` is set, also patches
 * `MediaSource.isTypeSupported` to return `false` for HEVC so Shaka
 * routes through our transmuxer even on platforms where the browser
 * supports HEVC natively (Safari, recent Chrome on Mac, etc.). Useful
 * for cross-platform testing of the transmuxing pipeline.
 *
 * @param shaka the global `shaka` namespace (import or window.shaka)
 * @param config plugin configuration
 * @returns A cleanup function that unregisters the transmuxer and
 *   restores any patched MSE methods.
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
      () => new HevcTransmuxer(mimeType),
      priority,
    );
  }

  let restoreIsTypeSupported: (() => void) | null = null;
  if (config.forceTranscode && typeof MediaSource !== "undefined") {
    const originalIsTypeSupported = MediaSource.isTypeSupported;
    MediaSource.isTypeSupported = function (mimeType: string): boolean {
      if (/hev1|hvc1/i.test(mimeType)) return false;
      return originalIsTypeSupported.call(MediaSource, mimeType);
    };
    restoreIsTypeSupported = () => {
      MediaSource.isTypeSupported = originalIsTypeSupported;
    };
  }

  return () => {
    if (typeof engine.unregisterTransmuxer === "function") {
      for (const mimeType of HEVC_MIME_TYPES) {
        // unregisterTransmuxer keys on `${mime}-${priority}` so the
        // priority used at register time must be passed back here.
        engine.unregisterTransmuxer(mimeType, priority);
      }
    }
    restoreIsTypeSupported?.();
  };
}
