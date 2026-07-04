/**
 * Demo entry point — shows how to use @hevcjs/shaka-plugin with Shaka Player.
 * Bundled by esbuild into shaka-bundle.js for the demo page.
 *
 * In a real project with a bundler (Vite, Webpack), you'd just:
 *   import { registerHevcTransmuxer } from 'hevc.js/shaka-plugin';
 */
import {
  HevcTransmuxer,
  registerHevcTransmuxer,
  subscribeSegmentStat,
} from "../packages/shaka-plugin/src/index.js";
import type {
  HevcShakaPluginConfig,
  SegmentPerfStat,
} from "../packages/shaka-plugin/src/index.js";

// Re-export for the demo HTML
export { HevcTransmuxer, registerHevcTransmuxer, subscribeSegmentStat };
export type { HevcShakaPluginConfig, SegmentPerfStat };
