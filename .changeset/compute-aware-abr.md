---
"@hevcjs/core": minor
"@hevcjs/shaka-plugin": minor
"@hevcjs/dashjs-plugin": minor
---

Add compute-aware ABR feedback for the Shaka and dash.js plugins. **On by default.**

Mainstream player ABR algorithms pick a variant from network bandwidth
alone — in a normal pipeline, fetch + parse + MSE append is essentially
free compared to the network. With these plugins we add a real
client-side cost: WASM HEVC decode + WebCodecs H.264 encode. A variant
can be perfectly reachable from a bandwidth standpoint and still saturate
the device's transcode budget, draining the buffer without the ABR
algorithm ever noticing.

This release adds a player-agnostic decider in `@hevcjs/core`
(`ComputeAwareDecider`) plus a perf bus (`subscribeSegmentStat`) the
transcoder publishes to after each segment. Both plugins ship an adapter
that subscribes to the bus and narrows the variants the host ABR is
allowed to choose from — via Shaka's
`player.configure({ abr: { restrictions } })` and dash.js's
`player.updateSettings({ streaming: { abr: { maxBitrate } } })`. The
host ABR controller is never replaced.

Usage (Shaka — needs an extra `attachComputeAware(player)` because the
player doesn't exist at registration time):

```js
// On by default.
const handle = registerHevcTransmuxer(shaka, { wasmUrl, workerUrl });
const player = new shaka.Player();
handle.attachComputeAware(player);
// To tune: { adaptiveCompute: { targetSpeedX: 1.5, lowerAfter: 1 } }
// To opt out: { adaptiveCompute: false }
```

Usage (dash.js — wires directly, the player is already available):

```js
// On by default.
await attachHevcSupport(player, { wasmUrl, workerUrl });
// To tune:    { adaptiveCompute: { targetSpeedX: 1.5 } }
// To opt out: { adaptiveCompute: false }
```

The Shaka handle remains callable for backwards compatibility
(`handle()` still unregisters the transmuxer), with `unregister()` /
`attachComputeAware(player)` exposed as methods on the same handle.

Both plugins now also re-export `subscribeSegmentStat` and
`SegmentPerfStat` from `@hevcjs/core` so consumers can plug their own
telemetry on the perf bus without a separate `@hevcjs/core` dependency.

Closes #127.
