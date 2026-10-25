# Test Mini-Bitstreams (Annotated Hex)

Small synthetic HEVC bitstreams for unit and integration tests.
Usable directly in C++ code without an external file.

## 1. Minimal NAL Unit — VPS (Phase 2)

A minimal valid VPS (2-byte header + RBSP).

```
Byte stream (hex):
00 00 00 01    — 4-byte start code
40 01          — NAL header: forbidden=0, nal_unit_type=32 (VPS), nuh_layer_id=0, nuh_temporal_id_plus1=1
0C 01 FF FF    — start of VPS RBSP (vps_video_parameter_set_id=0, ...)
01 60 00 00    — VPS continued
03 00 00 03    — contains an emulation prevention byte (0x000003)
00 00 03 00    — another emulation prevention
96 AC 09 00    — continued
80             — rbsp_stop_one_bit + alignment
```

```cpp
// Usage in a test
const uint8_t vps_nal[] = {
    0x00, 0x00, 0x00, 0x01,  // start code
    0x40, 0x01,              // NAL header: type=32(VPS), layer=0, tid=1
    0x0C, 0x01, 0xFF, 0xFF,
    0x01, 0x60, 0x00, 0x00,
    0x03, 0x00, 0x00, 0x03,
    0x00, 0x00, 0x03, 0x00,
    0x96, 0xAC, 0x09, 0x00,
    0x80
};
// NAL type = (0x40 >> 1) & 0x3F = 32 = VPS_NUT
// nuh_layer_id = ((0x40 & 0x01) << 5) | ((0x01 >> 3) & 0x1F) = 0
// nuh_temporal_id_plus1 = 0x01 & 0x07 = 1
```

## 2. Minimal Sequence — VPS + SPS + PPS + I-Slice (Phase 3-4)

The smallest decodable HEVC bitstream: 1 8x8 frame, fixed QP, a single CTU.

```cpp
// Generated with x265 --input raw_8x8.yuv --input-res 8x8 --fps 1 --frames 1
// --preset ultrafast --qp 30 --keyint 1 --no-deblock --no-sao --no-wpp
// Then converted to hex
const uint8_t minimal_idr_8x8[] = {
    // --- VPS ---
    0x00, 0x00, 0x00, 0x01,  // start code
    0x40, 0x01,              // NAL type=32 (VPS)
    0x0C, 0x01, 0xFF, 0xFF, 0x01, 0x60, 0x00, 0x00,
    0x03, 0x00, 0x90, 0x00, 0x00, 0x03, 0x00, 0x00,
    0x03, 0x00, 0x5D, 0xAC, 0x09,

    // --- SPS ---
    0x00, 0x00, 0x00, 0x01,  // start code
    0x42, 0x01,              // NAL type=33 (SPS)
    0x01, 0x01, 0x60, 0x00, 0x00, 0x03, 0x00, 0x90,
    0x00, 0x00, 0x03, 0x00, 0x00, 0x03, 0x00, 0x5D,
    0xA0, 0x02, 0x80, 0x80, 0x24, 0x1F, 0xE5, 0x94,
    0x92, 0x4A, 0x10, 0x10, 0x10, 0x08,

    // --- PPS ---
    0x00, 0x00, 0x00, 0x01,  // start code
    0x44, 0x01,              // NAL type=34 (PPS)
    0xC0, 0xF3, 0xC0, 0x04, 0x10,

    // --- IDR Slice ---
    0x00, 0x00, 0x00, 0x01,  // start code
    0x26, 0x01,              // NAL type=19 (IDR_W_RADL)
    // ... slice data (CABAC coded)
};
// NOTE: This bitstream is an EXAMPLE of the structure.
// For a truly decodable bitstream, use x265 to generate
// a .265 file then convert it to a C++ array with xxd -i.
```

## 3. NAL Header Breakdown (Phase 2)

Annotated NAL header examples for testing parsing:

