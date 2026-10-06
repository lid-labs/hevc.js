# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **`@hevcjs/shaka-plugin`: `recommendedPlayerConfig()`** (`buffer-config.ts`, `compute-aware.ts`): the buffer depth `recommendedBufferConfig()` already carried, plus `abr.switchInterval: 2`. Shaka honours the compute-aware cap's `abr.restrictions` at its next ABR decision and declines to take one inside `switchInterval`, 8s by default — so a cap that fired on time sat unapplied for several segments, each transcoded at the resolution the cap had just rejected. Measured against one deployment at ~0.4x transcode, six runs per setting: the played variant obeyed the cap after 9.3-9.9s at the 8s default, against 3.3-6.9s at 2s, with no overlap. What remains at 2s is the rate segments arrive at (~5s for 2s of media at 0.4x), a floor set by decode throughput rather than by this setting — so going lower buys nothing. The plugin does not apply the value itself: `switchInterval` governs network-driven ABR as well as the cap, so it stays the application's call, and `attachComputeAware` only sets it when passed the option. `recommendedBufferConfig()` is deprecated in favour of the new function and otherwise unchanged, so existing callers keep exactly what they had; `demo/shaka.html` now applies `recommendedPlayerConfig()`. The e2e case (`tests/e2e/switch-latency.spec.ts`) asserts the setting rather than a latency budget: one that told the two regimes apart would have to sit between 6.9s and 9.3s, and the residual latency moves with the machine — the same GitHub runner measured 16.7s — so on a slower machine such a budget would fail a correct implementation. It reports the measurement instead, and against the local demo server that measurement is not comparable at all (24-28s at the same 8s setting), since a local server hands over a whole segment at once while Shaka's ABR decisions come from progress events.
- **E2E measurement of the compute-aware cap on the Shaka path** (`tests/e2e/compute-cap.spec.ts`, `tests/e2e/helpers.ts`): the cap's unit tests feed the decider a slow `speedX` and check `abr.restrictions`; what they cannot show is whether the real loop reacts — real Shaka ABR, real WASM decode, real encoder, real MSE buffer — which is what #126 asks and what needs hardware transcoding below real time. CDP supplies it: `Emulation.setCPUThrottlingRate` slows the CPU-bound decode while hardware WebCodecs encoding stays put, the same imbalance as the reported machine. It throttles the renderer and not dedicated workers, so the throttled run takes `?workerUrl=off` — measured, 6x leaves the off-main-thread transcode at 1.4-4.0x. Reading on this repo's reference Mac: 1.85-1.99x unthrottled with the cap never engaging; at 6x, `speedX` 0.37-0.43 drops the cap 1080p → 720p → 480p within three observations. Where it lands from there depends on machine load, and both outcomes were observed across runs: either transcode clears real time again (`speedX` back to ~1.55x, playback advancing, cap raising to 720p six observations later), or it stays under it even at the bottom rung (down to 0.26x, playback stalled) — which is the throughput problem tracked in #232, not a cap that failed, so the test then requires only that the cap went all the way down. Shaka's own switch latency is visible in the series: the restriction lands on `abr.restrictions` several segments before the active variant follows. A cap drop is required only when a slow observation had a rung to spare — measured on a GitHub runner where network ABR had settled on the bottom rung, ten observations ran under 1.0x with `cap: none`, which is the decider working as designed (it only ever subtracts from the variant the player is on) and not a cap that failed. The test asserts only what it measured — no `avg speedX` below 1.0 and it skips, printing the series, rather than passing vacuously — and `E2E_CPU_THROTTLE` raises the rate on faster hardware. The ladder top is taken as the widest ladder seen across the run, since `getVariantTracks()` hides the variants the cap has already restricted.
- **E2E in CI against the PR preview** (`preview.yml`): a job runs the Playwright suite against the deployed preview once it is up, uploading the HTML report. Non-blocking to start with — the suite has never run in CI, so its stability and duration are unmeasured. The preview job now exposes its URL as a job output. Four cases skip on that target: the cross-origin test needs the local server bound to `0.0.0.0`, the three `hls-native` cases need a branded Chrome.
- **`@hevcjs/shaka-plugin`: `recommendedBufferConfig()`**: buffer settings for HEVC playback through the transmuxer (`bufferingGoal` 30s, against Shaka's default of 10; `rebufferingGoal` is deliberately left alone, since raising it gates playback on buffer depth and turns a stutter into a longer stall). Shaka's `transmux()` hands MSE one segment at a time, so the buffered range grows in jumps; where transcoding runs near real time the playback head rides its edge and stutters. Applied by `demo/shaka.html`, documented under "Performance & tuning" in the plugin README.
- **`@hevcjs/hlsjs-plugin`**: hls.js plugin for HEVC playback via the shared MSE intercept. `attachHevcSupport(config)` — no player instance needed; supports fMP4 HLS with video-only or demuxed-audio renditions (master playlists + audio group validated end-to-end). Muxed A/V segments play video-only for now.
- **Core `strictAppendProgress` intercept option**: updateend for a media append only fires once that segment's first transcoded chunk reached the SourceBuffer — satisfies hls.js's `bufferAppendNoProgress` watchdog. Off by default (dash.js/Shaka unchanged).
- **Core: `SourceBuffer.changeType()` patched**: HEVC mimes map to their H.264 equivalent on codec switches.
- **HLS demo page** (`demo/hls.html`) with the same four presets as the DASH demo (BBB 30s ABR + three test patterns), repackaged from the DASH streams by `tools/gen_hls_streams.sh` (`-c copy`, CODECS attribute injected from the DASH manifest, hvc1 tagging). E2E spec `tests/e2e/hls.spec.ts`.

### Changed
- **CI reports which streams a decoder change moves** (`.github/workflows/build.yml`, `scripts/decoder-output-diff.sh`): the oracle suite proves the decoder matches a stored reference, which is a different question from whether a change leaves the output alone — a PR that changes decoding and updates the reference data in the same commit keeps the oracle green while the picture moves, and the three demo streams have no oracle reference at all, so a regression visible only at 1080p or 4K passed unnoticed. A job now builds the decoder at the merge base and at the head, decodes the conformance fixtures and the demo streams with both, and writes the streams that differ to the job summary. What that covers differs locally and in CI, and the report says so rather than leaving it to be inferred: `.gitignore` excludes `*.265` apart from the conformance fixtures, so a CI checkout holds 18 of the 21 streams a local run sees — `bbb4k_singleslice.265`, `bbb720_singleslice.265` and `full_qcif_10f.265` are produced locally and never committed. The 4K regression #257 worried about therefore stays uncovered in CI until those streams are committed or generated there; a run now names them as missing instead of quietly comparing fewer streams than it claims, with a one-line `::notice` in the Checks tab. It never goes red because the output moved — that is what a decoding fix does, and a job red on every legitimate correction is trained away — but it does go red when nothing could be compared at all, since a report of zero streams would otherwise read like a pass. A stream that fails to decode at both ends is listed apart rather than counted as unchanged. The useful reading is the count — run locally against this session's §8.1 work, 1 of 21 streams moved, and it was the fixture that fix targeted. The base decoder is built in a `git worktree` rather than a second checkout, so the streams fed to both binaries are the ones at the head and a fixture added by the PR is still compared. No merge-base build cache, contrary to what #257 suggested: a native build measures under a minute on the runner, less than the complexity of avoiding it. The comparison lives in a script rather than inline YAML so it can be run locally — `scripts/decoder-output-diff.sh <base-decoder> <head-decoder> [stream…]`. The job summary carries it instead of a PR comment: commenting needs `pull-requests: write`, which the token of a fork PR does not have, and the workarounds are `pull_request_target` or a second `workflow_run` workflow.
- **A stale decoder is reported instead of noticed months later** (`.github/workflows/build.yml`, `CONTRIBUTING.md`): `packages/core/wasm/hevc-decode.wasm` is committed, but nothing kept it current — `release.yml` rebuilds before publishing and never commits the result back, so the copy in the repo stayed at whatever a contributor last happened to commit. It is what a reader consults to know what the shipped decoder contains, and it gave the wrong answer for months (1.4.1 went out with a decoder built in April). The existing `build-wasm` job now compares its own output against both committed copies — the one the package ships and the one `pnpm dev:lan` serves as is — so no second build and no extra CI minute. It only warns for now: two container builds on the same machine give byte-identical output, but whether this runner's native Emscripten 6.0.8 agrees with a container on another host is what these first runs are there to establish — a red result would mean the binary should be gitignored instead, which is the alternative #254 weighed. `CONTRIBUTING.md` now states the expectation, which it never did.
- **`site/wasm/` is gone, and with it the URL serving a six-month-old decoder** (`site/wasm/`, `.gitignore`): the directory held a third copy of the decoder dated 12 April that no script and no CI job regenerated, and that `pages.yml` published at the site root through `cp -r site/*`. `https://hevcjs.dev/wasm/hevc-decode.wasm` answered 200 with those 279,844 bytes — a decoder missing every fix since, including the reference-list guards of 1.4.4 and the forged-SPS overrun. Nothing in the tree referenced it, and nothing links to it as far as is known, so both files are removed and that URL now 404s. The `site/wasm/*.map` rule in `.gitignore` went with them.
- **The LAN dev server picks a derived port instead of 8443** (`pnpm dev:lan`). `scripts/dev-port.mjs` derives it from the repo, the worktree and the role, in the 20000-29999 range: stable across restarts, distinct per worktree, so two worktrees can serve the demo side by side. The port is printed on startup, and `PORT=9000 pnpm dev:lan` still forces one. An occupied port already failed — `dev-lan-serve.mjs` listens without a fallback — but it now fails *before* the certificate and LAN-address work, with a message naming the port.
  - The script comes from the `/mdma-dev-config` skill and is installed identically in every repo. **Do not edit it here** — a local fix would make it diverge.
  - `pnpm dev` is unaffected: it only runs `tsup --watch` in each package, with no server and no port.
  - The e2e server keeps port 8090 (`tests/e2e/target.ts`): test ports stay fixed so CI is untouched.
  - `.super.engineering/config.json` declares the setup (`pnpm install --frozen-lockfile`) and the `dev` / `dev:lan` entries, so a fresh worktree installs itself.
- **The committed demo bundles catch up with the sources** (`demo/dash-bundle.js`, `demo/hls-bundle.js`, `demo/shaka-bundle.js`, `demo/transcode-worker.js`): they are esbuild output committed to the repo and served by GitHub Pages, and they had not been regenerated since 2026-08-13, while 26 commits touched `packages/` after that. Regenerating them for the encoder fix below therefore also ships everything in between to the public demo — two-track muxed A/V, the bounded decoder memory work, the reorder-buffer fix at segment boundaries, the hls.js `preferManagedMediaSource` guard. Worth knowing before reading the bundle diff, which is far larger than the source change that prompted it.
- **The demo pages state the resolution actually on screen** (`demo/demo-utils.js`, `demo/dash.html`, `demo/hls.html`, `demo/shaka.html`): a new `on screen: WxH` readout, driven by the video element's `resize` event. The other readouts name the variant the player decided to fetch, which is a request, not a picture — the two were a rendition apart for whole streams under the bug above and nothing on the page said so. On `hls.html` the existing `quality: WxH` readout is renamed `source:`, which is what it always was: the dimensions of the segment being transcoded, read from the perf bus.
- **The e2e suite targets the branch, not production** (`playwright.config.ts`, `tests/e2e/target.ts`, `tests/e2e/helpers.ts`, `package.json`): `pnpm test:e2e` defaulted to `https://hevcjs.dev/demo`, so the command CONTRIBUTING and CLAUDE.md tell contributors to run before merging exercised code already on `main` — a green suite proving nothing about the change. The target is now `E2E_BASE_URL`, defaulting to the local demo, and `test:e2e` builds the WASM and demo bundles first, since a stale local decoder yields the same false green. `test:e2e:prod` keeps the old target under a name that says so; `test:e2e:fast` skips the rebuild; `test:e2e:bs` names the production target explicitly, since the BrowserStack matrix reaches localhost only through the tunnel `tools/run-e2e-bs-local.sh` starts. `helpers.ts` resolved the base URL a second time in its own hardcoded ternary — reachable by all six specs, so changing only the config would have left every test on production. Replaced by relative navigation against Playwright's `baseURL`, which is normalised with a trailing slash: `new URL()` resolution drops the last path segment without it.
- **`pnpm build:wasm` picks its own toolchain** (`scripts/build-wasm.sh`): a local Emscripten SDK when `emcmake` is on the PATH, otherwise the `emscripten/emsdk:6.0.8` container CI pins, `WASM_BUILDER=docker` forcing the latter. The container recipe was documented in both README and CONTRIBUTING but wired into no script, so `build:wasm` failed outright without a local SDK — which is what made a local-by-default e2e run impractical. Switching route invalidates the CMake cache, so the script stamps `build-wasm/` with the builder that produced it and reconfigures when it changes.
- **hls.js demo GIF in both READMEs**: a 6s capture of `demo/hls.html` with forced transcoding on, showing playback and the per-segment speed readout, placed under the `hls.js` setup section. `docs/assets/hlsjs-demo.gif`, cropped to the page (the capture was pillarboxed with ~297px of black each side), 706x720 at 25fps, 4.0 MB — same treatment as the dash.js GIF, 1.6 MB lighter.
- **Documented WASM size**: 261 KB → 262 KB. The shipped `hevc-decode.wasm` is 267,853 bytes, which the old figure rounded down rather than to the nearest. The gzip-compressed size is now stated alongside it — ~97 KB (98,922 bytes), which is what a browser downloads wherever the server serves the `.wasm` compressed. Applied to both READMEs, `@hevcjs/core`'s README and the comparison page.

### Fixed
- **A stream starting before its IRAP still showed that IRAP's RASL pictures** (`dpb.h`, `dpb.cpp`): §8.1 gives `NoRaslOutputFlag = 1` to an IRAP that opens decoding, and `first_picture_` was standing in for that condition — but it falls on the first picture of any kind and stays down, so a segment not aligned on an IRAP (what a seek can produce) reached its IRAP with the flag already spent, and emitted a RASL set whose references were never decoded. A dedicated flag now says what it means: no IRAP has opened a coded video sequence yet, so the next one does. `first_picture_` is gone, since replacing its only reader left it written and never read. Measured on the open-GOP fixture cut at its first RASL picture: 4 frames out, pixel-identical to ffmpeg, against 7 before this change and 10 before the §8.1 override itself. Aligned segments are unaffected — a stream opening on an IRAP already took this path. The same branch also made a latent conformance gap reachable, fixed here: `derive_rps` derived `NoRaslOutputFlag` a second time without the opening-IRAP case, so §8.3.2's marking loop did not run for it. That was harmless only while such an IRAP was necessarily the first picture, with an empty DPB; a stream opening before its IRAP reaches it with those earlier pictures stored and marked as short-term references, which the IRAP is required to unmark. It now reads the value `derive_poc` stored for the same picture, which removes the third copy of that derivation. No output changes on the streams at hand, so it is conformance rather than a visible fix. The clause's two other cases stay out of reach and are tracked in #277: an end-of-sequence NAL never arrives at the DPB, which turns out to be a wider question than propagating a flag (nothing increments `cvs_id_` for a CRA that opens a sequence, and `DisplayPtsAssigner` orders by `(cvs_id, poc)`), and `HandleCraAsBlaFlag` has no way into the API at all.
- **RASL pictures that cannot be reconstructed were output** (`decoder.cpp`, `dpb.cpp`, `dpb.h`): §8.1 ends the derivation of `PicOutputFlag` with an override the decoder never applied — a RASL picture whose associated IRAP has `NoRaslOutputFlag = 1` is set to 0, because it references pictures preceding that IRAP in decode order, which were never decoded. It was decoded against whatever the DPB held, concealed to neutral grey by the missing-reference path added in 1.4.5, and muxed like any other frame. `is_rasl()` existed in `src/common/types.h` with no call site anywhere in the tree, which was the shape of the gap. `derive_poc` already derived `NoRaslOutputFlag`, including the first-picture case, but dropped it on the floor; the DPB now keeps the flag of the IRAP in effect for the RASL pictures that follow, and `PicOutputFlag` is derived once rather than read from the slice header at both the output marking and the suppression report — reading it twice would let a picture be held back without being reported, which shifts the timestamps of every later frame of the segment. Reachable wherever a segment opens on a CRA with RASL pictures, a plain open GOP: the transcoder starts a decoder mid-stream on every segment, so at startup and after every seek. Measured on the new fixture that opens on its CRA: 7 frames out against the 4 ffmpeg outputs, now 4 with a pixel-identical MD5. A RASL picture decoded before any IRAP is suppressed too — with none decoded there are no references at all, which is what a segment not aligned on an IRAP produces; that cut goes from 10 frames to 7, where ffmpeg outputs 4. The remaining three belong to the CRA further down, the first IRAP of the stream but no longer its first picture, so it still takes `NoRaslOutputFlag = 0` — that turns on the meaning of `first_picture_` rather than on this clause, and is tracked in #273. Covered by `tests/unit/test_rasl_output.cpp` (6 cases) and two oracle cases; the suite carried no RASL picture at all before (`tools/gen_open_gop_fixtures.sh`, two fixtures, documented in `tests/conformance/fixtures/README.md`).
- **An ABR up-switch never reached the screen on dash.js and hls.js** (`segment-transcoder.ts`): `processInitSegment` overwrote `_width`/`_height` with the new variant's dimensions but left the encoder configured for the previous one, so `_prepareEncoder` compared the incoming frames against the dimensions it had just been handed, saw no change, and kept encoding 1080p frames at the 480p size. Measured on the ABR demo preset before the fix: the player switched to 1080p at t≈2s and `videoHeight` was still 480 when the 30s stream ended, on both pages. `prepareInit` — Shaka's path — already reset itself, which is why only the MSE-intercept players were affected. The parameter sets carried by the new init segment are re-armed too: `_paramSetsFed` stayed true, so the new stream's VPS/SPS/PPS were dropped as already fed. Covered by `tests/e2e/demo-quality-readout.spec.ts`, which fails on the previous code.
- **`pic_output_flag` was ignored, so a picture the bitstream marks as not for output was emitted anyway** (`decoder.cpp`, `segment-transcoder.ts`): `decoder.cpp` read `PicOutputFlag` from the slice header when allocating the picture, then overwrote it with `true` after decoding, and `output_pictures()` returned every picture the DPB held. §C.3.1 has such a picture decoded — it may serve as a reference — but never output; emitting it also held its storage buffer for a bump that would otherwise never come. The override was there because dropping it breaks the transcoder's timestamp mapping: `segment-transcoder.ts` gives the i-th drained frame the i-th smallest sample PTS, which holds only while output frames and demuxed samples map 1:1, so a single skipped picture shifted every later frame of the segment onto the wrong timestamp and moved the muxed base time with it. The decoder now reports each suppressed picture as `(cvs_id, poc)` (`hevc_decoder_get_suppressed_picture_count` / `hevc_decoder_take_suppressed_pictures`, `HEVCDecoder.takeSuppressedPictures()`), and both transcoder paths assign timestamps through `DisplayPtsAssigner`, which consumes the slot of a suppressed picture instead of handing it to the next frame; durations span the resulting hole and the muxed base time follows the first frame actually output. The pair rather than the POC alone, because POC restarts at every IRAP: across a CVS boundary, POC alone would order a picture of the new sequence before the pictures of the previous one still pending output. `HEVCFrame` carries `cvs_id` for the same reason. Reachable only on streams whose PPS sets `output_flag_present_flag` — x265 does not, which is why no fixture caught this; the tests patch one that does.
- **A suppressed picture at the end of a segment left the frame before it a frame short** (`segment-transcoder.ts`): that frame kept its own slot's duration, so the muxed segment came up a frame short while the next segment's `tfdt` still starts a full segment later — the timeline gained a hole at the join. Both transcoder paths now close the last frame on the end of the segment, one slot past the last sample, through a shared `closeDuration()` that also covers the batch-boundary and inter-frame cases. A frame extrapolated past the sample list has no successor and keeps its nominal duration.
- **A picture suppressed exactly on a streaming batch boundary left the preceding frame a slot short** (`segment-transcoder.ts`): the last frame of a full batch fell back to its slot's nominal duration because the frame after it was not decoded yet — the same hole as above, at slot 30, 60, and so on. A batch is now held back until one frame past it is available, which costs one frame of latency and keeps the memory bound. The `DisplayPtsAssigner` docstring is narrowed to what the DPB guarantees: the reorder bound counts pictures pending output, so a bitstream may decode a suppressed picture whose POC falls inside a range already emitted; the frame timed too early keeps the slot, and the report still lands before any later frame is timed, so the error stops there rather than accumulating.
- **`TranscodePipeline` never drained the suppressed-picture list** (`transcode-pipeline.ts`, `segment-transcoder.ts`, `decoder.h`): it times frames off its own clock rather than off the sample PTS, so a suppressed picture costs it nothing to re-map — but the list the decoder keeps for callers that do is only emptied by reading it. `_extrapolate()` also fabricated a timestamp in silence for a case the segment flush should rule out, whose symptom would be a drifting timeline pointing nowhere near there; it warns now. `decoder.h` still claimed `output_pictures()` returns every picture ever decoded, which stopped being true when it started skipping `PicOutputFlag = 0`.
- **An intra slice inherited the previous picture's reference lists** (`decoder.cpp`): `construct_ref_pic_lists` was called only for P and B slices, though it handles I slices by clearing the lists and returning. The lists are read unconditionally right after decoding, to store each picture's reference POCs for TMVP scaling — so on an IRAP they were read as the previous picture left them, while the IRAP had just unmarked every reference of the sequence that ended and `alloc_picture()` had evicted them. AddressSanitizer reports a heap-use-after-free on the first such picture. Reachable when inter pictures precede the IRAP of a second sequence — a segment spanning a mid-stream IDR; found while adding the two-sequence fixture for `pic_output_flag`.
- **A forged SPS could overrun the inter chroma prediction buffer** (`sps.cpp`): `chroma_format_idc` 2 (4:2:2) and 3 (4:4:4) were accepted, but `coding_tree.cpp` hands `perform_inter_prediction` an `int16_t[32*32]` sized for `SubWidthC == SubHeightC == 2`, while `nSamples` is `(cbSize/SubWidthC) * (cbSize/SubHeightC)` — 2048 at 4:2:2 and 4096 at 4:4:4 for a 64x64 CB, against a 1024-element buffer. Nothing else in the decoder rejected those formats, and the chroma deblocking path only ever covered 4:2:0. They are now rejected at SPS parse, which is what keeps the overrun unreachable; monochrome and 4:2:0 are unaffected.
- **`DeltaPocMsbCycleLt` was read as the raw syntax element** (`slice_header.cpp`, `dpb.cpp`): §7.4.7.1 accumulates it across each run of long-term entries — `delta_poc_msb_cycle_lt[i] + DeltaPocMsbCycleLt[i-1]` unless `i` starts a run — so from the second entry on, the derived POC was wrong, `find_by_poc` missed, and the reference was dropped. Latent while SPS long-term entries never reached the DPB at all.
- **`ref_pic_list0/1(idx)` bounded only from above** (`dpb.h`): `refIdx` defaults to −1 throughout the decoder, and the accessor is public, so a negative index read one element before the vector. No caller reached it, but the guard belongs in the accessor rather than in each of the fifteen call sites.
- **Inter prediction read uninitialised stack buffers when a reference was missing** (`interpolation.cpp`): `perform_inter_prediction` declares two 8 KB `int16_t` arrays and fills them only inside `if (refPic)`, but left `predFlagLX` set when the pointer was null — so `weighted_pred_default` / `weighted_pred_explicit` read every sample of a buffer nothing wrote. A null entry is not an error path: `dpb.cpp` pushes whatever `find_short_term_by_poc` returns, so any reference absent from the DPB leaves one, which is the normal situation when decoding starts mid-stream — exactly what the segment transcoder does on every segment. Output was undefined and not reproducible between runs. Missing references now clear the flag. A PU left with no reference at all returns neutral grey from an explicit early return, which also keeps it away from the weighted-prediction helpers — both treat "neither flag set" as their bi-prediction branch, so reaching them would have averaged two untouched buffers. The concealment is logged under the `INTER` category.
- **Long-term references signalled through the SPS were silently dropped** (`slice_header.cpp`, `dpb.cpp`): §7.4.7.1 derives `PocLsbLt[i]` and `UsedByCurrPicLt[i]` from `lt_ref_pic_poc_lsb_sps[]` and `used_by_curr_pic_lt_sps_flag[]` for the first `num_long_term_sps` entries, but the parser filled its arrays only in the branch for entries coded in the slice. The DPB read those arrays for every index, so an SPS-sourced reference was seen as POC LSB 0, not used by the current picture, and landed in `PocLtFoll` — never entering `RefPicSetLtCurr`, never reaching the reference lists. It also made `NumPicTotalCurr` disagree between parser and DPB, 1 against 0 on a conforming P slice whose only used references are SPS long-term ones; such a stream used to hang, and since the guards added in 1.4.4 decoded with empty reference lists instead.
- **A non-conforming bitstream could hang the decoder** (`slice_header.cpp`, `dpb.cpp`): §8.3.4's reference list construction looped forever when `NumPicTotalCurr` reached 0 on a P/B slice — none of the three inner loops runs, so `rIdx` never advances past a `NumRpsCurrTempList0` that is always at least 1. The loop allocates nothing, so no exception surfaced and the `catch (...)` handlers in `hevc_api.cpp` never saw it: the transcode worker pinned a core and stopped emitting frames. The same block also indexed `RefPicListTemp0` with an unchecked `list_entry_lX`, whose `Ceil(Log2(NumPicTotalCurr))` width can represent values past the end of the list, reading a `Picture*` out of bounds. Both are bitstream conformance requirements (§7.4.7.1, §7.4.7.2) that nothing enforced; the slice header parser now rejects them, and the DPB bounds its own indexing.
- **Decoder memory grew with segment length instead of staying bounded** (`segment-transcoder.ts`, `dpb.cpp`): both transcoder paths now drain after every feed rather than feeding a whole segment and draining once. A deferred drain retained one DPB picture per decoded frame (~24 MB each at 4K), overrunning the 2 GB WASM ceiling on a 2s 4K segment. `processMediaSegmentStreaming` also ships each batch as it is encoded, bounding the JS heap. Memory envelope documented in `docs/memory-envelope.md`.
- **Pictures emitted out of display order on streams with B-frames** (`dpb.cpp`): `DPB::drain` evaluated its §C.5.2.2 bumping conditions with the current picture included (the process runs before it is stored), and measured DPB fullness with `pictures_.size()`, which never shrinks because eviction is deferred to keep drained pointers valid — so once the condition held it drained the whole DPB in decode order. Latent while callers drained once per segment; load-bearing now that draining is per picture.
- **Transcoded segments land at the wrong position after an out-of-buffer seek** (`segment-transcoder.ts`): mp4box.js continues its pre-seek clock; samples are now rebased onto the segment's tfdt (structurally parsed moof→traf→tfdt, strict on ambiguity). Affects any player that repositions without `abort()` — hls.js ≥1.6.6 in particular.
- **`timestampOffset` seek heuristic** (`mse-intercept.ts`): flush only on a ≥0.5s jump with queued segments after a first init — no more pipeline resets on hls.js routine alignment writes or on playlists starting at `EXT-X-MEDIA-SEQUENCE > 0`.

## [1.1.0] - 2026-05-10

`@hevcjs/core@1.1.0` + `@hevcjs/dashjs-plugin@1.0.4`

### Added
- **`hevcMimeToH264Codec` helper** (`packages/core/src/codec-mapping.ts`): parses the HEVC level (`L<level*30>` field) from a mime/codec string and returns a matching H.264 codec string. Used by MSE intercept to advertise an `avc1.X` profile/level that fits the resolution implied by the input HEVC level, instead of always advertising High@5.1.
- **vitest setup for `packages/core`**: first JS/TS unit tests in the project (`codec-mapping.test.ts`, 14 cases covering boundary levels, hev1/hvc1/H prefixes, malformed input, dot-anchored regex). Added `pnpm test:unit` workspace script.
- **CI: JS unit tests** (`.github/workflows/test.yml`): new `js-unit-tests` job runs `pnpm test:unit` on every push and PR.

### Changed
- **MSE intercept advertises a dynamic H.264 codec** (`packages/core/src/mse-intercept.ts`): `isTypeSupported`, `decodingInfo`, and `addSourceBuffer` no longer hardcode `avc1.640033`. The advertised string is now derived from the incoming HEVC mime via `hevcMimeToH264Codec`. A 720p HEVC manifest now advertises `avc1.640028`, a 1080p manifest `avc1.64002a`, a 4K manifest `avc1.640033`. `@hevcjs/dashjs-plugin` benefits transparently — no code change in the plugin itself.

## Previously published (to be retro-attributed)

> Entries below were shipped in `@hevcjs/core@1.0.3`–`1.0.5` and `@hevcjs/dashjs-plugin@1.0.1`–`1.0.3` but never got their own git tag or GitHub release at the time. A follow-up housekeeping pass will redistribute them into proper versioned sections.

### Added
- **CDN-friendly asset loading** (`@hevcjs/core@1.0.5` + `@hevcjs/dashjs-plugin@1.0.3`): the plugin can now be loaded directly from a CDN (esm.sh, unpkg, jsDelivr) onto a page hosted on a different origin. Two related fixes:
  - `TranscodeWorkerClient` auto-fetches a cross-origin `workerUrl` and wraps it in a same-origin `blob:` URL (the `Worker` constructor refuses cross-origin scripts even with CORS).
  - `wasmBinaryUrl` is now plumbed through `MSEInterceptConfig` / `TranscodePipelineConfig` / `SegmentTranscoderConfig` and forwarded to Emscripten's `locateFile`, so the `.wasm` resolves correctly when the loader runs inside a `blob:` worker context. Same-origin callers are unaffected (additive option).
- **E2E cross-origin asset test** (`tests/e2e/dash.spec.ts`): page on `localhost:8090`, worker + wasm fetched from `127.0.0.1:8090`. Local Python test server now sends permissive CORS headers (`tests/cors-server.py`).
- **Demo URL parameter overrides** (`demo/dash.html`): `?workerUrl=`, `?wasmUrl=`, `?wasmBinaryUrl=` for testing alternate asset locations without rebuilding.


- **Security hardening CI**: CodeQL static analysis (C++ + JS/TS) on push/PR/weekly schedule, Dependabot for npm deps + GitHub Actions versions, `pnpm audit --prod` in test pipeline
- **SECURITY.md**: vulnerability reporting policy via GitHub Security Advisories
- **CI hardening**: all GitHub Actions pinned by SHA (supply chain protection), github-script injection fix (env vars instead of inline `${{ }}`), permissions scoped per-job
- **E2E bug fix validation tests** (Playwright + BrowserStack): tests couvrant gaps buffer, audio, seek DASH, détection HEVC natif. Validé sur Chrome/Edge Windows, Chrome/Safari macOS, Firefox (skip)
- **BrowserStack Local tunnel support**: `LOCAL_DEMO=1` pour tester contre localhost via tunnel. Script `tools/run-e2e-bs-local.sh`
- **E2E cross-browser tests** (Playwright + BrowserStack): tests DASH (page load, 720p/1080p/4K transcode pipeline) sur 5 browsers (Chrome/Edge/Firefox Windows, Chrome/Safari macOS). `pnpm test:e2e` (local) et `pnpm test:e2e:bs` (BrowserStack)
- **Native HEVC detection**: le plugin dashjs détecte si le browser supporte HEVC nativement via `MediaSource.isTypeSupported` et skip le transcoding (Safari, Firefox). Option `forceTranscode: true` pour forcer

### Removed
- **`@hevcjs/hlsjs` plugin** : plugin hls.js abandonné — package, demo, tests E2E, streams HLS ABR, documentation supprimés
- **`@hevcjs/videojs` plugin** : plugin Video.js abandonné — package, demo, tests E2E, documentation supprimés
- **Tests E2E hls/videojs** : `hls.spec.ts`, `videojs.spec.ts`, `seek-long-stream.spec.ts` supprimés. Tests HLS retirés de `bugfix-validation.spec.ts`

### Fixed
- **E2E base URL** : l'URL distante GitHub Pages corrigée (`/hevc.js/demo/` au lieu de `/hevc.js/`)
- **Buffer gaps 78ms** (`segment-transcoder.ts`): auto-détection du fps depuis les durées des samples demuxés (24fps BBB au lieu du default 25fps). Timestamps calculés depuis les durées cumulées des samples source. Durées muxer prises directement des samples originaux (plus de double arrondi)
- **Audio SourceBuffer jamais créé** (`mse-intercept.ts`): backpressure `fakeUpdating` relâchée immédiatement quand la queue est peu remplie. dash.js peut créer le SB audio pendant que le transcoding vidéo tourne en arrière-plan
- **Artefacts ABR switch** (`segment-transcoder.ts`): l'encoder H.264 est recréé quand la résolution des frames change (ABR 480p→720p→1080p). Nouveau init segment H.264 généré et appendé au SourceBuffer
- **Race condition async VideoEncoder**: `attachHevcSupport` est maintenant async — vérifie le support H.264 encoding AVANT d'installer l'intercept MSE (évite crash `bufferAppendError` sur Firefox)
- **Capabilities filter dashjs**: dead code simplifié (retournait `true` dans les deux branches)

### Changed
- **Thread pool WPP parallel decode (Phase 9B)**: Persistent `ThreadPool` class with N worker threads (N = `hardware_concurrency`), job queue with mutex + condition variable. Replaces the V1 thread-per-row approach (which created/destroyed 34 `std::thread` per frame + spin-wait). Workers survive across frames, eliminating thread creation overhead. Per-row `std::condition_variable` replaces spin-wait with `__builtin_ia32_pause()`/`yield`, freeing CPU for actual decode work.
  - `src/common/thread_pool.h/.cpp` — generic thread pool (submit + wait_all)
  - `decode_wpp_parallel()` reintroduced in `coding_tree.cpp` with pool + condvar sync
  - Thread pool owned by `Decoder`, passed to `DecodingContext`, reused across all frames
  - **Results**: 1080p WPP 128 fps (+29% vs V1 99 fps), 4K WPP 31 fps (+15% vs V1 27 fps)
  - **Bug fixed**: deadlock due to `condition_variable::notify_all()` without holding mutex — signal lost between predicate check and sleep. Fix: store `completed_col` under `lock_guard` before notify.
  - 128/128 tests pixel-perfect

- **Single-thread performance optimizations (Phase 9C)**:
  - `derive_merge_mode`: replace `std::vector<MergeCandidate>` heap alloc with fixed `MergeCandidate[5]` array — called thousands of times per frame
  - Z-scan (Morton code): branchless 5-op bit interleave replaces 8-iteration loop in `is_pu_available`/`is_amvp_nb_available`
  - `apply_sao`: skip per-pixel `cu_at()` grid lookup when CTU has no PCM/bypass (99.9% of CTUs), pre-computed EO direction offsets, direct plane pointers
  - `apply_deblocking`: direct plane pointer access instead of `pic->sample()` per pixel
  - `decode_residual_coding`: scan tables returned by const pointer instead of copied to stack
  - Inter pred sample copy: row-based direct pointer writes instead of `pic->sample()` per pixel
  - **Results**: natif 1080p 63→77 fps (+22%), 4K 24→29 fps (+21%), WPP 99→164 fps (+66%)
  - **WASM Chrome**: 1080p ~60→~85 fps decode (+42%), 4K ~18 fps (CABAC-bound)

- **CABAC hot path optimizations (Phase 9D)**:
  - `trace_file()` calls guarded with `#ifdef HEVC_TRACE_CABAC` — eliminates dead code WASM JIT couldn't optimize
  - `BitstreamReader::read_bit_fast()` inline method replaces `read_bits_safe(1)` in renormalize/bypass
  - Batched renormalize: `__builtin_clz` + `read_bits_safe(shift)` replaces bit-by-bit loop
  - **WASM Chrome**: 1080p ~80→~85 fps (+6%)

- **Perf logging in transcode pipeline**: timing split demux/decode/encode per segment, logged from worker via postMessage. `SegmentTranscoder.lastPerfStats` exposes `{demuxMs, decodeMs, encodeMs, frames}`.

- **`copyPlane` optimization**: `HEAPU16.slice()` bulk copy when `stride === width` (always true) instead of row-by-row loop.

- **WASM ThreadPool guard**: skip thread creation under `__EMSCRIPTEN__` (no pthreads in WASM)
- **WASM benchmark script**: `tools/bench_wasm.mjs` for Node.js performance testing

### Fixed
- **SAO pre-scan `|| true` leftover**: `if (pcmFilterDisabled || true)` forced CTU grid scan for every CTU even when no PCM exists. Fixed to `if (pcmFilterDisabled || pps.transquant_bypass_enabled_flag)`. Natif +4% (77fps 1080p, 29fps 4K).

### Fixed
- **Merge candidate availability §6.4.2 + early part_mode**: `is_pu_available` applied z-scan (§6.4.1) before sameCb, violating §6.4.2. Additionally, `part_mode` was only written to CU grid after all PUs, so partition-specific merge exclusions (lines 279-288) used stale values. These correlated bugs masked each other — the z-scan rejection hid the stale `part_mode`. Fix: early `part_mode` write + sameCb-first check in `is_pu_available`. Fixes BBB 1080p frames 18+ (4677→0 diffs). **128/128 tests pixel-perfect.**
- **Scaling list pred_mode lookup (§8.6.3)**: `perform_dequant` used `cu_at(0,0)` instead of `cu_at(x0,y0)` to determine pred_mode for scaling list matrix selection. For intra CUs in inter frames, the inter matrix was used instead of intra, producing wrong dequant values (±1 residual error per affected pixel). Default 8x8 matrices differ significantly (intra[7][7]=115 vs inter[7][7]=91). Fixes BBB 1080p frames 2-17 (29→0 diffs).
- **AMVP prediction block availability (§6.4.2)**: `is_amvp_nb_available` used z-scan order (§6.4.1) for ALL neighbors, including those within the same coding block. Per §6.4.2, intra-CU neighbors are always available (no z-scan needed, except NxN partition exclusion). Additionally, `pred_mode` was only stored in the CU grid AFTER all PUs were processed, so the 2nd PU of a multi-PU CU saw the previous frame's `pred_mode` (INTRA) for same-CU neighbors, causing AMVP to fall back to zero-MV padding. Fixes BBB 1080p P/B frames (4517→0 Y diffs at frame 1).
- **WPP substream seek (§7.3.8.1)**: BitstreamReader was never repositioned at WPP row boundaries, causing crash (`read past end`) at CTU 899 on BBB 1080p. Now computes absolute RBSP positions from `entry_point_offset_minus1` and seeks to correct substream start.
- **EP byte accounting in entry_point_offsets (§7.4.7.1)**: entry_point_offsets count emulation prevention bytes, but substream positions were computed in RBSP space (EP bytes removed). Added `coded_to_rbsp_offset` conversion using tracked EP byte positions from `extract_rbsp`.
- **QP derivation uses QG coordinates (§8.6.1)**: `derive_qp_y` was using CU coordinates `(xCb, yCb)` for neighbor QP prediction instead of quantization group coordinates `(xQg, yQg)`. Caused systematic QP errors (+4 to -4) on streams with `cu_qp_delta_enabled_flag`.
- **WPP QpY_prev reset (§8.6.1)**: `qPY_PREV` was not reset to `SliceQpY` at the first quantization group of each CTB row when `entropy_coding_sync_enabled_flag` is set. Same reset added for tile boundaries.
- **QP derivation shortcut removed (§8.6.1)**: `derive_qp_y` incorrectly returned `QpY_prev` when `IsCuQpDeltaCoded` was false. The spec requires full neighbor-based `qPY_PRED` computation even with `CuQpDeltaVal=0`.
- **QpY_prev_qg tracking (§8.6.1)**: `qPY_PREV` was updated after every CU, but the spec defines it as the QP of the last CU in the *previous* QG. Introduced `QpY_prev_qg` saved at QG boundary start. Fixes catastrophic decode errors on `cu_qp_delta_enabled` streams (BBB 4K: 12M→<2K diffs/frame, all I-frames now pixel-perfect).
- **SAO cross-slice boundary (§8.7.3.2)**: SAO edge offset did not check `slice_loop_filter_across_slices_enabled_flag` before accessing neighbor samples in adjacent slices. Also added cross-tile boundary check. Fixes `conf_b_xslice_256` (pixel-perfect).

### Added
- **Web Worker transcoding**:
  - `SegmentTranscoder` runs in a dedicated Web Worker — main thread stays free for UI
  - `TranscodeWorkerClient` handles postMessage communication (init, initSegment, mediaSegment, abort)
  - Worker auto-reinitializes after seek/abort
  - `workerUrl` option in `attachHevcSupport()` enables Worker mode
  - Fallback to main-thread when `workerUrl` is not provided

- **`@hevcjs/dashjs-plugin` — dash.js HEVC plugin**:
  - `attachHevcSupport(player)` — one-line integration with dash.js
  - Transparent MSE interception: patches `MediaSource.isTypeSupported`, `addSourceBuffer`, `navigator.mediaCapabilities.decodingInfo`
  - Proxy SourceBuffer with proper `updating` state management — dash.js waits during transcoding, no segment flooding
  - Pipeline: HEVC fMP4 segment → mp4box.js demux → WASM decode → WebCodecs H.264 encode → fMP4 mux → MSE
  - VPS/SPS/PPS extraction from hvcC box in init segments
  - Audio passthrough (non-HEVC tracks untouched)
  - Demo page with dash.js playing HEVC DASH streams (1080p + 4K)

- **Shared modules extracted to `@hevcjs/core`**:
  - `FMP4Demuxer` (mp4box.js wrapper), `FMP4Muxer`, `H264Encoder`, `FrameRenderer`, `MSEController`
  - `TranscodePipeline` (HEVC→H.264 orchestration)
  - `installMSEIntercept` / `SegmentTranscoder` (used by dashjs plugin)
  - Dynamic H.264 codec level selection (High 4.0/4.2/5.1 based on resolution)
  - `HEVCDecoder.create()` supports global `HEVCDecoderModule` from script tag

- **hevc.js monorepo restructure**:
  - pnpm workspace with `packages/core/`, `packages/dashjs-plugin/`
  - npm subpath exports: `hevc.js`, `hevc.js/dashjs-plugin`
  - tsup build (ESM + .d.ts), TypeScript strict mode
  - esbuild demo bundling (`pnpm build:demo`)
  - C++ source and tests unchanged (128/128 tests pass)

- **Phase 7 — Main 10 Profile (10-bit 4:2:0)**:
  - 10-bit decoding pixel-perfect (I-frame + full pipeline I+P+B with deblock+SAO)
  - 2 new oracle tests: `oracle_i_64x64_10bit`, `oracle_full_qcif_10f_10bit`
  - `oracle_test.sh` now supports 10-bit output format via optional `PIX_FMT` parameter

- **Phase 9 — Performance optimizations**:
  - Interior PU interpolation: skip bounds checking for PUs not at picture edges (+32% native, 56→75 fps 1080p)
  - Stack-allocated interpolation buffers: eliminate heap allocations per PU
  - SAO early exit: skip full-picture copy when no CTU has SAO enabled
  - Fixed stray `fprintf` in `dpb.cpp` (debug output in release builds)

- **Phase 8 — WASM Integration**:
  - C API (`src/wasm/hevc_api.h/cpp`): `hevc_decoder_create/destroy/decode/get_frame/get_info`
  - Emscripten build: MODULARIZE, ALLOW_MEMORY_GROWTH, STACK_SIZE=1MB, EXPORTED_FUNCTIONS
  - JS wrapper (`src/wasm/hevc_decoder.js`): promise-based API with typed array frame extraction
  - Web Worker (`src/wasm/worker.js`): decode in background thread, transferable frame buffers
  - Demo HTML (`demo/index.html`): WebGL YUV→RGB renderer (BT.709), file input, play/pause/step, keyboard shortcuts
  - WASM pixel-perfect verified against native build (MD5 match on `i_64x64_qp22.265`)
  - .wasm size: 123KB

### Fixed
- **cu_skip_flag pred_mode not stored before decode_prediction_unit_inter** — skip CUs entered AMVP path (reading extra CABAC bin) instead of merge path because `pred_mode` was only stored in the CU grid AFTER the prediction unit decode. Latent bug masked in 8-bit tests by coincidental CABAC alignment; exposed by 10-bit bitstreams with different CABAC state.
- **Multi-frame YUV output ignored bit depth** — the multi-frame output path in `main.cpp` cast all samples to `uint8_t`, producing 8-bit files for 10-bit content. Single-frame path (`write_yuv`) was correct. Also fixed chroma crop assuming 4:2:0 (`/2` hardcoded instead of using `SubWidthC`/`SubHeightC`).

### Previously added
- **Phase 6 — Loop Filters** (11/14 tests pass, 3 failures are multi-slice limitation):
  - Deblocking filter (§8.7.2) — boundary strength derivation, strong/weak luma filter, chroma filter (Bs==2)
  - SAO filter (§8.7.3) — edge offset (4 EO classes), band offset (32 bands), CTU merge (left/up)
  - Per-TU cbf and edge flag storage for deblocking boundary detection
  - SAO parameter storage with derived SaoOffsetVal (§7.4.9.3)
  - **`oracle_full_qcif_10f` pixel-perfect — Main profile complet**

### Fixed
- Chroma deblocking skipped when luma decision dE==0 (luma `continue` also skipped chroma filtering)

### Previously added (Phase 5)
- **Phase 5 — Inter Prediction** (10/10 tests pass):
  - Explicit weighted sample prediction (§8.5.3.3.4.3) — `weighted_pred_flag` P-slices with per-ref luma/chroma weights and offsets
  - CVS-aware output frame ordering — `cvs_id` counter for multi-GOP bitstreams with POC wrap at IDR boundaries
  - `interSplitFlag` (§7.4.9.4) — forces transform tree split for non-2Nx2N inter CUs when `max_transform_hierarchy_depth_inter == 0`

### Fixed
- P-slices with `weighted_pred_flag=1` used default WP instead of explicit (caused luma mismatch cascading to B-frames)
- Multi-IDR bitstreams output frames interleaved across GOPs (POC-only sort mixed frames from different coded video sequences)
- Non-2Nx2N inter CUs (PART_2NxN, PART_Nx2N, AMP) read `split_transform_flag` from bitstream when it should be inferred as 1, corrupting subsequent CABAC state

### Previously added
- **Phase 3 — Parameter Sets & Slice Header parsing**:
  - `ProfileTierLevel` parsing (§7.3.3) — general + sub-layer profiles, constraint flags for all profile_idc branches
  - `VPS::parse()` (§7.3.2.1) — timing info, layer sets, sub-layer ordering
  - `SPS::parse()` + `SPS::derive()` (§7.3.2.2, §7.4.3.2.1) — chroma format, dimensions, conformance window, bit depth, quad-tree config, scaling list data with full fallback, short-term reference picture sets with inter-prediction, long-term ref pics, VUI skip
  - `PPS::parse()` + `PPS::derive_tile_scan()` (§7.3.2.3, §6.5.1) — tiles layout, CtbAddrRsToTs/TsToRs/TileId derivation, deblocking filter control
  - `SliceHeader::parse()` (§7.3.6) — POC, short-term/long-term RPS, ref pic list modification, pred_weight_table, SAO flags, deblocking overrides, entry point offsets, dependent slices
  - `ScalingListData` with default matrices (Tables 7-3 to 7-5) and copy/prediction mechanism
  - `ParameterSetManager` — VPS/SPS/PPS storage by ID (AD-003), activation via slice header
  - CLI `--dump-headers` — full parameter set and slice header inspection
  - 17 new unit tests covering parsers across toy (64x64), QCIF (176x144), 1080p, 4K, and conformance edge-case bitstreams

- **NalParser** (`src/bitstream/nal_parser.cpp`) — Annex B byte stream parsing:
  - Start code detection (3-byte `0x000001` and 4-byte `0x00000001`)
  - NAL unit header parsing (nal_unit_type, nuh_layer_id, nuh_temporal_id_plus1) with `forbidden_zero_bit` validation
  - RBSP extraction integrated into parsing pipeline
  - Access Unit boundary detection (§7.4.2.4.4) — groups NAL units into frames
  - `nal_type_name()` helper for human-readable NAL type names
- **CLI `--dump-nals`** — Lists all NAL units with offset, type, size, TemporalId + Access Unit grouping summary
- 22 new unit tests for NalParser (start codes, header parsing, EP removal, AU boundaries, Exp-Golomb edge cases)
- Integration test on real bitstream (`toy_qp30.265`)
- Project infrastructure: CMake build system, Google Test, CTest oracle tests
- BitstreamReader with bit-level reading, Exp-Golomb (ue/se), RBSP extraction
- `Picture::allocate()` and `Picture::write_yuv()` implementation (8-bit and 10-bit YUV output)
- `HEVC_LOG` debug logging infrastructure with 12 categories and runtime filtering via `HEVC_DEBUG_FILTER`
- Header interfaces for all phases: NalUnit, VPS, SPS, PPS, SliceHeader
- 10 oracle test fixtures (toy, conformance, real-world)
- Real-world test bitstreams: Big Buck Bunny 1080p (50 frames), 4K (25 frames)
- Oracle test scripts (oracle_test.sh, oracle_compare.py)
- CABAC reference data extraction script (`tools/extract_cabac_reference.py`)
- Toy bitstream generation script (`tools/gen_toy_bitstreams.sh`)
- Agent guide (`docs/agent-guide.md`) with phase-by-phase error catalog and debug workflow
- GitHub Actions CI (build native/WASM + unit tests + oracle tests)
- CLI with `-o` output flag (stub, exit code 2 = SKIP until decode pipeline implemented)

### Changed
- Renamed project from hevc-torture to hevc-decode
- **BitstreamReader**: replaced bit-by-bit loop with 64-bit cached read (O(1) per `read_bits()` call)
- **BitstreamReader**: `more_rbsp_data()` now O(1) — `find_last_one_bit` computed once at construction
- **Picture::write_yuv()**: 8-bit output writes per-line instead of per-byte

### Fixed
- **debug.h**: replaced GNU extension `##__VA_ARGS__` with standard `__VA_OPT__(,)` to fix `-Wpedantic` build error
- **DECISIONS.md**: corrected WASM default stack size (64KB, not 1MB)
