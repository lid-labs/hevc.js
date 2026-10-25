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
// Two registers: the widened products of an i16x8.
typedef int32_t i32x8 __attribute__((vector_size(32)));

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

inline i32x8 widen(i16x8 v) {
    return __builtin_convertvector(v, i32x8);
}

inline i32x8 splat8w(int32_t x) {
    return i32x8{x, x, x, x, x, x, x, x};
}

// Narrowing store of 8 lanes, truncated to int16 like store4.
inline void store8(int16_t* p, i32x8 v) {
    store8(p, __builtin_convertvector(v, i16x8));
}

} // namespace simd
} // namespace hevc
