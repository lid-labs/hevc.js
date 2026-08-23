# @hevcjs/core

HEVC/H.265 decoder compiled to WebAssembly, with a built-in HEVC-to-H.264 transcoding pipeline. 261KB WASM, zero dependencies.

Implemented per **ITU-T H.265 v8** — 716 pages of spec, validated pixel-perfect against ffmpeg on 128 test bitstreams.

## Install

```bash
npm install @hevcjs/core
```

## Setup

The package includes 3 static files that must be served by your web server:

- `transcode-worker.js` — Web Worker (IIFE, standalone)
- `wasm/hevc-decode.js` — Emscripten glue code
- `wasm/hevc-decode.wasm` — WASM binary (261KB)

Copy them from `node_modules/@hevcjs/core/dist/` to your public/static directory:

```bash
cp node_modules/@hevcjs/core/dist/transcode-worker.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.wasm public/
```

Adjust the destination to match your project structure (`public/`, `static/`, `dist/`, etc.).

## Usage

### MSE intercept (transparent HEVC playback)

```js
import { installMSEIntercept } from '@hevcjs/core';

installMSEIntercept({
  workerUrl: '/transcode-worker.js',
  wasmUrl: '/hevc-decode.js',
});
```

### Loading from a CDN (zero build, cross-origin)

`@hevcjs/core` works directly from a CDN — no install, no build step, no static asset copy:

```html
<script type="module">
  import { installMSEIntercept } from 'https://esm.sh/@hevcjs/core@1';

  installMSEIntercept({
    workerUrl:     'https://unpkg.com/@hevcjs/core@1/dist/transcode-worker.js',
    wasmUrl:       'https://unpkg.com/@hevcjs/core@1/dist/wasm/hevc-decode.js',
    wasmBinaryUrl: 'https://unpkg.com/@hevcjs/core@1/dist/wasm/hevc-decode.wasm',
  });
</script>
```

`wasmBinaryUrl` is required when assets live on a different origin than the page (Emscripten otherwise fails to resolve the `.wasm` relative to the worker's `blob:` URL). Cross-origin worker loading is handled transparently — the plugin fetches the script and wraps it in a same-origin blob URL since classic Workers refuse cross-origin scripts even with CORS headers.

### Segment transcoder (manual control)

```js
import { SegmentTranscoder } from '@hevcjs/core';

const transcoder = new SegmentTranscoder({ fps: 25 });
await transcoder.init();
await transcoder.processInitSegment(initSegmentBytes);
const h264Segment = await transcoder.processMediaSegment(hevcSegmentBytes);
```

### Compute-aware ABR primitives

`@hevcjs/core` publishes a `SegmentPerfStat` on every successful segment transcode. Both `@hevcjs/shaka-plugin` and `@hevcjs/dashjs-plugin` consume this bus to cap variants when the device can't keep up. You can subscribe directly if you're integrating with a different player or building custom telemetry:

```js
import { subscribeSegmentStat, ComputeAwareDecider } from '@hevcjs/core';

const detach = subscribeSegmentStat(stat => {
  // stat: { totalMs, segDurMs, speedX, frames, width, height }
  console.log(`speedX=${stat.speedX} on ${stat.width}x${stat.height}`);
});

// Or use the player-agnostic decider directly
const decider = new ComputeAwareDecider({ measureWindow: 2, lowerAfter: 1 });
decider.setLadderSize(4);
const decision = decider.observe(stat.speedX, currentVariantIdx);
// decision: { capIndex, avgSpeedX, reason: 'init' | 'hold' | 'lower' | 'raise' }
```

## How it works

1. **Demux** — mp4box.js extracts raw HEVC NAL units from fMP4 segments
2. **Decode** — WASM decoder produces YUV frames (spec-compliant, pixel-perfect)
3. **Encode** — WebCodecs `VideoEncoder` compresses to H.264
4. **Mux** — Custom fMP4 muxer wraps H.264 in ISO BMFF with correct timestamps

All heavy work runs in a Web Worker. No `SharedArrayBuffer` required, no special server headers needed.

## Performance

Single-threaded, Apple Silicon:

| Resolution | WASM (Chrome) |
|---|---|
| 1080p decode | 61 fps |
| 4K decode | 21 fps |
| 1080p transcode | ~2.5x realtime |

## Requirements

- WebAssembly + Web Workers
- WebCodecs (Chrome/Edge 94+, Firefox with H.264 encoding support) for transcoding
- Secure Context (HTTPS or localhost)

## License

MIT
