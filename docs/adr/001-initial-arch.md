# ADR-001: Initial decoder architecture

## Status
Accepted

## Date
2026-03-19

## Context

We are building an HEVC (H.265) decoder in C++17, compiled to WebAssembly. The decoder must:
- Conform to the ITU-T H.265 v8 (2021) spec
- Produce frames that are pixel-perfect against libde265
- Run in a Web Worker for a web player
- Support up to 4K@60fps (Main/Main 10/4:2:2/4:4:4, Level 5.1)

## Decision

### Module architecture

```
BitstreamReader (bits) → NAL Parser → Syntax Parser (VPS/SPS/PPS/Slice)
                                            │
                                     CABAC Decoder
                                            │
                              Coding Tree (CTU → CU → PU/TU)
                                            │
                                    ┌───────┴───────┐
                                    │               │
                              Intra Pred      Inter Pred
                                    │               │
                                    └───────┬───────┘
                                            │
                                   Transform Inverse
                                            │
                                    Reconstruction
                                            │
                                    Loop Filters
                                            │
                                      DPB / Output
```

### Technical choices

1. **C++17**: templates for the bit depth (8/10/16), constexpr for the tables
2. **No dynamic allocation in the hot path**: pre-allocated pools
3. **Parsing / decoding separation**: parsing (CABAC) produces data structures, decoding consumes them
4. **C API for WASM**: pure C interface, no C++ exceptions in the public API
5. **Dual build**: native (for tests/debug) and WASM (for production)

### What we do NOT do

- No encoder
- No multi-layer support (nuh_layer_id != 0)
- No HRD (Hypothetical Reference Decoder)
- No SEI beyond decoded_picture_hash
- No range extensions beyond 4:4:4 (no 12-bit, no cross-component prediction)

## Consequences

- The code follows the structure of the spec (one file per major section)
- Function names mirror the spec for traceability
- libde265 is used as an oracle, never as a source of code
- The phases are incremental: each phase produces a working decoder for a subset of the spec
