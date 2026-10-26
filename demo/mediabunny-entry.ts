/**
 * Demo entry point — shows how to use @hevcjs/mediabunny-plugin with Mediabunny.
 * Bundled by esbuild into mediabunny-bundle.js for the demo page.
 *
 * Mediabunny is bundled here rather than loaded from a CDN: the plugin
 * registers its decoder in Mediabunny's module state, so the page and the
 * plugin must share one copy of it.
 *
 * In a real project with a bundler (Vite, Webpack), you'd just:
 *   import { registerHevcDecoder } from '@hevcjs/mediabunny-plugin';
 */
export { registerHevcDecoder } from "../packages/mediabunny-plugin/src/index.js";
export { ALL_FORMATS, BlobSource, BufferSource, Input, VideoSampleSink } from "mediabunny";
