export { attachHevcSupport } from "./plugin.js";
export type { HevcHlsPluginConfig, HevcHlsPluginHandle } from "./plugin.js";
export { attachHlsComputeAware } from "./compute-aware.js";
export type { HlsComputeAwareOptions } from "./compute-aware.js";

// Re-export shared MSE utilities from core
export { installMSEIntercept, uninstallMSEIntercept, SegmentTranscoder } from "@hevcjs/core";
export type { SegmentTranscoderConfig, TranscodedInit } from "@hevcjs/core";
// Perf-bus surface: subscribe to per-segment transcode stats (speedX,
// frames, resolution) without depending on @hevcjs/core directly.
export { subscribeSegmentStat } from "@hevcjs/core";
export type { SegmentPerfStat } from "@hevcjs/core";
