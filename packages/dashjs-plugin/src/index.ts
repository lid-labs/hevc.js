export { attachHevcSupport } from "./plugin.js";
export type { HevcDashPluginConfig } from "./plugin.js";
export { attachDashComputeAware } from "./compute-aware.js";
export type { DashComputeAwareOptions } from "./compute-aware.js";

// Re-export shared MSE utilities from core
export { installMSEIntercept, uninstallMSEIntercept, SegmentTranscoder } from "@hevcjs/core";
export type { SegmentTranscoderConfig, TranscodedInit } from "@hevcjs/core";
// Perf-bus surface: subscribe to per-segment transcode stats (speedX,
// frames, resolution) without depending on @hevcjs/core directly.
export { subscribeSegmentStat } from "@hevcjs/core";
export type { SegmentPerfStat } from "@hevcjs/core";
