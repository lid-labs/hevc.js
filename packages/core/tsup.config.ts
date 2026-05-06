import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    outDir: "dist",
    external: ["./wasm/hevc-decode.js", "mp4box"],
  },
  {
    entry: ["src/transcode-worker.ts"],
    format: ["iife"],
    dts: false,
    clean: false,
    sourcemap: true,
    outDir: "dist",
    noExternal: [/.*/],
  },
]);
