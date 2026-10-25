#pragma once

// Portable 128-bit SIMD through GCC/clang vector extensions: one source that
// compiles to NEON, SSE2 and WASM SIMD128 (emscripten, -msimd128). Results
// match the scalar code bit for bit, including the int16 truncation of the
// intermediate values: int32 lanes hold every filter sum at any bit depth;
// int16 lanes only serve sums known to fit, and wrap like the scalar cast.

#include <cstdint>
#include <cstring>

namespace hevc {
namespace simd {

typedef int32_t i32x4 __attribute__((vector_size(16)));
typedef uint16_t u16x4 __attribute__((vector_size(8)));
typedef int16_t i16x4 __attribute__((vector_size(8)));
typedef int16_t i16x8 __attribute__((vector_size(16)));
typedef uint8_t u8x4 __attribute__((vector_size(4)));
typedef uint8_t u8x8 __attribute__((vector_size(8)));

// 4 consecutive samples, widened. memcpy keeps the unaligned loads well defined.
inline i32x4 load4(const uint16_t* p) {
    u16x4 v;
    memcpy(&v, p, sizeof(v));
    return __builtin_convertvector(v, i32x4);
}

inline i32x4 load4(const int16_t* p) {
    i16x4 v;
    memcpy(&v, p, sizeof(v));
    return __builtin_convertvector(v, i32x4);
}

// Narrowing store: each lane is truncated to int16, as static_cast<int16_t> does.
inline void store4(int16_t* p, i32x4 v) {
    i16x4 n = __builtin_convertvector(v, i16x4);
    memcpy(p, &n, sizeof(n));
}

inline i32x4 splat(int32_t x) {
    return i32x4{x, x, x, x};
}

// Narrowing store to samples: each lane must already lie in [0, 65535].
inline void store4(uint16_t* p, i32x4 v) {
    u16x4 n = __builtin_convertvector(v, u16x4);
    memcpy(p, &n, sizeof(n));
}

// 8-bit samples (Picture::planes8): widening loads, narrowing stores whose
// lanes must already lie in [0, 255]
inline i32x4 load4(const uint8_t* p) {
    u8x4 v;
    memcpy(&v, p, sizeof(v));
    return __builtin_convertvector(v, i32x4);
}

inline void store4(uint8_t* p, i32x4 v) {
    u8x4 n = __builtin_convertvector(v, u8x4);
    memcpy(p, &n, sizeof(n));
}

// Lane-wise select, min and max: comparisons give all-ones or zero lanes.
inline i32x4 select(i32x4 mask, i32x4 a, i32x4 b) {
    return (a & mask) | (b & ~mask);
}

inline i32x4 min(i32x4 a, i32x4 b) {
    return select(a < b, a, b);
}

inline i32x4 max(i32x4 a, i32x4 b) {
    return select(a > b, a, b);
}

inline i32x4 abs(i32x4 a) {
    return select(a < splat(0), -a, a);
}

// Clip3(lo, hi, v), lane-wise
inline i32x4 clip3(i32x4 lo, i32x4 hi, i32x4 v) {
    return min(max(v, lo), hi);
}

// 8 consecutive values as int16. uint16_t samples must be below 32768, which
// holds at 8-bit depth.
inline i16x8 load8(const uint16_t* p) {
    i16x8 v;
    memcpy(&v, p, sizeof(v));
    return v;
}

inline i16x8 load8(const int16_t* p) {
    i16x8 v;
    memcpy(&v, p, sizeof(v));
    return v;
}

inline void store8(int16_t* p, i16x8 v) {
    memcpy(p, &v, sizeof(v));
}

inline i16x8 load8(const uint8_t* p) {
    u8x8 v;
    memcpy(&v, p, sizeof(v));
    return __builtin_convertvector(v, i16x8);
}

inline void store8(uint8_t* p, i16x8 v) {
    u8x8 n = __builtin_convertvector(v, u8x8);
    memcpy(p, &n, sizeof(n));
}

inline i16x8 splat8(int16_t x) {
    return i16x8{x, x, x, x, x, x, x, x};
}

inline i16x8 select(i16x8 mask, i16x8 a, i16x8 b) {
    return (a & mask) | (b & ~mask);
}

inline i16x8 min(i16x8 a, i16x8 b) {
    return select(a < b, a, b);
}

inline i16x8 max(i16x8 a, i16x8 b) {
    return select(a > b, a, b);
}

inline void store8(uint16_t* p, i16x8 v) {
    memcpy(p, &v, sizeof(v));
}

// Lane permutation of two i16x8, constant indices 0-15 (8+ picks from b).
// clang and GCC spell it differently (DECISIONS.md, AD-010).
#if defined(__clang__)
#define HEVC_SHUFFLE16(a, b, ...) __builtin_shufflevector((a), (b), __VA_ARGS__)
#else
#define HEVC_SHUFFLE16(a, b, ...) \
    __builtin_shuffle((a), (b), ::hevc::simd::i16x8{__VA_ARGS__})
#endif

// Lanes 0-3 / 4-7 of an i16x8, widened. 32-byte vectors are avoided: on x86
// without AVX, GCC warns that passing them changes the ABI (-Wpsabi).
inline i32x4 widen_lo(i16x8 v) {
    i16x4 h;
    memcpy(&h, &v, sizeof(h));
    return __builtin_convertvector(h, i32x4);
}

inline i32x4 widen_hi(i16x8 v) {
    i16x4 h;
    memcpy(&h, reinterpret_cast<const char*>(&v) + sizeof(h), sizeof(h));
    return __builtin_convertvector(h, i32x4);
}

// a then b, narrowed to int16 (truncating, like store4)
inline i16x8 pack(i32x4 a, i32x4 b) {
    const i16x4 na = __builtin_convertvector(a, i16x4);
    const i16x4 nb = __builtin_convertvector(b, i16x4);
    i16x8 v;
    memcpy(&v, &na, sizeof(na));
    memcpy(reinterpret_cast<char*>(&v) + sizeof(na), &nb, sizeof(nb));
    return v;
}

} // namespace simd
} // namespace hevc
