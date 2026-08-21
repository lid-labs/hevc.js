#include "decoding/transform.h"
#include "decoding/coding_tree.h"
#include "decoding/cabac_tables.h"
#include "common/types.h"
#include "common/debug.h"

#include <cstring>
#include <algorithm>

namespace hevc {

// ============================================================
// DST-VII 4x4 inverse (Table 8-12)
// ============================================================

// DST-VII matrix (for reference — used directly in idst4 below)

// ============================================================
// Partial butterfly inverse transforms
// ============================================================

static void idst4(const int16_t* src, int16_t* dst, int shift, int line) {
    int add = 1 << (shift - 1);
    for (int j = 0; j < line; j++) {
        int c0 = src[0 * line + j];
        int c1 = src[1 * line + j];
        int c2 = src[2 * line + j];
        int c3 = src[3 * line + j];

        // DST-VII inverse uses M^T (columns of forward matrix as rows)
        // Forward matrix rows: {29,55,74,84}, {74,74,0,-74}, {84,-29,-74,55}, {55,-84,74,-29}
        // Transpose (columns become rows): {29,74,84,55}, {55,74,-29,-84}, {74,0,-74,74}, {84,-74,55,-29}
        int s0 = 29 * c0 + 74 * c1 + 84 * c2 + 55 * c3;
        int s1 = 55 * c0 + 74 * c1 - 29 * c2 - 84 * c3;
        int s2 = 74 * c0 +  0 * c1 - 74 * c2 + 74 * c3;
        int s3 = 84 * c0 - 74 * c1 + 55 * c2 - 29 * c3;

        dst[0 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (s0 + add) >> shift));
        dst[1 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (s1 + add) >> shift));
        dst[2 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (s2 + add) >> shift));
        dst[3 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (s3 + add) >> shift));
    }
}

static void idct4(const int16_t* src, int16_t* dst, int shift, int line) {
    int add = 1 << (shift - 1);
    for (int j = 0; j < line; j++) {
        int E0 = 64 * src[0 * line + j] + 64 * src[2 * line + j];
        int E1 = 64 * src[0 * line + j] - 64 * src[2 * line + j];
        int O0 = 83 * src[1 * line + j] + 36 * src[3 * line + j];
        int O1 = 36 * src[1 * line + j] - 83 * src[3 * line + j];

        dst[0 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (E0 + O0 + add) >> shift));
        dst[1 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (E1 + O1 + add) >> shift));
        dst[2 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (E1 - O1 + add) >> shift));
        dst[3 * line + j] = static_cast<int16_t>(Clip3(-32768, 32767, (E0 - O0 + add) >> shift));
    }
}

static void idct8(const int16_t* src, int16_t* dst, int shift, int line) {
    int add = 1 << (shift - 1);
    for (int j = 0; j < line; j++) {
        int EE0 = 64 * src[0 * line + j] + 64 * src[4 * line + j];
        int EE1 = 64 * src[0 * line + j] - 64 * src[4 * line + j];
        int EO0 = 83 * src[2 * line + j] + 36 * src[6 * line + j];
        int EO1 = 36 * src[2 * line + j] - 83 * src[6 * line + j];

        int E0 = EE0 + EO0, E3 = EE0 - EO0;
        int E1 = EE1 + EO1, E2 = EE1 - EO1;

        int O0 = 89*src[1*line+j] + 75*src[3*line+j] + 50*src[5*line+j] + 18*src[7*line+j];
        int O1 = 75*src[1*line+j] - 18*src[3*line+j] - 89*src[5*line+j] - 50*src[7*line+j];
        int O2 = 50*src[1*line+j] - 89*src[3*line+j] + 18*src[5*line+j] + 75*src[7*line+j];
        int O3 = 18*src[1*line+j] - 50*src[3*line+j] + 75*src[5*line+j] - 89*src[7*line+j];

        dst[0*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E0+O0+add) >> shift));
        dst[1*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E1+O1+add) >> shift));
        dst[2*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E2+O2+add) >> shift));
        dst[3*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E3+O3+add) >> shift));
        dst[4*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E3-O3+add) >> shift));
        dst[5*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E2-O2+add) >> shift));
        dst[6*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E1-O1+add) >> shift));
        dst[7*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E0-O0+add) >> shift));
    }
}

