# Chapter 7 — Syntax and Semantics (Index)

This chapter is the core of HEVC parsing. Each subsection corresponds to a syntactic structure to parse from the bitstream.

## Chapter structure

| Section | File | Content | Phase |
|---------|---------|---------|-------|
| §7.3.1 | `07-03-nal-unit.md` | NAL unit syntax | 2 |
| §7.3.2-4 | `07-04-parameter-sets.md` | VPS, SPS, PPS | 3 |
| §7.3.6 | `07-05-slice-header.md` | Slice segment header | 3 |
| §7.3.8.1 | `07-08-slice-segment-data.md` | slice_segment_data() loop, end_of_slice_segment_flag | 4 |
| §7.3.8-11 | `07-06-slice-data.md` | CTU, CU, PU, TU | 4-5 |
| §7.3.7 | `07-07-sei.md` | SEI messages | Optional |

## Spec reading conventions

The spec uses bitstream reading functions:

| Spec notation | C++ function | Description |
|--------------|-------------|-------------|
| `f(n)` | `read_bits(n)` | n bits fixed-length |
| `u(n)` | `read_u(n)` | unsigned integer, n bits |
| `i(n)` | `read_i(n)` | signed integer, n bits (2's complement) |
| `ue(v)` | `read_ue()` | unsigned Exp-Golomb |
| `se(v)` | `read_se()` | signed Exp-Golomb |
| `ae(v)` | `cabac_decode()` | CABAC-coded (context-adaptive) |
| `b(8)` | `read_byte()` | byte-aligned byte |

## Conditional descriptors

The spec makes extensive use of presence conditions. Rule: **if a syntax element is not present, its inferred value is defined in the semantics (§7.4)**.

Example:
```
if( condition )
    syntax_element    ue(v)
```
If `condition` is false, `syntax_element` takes its inferred value (often 0).

## Implementation approach

1. Translate the spec pseudo-code to C++ line by line
2. Each syntax element is stored in a struct
3. Derived values (§7.4) are computed immediately after parsing
4. Inferred values are initialized in the struct constructor