```cpp
struct NalTestCase {
    uint8_t bytes[2];
    NalUnitType expected_type;
    uint8_t expected_layer_id;
    uint8_t expected_temporal_id;
    const char* description;
};

const NalTestCase nal_header_tests[] = {
    // bytes         type              layer  tid  description
    {{ 0x40, 0x01 }, NalUnitType::VPS_NUT,   0, 0, "VPS" },
    {{ 0x42, 0x01 }, NalUnitType::SPS_NUT,   0, 0, "SPS" },
    {{ 0x44, 0x01 }, NalUnitType::PPS_NUT,   0, 0, "PPS" },
    {{ 0x4E, 0x01 }, NalUnitType::PREFIX_SEI,0, 0, "Prefix SEI" },
    {{ 0x50, 0x01 }, NalUnitType::SUFFIX_SEI,0, 0, "Suffix SEI" },
    {{ 0x26, 0x01 }, NalUnitType::IDR_W_RADL,0, 0, "IDR with RADL" },
    {{ 0x28, 0x01 }, NalUnitType::IDR_N_LP,  0, 0, "IDR no LP" },
    {{ 0x02, 0x01 }, NalUnitType::TRAIL_R,   0, 0, "Trailing (ref)" },
    {{ 0x00, 0x01 }, NalUnitType::TRAIL_N,   0, 0, "Trailing (non-ref)" },
    {{ 0x2A, 0x01 }, NalUnitType::CRA_NUT,   0, 0, "CRA" },
    {{ 0x46, 0x01 }, NalUnitType::AUD_NUT,   0, 0, "Access Unit Delimiter" },
    {{ 0x48, 0x01 }, NalUnitType::EOS_NUT,   0, 0, "End of Sequence" },
    {{ 0x02, 0x03 }, NalUnitType::TRAIL_R,   0, 2, "Trail R, TemporalId=2" },
    {{ 0x02, 0x05 }, NalUnitType::TRAIL_R,   0, 4, "Trail R, TemporalId=4" },
};

// NAL header breakdown (2 bytes):
// Byte 0: [forbidden_zero_bit(1)] [nal_unit_type(6)] [nuh_layer_id MSB(1)]
// Byte 1: [nuh_layer_id LSB(5)]  [nuh_temporal_id_plus1(3)]
//
// nal_unit_type   = (byte0 >> 1) & 0x3F
// nuh_layer_id    = ((byte0 & 1) << 5) | ((byte1 >> 3) & 0x1F)
// temporal_id     = (byte1 & 0x07) - 1
```

## 4. Exp-Golomb test vectors (Phase 2)

```cpp
struct ExpGolombTestCase {
    std::vector<uint8_t> bytes;
    int start_bit;        // bit offset in bytes
    uint32_t expected_ue;
    int32_t expected_se;
    int bits_consumed;
};

const ExpGolombTestCase eg_tests[] = {
    // ue(0) = 1 -> 1 bit
    { {0x80}, 0, 0, 0, 1 },
    // ue(1) = 010 -> 3 bits
    { {0x40}, 0, 1, 1, 3 },
    // ue(2) = 011 -> 3 bits
    { {0x60}, 0, 2, -1, 3 },
    // ue(3) = 00100 -> 5 bits
    { {0x20}, 0, 3, 2, 5 },
    // ue(4) = 00101 -> 5 bits
    { {0x28}, 0, 4, -2, 5 },
    // ue(5) = 00110 -> 5 bits
    { {0x30}, 0, 5, 3, 5 },
    // ue(6) = 00111 -> 5 bits
    { {0x38}, 0, 6, -3, 5 },
    // ue(7) = 0001000 -> 7 bits
    { {0x10}, 0, 7, 4, 7 },
    // ue(8) = 0001001 -> 7 bits
    { {0x12}, 0, 8, -4, 7 },
    // ue(255) = 00000000 100000000 -> 17 bits
    { {0x00, 0x80, 0x00}, 0, 255, 128, 17 },
};
```

