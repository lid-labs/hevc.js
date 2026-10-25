# CABAC Arithmetic Decoder Tables

Tables extracted from the spec ITU-T H.265, section 9.3.4.3.

## rangeTabLps[64][4]

Index: `[pStateIdx][qRangeIdx]` where `qRangeIdx = (ivlCurrRange >> 6) & 3`

```cpp
const uint8_t rangeTabLps[64][4] = {
    { 128, 176, 208, 240 },  //  0
    { 128, 167, 197, 227 },  //  1
    { 128, 158, 187, 216 },  //  2
    { 123, 150, 178, 205 },  //  3
    { 116, 142, 169, 195 },  //  4
    { 111, 135, 160, 185 },  //  5
    { 105, 128, 152, 175 },  //  6
    { 100, 122, 144, 166 },  //  7
    {  95, 116, 137, 158 },  //  8
    {  90, 110, 130, 150 },  //  9
    {  85, 104, 123, 142 },  // 10
    {  81,  99, 117, 135 },  // 11
    {  77,  94, 111, 128 },  // 12
    {  73,  89, 105, 122 },  // 13
    {  69,  85, 100, 116 },  // 14
    {  66,  80,  95, 110 },  // 15
    {  62,  76,  90, 104 },  // 16
    {  59,  72,  86,  99 },  // 17
    {  56,  69,  81,  94 },  // 18
    {  53,  65,  77,  89 },  // 19
    {  51,  62,  73,  85 },  // 20
    {  48,  59,  69,  80 },  // 21
    {  46,  56,  66,  76 },  // 22
    {  43,  53,  63,  72 },  // 23
    {  41,  50,  59,  69 },  // 24
    {  39,  48,  56,  65 },  // 25
    {  37,  45,  54,  62 },  // 26
    {  35,  43,  51,  59 },  // 27
    {  33,  41,  48,  56 },  // 28
    {  32,  39,  46,  53 },  // 29
    {  30,  37,  43,  50 },  // 30
    {  29,  35,  41,  48 },  // 31
    {  27,  33,  39,  45 },  // 32
    {  26,  31,  37,  43 },  // 33
    {  24,  30,  35,  41 },  // 34
    {  23,  28,  33,  39 },  // 35
    {  22,  27,  32,  37 },  // 36
    {  21,  26,  30,  35 },  // 37
    {  20,  24,  29,  33 },  // 38
    {  19,  23,  27,  31 },  // 39
    {  18,  22,  26,  30 },  // 40
    {  17,  21,  25,  28 },  // 41
    {  16,  20,  23,  27 },  // 42
    {  15,  19,  22,  25 },  // 43
    {  14,  18,  21,  24 },  // 44
    {  14,  17,  20,  23 },  // 45
    {  13,  16,  19,  22 },  // 46
    {  12,  15,  18,  21 },  // 47
    {  12,  14,  17,  20 },  // 48
    {  11,  14,  16,  19 },  // 49
    {  11,  13,  15,  18 },  // 50
    {  10,  12,  15,  17 },  // 51
    {  10,  12,  14,  16 },  // 52
    {   9,  11,  13,  15 },  // 53
    {   9,  11,  12,  14 },  // 54
    {   8,  10,  12,  14 },  // 55
    {   8,   9,  11,  13 },  // 56
    {   7,   9,  11,  12 },  // 57
    {   7,   9,  10,  12 },  // 58
    {   7,   8,  10,  11 },  // 59
    {   6,   8,   9,  11 },  // 60
    {   6,   7,   9,  10 },  // 61
    {   6,   7,   8,   9 },  // 62
    {   2,   2,   2,   2 },  // 63
};
```

## transIdxMps[64] — State transition after MPS

```cpp
const uint8_t transIdxMps[64] = {
     1,  2,  3,  4,  5,  6,  7,  8,  9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50,
    51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    61, 62, 62, 63,
};
```

## transIdxLps[64] — State transition after LPS

```cpp
const uint8_t transIdxLps[64] = {
     0,  0,  1,  2,  2,  4,  4,  5,  6,  7,
     8,  9,  9, 11, 11, 12, 13, 13, 15, 15,
    16, 16, 18, 18, 19, 19, 21, 21, 22, 22,
    23, 24, 24, 25, 26, 26, 27, 27, 28, 29,
    29, 30, 30, 30, 31, 32, 32, 33, 33, 33,
    34, 34, 35, 35, 35, 36, 36, 36, 37, 37,
    37, 38, 38, 63,
};
```

## decode_decision algorithm (§9.3.4.3.2)

```cpp
int CabacDecoder::decode_decision(int ctxIdx) {
    uint8_t pStateIdx = contexts[ctxIdx].pStateIdx;
    uint8_t valMps    = contexts[ctxIdx].valMps;

    uint8_t qRangeIdx = (ivlCurrRange >> 6) & 3;
    uint8_t ivlLpsRange = rangeTabLps[pStateIdx][qRangeIdx];

    ivlCurrRange -= ivlLpsRange;

    int binVal;
    if (ivlOffset >= ivlCurrRange) {
        // LPS
        binVal = 1 - valMps;
        ivlOffset -= ivlCurrRange;
        ivlCurrRange = ivlLpsRange;

        if (pStateIdx == 0)
            contexts[ctxIdx].valMps = 1 - valMps;

        contexts[ctxIdx].pStateIdx = transIdxLps[pStateIdx];
    } else {
        // MPS
        binVal = valMps;
        contexts[ctxIdx].pStateIdx = transIdxMps[pStateIdx];
    }

    renormalize();
    return binVal;
}
```

## decode_bypass algorithm (§9.3.4.3.4)

```cpp
int CabacDecoder::decode_bypass() {
    ivlOffset = (ivlOffset << 1) | read_bit();

    if (ivlOffset >= ivlCurrRange) {
        ivlOffset -= ivlCurrRange;
        return 1;
    }
    return 0;
}
```

## decode_terminate algorithm (§9.3.4.3.5)

```cpp
int CabacDecoder::decode_terminate() {
    ivlCurrRange -= 2;

    if (ivlOffset >= ivlCurrRange) {
        // end_of_slice_segment_flag = 1
        return 1;
    }

    renormalize();
    return 0;
}
```

## Renormalization (§9.3.4.3.3)

```cpp
void CabacDecoder::renormalize() {
    while (ivlCurrRange < 256) {
        ivlCurrRange <<= 1;
        ivlOffset = (ivlOffset << 1) | read_bit();
    }
}
```

## Initialization (§9.3.4.3.1)

```cpp
void CabacDecoder::init_decoder(BitstreamReader& bs) {
    ivlCurrRange = 510;
    ivlOffset = bs.read_bits(9);
}
```
