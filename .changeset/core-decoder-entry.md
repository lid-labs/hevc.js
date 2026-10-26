---
"@hevcjs/core": minor
"@hevcjs/mediabunny-plugin": patch
---

`@hevcjs/core/decoder`: a decoder-only entry point (`HEVCDecoder` and its types) that does not pull mp4box into the app's bundle. `@hevcjs/mediabunny-plugin` imports from it, which brings an app bundle that only registers the plugin from 150 KB down to 8.4 KB minified.
