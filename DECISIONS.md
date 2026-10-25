# Architecture Decisions

New decisions are appended here. `docs/adr/001-initial-arch.md` is the initial
architecture document, dated 2026-03-19, and is not updated.

## AD-001 : Bit depth — Runtime, not templates

**Context**: The plan mentions "templates for the bit depth (8/10/16)". Two possible approaches:
- Template `<int BitDepth>`: compile-time specialisation, maximum performance, duplicated code
- Runtime `int bit_depth`: a single code path, simpler, runtime branching

**Decision**: Runtime, with `uint16_t` as the universal sample type.

**Rationale**:
- The Main profile (Phases 4-6) is 8-bit only. No need for templates before Phase 7
- `uint16_t` holds 8-bit and 10-bit with no overhead
- Performance will come from SIMD (Phase 9), not from templates
- Less code = fewer conformance bugs

**Consequence**: `Pixel = uint16_t` everywhere. Shifts/clips use `BitDepth` at runtime.

## AD-002 : Picture layout — Planar (separate planes)

**Decision**: 3 separate Y, Cb, Cr buffers with independent strides.

**Rationale**:
- The spec treats each component independently
- Deblocking and SAO operate plane by plane
- Chroma interpolation has different dimensions
- SIMD filters prefer data contiguous per plane

**Structure**:
```cpp
struct Picture {
    std::vector<uint16_t> planes[3];  // Y=0, Cb=1, Cr=2
    int width[3], height[3];           // per-plane dimensions
    int stride[3];                     // per-plane stride (in samples)
    int bit_depth;
    int chroma_format_idc;             // 1=420, 2=422, 3=444
    int poc;
};
```

## AD-003 : Parameter set ownership — Stored by value, indexed by ID

**Decision**: `std::array<std::optional<VPS>, 16>` for VPSs, the same for SPSs (16 max) and PPSs (64 max).

**Rationale**:
- The IDs are bounded by the spec (VPS: 0-15, SPS: 0-15, PPS: 0-63)
- No need for a dynamic map
- Full copy on every update (parameter sets are small)
- The slice header references the active PPS by ID

## AD-004 : Error handling — Assertions in debug, error codes in release

**Decision**:
- Debug: `assert()` + `HEVC_DEBUG` logging to trace intermediate values
- Release: functions return `bool` or `enum HEVCError`
- No C++ exceptions (required for the WASM C API)

## AD-005 : CABAC — Struct of arrays for the contexts

**Decision**: All contexts in a single flat array, indexed by global ctxIdx.

```cpp
struct CabacContext {
    uint8_t pStateIdx;
    uint8_t valMps;
};

struct CabacEngine {
    CabacContext contexts[256];  // all contexts
    uint16_t ivlCurrRange;
    uint16_t ivlOffset;
    BitstreamReader* bs;
};
```

**Rationale**:
- O(1) access by ctxIdx
- Simple init (a loop over the array)
- Save/restore for WPP in one memcpy

## AD-006 : Intermediate buffers — Stack-allocated, max CTU size

**Decision**: Temporary buffers (prediction, residual, transform) are allocated on the stack at the maximum CTU size (64x64).

```cpp
// In the CU decoding function:
int16_t pred_samples[64 * 64];
int16_t residual[64 * 64];
int32_t transform_buf[64 * 64];  // extended precision for the transform
```

**Rationale**:
- No dynamic allocation in the hot path
- 64*64*4 = 16KB per buffer, ~48KB total — acceptable on the stack
- WASM: the default Emscripten stack is ~64KB (the heap can grow, the stack cannot). Plan for `-sSTACK_SIZE=1048576` in Phase 8, or restructure to allocate the buffers at CTU level

## AD-007 : DPB — the caller sets the memory envelope; the decoder only frees on a bump

**Context**: A picture's storage buffer is reclaimed only once it is neither a
reference nor pending output. `drain()` does not evict: it returns raw
`Picture*` that must stay valid until the next `feed()`, so eviction is
deferred to `alloc_picture()`.

Consequence: a caller that chains `feed()` calls before draining retains one
picture per decoded frame (~24 MB at 4K), and the segment length it can handle
becomes bounded by the 2 GB WASM ceiling.

**Decision**: Do not make `drain()` evict, and require callers to interleave
`feed()` / `drain()`. The JS wrapper copies planes out of the WASM heap, so
draining early costs nothing.

**Rationale**:
- Evicting inside `drain()` would invalidate the pointers it just returned
- The batch API (`decode()` + `get_frame(i)`) needs the retention: that is its
  contract, not a leak
- Moving the decision to the caller keeps a single memory model for both

**Consequence**: `DPB::drain` is called once per picture rather than once per
segment, which puts its §C.5.2.2 conditions on the hot path. They must
therefore exclude the current picture (the process runs before it is stored)
and measure DPB fullness in occupied buffers — a count that falls as pictures
are bumped. With `pictures_.size()`, which never falls, the condition stays
true and drains the whole DPB in decode order.

Figures and guard rails: `docs/memory-envelope.md`.


## AD-008 : Bitstream conformance belongs to the parser, memory safety to the decoder