## 5. Access Unit Boundary test vectors (Phase 2)

```cpp
// NAL unit sequence to test AU boundary detection
const uint8_t au_boundary_test[] = {
    // === AU 0 ===
    0x00, 0x00, 0x00, 0x01, 0x40, 0x01, /* VPS data... */ 0x80,
    0x00, 0x00, 0x00, 0x01, 0x42, 0x01, /* SPS data... */ 0x80,
    0x00, 0x00, 0x00, 0x01, 0x44, 0x01, /* PPS data... */ 0x80,
    0x00, 0x00, 0x00, 0x01, 0x26, 0x01, /* IDR slice first_slice=1 */ 0x80,
    0x00, 0x00, 0x00, 0x01, 0x50, 0x01, /* Suffix SEI (same AU!) */ 0x80,

    // === AU 1 ===
    0x00, 0x00, 0x00, 0x01, 0x4E, 0x01, /* Prefix SEI (new AU!) */ 0x80,
    0x00, 0x00, 0x00, 0x01, 0x02, 0x01, /* TRAIL_R first_slice=1 */ 0x80,

    // === AU 2 ===
    0x00, 0x00, 0x00, 0x01, 0x02, 0x01, /* TRAIL_R first_slice=1 */ 0x80,
};

// Expected result: 3 Access Units
// AU 0 : VPS + SPS + PPS + IDR + Suffix SEI (5 NALs)
// AU 1 : Prefix SEI + TRAIL_R (2 NALs)
// AU 2 : TRAIL_R (1 NAL)
//
// PITFALL: the Suffix SEI (type 40) stays in AU 0
//          the Prefix SEI (type 39) starts AU 1
```

## 6. Emulation Prevention test vectors (Phase 2)

```cpp
struct EmulationPreventionTest {
    std::vector<uint8_t> input;
    std::vector<uint8_t> expected_rbsp;
    const char* description;
};

const EmulationPreventionTest ep_tests[] = {
    {
        { 0x00, 0x00, 0x03, 0x00 },
        { 0x00, 0x00, 0x00 },
        "0x000300 -> 0x0000"
    },
    {
        { 0x00, 0x00, 0x03, 0x01 },
        { 0x00, 0x00, 0x01 },
        "0x000301 -> 0x0001 (would be start code without EP)"
    },
    {
        { 0x00, 0x00, 0x03, 0x02 },
        { 0x00, 0x00, 0x02 },
        "0x000302 -> 0x0002"
    },
    {
        { 0x00, 0x00, 0x03, 0x03 },
        { 0x00, 0x00, 0x03 },
        "0x000303 -> 0x0003 (preserves the 03 byte)"
    },
    {
        { 0xAB, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x03, 0xCD },
        { 0xAB, 0x00, 0x00, 0x00, 0x00, 0x00, 0xCD },
        "Multiple EP bytes in sequence"
    },
    {
        { 0x00, 0x00, 0x04, 0x00, 0x00, 0x05 },
        { 0x00, 0x00, 0x04, 0x00, 0x00, 0x05 },
        "0x000004 and 0x000005 are NOT EP sequences"
    },
};
```

## How to generate real test bitstreams

```bash
# Create a raw 8x8 YUV (all pixels at 128)
python3 -c "import sys; sys.stdout.buffer.write(bytes([128]*8*8 + [128]*4*4*2))" > /tmp/gray_8x8.yuv

# Encode with x265
x265 --input /tmp/gray_8x8.yuv --input-res 8x8 --fps 1 --frames 1 \
     --preset ultrafast --qp 30 --keyint 1 --no-deblock --no-sao \
     -o /tmp/test_8x8.265

# Convert to a C++ array
xxd -i /tmp/test_8x8.265 > tests/fixtures/test_8x8.h

# Decode with libde265 for reference
dec265 /tmp/test_8x8.265 -o /tmp/ref_8x8.yuv
```
