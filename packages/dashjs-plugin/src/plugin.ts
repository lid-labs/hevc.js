/**
 * dash.js HEVC Plugin — Enables HEVC playback in dash.js via WASM transcoding.
 *
 * Patches MSE and registers a capabilities filter so dash.js accepts HEVC
 * representations and transparently transcodes them to H.264.
 *
 * Usage:
 * ```ts
 * import dashjs from 'dashjs';
 * import { attachHevcSupport } from 'hevc.js/dash';
 *
 * const player = dashjs.MediaPlayer().create();
 * const cleanup = await attachHevcSupport(player, { wasmUrl: '/hevc-decode.js' });
 * player.initialize(videoElement, mpdUrl, true);
 * ```
 */

import { H264Encoder, installMSEIntercept, uninstallMSEIntercept, getMediaSourceConstructor } from "@hevcjs/core";
import type { MSEInterceptConfig } from "@hevcjs/core";
import { attachDashComputeAware } from "./compute-aware.js";
import type { DashComputeAwareOptions } from "./compute-aware.js";

export interface HevcDashPluginConfig extends MSEInterceptConfig {
  /**
   * Force HEVC transcoding even if the browser supports HEVC natively.
   * Useful for testing. Default: false.
   */
  forceTranscode?: boolean;
  /**
   * Compute-aware ABR feedback loop. Caps dash.js variants by observed
   * transcode `speedX` so the device doesn't pick a variant it can't
   * transcode in real time.
   *
   * - **On by default** (undefined or `true`) — sensible defaults.
   * - Pass an object to tune the decider knobs (`targetSpeedX`, etc.).
   * - Pass `false` to opt out.
   */
  adaptiveCompute?: boolean | DashComputeAwareOptions;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DashMediaPlayer = any;

/** Check if the browser can play HEVC natively via MSE */
async function hasNativeHevcSupport(): Promise<boolean> {
  try {
    const MS = getMediaSourceConstructor();
    if (!MS) return false;
    if (!MS.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"')) return false;
    // ManagedMediaSource-only browsers (iPhone Safari): trust isTypeSupported —
    // it reflects hardware HEVC there, and the probe below needs classic MSE.
    if (typeof MediaSource === "undefined") return true;
    // isTypeSupported can lie (e.g. Firefox Win without HEVC extension installed).
    // Verify by actually creating a SourceBuffer.
    return await new Promise<boolean>((resolve) => {
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      const video = document.createElement("video");
      const timeout = setTimeout(() => { cleanup(); resolve(false); }, 1000);
      function cleanup() {
        clearTimeout(timeout);
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      }
      ms.addEventListener("sourceopen", () => {
        try {
          const sb = ms.addSourceBuffer('video/mp4; codecs="hev1.1.6.L93.B0"');
          ms.removeSourceBuffer(sb);
          cleanup();
          resolve(true);
        } catch {
          cleanup();
          resolve(false);
        }
      });
      video.src = url;
    });
  } catch {
    return false;
  }
}

/**
 * Attach HEVC transcoding support to a dash.js MediaPlayer instance.
 *
 * Must be called BEFORE player.initialize().
 * Skips if the browser has native HEVC support (unless forceTranscode is set).
 * Checks H.264 encoding support before installing the MSE intercept.
 *
 * @param player dash.js MediaPlayer instance
 * @param config Optional transcoder configuration
 * @returns A cleanup function to remove the plugin
 */
export async function attachHevcSupport(
  player: DashMediaPlayer,
  config: HevcDashPluginConfig = {},
): Promise<() => void> {
  // Skip transcoding if browser has native HEVC support
  if (!config.forceTranscode && await hasNativeHevcSupport()) {
    console.log("[hevc.js/dash] Native HEVC support detected — transcoding not needed");
    // Register capabilities filter so dash.js accepts HEVC representations
    if (player?.registerCustomCapabilitiesFilter) {
      player.registerCustomCapabilitiesFilter(() => true);
    }
    return () => {};
  }

  // The transcoding path patches classic MediaSource — without it (iPhone
  // Safari has only ManagedMediaSource) there is nothing we can intercept.
  if (typeof MediaSource === "undefined") {
    console.warn(
      "[hevc.js/dash] Classic MediaSource is not available in this browser — " +
      "HEVC transcoding disabled.",
    );
    return () => {};
  }

  if (!H264Encoder.isSupported()) {
    console.warn(
      "[hevc.js/dash] WebCodecs VideoEncoder not available. " +
      "HEVC transcoding requires Chrome 94+ or equivalent.",
    );
    return () => {};
  }

  // Check H.264 encoding support BEFORE installing MSE intercept
  const canEncode = await H264Encoder.checkSupport();
  if (!canEncode) {
    console.warn(
      "[hevc.js/dash] VideoEncoder exists but H.264 encoding is not supported. " +
      "HEVC transcoding is not available in this browser.",
    );
    return () => {};
  }

  console.log("[hevc.js/dash] No native HEVC support — installing WASM transcoder");

  // Install MSE intercept — patches isTypeSupported + addSourceBuffer
  installMSEIntercept({
    wasmUrl: config.wasmUrl,
    wasmBinaryUrl: config.wasmBinaryUrl,
    fps: config.fps,
    bitrate: config.bitrate,
    workerUrl: config.workerUrl,
  });

  // Tell dash.js to accept all representations (including HEVC, which it would normally reject)
  if (player.registerCustomCapabilitiesFilter) {
    player.registerCustomCapabilitiesFilter(() => true);
  }

  let detachComputeAware: (() => void) | null = null;
  // Default-on: only an explicit `false` opts out.
  if (config.adaptiveCompute !== false) {
    const opts = typeof config.adaptiveCompute === "object" ? config.adaptiveCompute : {};
    detachComputeAware = attachDashComputeAware(player, opts);
  }

  return () => {
    detachComputeAware?.();
    uninstallMSEIntercept();
  };
}
