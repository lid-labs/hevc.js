# Spec Overview — ITU-T H.265 (V8, 2021)

## Spec structure

The H.265 spec is organized into major chapters. Only the implementation chapters are covered here.

| Chapter | Content | Priority | Phase |
|----------|---------|----------|-------|
| 6 | Source, coded, decoded and output data formats | High | 1 |
| 7 | Syntax and semantics | Critical | 2-3 |
| 8 | Decoding process | Critical | 4-6 |
| 9 | Parsing process (CABAC) | Critical | 4 |
| Annex A | Profiles, tiers, levels | High | 3, 7 |
| Annex B | Byte stream format | High | 2 |
| Annex C | HRD (Hypothetical Reference Decoder) | Low | - |
| Annex D | SEI messages | Low | - |

## Fundamental concepts

### Block hierarchy

```
CVS (Coded Video Sequence)
└── AU (Access Unit) = 1 frame
    └── NAL Unit
        └── Slice Segment
            └── CTU (Coding Tree Unit) — max size 64x64
                └── CU (Coding Unit) — quad-tree split
                    ├── PU (Prediction Unit) — prediction
                    └── TU (Transform Unit) — transform quad-tree
```

### Important NAL unit types

| nal_unit_type | Name | Description |
|---------------|-----|-------------|
| 0-1 | TRAIL_N/R | Trailing picture (P/B slice) |
| 2-3 | TSA_N/R | Temporal sub-layer access |
| 4-5 | STSA_N/R | Step-wise temporal sub-layer |
| 6-7 | RADL_N/R | Random access decodable leading |
| 8-9 | RASL_N/R | Random access skipped leading |
| 16-18 | BLA_W_LP/W_RADL/N_LP | Broken link access |
| 19-20 | IDR_W_RADL/N_LP | Instantaneous decoding refresh |
| 21 | CRA_NUT | Clean random access |
| 32 | VPS_NUT | Video Parameter Set |
| 33 | SPS_NUT | Sequence Parameter Set |
| 34 | PPS_NUT | Picture Parameter Set |
| 35 | AUD_NUT | Access Unit Delimiter |
| 36 | EOS_NUT | End of Sequence |
| 37 | EOB_NUT | End of Bitstream |
| 39-40 | PREFIX/SUFFIX_SEI | SEI messages |

### Picture Order Count (POC)

The POC is the central mechanism for ordering frames. It is derived in the slice header (§8.3.1):

```
PicOrderCntVal = PicOrderCntMsb + slice_pic_order_cnt_lsb
```

The MSB is derived relative to the previous frame, with wrap-around rules.

### Decoded Picture Buffer (DPB)

The DPB stores reference frames and frames waiting for output. Its size is defined by the level (Annex A). The management process is described in §C.5.

### Overall decoding process

```
1. Parse NAL unit header
2. If VPS/SPS/PPS: parse and store
3. If slice:
   a. Parse slice header
   b. For each CTU in the slice:
      i.   Parse coding_tree_unit (CABAC)
      ii.  For each CU:
           - If PCM: direct reconstruction (bypass prediction/transform), reset CABAC
           - If intra: derive intra prediction (35 luma modes, 5 chroma modes)
           - If inter: derive motion vectors (merge/AMVP), interpolation (8-tap luma, 4-tap chroma)
           - If skip: merge mode, no residual
      iii. Inverse transform + dequant
      iv.  Reconstruction = prediction + residual
   c. Loop filters (deblocking + SAO) on the whole picture
   d. Store in the DPB
   e. Output if conditions are met
```

## Spec → code mapping

| Spec section | C++ module | File |
|-------------|-----------|---------|
| Annex B | Bitstream | src/bitstream/byte_stream.cpp |
| §7.3.1 | NAL Parser | src/bitstream/nal_unit.cpp |
| §7.3.2 | VPS | src/syntax/vps.cpp |
| §7.3.3 | SPS | src/syntax/sps.cpp |
| §7.3.4 | PPS | src/syntax/pps.cpp |
| §7.3.6 | Slice Header | src/syntax/slice_header.cpp |
| §7.3.8 | CTU | src/syntax/coding_tree.cpp |
| §8.3 | Ref Pic Mgmt | src/decoding/ref_pictures.cpp |
| §8.5.3 | Inter Pred | src/decoding/inter_prediction.cpp |
| §8.5.4 | Intra Pred | src/decoding/intra_prediction.cpp |
| §8.6 | Transform | src/decoding/transform.cpp |
| §8.7.2 | Deblocking | src/filters/deblocking.cpp |
| §8.7.3 | SAO | src/filters/sao.cpp |
| §9 | CABAC | src/bitstream/cabac.cpp |
| §7.3.10.2 | PCM Samples | src/syntax/pcm.cpp |
| §8.1 | General Decoding | src/decoding/decoder.cpp |
| §8.3.1 | POC Derivation | src/decoding/ref_pictures.cpp |
| §C.5 | DPB Output/Bumping | src/common/dpb.cpp |
| Annex A | Profile/Level | src/syntax/profile_tier_level.cpp |
