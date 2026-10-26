# @hevcjs/mediabunny-plugin

HEVC/H.265 decoding for [Mediabunny](https://mediabunny.dev) where WebCodecs cannot decode it — Firefox, Chrome on Linux, machines without a hardware HEVC decoder. Registers a [custom video decoder](https://mediabunny.dev/guide/supported-formats-and-codecs#custom-coders) backed by the hevc.js WebAssembly decoder; Mediabunny then reads, converts and extracts frames from HEVC tracks as it does for any other codec.

Where the browser decodes HEVC itself, the plugin stays out of the way: it only claims the profiles WebCodecs reports as unsupported.

## Install

```bash
npm install @hevcjs/mediabunny-plugin mediabunny
```

**[Live demo](https://hevcjs.dev/demo/mediabunny.html)**: decode an HEVC file in your browser, with a toggle to force hevc.js where WebCodecs has native HEVC.

## Usage

Copy the decoder from `@hevcjs/core` to your public directory:

```bash
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.js public/
cp node_modules/@hevcjs/core/dist/wasm/hevc-decode.wasm public/
```

Load the glue with a script tag; it finds `hevc-decode.wasm` next to itself:

```html
<script src="/hevc-decode.js"></script>
```

Then register the decoder, and await it, before any decoding task:

```js
import { Input, ALL_FORMATS, BlobSource, VideoSampleSink } from 'mediabunny';
import { registerHevcDecoder } from '@hevcjs/mediabunny-plugin';

await registerHevcDecoder();

const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
const track = await input.getPrimaryVideoTrack();
await track.canDecode(); // true for HEVC Main / Main 10, native or not

for await (const sample of new VideoSampleSink(track).samples()) {
  // ...
  sample.close();
}
```

Mediabunny prefers a registered decoder over WebCodecs, so `registerHevcDecoder()` asks WebCodecs first, once, which profiles it decodes, and leaves those to it. `registerHevcDecoder({ force: true })` decodes with hevc.js everywhere, which is useful to test the WASM path on a browser that has native HEVC.

## Options

| Option | Default | |
|---|---|---|
| `force` | `false` | Claim every supported profile, even those WebCodecs decodes natively |
| `wasmUrl` | `./wasm/hevc-decode.js` | Forwarded to `HEVCDecoder.create()` of `@hevcjs/core`, which only uses it when no glue is loaded globally |
| `wasmBinaryUrl` | next to the glue | URL of `hevc-decode.wasm`, forwarded likewise |

The options of the first call stay in effect: later calls return the same registration.

## What it decodes

- **Profiles**: Main and Main 10, 4:2:0. Other HEVC tracks are left to WebCodecs.
- **Output**: `I420` frames, `I420P10` for 10-bit streams where `VideoFrame` accepts it; elsewhere 10-bit frames are scaled down to 8 bits.
- **Packets**: MP4/MOV-style (`hvcC` description, length-prefixed NAL units) and Annex B.

## Limitations

- Decoding runs on the thread that runs Mediabunny. Run Mediabunny in a Web Worker to keep the page responsive; in a classic worker, load the glue with `importScripts('/hevc-decode.js')` instead of a script tag, and pass `wasmBinaryUrl` unless `hevc-decode.wasm` sits next to the worker script — inside a worker, the glue resolves it against the worker's URL.
- The native probe tests one level per profile (level 3.1). A browser that decodes HEVC at that level but not at a higher one is not detected, and Mediabunny will report those tracks as undecodable; `force: true` covers that case.
- No colour metadata is attached to the frames yet: they take `VideoFrame`'s defaults.

## License

MIT. Mediabunny itself is MPL-2.0; it is a peer dependency, not bundled into this package.
