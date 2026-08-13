/**
 * hls.js HEVC Plugin — Enables HEVC playback in hls.js via WASM transcoding.
 *
 * Patches MSE so hls.js keeps HEVC levels in its ladder (the patched
 * `MediaSource.isTypeSupported` answers for the H.264 equivalent) and
 * transparently transcodes HEVC segments to H.264.
 *
 * Usage:
 * ```ts
 * import Hls from 'hls.js';
 * import { attachHevcSupport } from '@hevcjs/hlsjs-plugin';
 *
 * const cleanup = await attachHevcSupport({ wasmUrl: '/hevc-decode.js' });
 * const hls = new Hls();
 * hls.attachMedia(videoElement);
 * hls.loadSource(m3u8Url);
 * ```
 *
 * Must be called BEFORE `new Hls()` — hls.js filters levels against
 * `MediaSource.isTypeSupported` at manifest parse time, so the intercept
 * has to be in place first.
 */

import { H264Encoder, installMSEIntercept, uninstallMSEIntercept, getMediaSourceConstructor } from "@hevcjs/core";
import type { MSEInterceptConfig } from "@hevcjs/core";

export interface HevcHlsPluginConfig extends MSEInterceptConfig {
  /**
   * Force HEVC transcoding even if the browser supports HEVC natively.
   * Useful for testing. Default: false.
   */
  forceTranscode?: boolean;
}

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
 * Attach HEVC transcoding support for hls.js.
 *
 * Must be called BEFORE creating the `Hls` instance.
 * Skips if the browser has native HEVC support (unless forceTranscode is set).
 * Checks H.264 encoding support before installing the MSE intercept.
 *
 * Unlike the dash.js plugin, no player instance is needed: hls.js keeps
 * HEVC levels as long as `MediaSource.isTypeSupported` accepts them, which
 * the MSE intercept guarantees.
 *
 * @param config Optional transcoder configuration
 * @returns A cleanup function to remove the plugin
 */
export async function attachHevcSupport(
  config: HevcHlsPluginConfig = {},
): Promise<() => void> {
  // Skip transcoding if browser has native HEVC support
  if (!config.forceTranscode && await hasNativeHevcSupport()) {
    console.log("[hevc.js/hls] Native HEVC support detected — transcoding not needed");
    return () => {};
  }

  // The transcoding path patches classic MediaSource — without it (iPhone
  // Safari has only ManagedMediaSource) there is nothing we can intercept.
  if (typeof MediaSource === "undefined") {
    console.warn(
      "[hevc.js/hls] Classic MediaSource is not available in this browser — " +
      "HEVC transcoding disabled.",
    );
    return () => {};
  }

  if (!H264Encoder.isSupported()) {
    console.warn(
      "[hevc.js/hls] WebCodecs VideoEncoder not available. " +
      "HEVC transcoding requires Chrome 94+ or equivalent.",
    );
    return () => {};
  }

  // Check H.264 encoding support BEFORE installing MSE intercept
  const canEncode = await H264Encoder.checkSupport();
  if (!canEncode) {
    console.warn(
      "[hevc.js/hls] VideoEncoder exists but H.264 encoding is not supported. " +
      "HEVC transcoding is not available in this browser.",
    );
    return () => {};
  }

  console.log("[hevc.js/hls] No native HEVC support — installing WASM transcoder");

  // Install MSE intercept — patches isTypeSupported + addSourceBuffer.
  // strictAppendProgress: hls.js's watchdog treats updateend without
  // buffered-range growth as `bufferAppendNoProgress` (up to
  // appendErrorMaxRetry per fragment), so updateend must wait for the
  // first transcoded chunk to land.
  installMSEIntercept({
    wasmUrl: config.wasmUrl,
    wasmBinaryUrl: config.wasmBinaryUrl,
    fps: config.fps,
    bitrate: config.bitrate,
    workerUrl: config.workerUrl,
    logLevel: config.logLevel,
    strictAppendProgress: true,
  });

  return () => {
    uninstallMSEIntercept();
  };
}
