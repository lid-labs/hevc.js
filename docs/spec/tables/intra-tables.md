# Intra Prediction Tables

Tables for intra prediction (spec ITU-T H.265, section 8.4.4.2).

## intraPredAngle[35] — Prediction angles (Table 8-4)

Indexed by intra mode (0-34). Modes 0 (Planar) and 1 (DC) do not use an angle.

```cpp
const int8_t intraPredAngle[35] = {
     0,   0,  // modes 0-1: Planar, DC (no angle)
    32,  26,  21,  17,  13,   9,   5,   2,  // modes 2-9
     0,  -2,  -5,  -9, -13, -17, -21, -26,  // modes 10-17
   -32, -26, -21, -17, -13,  -9,  -5,  -2,  // modes 18-25
     0,   2,   5,   9,  13,  17,  21,  26,  // modes 26-33
    32                                        // mode 34
};
```

## invAngle[35] — Inverse angles for projection (Table 8-5)

Used only for modes with a negative angle (modes 11-25 except 18 and 26).
`invAngle = round(256 * 32 / abs(intraPredAngle))`.

```cpp
const int16_t invAngle[35] = {
       0,    0,  // modes 0-1 (not used)
     256,  315,  390,  482,  630,  910, 1638, 4096,  // modes 2-9
       0, 4096, 1638,  910,  630,  482,  390,  315,  // modes 10-17
     256,  315,  390,  482,  630,  910, 1638, 4096,  // modes 18-25
       0, 4096, 1638,  910,  630,  482,  390,  315,  // modes 26-33
     256                                              // mode 34
};
```

Note: only the values for negative angles are used. The 0s for modes 0, 1, 10, 26 are never accessed because these modes have no negative angle.

## Reference sample filtering (Table 8-3)

Condition for applying the [1,2,1]/4 filter on the reference samples, depending on the mode and the block size:

```cpp
// Returns true if the filter must be applied
bool intraFilterRequired(int mode, int log2BlkSize) {
    // No filtering for 4x4 blocks
    if (log2BlkSize == 2) return false;

    // Strong intra smoothing for 32x32 (handled separately)
    // The [1,2,1] filter is applied for the following modes:

    // Table 8-3: modes filtered per block size
    // 8x8  : modes 2-9, 11-17, 19-25, 27-34 (all except 0, 1, 10, 18, 26)
    // 16x16 : modes 2-9, 11-17, 19-25, 27-34 (same)
    // 32x32 : strong intra smoothing OR [1,2,1] filter depending on the condition

    // Simplified: filter if the mode is not DC, Planar, exact horizontal (10),
    // exact vertical (26), exact diagonal (2, 18, 34)
    static const bool filterFlag[35] = {
    //   0     1     2     3     4     5     6     7     8     9
        true, false,false, true, true, true, true, true, true, true,
    //  10    11    12    13    14    15    16    17    18    19
        false,true, true, true, true, true, true, true, false,true,
    //  20    21    22    23    24    25    26    27    28    29
        true, true, true, true, true, true, false,true, true, true,
    //  30    31    32    33    34
        true, true, true, true, false,
    };

    // The spec uses a more precise condition based on minDistVerHor
    // which depends on abs(intraPredAngle[mode])
    // For 8x8: filter if minDistVerHor > intraHorVerDistThres[log2BlkSize-2]
    // intraHorVerDistThres = { 7, 1, 0 } for 8x8, 16x16, 32x32

    int absAngle = abs(intraPredAngle[mode]);
    int thresholds[3] = { 7, 1, 0 };  // for log2BlkSize = 3, 4, 5
    return absAngle <= thresholds[log2BlkSize - 3];
}
```

## Strong Intra Smoothing (32x32 only)

Condition for applying it:

```cpp
bool useStrongSmoothing(int log2BlkSize, int BitDepth,
                         const int16_t* refSamples) {
    if (log2BlkSize != 5) return false;  // 32x32 only
    if (!sps.strong_intra_smoothing_enabled_flag) return false;

    int topLeft  = refSamples[0];             // p[-1][-1]
    int topRight = refSamples[64];            // p[63][-1]  (2*nTbS)
    int botLeft  = refSamples[64 + 64];       // p[-1][63]

    int threshold = 1 << (BitDepth - 5);

    // Bilinear condition: the intermediate samples must be
    // close to the bilinear interpolation between the corners
    bool bilinearTop = abs(topLeft + topRight - 2 * refSamples[32]) < threshold;
    bool bilinearLeft = abs(topLeft + botLeft - 2 * refSamples[64 + 32]) < threshold;

    return bilinearTop && bilinearLeft;
}
```

## MPM (Most Probable Modes) Derivation

```cpp
void deriveMPM(int candModeA, int candModeB, int candModeList[3]) {
    if (candModeA == candModeB) {
        if (candModeA < 2) {
            // Planar or DC
            candModeList[0] = 0;  // Planar
            candModeList[1] = 1;  // DC
            candModeList[2] = 26; // Vertical
        } else {
            candModeList[0] = candModeA;
            candModeList[1] = 2 + ((candModeA - 2 + 29) % 32);  // -3 modulo
            candModeList[2] = 2 + ((candModeA - 2 +  1) % 32);  // +1 modulo
        }
    } else {
        candModeList[0] = candModeA;
        candModeList[1] = candModeB;

        if (candModeA != 0 && candModeB != 0)
            candModeList[2] = 0;  // Planar
        else if (candModeA != 1 && candModeB != 1)
            candModeList[2] = 1;  // DC
        else
            candModeList[2] = 26; // Vertical
    }
}
```