static void idct16(const int16_t* src, int16_t* dst, int shift, int line) {
    static const int16_t g[8][16] = {
        { 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64 },
        { 90, 87, 80, 70, 57, 43, 25,  9, -9,-25,-43,-57,-70,-80,-87,-90 },
        { 89, 75, 50, 18,-18,-50,-75,-89,-89,-75,-50,-18, 18, 50, 75, 89 },
        { 87, 57,  9,-43,-80,-90,-70,-25, 25, 70, 90, 80, 43, -9,-57,-87 },
        { 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83 },
        { 80,  9,-70,-87,-25, 57, 90, 43,-43,-90,-57, 25, 87, 70, -9,-80 },
        { 75,-18,-89,-50, 50, 89, 18,-75,-75, 18, 89, 50,-50,-89,-18, 75 },
        { 70,-43,-87,  9, 90, 25,-80,-57, 57, 80,-25,-90, -9, 87, 43,-70 },
    };
    static const int16_t ge[4][16] = {
        { 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64 },
        { 89, 75, 50, 18,-18,-50,-75,-89,-89,-75,-50,-18, 18, 50, 75, 89 },
        { 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83 },
        { 75,-18,-89,-50, 50, 89, 18,-75,-75, 18, 89, 50,-50,-89,-18, 75 },
    };
    (void)g; (void)ge;

    int add = 1 << (shift - 1);
    for (int j = 0; j < line; j++) {
        // Even-even
        int EEE0 = 64 * src[0*line+j] + 64 * src[8*line+j];
        int EEE1 = 64 * src[0*line+j] - 64 * src[8*line+j];
        int EEO0 = 83 * src[4*line+j] + 36 * src[12*line+j];
        int EEO1 = 36 * src[4*line+j] - 83 * src[12*line+j];

        int EE0 = EEE0 + EEO0, EE3 = EEE0 - EEO0;
        int EE1 = EEE1 + EEO1, EE2 = EEE1 - EEO1;

        // Even-odd
        int EO0 = 89*src[2*line+j] + 75*src[6*line+j] + 50*src[10*line+j] + 18*src[14*line+j];
        int EO1 = 75*src[2*line+j] - 18*src[6*line+j] - 89*src[10*line+j] - 50*src[14*line+j];
        int EO2 = 50*src[2*line+j] - 89*src[6*line+j] + 18*src[10*line+j] + 75*src[14*line+j];
        int EO3 = 18*src[2*line+j] - 50*src[6*line+j] + 75*src[10*line+j] - 89*src[14*line+j];

        int E[8];
        E[0] = EE0 + EO0; E[7] = EE0 - EO0;
        E[1] = EE1 + EO1; E[6] = EE1 - EO1;
        E[2] = EE2 + EO2; E[5] = EE2 - EO2;
        E[3] = EE3 + EO3; E[4] = EE3 - EO3;

        // Odd
        int O[8];
        O[0] = 90*src[1*line+j]+87*src[3*line+j]+80*src[5*line+j]+70*src[7*line+j]+57*src[9*line+j]+43*src[11*line+j]+25*src[13*line+j]+ 9*src[15*line+j];
        O[1] = 87*src[1*line+j]+57*src[3*line+j]+ 9*src[5*line+j]-43*src[7*line+j]-80*src[9*line+j]-90*src[11*line+j]-70*src[13*line+j]-25*src[15*line+j];
        O[2] = 80*src[1*line+j]+ 9*src[3*line+j]-70*src[5*line+j]-87*src[7*line+j]-25*src[9*line+j]+57*src[11*line+j]+90*src[13*line+j]+43*src[15*line+j];
        O[3] = 70*src[1*line+j]-43*src[3*line+j]-87*src[5*line+j]+ 9*src[7*line+j]+90*src[9*line+j]+25*src[11*line+j]-80*src[13*line+j]-57*src[15*line+j];
        O[4] = 57*src[1*line+j]-80*src[3*line+j]-25*src[5*line+j]+90*src[7*line+j]- 9*src[9*line+j]-87*src[11*line+j]+43*src[13*line+j]+70*src[15*line+j];
        O[5] = 43*src[1*line+j]-90*src[3*line+j]+57*src[5*line+j]+25*src[7*line+j]-87*src[9*line+j]+70*src[11*line+j]+ 9*src[13*line+j]-80*src[15*line+j];
        O[6] = 25*src[1*line+j]-70*src[3*line+j]+90*src[5*line+j]-80*src[7*line+j]+43*src[9*line+j]+ 9*src[11*line+j]-57*src[13*line+j]+87*src[15*line+j];
        O[7] =  9*src[1*line+j]-25*src[3*line+j]+43*src[5*line+j]-57*src[7*line+j]+70*src[9*line+j]-80*src[11*line+j]+87*src[13*line+j]-90*src[15*line+j];

        for (int k = 0; k < 8; k++) {
            dst[k*line+j]      = static_cast<int16_t>(Clip3(-32768, 32767, (E[k]+O[k]+add) >> shift));
            dst[(15-k)*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E[k]-O[k]+add) >> shift));
        }
    }
}

