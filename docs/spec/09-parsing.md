# Chapter 9 — Parsing Process (CABAC)

Spec ref: §9.1 (general), §9.2 (initialization), §9.3 (binarization), §9.4 (context modeling), §9.5 (decoding engine)

## Overview

CABAC (Context-Adaptive Binary Arithmetic Coding) is the only entropy coding mode in HEVC (unlike H.264, which also had CAVLC).

Every `ae(v)` syntax element in chapter 7 is decoded by CABAC.

### Architecture CABAC

```
Bitstream → Arithmetic Decoder → Binary decisions (bins)
                                        │
                                   Binarization
                                        │
                                  Syntax Elements
```

The process:
1. **Binarization** : each syntax element has a binarization scheme (how it is represented as bins)
2. **Context modeling** : each bin uses a "context" that stores the probability
3. **Arithmetic decoding** : decoding of the bin based on the context probability

## 9.2 — Initialization

### Context initialization

```cpp
// At the start of each slice:
// §9.2.1.1 — Context variables initialization

struct CabacContext {
    uint8_t pStateIdx;  // probability state index (0-62)
    uint8_t valMps;     // most probable symbol (0 or 1)
};

void init_context(CabacContext& ctx, int initValue, int SliceQpY) {
    int slope = (initValue >> 4) * 5 - 45;
    int offset = ((initValue & 15) << 3) - 16;
    int initState = Clip3(1, 126, ((slope * Clip3(0, 51, SliceQpY)) >> 4) + offset);

    if (initState >= 64) {
        ctx.pStateIdx = initState - 64;
        ctx.valMps = 1;
    } else {
        ctx.pStateIdx = 63 - initState;
        ctx.valMps = 0;
    }
}

// There are ~200 different contexts in HEVC
// Each syntax element type has its own contexts
// The initValues are tabulated in the spec (Tables 9-5 to 9-42)
```

### Arithmetic engine initialization

```cpp
struct ArithmeticDecoder {
    uint16_t ivlCurrRange;   // current range [256, 510]
    uint16_t ivlOffset;      // current offset

    void init(BitstreamReader& bs) {
        ivlCurrRange = 510;
        ivlOffset = bs.read_bits(9);
    }
};
```

## 9.3 — Binarization

Each syntax element has a specific binarization scheme:

### Binarization types

| Type | Used for | Description |
|------|-------------|-------------|
| FL (Fixed Length) | flags, small integers | n bins, direct value |
| TR (Truncated Rice) | bounded | like unary but truncated |
| EGk (Exp-Golomb kth order) | large integers | unary prefix + suffix |
| TU (Truncated Unary) | small bounded integers | unary truncated at cMax |

### Examples

```cpp
// split_cu_flag : FL, 1 bin, context-coded
// Trivial binarization: the bin IS the value

// part_mode: varies with slice type and CU size
// Binarization depends on the context (Table 9-34)

// coeff_abs_level_remaining: Golomb-Rice + EG
// §9.3.2.7 — prefix TR (cRiceParam) + suffix EGk
// This is the most complex one

// last_sig_coeff_x_prefix: TR binarization
// The bins use different contexts depending on the position
```

### residual_coding binarization (the most complex)

```cpp
// §9.3.3.1 — coeff_abs_level_greater1_flag : 1 bin, context-coded
// §9.3.3.2 — coeff_abs_level_greater2_flag : 1 bin, context-coded
// §9.3.3.3 — coeff_abs_level_remaining : bypass-coded (no context)
//   → Golomb-Rice code with adaptive parameter

// §9.3.3.11 — coeff_abs_level_remaining binarization
int decode_coeff_abs_level_remaining(ArithmeticDecoder& ad, int cRiceParam) {
    int prefix = 0;
    while (prefix < 4 && ad.decode_bypass())
        prefix++;

    if (prefix < 4) {
        // Truncated Rice: prefix * (1 << cRiceParam) + suffix
        return (prefix << cRiceParam) + ad.decode_bypass_bits(cRiceParam);
    }

    // Exp-Golomb coded suffix (order = cRiceParam)
    // Read unary-coded length extension
    int length = cRiceParam;
    while (ad.decode_bypass()) {
        length++;
    }
    return (((1 << (length - cRiceParam)) + 3) << cRiceParam)
           + ad.decode_bypass_bits(length);
}
```

### Rice parameter adaptation (cRiceParam)

The Rice parameter is adaptive: it adjusts after each sub-block based on the decoded coefficient levels.

