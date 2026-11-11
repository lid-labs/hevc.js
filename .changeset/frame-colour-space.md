---
"@hevcjs/mediabunny-plugin": patch
---

Decoded frames carry the track's colour space, which Mediabunny reads from the container's `colr` box and the SPS. They used to take the `VideoFrame` default, BT.709 limited range, which washed out HLG and PQ video and clipped the shadows and highlights of full-range video.