static void idct32(const int16_t* src, int16_t* dst, int shift, int line) {
    int add = 1 << (shift - 1);

    // DCT coefficients from the spec tables
    static const int16_t tm[32][32] = {
        { 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64, 64},
        { 90, 90, 88, 85, 82, 78, 73, 67, 61, 54, 46, 38, 31, 22, 13,  4, -4,-13,-22,-31,-38,-46,-54,-61,-67,-73,-78,-82,-85,-88,-90,-90},
        { 90, 87, 80, 70, 57, 43, 25,  9, -9,-25,-43,-57,-70,-80,-87,-90,-90,-87,-80,-70,-57,-43,-25, -9,  9, 25, 43, 57, 70, 80, 87, 90},
        { 90, 82, 67, 46, 22, -4,-31,-54,-73,-85,-90,-88,-78,-61,-38,-13, 13, 38, 61, 78, 88, 90, 85, 73, 54, 31,  4,-22,-46,-67,-82,-90},
        { 89, 75, 50, 18,-18,-50,-75,-89,-89,-75,-50,-18, 18, 50, 75, 89, 89, 75, 50, 18,-18,-50,-75,-89,-89,-75,-50,-18, 18, 50, 75, 89},
        { 88, 67, 31,-13,-54,-82,-90,-78,-46, -4, 38, 73, 90, 85, 61, 22,-22,-61,-85,-90,-73,-38,  4, 46, 78, 90, 82, 54, 13,-31,-67,-88},
        { 87, 57,  9,-43,-80,-90,-70,-25, 25, 70, 90, 80, 43, -9,-57,-87,-87,-57, -9, 43, 80, 90, 70, 25,-25,-70,-90,-80,-43,  9, 57, 87},
        { 85, 46,-13,-67,-90,-73,-22, 38, 82, 88, 54, -4,-61,-90,-78,-31, 31, 78, 90, 61,  4,-54,-88,-82,-38, 22, 73, 90, 67, 13,-46,-85},
        { 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83, 83, 36,-36,-83,-83,-36, 36, 83},
        { 82, 22,-54,-90,-61, 13, 78, 85, 31,-46,-90,-67,  4, 73, 88, 38,-38,-88,-73, -4, 67, 90, 46,-31,-85,-78,-13, 61, 90, 54,-22,-82},
        { 80,  9,-70,-87,-25, 57, 90, 43,-43,-90,-57, 25, 87, 70, -9,-80,-80, -9, 70, 87, 25,-57,-90,-43, 43, 90, 57,-25,-87,-70,  9, 80},
        { 78, -4,-82,-73, 13, 85, 67,-22,-88,-61, 31, 90, 54,-38,-90,-46, 46, 90, 38,-54,-90,-31, 61, 88, 22,-67,-85,-13, 73, 82,  4,-78},
        { 75,-18,-89,-50, 50, 89, 18,-75,-75, 18, 89, 50,-50,-89,-18, 75, 75,-18,-89,-50, 50, 89, 18,-75,-75, 18, 89, 50,-50,-89,-18, 75},
        { 73,-31,-90,-22, 78, 67,-38,-90,-13, 82, 61,-46,-88, -4, 85, 54,-54,-85,  4, 88, 46,-61,-82, 13, 90, 38,-67,-78, 22, 90, 31,-73},
        { 70,-43,-87,  9, 90, 25,-80,-57, 57, 80,-25,-90, -9, 87, 43,-70,-70, 43, 87, -9,-90,-25, 80, 57,-57,-80, 25, 90,  9,-87,-43, 70},
        { 67,-54,-78, 38, 85,-22,-90,  4, 90, 13,-88,-31, 82, 46,-73,-61, 61, 73,-46,-82, 31, 88,-13,-90, -4, 90, 22,-85,-38, 78, 54,-67},
        { 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64, 64,-64,-64, 64},
        { 61,-73,-46, 82, 31,-88,-13, 90, -4,-90, 22, 85,-38,-78, 54, 67,-67,-54, 78, 38,-85,-22, 90,  4,-90, 13, 88,-31,-82, 46, 73,-61},
        { 57,-80,-25, 90, -9,-87, 43, 70,-70,-43, 87,  9,-90, 25, 80,-57,-57, 80, 25,-90,  9, 87,-43,-70, 70, 43,-87, -9, 90,-25,-80, 57},
        { 54,-85, -4, 88,-46,-61, 82, 13,-90, 38, 67,-78,-22, 90,-31,-73, 73, 31,-90, 22, 78,-67,-38, 90,-13,-82, 61, 46,-88,  4, 85,-54},
        { 50,-89, 18, 75,-75,-18, 89,-50,-50, 89,-18,-75, 75, 18,-89, 50, 50,-89, 18, 75,-75,-18, 89,-50,-50, 89,-18,-75, 75, 18,-89, 50},
        { 46,-90, 38, 54,-90, 31, 61,-88, 22, 67,-85, 13, 73,-82,  4, 78,-78, -4, 82,-73,-13, 85,-67,-22, 88,-61,-31, 90,-54,-38, 90,-46},
        { 43,-90, 57, 25,-87, 70,  9,-80, 80, -9,-70, 87,-25,-57, 90,-43,-43, 90,-57,-25, 87,-70, -9, 80,-80,  9, 70,-87, 25, 57,-90, 43},
        { 38,-88, 73, -4,-67, 90,-46,-31, 85,-78, 13, 61,-90, 54, 22,-82, 82,-22,-54, 90,-61,-13, 78,-85, 31, 46,-90, 67,  4,-73, 88,-38},
        { 36,-83, 83,-36,-36, 83,-83, 36, 36,-83, 83,-36,-36, 83,-83, 36, 36,-83, 83,-36,-36, 83,-83, 36, 36,-83, 83,-36,-36, 83,-83, 36},
        { 31,-78, 90,-61,  4, 54,-88, 82,-38,-22, 73,-90, 67,-13,-46, 85,-85, 46, 13,-67, 90,-73, 22, 38,-82, 88,-54, -4, 61,-90, 78,-31},
        { 25,-70, 90,-80, 43,  9,-57, 87,-87, 57, -9,-43, 80,-90, 70,-25,-25, 70,-90, 80,-43, -9, 57,-87, 87,-57,  9, 43,-80, 90,-70, 25},
        { 22,-61, 85,-90, 73,-38, -4, 46,-78, 90,-82, 54,-13,-31, 67,-88, 88,-67, 31, 13,-54, 82,-90, 78,-46,  4, 38,-73, 90,-85, 61,-22},
        { 18,-50, 75,-89, 89,-75, 50,-18,-18, 50,-75, 89,-89, 75,-50, 18, 18,-50, 75,-89, 89,-75, 50,-18,-18, 50,-75, 89,-89, 75,-50, 18},
        { 13,-38, 61,-78, 88,-90, 85,-73, 54,-31,  4, 22,-46, 67,-82, 90,-90, 82,-67, 46,-22, -4, 31,-54, 73,-85, 90,-88, 78,-61, 38,-13},
        {  9,-25, 43,-57, 70,-80, 87,-90, 90,-87, 80,-70, 57,-43, 25, -9, -9, 25,-43, 57,-70, 80,-87, 90,-90, 87,-80, 70,-57, 43,-25,  9},
        {  4,-13, 22,-31, 38,-46, 54,-61, 67,-73, 78,-82, 85,-88, 90,-90, 90,-90, 88,-85, 82,-78, 73,-67, 61,-54, 46,-38, 31,-22, 13, -4},
    };

    for (int j = 0; j < line; j++) {
        int O[16], E[16], EO[8], EE[8], EEO[4], EEE[4];

        // Odd
        for (int k = 0; k < 16; k++) {
            O[k] = 0;
            for (int n = 0; n < 16; n++)
                O[k] += tm[2*n+1][k] * src[(2*n+1)*line+j];
        }
        // Even-Odd
        for (int k = 0; k < 8; k++) {
            EO[k] = 0;
            for (int n = 0; n < 8; n++)
                EO[k] += tm[2*(2*n+1)][k] * src[2*(2*n+1)*line+j];
        }
        // Even-Even-Odd
        for (int k = 0; k < 4; k++) {
            EEO[k] = 0;
            for (int n = 0; n < 4; n++)
                EEO[k] += tm[4*(2*n+1)][k] * src[4*(2*n+1)*line+j];
        }
        // Even-Even-Even-Even and Even-Even-Even-Odd (2-point + 2-point)
        int EEEE0 = 64 * src[0*line+j] + 64 * src[16*line+j];
        int EEEE1 = 64 * src[0*line+j] - 64 * src[16*line+j];
        int EEEO0 = 83 * src[8*line+j] + 36 * src[24*line+j];
        int EEEO1 = 36 * src[8*line+j] - 83 * src[24*line+j];
        EEE[0] = EEEE0 + EEEO0;
        EEE[1] = EEEE1 + EEEO1;
        EEE[2] = EEEE1 - EEEO1;
        EEE[3] = EEEE0 - EEEO0;

        // Build up
        EE[0] = EEE[0] + EEO[0]; EE[7] = EEE[0] - EEO[0];
        EE[1] = EEE[1] + EEO[1]; EE[6] = EEE[1] - EEO[1];
        EE[2] = EEE[2] + EEO[2]; EE[5] = EEE[2] - EEO[2];
        EE[3] = EEE[3] + EEO[3]; EE[4] = EEE[3] - EEO[3];

        for (int k = 0; k < 8; k++) {
            E[k]    = EE[k] + EO[k];
            E[15-k] = EE[k] - EO[k];
        }

        for (int k = 0; k < 16; k++) {
            dst[k*line+j]      = static_cast<int16_t>(Clip3(-32768, 32767, (E[k]+O[k]+add) >> shift));
            dst[(31-k)*line+j] = static_cast<int16_t>(Clip3(-32768, 32767, (E[k]-O[k]+add) >> shift));
        }
    }
}