**Context**: §8.3.4's reference list construction trusted two conformance
requirements that nothing enforced — `NumPicTotalCurr != 0` on a P/B slice (§7.4.7.1)
and `list_entry_lX < NumPicTotalCurr` (§7.4.7.2). The first made a loop
non-terminating, the second read past the end of a vector.

**Decision**: Reject non-conforming streams in `SliceHeader::parse`, and keep a
local guard at the point of use in `DPB`.

**Rationale**:
- The parser already owns this role (`num_ref_idx > 14`, `slice_segment_address`,
  `lt_idx_sps`) and returning false there makes `decode_picture` fail before a
  picture is allocated, so no state has to be unwound
- The two are not duplicates: the parser decides whether a stream is admissible,
  the DPB makes an indexing operation safe whatever its input. `construct_ref_pic_lists`
  is public and its `NumPicTotalCurr` is re-derived from DPB state, not carried over
  from the parser — the two counts can disagree
- A guard at the point of use is testable directly; testing the parser path alone
  requires hand-building a bitstream

**Consequence**: A decoder-side guard firing means the two derivations diverged,
not that the stream is bad. One such divergence is known and tracked in #249:
long-term references declared in the SPS are never copied into the slice header,
so the DPB counts 0 where the parser counted 1.


## AD-009 : PicOutputFlag — the decoder reports the skip, the caller re-maps its timestamps

**Context**: §C.3.1 has a picture with `PicOutputFlag = 0` decoded, possibly
used as a reference, and never output. `segment-transcoder.ts` assigns
timestamps by output position: the i-th drained frame takes the i-th smallest
sample PTS. That mapping is only valid while output frames and demuxed samples
stand 1:1, so honouring the flag breaks it — which is why the flag was
overridden rather than honoured (#243, reverted out of #240).

Nothing else tells the caller a sample produced no frame. Frames carry their
POC, but a POC missing from the output is indistinguishable from one the DPB
has not bumped yet.

Three clauses suppress a picture, and all feed the mechanism below: §C.3.1 as
the slice header carries it; §8.1, which clears `PicOutputFlag` on a RASL
picture whose associated IRAP has `NoRaslOutputFlag = 1`; and §C.5.2.2, where
such an IRAP with `NoOutputOfPriorPicsFlag = 1` empties the pictures of the
previous sequence still pending output (#277).

**Decision**: The decoder reports each suppressed picture as `(cvs_id, poc)`
(`hevc_decoder_take_suppressed_pictures`), and the caller consumes the
matching timestamp slot itself (`DisplayPtsAssigner`).

**Rationale**:
- The decoder is the only component that knows a picture was suppressed; the
  timestamps are the caller's, from the container, and the decoder knows
  nothing of them
- Reporting the pictures rather than a count keeps the mapping usable on
  B-frame streams: a suppressed picture that displays *after* the frame being
  timed must not consume a slot ahead of it
- The pair, not the POC alone: POC restarts at every IRAP (§8.3.1), so across
  a CVS boundary it would place a picture of the new sequence before the
  pictures of the previous one still pending output. `DPB::bump` orders by the
  same pair, and `HEVCFrame` now carries `cvs_id` so the caller can too
- The alternative — having the decoder emit a placeholder frame — would put a
  picture that must not be displayed back on the encode path

**Consequence**: The report is only correct because bumping releases a picture
once no smaller POC can still arrive: every suppressed picture that displays
earlier has been decoded by then, so its slot can be consumed on the spot.
Callers that assign timestamps positionally must poll
`takeSuppressedPictures()` after every `feed()`; one that ignores it keeps the
pre-fix behaviour, off by one slot per suppressed picture — and leaves the
decoder's list growing, since reading it is what empties it.

## AD-010 : SIMD — GCC/clang vector extensions, not per-architecture intrinsics

**Context**: The speed campaign against ffmpeg's decoder (#232) needs SIMD in
the hot loops. The shipped decoder is the WASM build (emscripten, SIMD128);
the native build runs on arm64 (NEON) and on x86-64 (SSE2) in CI. ffmpeg
writes assembly per architecture; intrinsics would mean one implementation per
target, and WASM SIMD128 intrinsics share nothing with NEON or SSE ones.

**Decision**: SIMD code is written once with `__attribute__((vector_size))`
types and plain operators (`src/common/simd.h`), which GCC, clang and
emscripten lower to each target's instructions. A kernel keeps the exact
integer semantics of the scalar code it replaces: int32 lanes by default,
int16 lanes only where the sums are bounded to fit (8-bit samples).

**Rationale**:
- One source for the three targets, and the WASM build stays bit-exact with
  the native one (`scripts/wasm-native-diff.sh`)
- No `#ifdef` per architecture to keep in sync, and no dependency
- The compilers handle the widening multiplies well: on arm64 the 2D
  interpolation's vertical pass comes out as `smull`/`smlal`, the 8-bit
  horizontal pass as `mla.8h`

**Consequence**: Lane shuffles (`__builtin_shufflevector` in clang,
`__builtin_shuffle` in GCC) are spelled differently by the two compilers, so a
kernel that needs them, such as a transpose, has to wrap both. Where the
generated code falls short of hand-written assembly, the gap stays: closing it
would mean per-architecture code, which this decision rules out until a
measurement justifies it.
