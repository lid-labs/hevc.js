---
"@hevcjs/core": patch
"@hevcjs/dashjs-plugin": patch
---

Fix iPhone Safari: detect native HEVC via ManagedMediaSource and stop crashing when classic MediaSource is absent

iPhone Safari only exposes `ManagedMediaSource` (iOS 17.1+). The dash.js plugin
misdetected "no native HEVC support" there, then threw an unhandled
`ReferenceError` inside `installMSEIntercept`, killing playback before
`player.initialize()`. Native HEVC detection now checks
`MediaSource ?? ManagedMediaSource` (new `getMediaSourceConstructor` export),
and `installMSEIntercept` safely no-ops with a warning when classic
`MediaSource` is unavailable.
