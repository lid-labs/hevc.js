# @hevcjs/mediabunny-plugin

HEVC/H.265 decoding for [Mediabunny](https://mediabunny.dev) where WebCodecs cannot decode it — Firefox, Chrome on Linux, machines without a hardware HEVC decoder. Registers a [custom video decoder](https://mediabunny.dev/guide/supported-formats-and-codecs#custom-coders) backed by the hevc.js WebAssembly decoder; Mediabunny then reads, converts and extracts frames from HEVC tracks as it does for any other codec.

Where the browser decodes HEVC itself, the plugin stays out of the way: it only claims the profiles WebCodecs reports as unsupported.

## Install

```bash
npm install @hevcjs/mediabunny-plugin mediabunny
```

**[Live demo](https://hevcjs.dev/demo/mediabunny.html)**: decode an HEVC file in your browser, with toggles to force hevc.js where WebCodecs has native HEVC and to decode in a worker or on the page's thread.

## Usage

Serve the decode worker and the decoder side by side, from this package and from `@hevcjs/core`:

```bash
cp node_modules/@hevcjs/mediabunny-plugin/dist/decode-worker.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.wasm public/
```

Then register the decoder, and await it, before any decoding task:

```js
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import { registerHevcDecoder } from '@hevcjs/mediabunny-plugin';

await registerHevcDecoder({ workerUrl: '/decode-worker.js' });

const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
const track = await input.getPrimaryVideoTrack();
await track.canDecode(); // true for HEVC Main / Main 10, native or not

for await (const sample of new VideoSampleSink(track).samples()) {
  // ...
  sample.close();
}
```

Each track being decoded gets its own worker, which loads `hevc-decode.js` and `hevc-decode.wasm` from the worker's directory unless `wasmUrl` / `wasmBinaryUrl` say otherwise. A worker on another origin, a CDN for instance, is fetched and started from a blob URL, since classic workers refuse cross-origin scripts; it then runs with your page's origin, so serve it, the glue and the binary only from sources you trust. Under a Content Security Policy, that cross-origin path needs `connect-src` for the worker's host and `worker-src blob:`; a same-origin worker needs `worker-src 'self'`.

Mediabunny prefers a registered decoder over WebCodecs, so `registerHevcDecoder()` asks WebCodecs first, once, which profiles it decodes, and leaves those to it. `registerHevcDecoder({ force: true })` decodes with hevc.js everywhere, which is useful to test the WASM path on a browser that has native HEVC.

### Without a worker

Leave `workerUrl` out and the page's thread decodes. Load the glue with a script tag instead, `<script src="/hevc-decode.js"></script>`; it finds `hevc-decode.wasm` next to itself. The plugin then yields to the event loop about every 50 ms so the page keeps painting and handling input, but the decoding itself still competes with the page for its thread.

## Options

| Option | Default | |
|---|---|---|
| `workerUrl` | none: decode on the page's thread | URL of `decode-worker.js` |
| `force` | `false` | Claim every supported profile, even those WebCodecs decodes natively |
| `wasmUrl` | with a worker: `hevc-decode.js` next to it; without: `./wasm/hevc-decode.js`, used only when no glue is loaded globally | URL of the Emscripten glue |
| `wasmBinaryUrl` | next to the glue | URL of `hevc-decode.wasm` |

The options of the first call stay in effect: later calls return the same registration.

## What it decodes

- **Profiles**: Main and Main 10, 4:2:0. Other HEVC tracks are left to WebCodecs.
- **Output**: `I420` frames, `I420P10` for 10-bit streams where `VideoFrame` accepts it; elsewhere 10-bit frames are scaled down to 8 bits.
- **Packets**: MP4/MOV-style (`hvcC` description, length-prefixed NAL units) and Annex B.

## Limitations

- The native probe tests one level per profile (level 3.1). A browser that decodes HEVC at that level but not at a higher one is not detected, and Mediabunny will report those tracks as undecodable; `force: true` covers that case.
- No colour metadata is attached to the frames yet: they take `VideoFrame`'s defaults.

## License

MIT. Mediabunny itself is MPL-2.0; it is a peer dependency, not bundled into this package.
