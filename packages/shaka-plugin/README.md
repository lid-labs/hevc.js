# @hevcjs/shaka-plugin

> **Status: experimental skeleton.** Package layout, registration, and Shaka Transmuxer interface are in place. The actual HEVC → H.264 conversion is a TODO that will plug into [`@hevcjs/core`](../core).

HEVC/H.265 playback plugin for [Shaka Player](https://github.com/shaka-project/shaka-player). Registers a custom Shaka `Transmuxer` that ingests HEVC fMP4 segments and (eventually) emits H.264 fMP4 that any browser can play via MSE.

Tracks issue [#101](https://github.com/privaloops/hevc.js/issues/101).

## Install

```bash
npm install @hevcjs/shaka-plugin shaka-player
```

## Usage (target API)

```js
import shaka from 'shaka-player';
import { registerHevcTransmuxer } from '@hevcjs/shaka-plugin';

const cleanup = registerHevcTransmuxer(shaka, {
  workerUrl: '/transcode-worker.js',
  wasmUrl:   '/hevc-decode.js',
});

const player = new shaka.Player();
await player.attach(document.querySelector('video'));
await player.load('https://example.com/stream/manifest.mpd');

// later: cleanup();
```

## How It Works

Shaka exposes a `TransmuxerEngine` that lets plugins convert one container/codec into another before MSE sees the bytes. This package follows the same pattern as Shaka's built-in `AacTransmuxer`:

1. `registerHevcTransmuxer(shaka)` calls `shaka.transmuxer.TransmuxerEngine.registerTransmuxer()` for `video/mp4; codecs="hev1"` and `hvc1`.
2. When Shaka encounters HEVC content it can't play natively, it instantiates `HevcTransmuxer` and feeds it segments via `transmux(data, stream, reference, duration)`.
3. The transmuxer decodes HEVC via `@hevcjs/core` (WASM) and re-encodes to H.264 via WebCodecs, returning an MSE-ready fMP4 segment.

## Requirements

- Chrome 94+, Edge 94+, or Firefox with WebCodecs H.264 encoding support
- Secure Context (HTTPS or localhost)
- shaka-player >= 4.0.0

## License

MIT
