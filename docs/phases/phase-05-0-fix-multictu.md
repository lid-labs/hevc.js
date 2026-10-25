# 5.0 — Fix multi-CTU I-frame CABAC context divergence

## Goal

Fix the bug that causes 21593 wrong pixels in the I frame (176x144, 9 CTUs) while the single-CTU (64x64) is pixel-perfect. This bug blocks ALL of Phase 5.

## Full diagnosis (session 2026-03-21)

### What works
- `oracle_i_64x64_qp22` (1 CTU): pixel-perfect
- 82 unit tests: PASS
- 12 audited spec sections: all conformant

### What fails
- Frame 0 of `p_qcif_10f.265`: 21593 wrong pixels, first at (160,0) in CTU 2

### Localization by bin-by-bin comparison with HM

- 18322 decision bins identical (val, range, offset)
- Divergence at decision bin 18323:
  - Ours ctx=90 (sig_coeff_flag luma ctxInc=8): pStateIdx=62 (saturated)
  - HM same logical context: pStateIdx≈31
- Cause: some bins are assigned to ctx=90 in our decoder but to ANOTHER context in HM. By coincidence, both contexts have the same state → identical r/o → invisible.

### What was verified and ruled out
- ctxIdxMap (Table 9-50): identical to libde265
- Scan tables (diag/horiz/vert): identical
- coded_sub_block_flag context (§9.3.4.2.4): identical
- coeff_abs_level_greater1 context (§9.3.4.2.6): identical
- cRiceParam derivation (§9.3.3.11): identical
- QP derivation, reference samples, MPM, chroma mode: all conformant

## Resolution plan — 6 steps

### Step 1 — Add the ctxIdx to the HM trace (20 min)

**Problem**: HM traces val/r/o but not the ctxIdx. The context assignments cannot be compared.

**File**: `/tmp/HM/source/Lib/TLibDecoder/TDecBinCoderCABAC.cpp`

The function `decodeBin(UInt& ruiBin, ContextModel &rcCtxModel)` receives a reference, not an index.

**Recommended approach** — compute the offset by memory address:

1. Find the base array of the contexts in HM:
```bash
grep -n "ContextModel\|m_contextModels\|NUM_CTX" \
  /tmp/HM/source/Lib/TLibDecoder/TDecSbac.h | head -30
```

2. If the contexts are in a contiguous `m_contextModels[N]` array, add in `TDecBinCoderCABAC.h`:
```cpp
void setContextBase(ContextModel* base) { m_ctxBase = base; }
ContextModel* m_ctxBase = nullptr;
```

3. Call `setContextBase` in `TDecSbac` after the init

4. In `decodeBin`, compute and trace:
```cpp
int ctxOff = (m_ctxBase) ? (int)(&rcCtxModel - m_ctxBase) : -1;
fprintf(stderr, "[HD] %d ctx=%d v=%d r=%d o=%d\n",
        hm_decision_seq, ctxOff, ruiBin, m_uiRange, m_uiValue >> 7);
```

**If the contexts are NOT contiguous** (separate ContextModel3DBuffers), use the alternative:
- Change the signature: `decodeBin(UInt& ruiBin, ContextModel &rcCtxModel, int ctxIdx = -1)`
- Pass the offset from each call in `TDecSbac.cpp` (~30 calls)
- Look for the pattern `m_pcTDecBinIf->decodeBin(uiBin, m_cXXXSCModel.get(...))`
- The offset is: constant of the syntax element + indices of the `.get(d, s, i)`

**Rebuild**:
```bash
cd /tmp/HM && make TAppDecoder-r 2>&1 | tail -5
# The Xcode binary: /tmp/HM/bin/xcode/clang-17.0/x86_64/release/TAppDecoder
```

### Step 2 — Generate the two traces (5 min)

```bash
# HM trace (100K decision bins are enough, the divergence is at bin 18323):
/tmp/HM/bin/xcode/clang-17.0/x86_64/release/TAppDecoder \
  -b tests/conformance/fixtures/p_qcif_10f.265 -o /dev/null \
  2>&1 | grep "^\[HD\]" > /tmp/hm_ctx_trace.txt

# Trace of our decoder:
cmake -B build -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-DCABAC_TRACE_BINS" .
cmake --build build -j8
perl -e 'alarm 120; exec @ARGV' ./build/hevc-decode \
  tests/conformance/fixtures/p_qcif_10f.265 -o /dev/null \
  2>&1 | grep "^DEC " > /tmp/our_ctx_trace.txt
```

