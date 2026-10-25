---
"@hevcjs/core": patch
---

Decoder: streams with dependent slice segments, alone or combined with WPP, decode correctly. They used to decode to wrong pictures, abort, or hang.
