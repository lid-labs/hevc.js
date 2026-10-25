---
"@hevcjs/core": patch
---

Decoder: the reference picture lists and the collocated picture are built for each slice instead of once per picture from the first slice. Pictures whose slices use different lists, such as different numbers of active references or list modification, were predicted from the wrong reference pictures in every slice after the first.