// ============================================================
// 2D inverse transform (§8.6.4.2)
// Vertical pass -> clip -> horizontal pass
// ============================================================

static void inverse_transform_2d(int log2TrafoSize, bool use_dst,
                                  int bit_depth,
                                  const int16_t* coeff, int16_t* residual) {
    int trSize = 1 << log2TrafoSize;
    int16_t tmp[64 * 64];
    int16_t tmp2[64 * 64];

    // Vertical pass: shift1 = 7
    int shift1 = 7;
    // Horizontal pass: shift2 = 20 - BitDepth
    int shift2 = 20 - bit_depth;

    // Pass 1: vertical (columns)
    // idctN processes columns: for each j, transforms src[k*line+j] -> dst[k*line+j]
    if (use_dst && log2TrafoSize == 2) {
        idst4(coeff, tmp, shift1, trSize);
    } else {
        switch (log2TrafoSize) {
            case 2: idct4(coeff, tmp, shift1, trSize); break;
            case 3: idct8(coeff, tmp, shift1, trSize); break;
            case 4: idct16(coeff, tmp, shift1, trSize); break;
            case 5: idct32(coeff, tmp, shift1, trSize); break;
        }
    }

    // Transpose between passes so pass 2 transforms rows
    for (int y = 0; y < trSize; y++)
        for (int x = 0; x < trSize; x++)
            tmp2[y * trSize + x] = tmp[x * trSize + y];

    // Pass 2: horizontal (rows) — after transpose, columns of tmp2 are rows of tmp
    if (use_dst && log2TrafoSize == 2) {
        idst4(tmp2, tmp, shift2, trSize);
    } else {
        switch (log2TrafoSize) {
            case 2: idct4(tmp2, tmp, shift2, trSize); break;
            case 3: idct8(tmp2, tmp, shift2, trSize); break;
            case 4: idct16(tmp2, tmp, shift2, trSize); break;
            case 5: idct32(tmp2, tmp, shift2, trSize); break;
        }
    }

    // Transpose back to get final residual in row-major order
    for (int y = 0; y < trSize; y++)
        for (int x = 0; x < trSize; x++)
            residual[y * trSize + x] = tmp[x * trSize + y];

}

