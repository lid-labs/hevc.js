import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    clean: true,
    sourcemap: true,
    outDir: "dist",
    external: ["mediabunny", "mp4box"],
  },
  {
    // Served as is by the app and started with new Worker(): self-contained
    entry: ["src/decode-worker.ts"],
    format: ["iife"],
    dts: false,
    clean: false,
    sourcemap: true,
    outDir: "dist",
    noExternal: [/.*/],
  },
]);
