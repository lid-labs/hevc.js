---
"@hevcjs/shaka-plugin": minor
---

Compute-aware ABR now shortens `abr.switchInterval` to 2s when it attaches, so a
cap change reaches the screen within about one segment instead of waiting out
Shaka's 8s default. Measured against one deployment on a device transcoding at
~0.4x, six runs per setting: the variant being played obeyed the cap after
9.3-9.9s at Shaka's default, against 3.3-6.9s at 2s. Every segment in between
was transcoded at the resolution the cap had already rejected. The value is only ever lowered, never
raised: a player already more reactive keeps its own. `switchInterval: null`
opts out, or pass your own number of seconds.
