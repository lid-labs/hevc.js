---
"@hevcjs/shaka-plugin": minor
---

Add `recommendedBufferConfig()`, buffer settings for HEVC playback through the transmuxer.

Shaka 4.x's `Transmuxer.transmux()` returns one `Uint8Array` per segment, so the buffered range grows in whole-segment jumps. Where WASM transcoding runs near real time, the playback head skirts the edge of that range and playback stutters in a few-second rhythm — contiguous buffer, nothing out of spec, but visible. The dash.js path does not show it, because it appends transcoded chunks to MSE progressively.

`player.configure(recommendedBufferConfig())` raises `bufferingGoal` to 30s, against Shaka's default of 10, so a slower-than-real-time stretch drains the buffer instead of stalling playback. It returns a config fragment rather than applying itself: the plugin is handed `shaka`, not the player, and silently rewriting a player's configuration would be a surprise.

`rebufferingGoal` is deliberately left alone. It decides whether Shaka gates playback on buffer depth at all, and defaults to 0 on Shaka 5 — the buffer poller never starts and the playback rate is never held back. Raising it would switch that on, so a device transcoding at around real time would freeze until the goal was re-accumulated: a longer stall than the stutter being fixed.

Headroom, not a cure — see the README's "Performance & tuning" section for what else helps when `speedX` stays below 1.
