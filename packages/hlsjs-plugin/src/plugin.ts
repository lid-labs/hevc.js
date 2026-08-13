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
import { attachHlsComputeAware } from "./compute-aware.js";
import type { HlsComputeAwareOptions } from "./compute-aware.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HlsInstance = any;

export interface HevcHlsPluginConfig extends MSEInterceptConfig {
  /**
   * Force HEVC transcoding even if the browser supports HEVC natively.
   * Useful for testing. Default: false.
   */
  forceTranscode?: boolean;
  /**
   * Compute-aware ABR feedback. Caps `hls.autoLevelCapping` by observed
   * transcode `speedX` so the device doesn't pick a level it can't
   * transcode in real time.
   *
   * - **On by default** (undefined or `true`) — sensible defaults.
   * - Pass an object to tune the decider knobs (`targetSpeedX`, etc.).
   * - Pass `false` to opt out: `attachComputeAware` becomes a silent no-op.
   *
   * `attachComputeAware(hls)` must be called explicitly because the Hls
   * instance is created after this plugin attaches.
   */
  adaptiveCompute?: boolean | HlsComputeAwareOptions;
}

/**
 * Return shape of `attachHevcSupport`. Callable for backwards compat
 * (`handle()` uninstalls, same as the previous plain cleanup function).
 */
export interface HevcHlsPluginHandle {
  (): void;
  /** Explicit alias for the callable form. */
  uninstall(): void;
  /**
   * Attach the compute-aware feedback loop to an Hls instance.
   * Active by default; becomes a silent no-op only when the config
   * explicitly passed `adaptiveCompute: false`.
   *
   * Options passed here are merged on top of options passed at attach
   * time; call-time options win (typical case: `onObservation` is only
   * known once the UI exists).
   *
   * @returns cleanup function — detaches the perf-bus listener.
   */
  attachComputeAware(hls: HlsInstance, options?: HlsComputeAwareOptions): () => void;
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
): Promise<HevcHlsPluginHandle> {
  // Skip transcoding if browser has native HEVC support
  if (!config.forceTranscode && await hasNativeHevcSupport()) {
    console.log("[hevc.js/hls] Native HEVC support detected — transcoding not needed");
    return makeHandle(() => {}, config.adaptiveCompute);
  }

  // The transcoding path patches classic MediaSource — without it (iPhone
  // Safari has only ManagedMediaSource) there is nothing we can intercept.
  if (typeof MediaSource === "undefined") {
    console.warn(
      "[hevc.js/hls] Classic MediaSource is not available in this browser — " +
      "HEVC transcoding disabled.",
    );
    return makeHandle(() => {}, config.adaptiveCompute);
  }

  if (!H264Encoder.isSupported()) {
    console.warn(
      "[hevc.js/hls] WebCodecs VideoEncoder not available. " +
      "HEVC transcoding requires Chrome 94+ or equivalent.",
    );
    return makeHandle(() => {}, config.adaptiveCompute);
  }

  // Check H.264 encoding support BEFORE installing MSE intercept
  const canEncode = await H264Encoder.checkSupport();
  if (!canEncode) {
    console.warn(
      "[hevc.js/hls] VideoEncoder exists but H.264 encoding is not supported. " +
      "HEVC transcoding is not available in this browser.",
    );
    return makeHandle(() => {}, config.adaptiveCompute);
  }

  console.log(
    config.forceTranscode
      ? "[hevc.js/hls] forceTranscode — installing WASM transcoder"
      : "[hevc.js/hls] No native HEVC support — installing WASM transcoder",
  );

  // The intercept patches classic MediaSource. When ManagedMediaSource also
  // exists, hls.js prefers it by default and would bypass the intercept —
  // remind integrators to pin classic MSE.
  if (typeof (globalThis as Record<string, unknown>).ManagedMediaSource !== "undefined") {
    console.warn(
      "[hevc.js/hls] ManagedMediaSource detected: pass `preferManagedMediaSource: false` " +
      "to the Hls constructor, or hls.js will bypass the transcoding intercept.",
    );
  }

  // Install MSE intercept — patches isTypeSupported + addSourceBuffer.
  // Forward the whole MSEInterceptConfig surface (spread, not a manual
  // pick, so new fields like onTranscodeStart aren't silently dropped).
  // strictAppendProgress: hls.js's watchdog treats updateend without
  // buffered-range growth as `bufferAppendNoProgress` (up to
  // appendErrorMaxRetry per fragment), so updateend must wait for the
  // first transcoded chunk to land.
  const { forceTranscode: _forceTranscode, adaptiveCompute, ...mseConfig } = config;
  installMSEIntercept({
    ...mseConfig,
    strictAppendProgress: true,
  });

  return makeHandle(() => {
    uninstallMSEIntercept();
  }, adaptiveCompute);
}

/**
 * Build the callable+methods handle. Invoking the handle (or `uninstall()`)
 * tears down both the MSE intercept AND any active compute-aware listener,
 * matching the Shaka plugin's cleanup behaviour.
 */
function makeHandle(
  uninstall: () => void,
  adaptive: boolean | HlsComputeAwareOptions | undefined,
): HevcHlsPluginHandle {
  let activeDetach: (() => void) | null = null;

  const tearDown = () => {
    activeDetach?.();
    activeDetach = null;
    uninstall();
  };

  const fn = (() => tearDown()) as HevcHlsPluginHandle;
  fn.uninstall = tearDown;
  fn.attachComputeAware = (
    hls: HlsInstance,
    runtimeOpts?: HlsComputeAwareOptions,
  ): () => void => {
    // Explicit opt-out is the only path that disables the feature.
    if (adaptive === false) return () => {};
    // Re-attaching replaces any previous listener.
    activeDetach?.();
    const attachOpts = typeof adaptive === "object" ? adaptive : {};
    const opts = { ...attachOpts, ...(runtimeOpts ?? {}) };
    const detach = attachHlsComputeAware(hls, opts);
    activeDetach = detach;
    return () => {
      detach();
      if (activeDetach === detach) activeDetach = null;
    };
  };
  return fn;
}
