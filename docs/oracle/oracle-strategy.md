# Oracle Validation Strategy

## Principe

libde265 serves as the reference oracle: the same bitstream is decoded with both decoders and the frames are compared pixel by pixel.

**Important**: libde265 is used only for its outputs (YUV frames, header dumps), NEVER for its source code.

## Test architecture

```
                    ┌──────────────┐
                    │  Bitstream   │
                    │   (.265)     │
                    └──────┬───────┘
                           │
                    ┌──────┴───────┐
                    │              │
              ┌─────▼─────┐ ┌─────▼──────┐
              │ libde265   │ │ hevc-      │
              │ (oracle)   │ │ torture    │
              └─────┬──────┘ └─────┬──────┘
                    │              │
              ┌─────▼──────┐ ┌────▼───────┐
              │ YUV frames │ │ YUV frames │
              └─────┬──────┘ └─────┬──────┘
                    │              │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  Pixel-exact │
                    │  comparator  │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │  PASS/FAIL   │
                    │  + diff map  │
                    └──────────────┘
```

## Required tools

### 1. libde265 CLI

```bash
# Installation
brew install libde265
# or build from source to control the version

# Decode to YUV
dec265 input.265 -o output_ref.yuv

# Dump headers (for phase 2-3 validation)
dec265 input.265 --dump-headers > headers_ref.txt
```

### 2. Comparison script (Python)

```python
#!/usr/bin/env python3
"""oracle_compare.py — Compare YUV output pixel by pixel."""

import sys
import numpy as np

def compare_yuv(ref_path, test_path, width, height, bit_depth=8, chroma='420'):
    """Compare two YUV files frame by frame."""
    bytes_per_sample = 2 if bit_depth > 8 else 1
    dtype = np.uint16 if bit_depth > 8 else np.uint8

    # Size of one frame
    if chroma == '420':
        frame_size = width * height * 3 // 2
    elif chroma == '422':
        frame_size = width * height * 2
    else:  # 444
        frame_size = width * height * 3
    frame_size *= bytes_per_sample

    ref_data = open(ref_path, 'rb').read()
    test_data = open(test_path, 'rb').read()

    num_frames = len(ref_data) // frame_size

    mismatches = []
    for f in range(num_frames):
        ref_frame = np.frombuffer(ref_data[f*frame_size:(f+1)*frame_size], dtype=dtype)
        test_frame = np.frombuffer(test_data[f*frame_size:(f+1)*frame_size], dtype=dtype)

        if not np.array_equal(ref_frame, test_frame):
            diff = np.abs(ref_frame.astype(int) - test_frame.astype(int))
            mismatches.append({
                'frame': f,
                'max_diff': int(diff.max()),
                'num_diff_pixels': int(np.count_nonzero(diff)),
                'first_diff_pos': int(np.argmax(diff > 0)),
                'psnr': 10 * np.log10((2**bit_depth - 1)**2 / np.mean(diff**2)) if diff.any() else float('inf')
            })

    return num_frames, mismatches

if __name__ == '__main__':
    # Usage: python3 oracle_compare.py ref.yuv test.yuv 1920 1080 [bit_depth] [chroma]
    ref, test, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    bd = int(sys.argv[5]) if len(sys.argv) > 5 else 8
    ch = sys.argv[6] if len(sys.argv) > 6 else '420'

    num_frames, mismatches = compare_yuv(ref, test, w, h, bd, ch)

    if not mismatches:
        print(f"PASS: {num_frames} frames, pixel-perfect match")
    else:
        print(f"FAIL: {len(mismatches)}/{num_frames} frames differ")
        for m in mismatches:
            print(f"  Frame {m['frame']}: {m['num_diff_pixels']} pixels differ, "
                  f"max_diff={m['max_diff']}, PSNR={m['psnr']:.2f}dB")
        sys.exit(1)
```

### 3. Integrated test script (CTest)

