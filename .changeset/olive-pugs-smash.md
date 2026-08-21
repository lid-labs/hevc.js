---
"@hevcjs/hlsjs-plugin": patch
---

Fix the documented hls.js setup breaking playback on iPhone Safari.

The README, the site docs and the demo all recommended constructing hls.js with
an unconditional `preferManagedMediaSource: false`. That is right wherever
classic `MediaSource` exists, but iPhone Safari exposes only
`ManagedMediaSource`: pinning classic MSE there leaves hls.js with no
MediaSource at all and playback fails outright, in every mode — not just when
transcoding is forced. dash.js and Shaka were unaffected because nothing told
them to avoid `ManagedMediaSource`.

The snippet is now guarded:

```js
const hls = new Hls({
  ...(typeof MediaSource !== 'undefined' ? { preferManagedMediaSource: false } : {}),
});
```

The claim that "browsers where only ManagedMediaSource exists play HEVC
natively, so nothing is lost there" was wrong as written: that holds only if
hls.js is left on its default. The plugin's own warning now prints the guarded
snippet instead of advice that invites the mistake.

Transcoding still does not run on iPhone Safari — the intercept patches classic
`MediaSource`, which is absent there — but playback now falls back to native
HEVC decoding instead of failing.
