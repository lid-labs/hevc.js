/**
 * Demo entry point — shows how to use @hevcjs/hlsjs-plugin with hls.js.
 * Bundled by esbuild into hls-bundle.js for the demo page.
 *
 * In a real project with a bundler (Vite, Webpack), you'd just:
 *   import { attachHevcSupport } from '@hevcjs/hlsjs-plugin';
 */
import {
  attachHevcSupport,
  subscribeSegmentStat,
} from "../packages/hlsjs-plugin/src/index.js";
import type {
  HevcHlsPluginConfig,
  SegmentPerfStat,
} from "../packages/hlsjs-plugin/src/index.js";

// Re-export for the demo HTML
export { attachHevcSupport, subscribeSegmentStat };
export type { HevcHlsPluginConfig, SegmentPerfStat };