```bash
#!/bin/bash
# test_oracle.sh — Run by CTest

BITSTREAM=$1
WIDTH=$2
HEIGHT=$3
BIT_DEPTH=${4:-8}
CHROMA=${5:-420}

# Decode with libde265
dec265 "$BITSTREAM" -o /tmp/ref.yuv 2>/dev/null

# Decode with hevc-torture
./hevc-torture "$BITSTREAM" -o /tmp/test.yuv

# Compare
python3 tools/oracle_compare.py /tmp/ref.yuv /tmp/test.yuv "$WIDTH" "$HEIGHT" "$BIT_DEPTH" "$CHROMA"
```

## Test bitstreams

### Sources

1. **HEVC conformance bitstreams** (ITU-T) — the official reference
   - Available through the HEVC test model (HM) reference software
   - Cover all tools and profiles

2. **Synthetic bitstreams** — created with x265/kvazaar to target specific cases
   - I-only, P-only, B-only
   - Specific block sizes
   - Specific intra modes
   - Varied QPs

3. **Real-world bitstreams** — encoded from standard test sequences
   - BasketballDrill, BQTerrace, etc.

### Download script

```bash
#!/bin/bash
# fetch_conformance.sh — Downloads the conformance bitstreams

DEST=tests/conformance
mkdir -p "$DEST"

# The conformance bitstreams are organised by profile/tool
# Structure : tests/conformance/{profile}/{tool}/{bitstream}.265
```

## Strategy per phase

### Phase 2 — Bitstream
- Compare the NAL listing (type, size) with `dec265 --dump-headers`
- No pixel comparison (no decoding yet)

### Phase 3 — Parameter Sets
- Compare each parsed field (VPS, SPS, PPS, slice header) with `dec265 --dump-headers`
- Write a verbose mode that dumps the same information in the same format

### Phase 4 — Intra
- First pixel-perfect comparison on I-frames
- Start with: 1 frame, fixed QP, no SAO, no deblocking
- Then: multi-frame I-only, variable QP, deblocking enabled
- Then: all block sizes, all intra modes

### Phase 5 — Inter
- P-frames first (uni-prediction)
- Then B-frames (bi-prediction)
- Then weighted prediction
- Test with different GOP structures

### Phase 6 — Filters
- Deblocking alone (SAO off)
- SAO alone (deblocking off if possible, otherwise both)
- Both together
- This is often where the last mismatches get resolved

### Phase 7 — Profiles
- Same strategy as Phase 4-6 but with 10-bit, 4:2:2, 4:4:4
- Conformance bitstreams specific to each profile

## Debugging mismatches

When a mismatch is detected:

1. **Identify the first wrong frame**
2. **Identify the first wrong pixel** (Y, Cb or Cr component)
3. **Locate the CTU/CU** containing that pixel
4. **Add logging** in hevc-torture for that specific CU
5. **Compare the intermediate values**:
   - Prediction samples (before residual)
   - Residual samples (after inverse transform)
   - Reconstruction (before filters)
   - After deblocking
   - After SAO
6. **Identify the stage** where the divergence starts

### Debug tools

```cpp
// Debug mode: dump the intermediate values for a given CU
#ifdef HEVC_DEBUG
void dump_cu_debug(int x, int y, int size, const char* stage,
                    const int16_t* samples, int stride) {
    fprintf(stderr, "[%s] CU(%d,%d) size=%d:\n", stage, x, y, size);
    for (int j = 0; j < size; j++) {
        for (int i = 0; i < size; i++)
            fprintf(stderr, "%4d ", samples[j*stride+i]);
        fprintf(stderr, "\n");
    }
}
#endif
```

## CI Integration

```yaml
# .github/workflows/oracle.yml
oracle-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Install libde265
      run: sudo apt-get install -y libde265-dev libde265-examples
    - name: Build hevc-torture
      run: cmake -B build && cmake --build build
    - name: Run oracle tests
      run: cd build && ctest --output-on-failure -L oracle
```

## Checklist

- [ ] libde265 installed and working
- [ ] oracle_compare.py operational
- [ ] CTest script for automated oracle tests
- [ ] Conformance bitstreams downloaded
- [ ] CI with oracle tests
- [ ] Debug mode with a dump of the intermediate values
- [ ] Documentation of the mismatch debugging process
