# @hevcjs/core

HEVC/H.265 decoder compiled to WebAssembly, with a built-in HEVC-to-H.264 transcoding pipeline. 328 KB WASM (~113 KB gzipped), zero dependencies.

Implemented per **ITU-T H.265 v8** — 716 pages of spec. Decodes all 147 bitstreams of the JCT-VC HEVC v1 conformance suite bit-exactly against the reference decoder's MD5 — see [Spec conformance](https://github.com/lid-labs/hevc.js#spec-conformance).

## Install

```bash
npm install @hevcjs/core
```

## Setup

The package includes 3 static files that must be served by your web server:

- `transcode-worker.js` — Web Worker (IIFE, standalone)
- `wasm/hevc-decode.js` — Emscripten glue code
- `wasm/hevc-decode.wasm` — WASM binary (328 KB, ~113 KB gzipped)

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

### Transcoding several segments at once

```js
installMSEIntercept({
  workerUrl: '/transcode-worker.js',
  poolSize: 2,   // default: 2 from four hardware threads up, 1 below
});
```

Each worker holds its own WASM decoder, so `poolSize` segments transcode in
parallel while the SourceBuffer is still fed in segment order. It raises
sustained throughput, which is what lets a player buffer ahead when transcoding
runs near real time; it does not shorten the first segment's latency. The cost
is one decoder and one DPB per worker, tens of megabytes at 1080p, so the value
is a bound and not a target: workers are created only as parallel work turns up.

A segment is handed to a second worker only when it starts on an IDR or a BLA
picture, which resets the decoder by itself. A segment whose first picture is a
CRA — an open GOP — stays on the worker that decoded the previous segment,
because its leading pictures reference that segment. DASH and HLS are usually
segmented on IDRs, so this is the common case; where it is not, `poolSize` has
no effect rather than a wrong one. `poolSize: 1` transcodes one segment at a
time.

`wasmBinaryUrl` is required when assets live on a different origin than the page (Emscripten otherwise fails to resolve the `.wasm` relative to the worker's `blob:` URL). Cross-origin worker loading is handled transparently — the plugin fetches the script and wraps it in a same-origin blob URL since classic Workers refuse cross-origin scripts even with CORS headers.

### Segment transcoder (manual control)

```js
import { SegmentTranscoder } from '@hevcjs/core';

const transcoder = new SegmentTranscoder({ fps: 25 });
await transcoder.init();
await transcoder.processInitSegment(initSegmentBytes);
const h264Segment = await transcoder.processMediaSegment(hevcSegmentBytes);
```

### Decoder only

When your code demuxes the stream itself and only needs decoded frames, import from `@hevcjs/core/decoder`. It exports `HEVCDecoder` and its types, and nothing that pulls mp4box into your bundle — the main entry does, even when only `HEVCDecoder` is used.

```js
import { HEVCDecoder } from '@hevcjs/core/decoder';

const decoder = await HEVCDecoder.create();
decoder.feed(annexBAccessUnit);   // one or more complete NAL units, Annex B
for (const frame of decoder.drain()) {
  // frame.y / frame.cb / frame.cr, in display order
}
const tail = decoder.flush();     // end of stream
decoder.destroy();
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
// decision: { capIndex, avgSpeedX, reason: 'init' | 'hold' | 'lower' | 'raise' | 'floor' }
```

## How it works

1. **Demux** — mp4box.js extracts raw HEVC NAL units from fMP4 segments
2. **Decode** — WASM decoder produces YUV frames (spec-compliant, pixel-perfect)
3. **Encode** — WebCodecs `VideoEncoder` compresses to H.264
4. **Mux** — Custom fMP4 muxer wraps H.264 in ISO BMFF with correct timestamps

All heavy work runs in a Web Worker. No `SharedArrayBuffer` required, no special server headers needed.

## Performance

Single-threaded decode on an Apple M4 Pro, measured on 2026-10-30 with
`node tools/bench_wasm.cjs <file> packages/core/wasm` on Node 24.4.1 — the root
README carries the streams and the method:

| Stream | WASM |
|---|---|
| 1080p, SAO, WPP — `bbb1080_50f.265` | 145 fps |
| 4K, SAO, WPP — `bbb4k_25f.265` | 32 fps |
| 4K, SAO, no WPP — `bbb4k_singleslice.265` | 45 fps |

**1080p transcode** (HEVC decode + H.264 encode, in Chromium through Playwright):
1.8-2.0x real time, measured on 2026-10-21.

## Requirements

- WebAssembly + Web Workers
- WebCodecs (Chrome/Edge 94+, Firefox with H.264 encoding support) for transcoding
- Secure Context (HTTPS or localhost)

## License

MIT
