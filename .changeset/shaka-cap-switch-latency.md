---
"@hevcjs/shaka-plugin": minor
---

Compute-aware ABR now shortens `abr.switchInterval` to 2s when it attaches, so a
cap change reaches the screen within about one segment instead of waiting out
Shaka's 8s default. Measured against the published demo on a device transcoding
at ~0.4x, the cap previously took 2.9s and 10.4s on two runs to affect the
variant being played, and every segment in between was transcoded at the
resolution the cap had already rejected. The value is only ever lowered, never
raised: a player already more reactive keeps its own. `switchInterval: null`
opts out, or pass your own number of seconds.
