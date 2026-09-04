# Decoder memory envelope

How much memory a decode holds at once, and what the caller controls.

## Where the memory goes

The decoded picture buffer (DPB) owns one full-resolution YUV picture per
entry. Planes are stored 16 bits per sample regardless of the stream's bit
depth, so one 4:2:0 picture costs:

```
width * height * 2 * 1.5 bytes
```

| Resolution | Per picture |
|---|---|
| 720p | ~2.8 MB |
| 1080p | ~6.2 MB |
| 4K | ~24.9 MB |

The WASM build has a 2 GB address-space ceiling, so the picture count is what
decides whether a decode fits.

## What bounds the picture count

A picture's storage buffer is reclaimed once it is neither a reference nor
pending output. `DPB::alloc_picture` runs that reclamation before every new
picture — but "pending output" only clears when the caller **bumps the picture
out**, via `drain()` or `flush()`.

So the bound is set by the calling pattern, not by the decoder:

| Calling pattern | Pictures held | 4K, 50-frame segment |
|---|---|---|
| `feed()` … `feed()`, then one `drain()` | one per frame decoded | ~1.2 GB — overruns the ceiling |
| `feed()` / `drain()` interleaved | §A.4.1 DPB bound, ≤ 16 + current | ~420 MB, flat in segment length |
| `decode()` batch API | one per frame decoded | ~1.2 GB — by design, see below |

Both rows are covered by tests in `tests/unit/test_incremental.cpp`
(`HeldMemoryDoesNotGrowWithSequenceLength`, `DPBRetainsEveryPictureWhenDrainIsDeferred`).

## Guidance for callers

**Streaming — interleave.** Call `drain()` after every `feed()`. The JS
wrapper copies planes out of the WASM heap in `drain()`, so the returned
frames stay valid across later feeds; there is no reason to defer. Both
transcoder paths do this — `processMediaSegment` (muxed A/V) and
`processMediaSegmentStreaming` (video-only, which is what DASH and HLS
streams take) — and it is what makes 4K segment length independent of
memory.

Interleaving puts `DPB::drain` on the hot path for every picture rather than
once per segment, so its §C.5.2.2 conditions have to be right: they are
evaluated with the current picture excluded (§C.5.2.2 runs before it is
stored), and DPB fullness counts occupied storage buffers, which fall as
pictures are bumped. Getting either wrong emits pictures before their
lower-POC neighbours are decoded — the stream then plays out of order.
`InterleavedDrainMatchesBatchedOutputOrder` pins this against the batched
path on the B-frame fixtures.

**Batch — bounded input only.** `decode()` + `get_frame(i)` keeps every
picture alive until the caller has read them all; that is the API's contract,
not a leak. Its envelope is `frames * per-picture cost`, so feed it clips
whose frame count you control — roughly 80 frames at 4K, 320 at 1080p, before
the ceiling is in sight.

## Notes

- 16-bit planes at 8-bit depth double the per-picture cost. Storing 8-bit
  streams in 8-bit planes would halve every figure in the first table.
- The figures above cover picture storage only. Per-picture side buffers
  (CU info, motion vectors, SAO parameters) are reused across frames and do
  not scale with the DPB.