Our trace has the format: `DEC <total_bin> ctx=<N> val=<V> r=<R> o=<O>`
The HM trace must have: `[HD] <dec_bin> ctx=<N> v=<V> r=<R> o=<O>`

**Note**: the bin counter differs (ours includes bypass+terminate, HM's only the decision bins). Use the LINE NUMBER as the comparison index, not the bin counter.

### Step 3 — Find the first ctxIdx divergence (5 min)

```bash
# Parse the two traces and compare the ctx
paste \
  <(awk '{gsub(/ctx=/,"",$3); print $3}' /tmp/hm_ctx_trace.txt) \
  <(awk '{gsub(/ctx=/,"",$3); print $3}' /tmp/our_ctx_trace.txt | head -100000) \
  | awk '{if ($1 != $2) {
      print "DIVERGE at decision bin " NR ": HM_ctx=" $1 " OUR_ctx=" $2
      exit
    }}'
```

**WARNING**: the two decoders may use different context numberings. HM's ctxIdx (global in `TDecSbac`) is NOT the same as our `CabacCtxOffset` enum. The two must be mapped.

**Mapping**: in HM, the contexts are defined in `TDecSbac.h` with offsets per syntax element. In our code, it is `CabacCtxOffset` in `cabac_tables.h`. Build a mapping between the two by comparing the first bins (which are identical) and noting which ctx is used for split_cu_flag, cbf_luma, sig_coeff_flag, etc.

Alternative: if the ctx do not match by number, compare the **(ctx, val) PAIRS** — two conformant decoders must use the same logical mapping even if the offsets differ. It is enough to check that the ctx of bin N in our trace corresponds to the SAME syntax element as the ctx of bin N in HM.

### Step 4 — Identify the faulty syntax element (10 min)

The divergent bin will say: "our ctx=X, HM ctx=Y". Look for which syntax element uses ctx=X in our code and which syntax element uses ctx=Y in HM. The possibilities:

| Hypothesis | How to check |
|-----------|-----------------|
| sig_coeff_flag with wrong ctxInc | Check eq 9-40..9-55 for the specific position (xC,yC) |
| cbf_luma/chroma with wrong trafoDepth | Check §7.3.8.8 parsing condition |
| split_transform_flag with wrong log2TrafoSize | Check the log2TrafoSize passed to the context |
| coded_sub_block_flag with wrong csbfCtx | Check the sub-block neighbours |
| Syntax element not parsed/parsed in excess | Compare the NUMBER of bins between two markers |

To identify the syntax element: add a log in our code that prints the syntax element name before each `decode_decision`:
```cpp
// In each decode_xxx function:
HEVC_LOG(CABAC, "SYN: split_cu_flag ctx=%d", ctxIdx);
```

### Step 5 — Fix the bug

The bug will typically be:
- An offset in the context enum
- An inverted or missing condition
- An incorrect parameter passed to a context derivation

**Put the reference in a comment** in the fixed code:
```cpp
// Fix: [description]. Ref: HM TDecSbac.cpp:XXX / libde265 slice.cc:XXX
```

### Step 6 — Validate and clean up (5 min)

```bash
# 1. Rebuild without trace
cmake -B build -DCMAKE_BUILD_TYPE=Debug -DCMAKE_CXX_FLAGS="" .
cmake --build build -j8

# 2. Unit tests
./build/hevc_tests  # 82+ tests must PASS

# 3. Single-CTU non-regression
./build/hevc-decode tests/conformance/fixtures/i_64x64_qp22.265 -o /tmp/test.yuv 2>/dev/null
md5 -q /tmp/test.yuv
# MUST be: 48c64cd2de381113913149e92065d66c

# 4. Multi-CTU I-frame (the real test)
./build/hevc-decode tests/conformance/fixtures/p_qcif_10f.265 -o /tmp/test_p.yuv 2>/dev/null
ffmpeg -y -i tests/conformance/fixtures/p_qcif_10f.265 -frames:v 1 -pix_fmt yuv420p /tmp/ref.yuv 2>/dev/null
head -c 38016 /tmp/test_p.yuv > /tmp/test_f0.yuv
python3 tools/oracle_compare.py /tmp/ref.yuv /tmp/test_f0.yuv 176 144
# GOAL: 0 pixels of difference

# 5. Commit
git add <modified files>
git commit -m "fix: [description of the bug] (§X.Y.Z)"

# 6. Update LEARNINGS.md and BACKLOG.md
```

## Key files

| File | Role |
|---------|------|
| `src/decoding/residual_coding.cpp:101` | `derive_sig_coeff_flag_ctx` — sig_coeff_flag context derivation |
| `src/decoding/residual_coding.cpp:175` | `decode_residual_coding` — main loop |
| `src/decoding/syntax_elements.cpp` | All the `decode_xxx` functions with context offset computation |
| `src/decoding/cabac_tables.h:108` | `CabacCtxOffset` enum — global offsets |
| `src/decoding/cabac.cpp:55` | `decode_decision` — CABAC trace (enabled by `CABAC_TRACE_BINS`) |
| `src/decoding/coding_tree.cpp:790` | `decode_transform_tree` — cbf parsing, split_transform |
| `/tmp/HM/source/Lib/TLibDecoder/TDecBinCoderCABAC.cpp:191` | HM trace (to be modified) |
| `/tmp/HM/source/Lib/TLibDecoder/TDecSbac.h` | HM context model declarations |
| `/tmp/libde265/libde265/slice.cc` | libde265 residual_coding (alternative reference) |

## Current state of HM

HM was already modified in a previous session:
- `/tmp/HM/source/Lib/TLibDecoder/TDecBinCoderCABAC.cpp`: `[HD]` trace with pS added
- The **umake** binary (`/tmp/HM/bin/umake/...`) is the OLD one (without pS)
- The **Xcode** binary (`/tmp/HM/bin/xcode/...`) is the NEW one (with pS)
- To rebuild: `cd /tmp/HM && make TAppDecoder-r`

## HM ↔ our code context mapping

HM uses separate `ContextModel3DBuffer`s per syntax element. Our code uses a global `CabacCtxOffset` enum. The two do NOT have the same indices.

To build the mapping, use the first (identical) bins of the trace:
- Bin 1 = `split_cu_flag`: our ctx=2 (`CTX_SPLIT_CU_FLAG`), note the HM ctx
- Follow the sequence of syntax elements for the first CUs: split_cu_flag → pred_mode (I-slice: not parsed) → part_mode → prev_intra_luma_pred_flag → ...
- Build a HM_ctx → syntax_element dictionary by reading `TDecSbac.cpp`

Alternatively, do NOT compare the ctx numerically but compare the ctx **SEQUENCES**: if our trace has `[2, 2, 2, 10, 14, 14, ...]` and HM has `[0, 0, 0, 5, 8, 8, ...]`, the patterns must match (same repetitions, same transitions). The FIRST bin where the pattern diverges is the bug.

## Alternative hypothesis — structural bug

If the ctx divergence is NOT a wrong offset but an EXTRA or MISSING bin, the two traces will be shifted by one bin from a certain point. To detect this:
- Compare the val sequences: if HM has `[1,1,0,1,...]` and we have `[1,1,1,0,1,...]`, there is an extra bin on our side
- Look for the insertion/deletion point by aligning the sequences (longest common subsequence)

This case happens when:
- A syntax element is parsed on our side but not in HM (e.g. `transform_skip_flag` parsed while `transform_skip_enabled_flag=0`)
- A cbf is parsed with the wrong condition
- A `coded_sub_block_flag` is parsed/inferred differently

## Rules

- **Anti-iterative-debug**: max 2 trace/test iterations. After 2 failures → re-read the spec
- **Reference in a comment**: if the solution comes from HM/libde265, document it in the code
- **Do not commit the traces**: the `-DCABAC_TRACE_BINS` flags are for debugging only
- **Test non-regression**: `oracle_i_64x64_qp22` must remain pixel-perfect
- **Working directory**: `/Users/privaloops/Sites/hevc-decode`
- **Timeout**: the decoder with `CABAC_TRACE_BINS` is slow (stderr logging). Use `perl -e 'alarm 120; exec @ARGV'` to limit it
