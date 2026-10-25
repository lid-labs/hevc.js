---
"@hevcjs/core": patch
---

Decoder: streams with tiles decode correctly. Each tile now starts at its entry point with freshly initialised CABAC contexts; before, a tiled stream could decode to wrong pictures from one tile on, or abort.
