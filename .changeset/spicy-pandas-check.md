---
"@hevcjs/core": patch
---

Harden SPS, PPS and slice header parsing against malicious bitstreams: validate picture dimensions against H.265 level 6.2 limits (§A.4.1), block sizes, bit depths, parameter set ids, reference picture set counts and indices, ref list sizes and entry point counts (§7.4.3.2.1, §7.4.3.3.1, §7.4.7.1, §7.4.8) before any allocation, array write or index. Prevents integer overflows in grid allocations, out-of-bounds reads/writes during parse, and attacker-controlled oversized allocations. Rejections are now logged under the PARSE debug category.