```cpp
// §9.3.3.11 — cRiceParam update
// After decoding each coeff_abs_level_remaining:
// If the reconstructed absolute value > 3 * (1 << cRiceParam)
//    cRiceParam = min(cRiceParam + 1, 4)
// cRiceParam is reset to 0 at the start of each sub-block group

// In practice:
int cRiceParam = 0;  // reset at the start of each 4x4 sub-block
for (int n = numSigCoeff - 1; n >= 0; n--) {
    if (need_remaining[n]) {
        int remaining = decode_coeff_abs_level_remaining(ad, cRiceParam);
        baseLevel[n] += remaining;
        // Update Rice parameter
        if (baseLevel[n] > 3 * (1 << cRiceParam) && cRiceParam < 4)
            cRiceParam++;
    }
}
```

`cRiceParam` starts at 0 for each sub-block and can rise up to 4. This is critical for correctly decoding large residual coefficients.

## 9.4 — Context Modeling

### Context selection

Each bin of a syntax element uses a specific context. The context choice often depends on:

1. **Position in the binarization** (which bin of the word)
2. **Neighbor values** (spatial context)
3. **Quad-tree depth**
4. **Slice type** (I, P, B)
5. **Component** (luma, Cb, Cr)

```cpp
// Example: split_cu_flag context (§9.3.4.2.2)
int ctx_split_cu_flag(int x0, int y0, int log2CbSize) {
    // Context based on the depth of the neighboring CUs
    int condL = (left_neighbor_depth > current_depth) ? 1 : 0;
    int condA = (above_neighbor_depth > current_depth) ? 1 : 0;
    return condL + condA;  // ctx index 0, 1, or 2
}

// Example: sig_coeff_flag context (§9.3.4.2.8) — very complex
// Depends on: cIdx, log2TrafoSize, scan position, coded_sub_block_flag of the neighbors
// ~42 contexts for luma, ~16 for chroma
```

### sig_coeff_flag context derivation (§9.3.4.2.8) — CRITIQUE

This is the most complex context derivation in HEVC. The context depends on 5 factors:

```cpp
int ctx_sig_coeff_flag(int xS, int yS, int xC, int yC, int log2TrafoSize,
                        int cIdx, const uint8_t* coded_sub_block_flag) {
    // xS, yS: position of the sub-block (4x4)
    // xC, yC: position of the coefficient within the sub-block (0-3)
    // coded_sub_block_flag: flags of the neighboring sub-blocks

    int sigCtx;

    if (log2TrafoSize == 2) {
        // 4x4 TU: context based on the position in the scan
        // Fixed table: ctxIdxMap[15] for luma/chroma
        sigCtx = ctxIdxMap[4*yC + xC];  // Tables 9-50, 9-51
    } else {
        // TU > 4x4: context based on the neighboring sub-blocks
        int prevCsbf = 0;
        if (xS < (1 << (log2TrafoSize - 2)) - 1)
            prevCsbf += coded_sub_block_flag[(xS+1) + yS * stride];  // right
        if (yS < (1 << (log2TrafoSize - 2)) - 1)
            prevCsbf += (coded_sub_block_flag[xS + (yS+1) * stride] << 1);  // below

        // Position within the sub-block
        int xP = xC, yP = yC;

        if (prevCsbf == 0)
            sigCtx = (xP + yP == 0) ? 2 : (xP + yP < 3) ? 1 : 0;
        else if (prevCsbf == 1)
            sigCtx = (yP == 0) ? 2 : (yP == 1) ? 1 : 0;
        else if (prevCsbf == 2)
            sigCtx = (xP == 0) ? 2 : (xP == 1) ? 1 : 0;
        else
            sigCtx = 2;

        // Offset per component and size
        if (cIdx == 0) {
            // Luma: 27 contexts (3 size zones)
            if (log2TrafoSize == 3)
                sigCtx += 9;    // 8x8
            else if (log2TrafoSize == 4)
                sigCtx += 21;   // 16x16 (uses different pattern)
            else
                sigCtx += 12;   // 32x32
        } else {
            // Chroma: 15 base contexts
            sigCtx += (log2TrafoSize == 3) ? 9 : 12;
        }
    }

    // Context 0 is reserved for the "last" coefficient (DC of the last sub-block)
    // Add the base offset for sig_coeff_flag (different for I/P/B)
    return sigCtx;
}
```

**Warning**: This pseudo-code is simplified. The implementation MUST follow equations 9-48 to 9-54 of the spec exactly. A single context error corrupts the whole CABAC decoding.

### Context table (summary)

