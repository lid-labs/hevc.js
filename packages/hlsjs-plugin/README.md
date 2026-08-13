# @hevcjs/hlsjs-plugin

HEVC/H.265 playback plugin for [hls.js](https://github.com/video-dev/hls.js). Transparently transcodes HEVC segments to H.264 via WebAssembly when native HEVC is unavailable. When native HEVC is available, the plugin detects it and does nothing.

## Install

```bash
npm install @hevcjs/hlsjs-plugin hls.js
```

## Usage — bundled (Vite, Webpack, etc.)

Copy the static assets from `@hevcjs/core` to your public directory:

```bash
cp node_modules/@hevcjs/core/dist/transcode-worker.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.wasm public/
```

Then:

```js
import Hls from 'hls.js';
import { attachHevcSupport } from '@hevcjs/hlsjs-plugin';

const video = document.querySelector('video');

// Must run BEFORE `new Hls()` — hls.js filters levels against
// MediaSource.isTypeSupported at manifest parse time.
await attachHevcSupport({
  workerUrl: '/transcode-worker.js',
  wasmUrl: '/hevc-decode.js',
});

const hls = new Hls({ preferManagedMediaSource: false });
hls.attachMedia(video);
hls.loadSource('https://example.com/stream/playlist.m3u8');
```

`preferManagedMediaSource: false` keeps hls.js on classic `MediaSource`, which the transcoding path requires. Browsers where only `ManagedMediaSource` exists (iPhone Safari) play HEVC natively, so nothing is lost there.

## Usage — from a CDN (zero build)

```html
<script type="module">
  import { attachHevcSupport } from 'https://esm.sh/@hevcjs/hlsjs-plugin@0';

  const video = document.querySelector('video');

  await attachHevcSupport({
    workerUrl:     'https://unpkg.com/@hevcjs/core@1/dist/transcode-worker.js',
    wasmUrl:       'https://unpkg.com/@hevcjs/core@1/dist/wasm/hevc-decode.js',
    wasmBinaryUrl: 'https://unpkg.com/@hevcjs/core@1/dist/wasm/hevc-decode.wasm',
  });

  const hls = new Hls({ preferManagedMediaSource: false });
  hls.attachMedia(video);
  hls.loadSource('https://example.com/stream/playlist.m3u8');
</script>
```

`wasmBinaryUrl` is required when assets live on a different origin than the page — Emscripten otherwise resolves the `.wasm` relative to the worker's `blob:` URL and fails.

## API

### `attachHevcSupport(config?): Promise<HevcHlsPluginHandle>`

Probes native HEVC support (by actually creating an HEVC SourceBuffer, not just `isTypeSupported`), checks WebCodecs H.264 encoding, then installs the MSE intercept. Returns a callable handle: invoke it (or `handle.uninstall()`) to tear everything down; `handle.attachComputeAware(hls)` wires the compute-aware ABR feedback loop (caps `hls.autoLevelCapping` when the device can't transcode the current level in real time — on by default, pass `adaptiveCompute: false` to opt out).

Unlike the dash.js plugin, no player instance is needed: hls.js keeps HEVC levels in its ladder as long as the (patched) `MediaSource.isTypeSupported` accepts them.

| Option | Type | Description |
|---|---|---|
| `workerUrl` | `string` | Transcode worker script URL. When set, transcoding runs off the main thread (recommended). |
| `wasmUrl` | `string` | URL of the Emscripten glue script (`hevc-decode.js`). |
| `wasmBinaryUrl` | `string` | URL of the `.wasm` binary — needed for cross-origin/CDN setups. |
| `forceTranscode` | `boolean` | Transcode even when native HEVC is available (testing). Default `false`. |
| `adaptiveCompute` | `boolean \| object` | Compute-aware ABR: `true`/omitted = on, object = decider tuning, `false` = off. |
| `logLevel` | `string` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'silent'`. |

## Scope and compatibility

- Tested against **hls.js 1.7.x** (the declared peer range `>=1.4.0` is not fully exercised — 1.6.6 changed how hls.js drives `SourceBuffer.timestampOffset`, and this plugin is designed for the current behavior).
- Supported today: HLS **fMP4** streams with video-only or demuxed audio renditions.
- Not yet supported: muxed audio+video fMP4 segments (single `audiovideo` SourceBuffer). These renditions are refused upfront (`isTypeSupported` answers false, and a clear error is logged if one slips through) instead of silently playing without audio. HEVC-in-MPEG-TS is untested.
- Compute-aware ABR is wired via `handle.attachComputeAware(hls)` — on by default.

## License

MIT
