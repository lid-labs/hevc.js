# @hevcjs/shaka-plugin

HEVC/H.265 playback plugin for [Shaka Player](https://github.com/shaka-project/shaka-player). Registers a custom Shaka `Transmuxer` that ingests HEVC fMP4 segments and emits H.264 fMP4 that any browser can play via MSE.

Tracks issue [#101](https://github.com/lid-labs/hevc.js/issues/101).

## Install

```bash
npm install @hevcjs/shaka-plugin shaka-player
```

## Usage

```js
import shaka from 'shaka-player';
import { registerHevcTransmuxer } from '@hevcjs/shaka-plugin';

const handle = registerHevcTransmuxer(shaka, {
  workerUrl: '/transcode-worker.js',
  wasmUrl:   '/hevc-decode.js',
});

const player = new shaka.Player();
await player.attach(document.querySelector('video'));
handle.attachComputeAware(player);          // compute-aware ABR (on by default)
await player.load('https://example.com/stream/manifest.mpd');

// later: handle(); // unregisters transmuxer AND detaches compute-aware
```

`handle` is callable for backward compatibility (`handle()` unregisters), and exposes `handle.unregister()` / `handle.attachComputeAware(player, options?)` for explicit control. The unified teardown tears down both the transmuxer registration and any active compute-aware listener.

## Compute-aware ABR

The plugin watches per-segment transcode `speedX` (`segDurMs / wallClockMs`). When the device can't keep up, it asks Shaka to narrow its variant ceiling via `player.configure({ abr: { restrictions } })` — Shaka's own bandwidth-based ABR keeps picking freely from what's left. **On by default.**

```js
// Tune the decider (defaults: measureWindow 2, lowerAfter 1, raiseAfter 6, targetSpeedX 1.3)
registerHevcTransmuxer(shaka, {
  adaptiveCompute: { targetSpeedX: 1.5, lowerAfter: 2 },
});

// Telemetry hook — fires per segment, not just on cap changes
handle.attachComputeAware(player, {
  onObservation: (stat, avgSpeedX, capIndex, reason) => {
    console.log(`speedX=${stat.speedX.toFixed(2)} cap=${capIndex} (${reason})`);
  },
});

// Opt out
registerHevcTransmuxer(shaka, { adaptiveCompute: false });
```

Options passed at `attachComputeAware` time merge on top of options passed at register time — convenient when `onObservation` is only known once the UI exists.

## Performance & tuning

Shaka 4.x's `Transmuxer.transmux()` contract returns one `Uint8Array` per segment, so the buffered range can only grow in whole-segment jumps. On hardware where WASM transcoding runs near real time, the playback head skirts the edge of that range: playback stutters in a few-second rhythm even though the buffer is contiguous and nothing is out of spec. The dash.js plugin does not show this, because it appends transcoded chunks to MSE progressively as the encoder emits them.

A deeper buffer gives transcoding room to stay ahead:

```js
import { registerHevcTransmuxer, recommendedBufferConfig } from '@hevcjs/shaka-plugin';

const player = new shaka.Player();
player.configure(recommendedBufferConfig());   // before load()
await player.load(manifestUrl);
```

That raises `streaming.bufferingGoal` to 30s, against Shaka's default of 10. Startup takes longer to fill the buffer, in exchange for playback that absorbs slower-than-real-time stretches instead of stalling on them. `configure()` deep-merges, so the rest of your configuration is untouched; only a later `configure()` setting `bufferingGoal` itself would override it.

It leaves `rebufferingGoal` alone on purpose. That setting decides whether Shaka gates playback on buffer depth at all — it defaults to 0 on Shaka 5, where the buffer poller never runs and the playback rate is never held back. Turning it on would mean that a device transcoding at around real time freezes until the goal is re-accumulated, trading a stutter for a longer hard stall. Raise it only if you have measured that it helps on your content and hardware.

This is a mitigation, not a cure: it buys headroom, it does not make transcoding faster. If `speedX` stays below 1 for long enough, the buffer drains whatever its depth. Two things help there:

- **Use the Worker** (`workerUrl`), which keeps decoding off the main thread.
- **Leave compute-aware ABR on** (the default), so the variant ceiling drops when the device cannot keep up.

`subscribeSegmentStat` reports the per-segment `speedX` if you want to see where a given device actually lands.

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