| Syntax element | Number of contexts | Init table |
|---------------|--------------------:|------------|
| split_cu_flag | 3 | 9-5 |
| cu_skip_flag | 3 | 9-6 |
| pred_mode_flag | 1 | 9-7 |
| part_mode | 4 | 9-8 |
| prev_intra_luma_pred_flag | 1 | 9-9 |
| intra_chroma_pred_mode | 1 | 9-10 |
| merge_flag | 1 | 9-11 |
| merge_idx | 1 | 9-12 |
| inter_pred_idc | 5 | 9-13 |
| ref_idx | 2 | 9-14 |
| mvd (abs_mvd_greater0/1) | 2 | 9-15 |
| cbf_luma | 2 | 9-18 |
| cbf_cb/cr | 5 | 9-19 |
| transform_skip_flag | 2 | 9-20 |
| last_sig_coeff_x/y_prefix | 18+18 | 9-21/22 |
| coded_sub_block_flag | 4 | 9-23 |
| sig_coeff_flag | 42+16 | 9-24/25 |
| coeff_abs_level_greater1 | 24 | 9-26 |
| coeff_abs_level_greater2 | 6 | 9-27 |
| sao_merge/type/offset | 3+1 | 9-28/29 |

## 9.5 — Arithmetic Decoding Engine

### Decode Decision (context-coded bin)

```cpp
// §9.3.4.3.2 — Arithmetic decoding process for a binary decision
int ArithmeticDecoder::decode_decision(CabacContext& ctx) {
    uint8_t qRangeIdx = (ivlCurrRange >> 6) & 3;
    uint16_t ivlLpsRange = rangeTabLps[ctx.pStateIdx][qRangeIdx];

    ivlCurrRange -= ivlLpsRange;

    int binVal;
    if (ivlOffset >= ivlCurrRange) {
        // LPS (least probable symbol)
        binVal = 1 - ctx.valMps;
        ivlOffset -= ivlCurrRange;
        ivlCurrRange = ivlLpsRange;

        if (ctx.pStateIdx == 0)
            ctx.valMps = 1 - ctx.valMps;
        ctx.pStateIdx = transIdxLps[ctx.pStateIdx];
    } else {
        // MPS (most probable symbol)
        binVal = ctx.valMps;
        ctx.pStateIdx = transIdxMps[ctx.pStateIdx];
    }

    // Renormalization
    renormalize();

    return binVal;
}
```

### Decode Bypass (equiprobable bin)

```cpp
// §9.3.4.3.4
int ArithmeticDecoder::decode_bypass() {
    ivlOffset = (ivlOffset << 1) | read_bit();

    if (ivlOffset >= ivlCurrRange) {
        ivlOffset -= ivlCurrRange;
        return 1;
    }
    return 0;
}
```

### Renormalization

```cpp
void ArithmeticDecoder::renormalize() {
    while (ivlCurrRange < 256) {
        ivlCurrRange <<= 1;
        ivlOffset = (ivlOffset << 1) | read_bit();
    }
}
```

### Tables LPS

```cpp
// Table 9-48 : rangeTabLps[64][4]
// 64 states x 4 range indices
// These tables are in the spec, ~256 entries to copy exactly

// Table 9-49 : transIdxMps[64] — next state after MPS
// Table 9-50 : transIdxLps[64] — next state after LPS
```

## Implementation strategy

1. **Arithmetic engine** first (decode_decision, decode_bypass, renormalize)
2. **Context initialization** (copy the init tables)
3. **Binarization** of each syntax element, one by one
4. **Tests**: decode a simple slice (I-frame) and verify the syntax elements

CABAC is the part most sensitive to errors: a single misread bit makes everything after it diverge. That is why it must be tested very finely.

## Known pitfalls

1. **Bit-exactness**: The arithmetic is integer and must conform exactly to the spec
2. **Renormalization**: Every missed renorm corrupts the decoding
3. **Context index**: The slightest wrong context produces absurd results
4. **cabac_init_flag**: Can swap the init tables between I and P/B
5. **Dependent slice segments**: CABAC continues the state of the previous slice
6. **End of slice detection**: end_of_slice_segment_flag + byte alignment

## Checklist

- [ ] Arithmetic decoder (decode_decision, decode_bypass, terminate)
- [ ] Renormalization
- [ ] Tables rangeTabLps, transIdxMps, transIdxLps (copy from the spec)
- [ ] Context initialization with all the initValues tables
- [ ] Binarization of each ae(v) syntax element
- [ ] Context selection for each syntax element
- [ ] cabac_init_flag handling
- [ ] Dependent slice segment CABAC continuation
- [ ] end_of_slice_segment_flag detection
- [ ] Tests: decode a minimal I-frame and verify all syntax elements