// ============================================================
// Dequantization (§8.6.3)
// ============================================================

void perform_dequant(DecodingContext& ctx, int x0, int y0,
                     int log2TrafoSize, int cIdx, int qp,
                     const int16_t* coefficients, int16_t* scaled) {
    int trSize = 1 << log2TrafoSize;

    // §8.6.3 — bdShift = BitDepth + Log2(nTbS) + 10 - log2TransformRange
    // log2TransformRange = 15 for Main profile
    int bitDepth = (cIdx == 0) ? ctx.sps->BitDepthY : ctx.sps->BitDepthC;
    int bdShift = bitDepth + log2TrafoSize + 10 - 15;
    int add = (bdShift > 0) ? (1 << (bdShift - 1)) : 0;

    int qpPer = qp / 6;
    int qpRem = qp % 6;
    int scale = levelScale[qpRem];

    // §8.6.3 collapses to 32-bit arithmetic whenever qpPer <= bdShift.
    // coeff * m * scale always fits in int32 (|32768 * 255 * 72| < 2^31); only the
    // << qpPer overflows, and dividing numerator and denominator by 2^qpPer turns
    // ((X << qpPer) + (1 << (bdShift-1))) >> bdShift into (X + (1 << (s-1))) >> s.
    // At s == 0 the rounding term vanishes and the result is X. i64 ops cost
    // noticeably more than i32 in WebAssembly, and this is a hot path.
    const int shiftDown = bdShift - qpPer;
    const bool narrow = (bdShift > 0) && (shiftDown >= 0);
    const int narrowAdd = (shiftDown >= 1) ? (1 << (shiftDown - 1)) : 0;

    // Check scaling lists
    bool useScalingList = ctx.sps->scaling_list_enabled_flag;

    for (int y = 0; y < trSize; y++) {
        for (int x = 0; x < trSize; x++) {
            int coeff = coefficients[y * trSize + x];
            if (coeff == 0) {
                scaled[y * trSize + x] = 0;
                continue;
            }

            int m = 16; // flat scaling (no scaling list)
            if (useScalingList) {
                // Get scaling list matrix value
                // For sizeId >= 2, upscale from 8x8
                int sizeId;
                if (log2TrafoSize == 2) sizeId = 0;
                else if (log2TrafoSize == 3) sizeId = 1;
                else if (log2TrafoSize == 4) sizeId = 2;
                else sizeId = 3;

                int matrixId;
                if (sizeId < 3) {
                    matrixId = (cIdx == 0) ? 0 : (cIdx == 1 ? 1 : 2);
                    // §8.6.3: CuPredMode[xTbY][yTbY] — use current CU, not (0,0)
                    if (ctx.cu_at(x0, y0).pred_mode != PredMode::MODE_INTRA)
                        matrixId += 3;
                } else {
                    matrixId = (ctx.cu_at(x0, y0).pred_mode == PredMode::MODE_INTRA) ? 0 : 3;
                }

                const auto& sl = ctx.pps->pps_scaling_list_data_present_flag ?
                    ctx.pps->scaling_list_data : ctx.sps->scaling_list_data;

                if (sizeId == 0) {
                    m = sl.scaling_list[sizeId][matrixId][y * trSize + x];
                } else {
                    // Upscale from 8x8 matrix
                    int ratio = trSize / 8;
                    if (ratio < 1) ratio = 1;
                    int idx = (y / ratio) * 8 + (x / ratio);
                    if (idx > 63) idx = 63;
                    m = sl.scaling_list[sizeId][matrixId % 6][idx];

                    // DC coeff override for 16x16 and 32x32
                    if ((sizeId == 2 || sizeId == 3) && x == 0 && y == 0) {
                        m = sl.scaling_list_dc[sizeId - 2][matrixId % 6];
                        if (m == 0) m = 16;
                    }
                }
            }

            // §8.6.3: d[x][y] = Clip3(coeffMin, coeffMax,
            //   ((coeff * m * levelScale[qP%6] << (qP/6)) + (1<<(bdShift-1))) >> bdShift)
            int val32;
            if (narrow) {
                const int prod = coeff * m * scale;
                val32 = (shiftDown >= 1) ? ((prod + narrowAdd) >> shiftDown) : prod;
            } else {
                int64_t val = static_cast<int64_t>(coeff) * m * scale;
                val = (val << qpPer) + add;
                val >>= bdShift;
                val32 = static_cast<int>(val);
            }
            scaled[y * trSize + x] = static_cast<int16_t>(Clip3(-32768, 32767, val32));
        }
    }
}

// ============================================================
// Transform inverse entry point
// ============================================================

void perform_transform_inverse(int log2TrafoSize, int cIdx,
                                bool is_intra, bool transform_skip,
                                int bit_depth,
                                const int16_t* scaled, int16_t* residual) {
    int trSize = 1 << log2TrafoSize;

    if (transform_skip) {
        // Transform skip: shift = 15 - BitDepth
        int shift = std::max(0, 15 - bit_depth);
        int add = (shift > 0) ? (1 << (shift - 1)) : 0;
        for (int i = 0; i < trSize * trSize; i++) {
            residual[i] = static_cast<int16_t>((scaled[i] + add) >> shift);
        }
        return;
    }

    // Use DST for 4x4 luma intra
    bool use_dst = (is_intra && cIdx == 0 && log2TrafoSize == 2);

    inverse_transform_2d(log2TrafoSize, use_dst, bit_depth, scaled, residual);
}

} // namespace hevc
