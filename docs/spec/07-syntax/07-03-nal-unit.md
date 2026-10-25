# §7.3.1 — NAL Unit Syntax

Spec ref: §7.3.1 (syntax), §7.4.2 (semantics)

## Pseudo-code spec

```
nal_unit(NumBytesInNalUnit) {
    nal_unit_header()
    NumBytesInRbsp = 0
    for(i = 2; i < NumBytesInNalUnit; i++) {
        if(i + 2 < NumBytesInNalUnit && next_bits(24) == 0x000003) {
            rbsp_byte[NumBytesInRbsp++]    b(8)
            rbsp_byte[NumBytesInRbsp++]    b(8)
            i += 2
            emulation_prevention_three_byte    f(8)  // = 0x03
        } else {
            rbsp_byte[NumBytesInRbsp++]    b(8)
        }
    }
}

nal_unit_header() {
    forbidden_zero_bit    f(1)    // = 0
    nal_unit_type         u(6)
    nuh_layer_id          u(6)
    nuh_temporal_id_plus1 u(3)
}
```

## C++ translation

```cpp
struct NalUnitHeader {
    uint8_t nal_unit_type;          // 0-63
    uint8_t nuh_layer_id;           // 0-63
    uint8_t nuh_temporal_id_plus1;  // 1-7

    // Derived (§7.4.2.2)
    uint8_t TemporalId() const { return nuh_temporal_id_plus1 - 1; }
};

struct NalUnit {
    NalUnitHeader header;
    std::vector<uint8_t> rbsp_data;  // after removal of the emulation prevention bytes
};

// Parsing
NalUnitHeader parse_nal_unit_header(BitstreamReader& bs) {
    NalUnitHeader h;
    uint8_t forbidden = bs.read_bits(1);  // must be 0
    h.nal_unit_type = bs.read_bits(6);
    h.nuh_layer_id = bs.read_bits(6);
    h.nuh_temporal_id_plus1 = bs.read_bits(3);
    return h;
}

// Emulation prevention byte removal (§7.3.1.1)
std::vector<uint8_t> extract_rbsp(const uint8_t* data, size_t size) {
    std::vector<uint8_t> rbsp;
    rbsp.reserve(size);
    for (size_t i = 0; i < size; ) {
        if (i + 2 < size && data[i] == 0x00 && data[i+1] == 0x00 && data[i+2] == 0x03) {
            rbsp.push_back(0x00);
            rbsp.push_back(0x00);
            i += 3;  // skip emulation prevention byte
        } else {
            rbsp.push_back(data[i++]);
        }
    }
    return rbsp;
}
```

## Annex B — Byte Stream Format

```
byte_stream_nal_unit() {
    while(next_bits(24) != 0x000001 && next_bits(32) != 0x00000001)
        leading_zero_8bits    f(8)    // = 0x00
    if(next_bits(24) != 0x000001)
        zero_byte             f(8)    // = 0x00
    start_code_prefix_one_3bytes    f(24)    // = 0x000001
    nal_unit(NumBytesInNalUnit)
    while(more_data_in_byte_stream() && next_bits(24) != 0x000001 &&
          next_bits(32) != 0x00000001)
        trailing_zero_8bits   f(8)    // = 0x00
}
```

### C++ translation — Start code detection

```cpp
// Find the NAL units in a byte stream (Annex B)
std::vector<NalUnit> parse_byte_stream(const uint8_t* data, size_t size) {
    std::vector<NalUnit> nalus;
    size_t i = 0;

    while (i < size) {
        // Look for a start code (0x000001 or 0x00000001)
        size_t start = find_start_code(data, size, i);
        if (start == size) break;

        // Find the end (next start code or end of data)
        size_t end = find_start_code(data, size, start + 3);
        // Remove trailing zeros
        while (end > start + 3 && data[end - 1] == 0x00) end--;

        // Parse the NAL unit
        NalUnit nalu;
        BitstreamReader bs(data + start, end - start);
        nalu.header = parse_nal_unit_header(bs);
        nalu.rbsp_data = extract_rbsp(data + start + 2, end - start - 2);
        nalus.push_back(std::move(nalu));

        i = end;
    }
    return nalus;
}
```

## Key semantics (§7.4.2)

- `forbidden_zero_bit`: MUST be 0, otherwise the NAL unit is invalid
- `nal_unit_type`: determines the RBSP type (VPS, SPS, PPS, slice, SEI, etc.)
- `nuh_layer_id`: 0 for single-layer (only 0 is supported for now)
- `TemporalId = nuh_temporal_id_plus1 - 1`: 0 for the base layer

### NAL unit classification

```cpp
bool is_vcl_nal(uint8_t type) { return type <= 31; }
bool is_irap_nal(uint8_t type) { return type >= 16 && type <= 23; }
bool is_idr_nal(uint8_t type) { return type == 19 || type == 20; }
bool is_cra_nal(uint8_t type) { return type == 21; }
bool is_bla_nal(uint8_t type) { return type >= 16 && type <= 18; }
bool is_rasl_nal(uint8_t type) { return type == 8 || type == 9; }
bool is_radl_nal(uint8_t type) { return type == 6 || type == 7; }
```

## Access Unit delimitation (§7.4.2.4.4)

An Access Unit (AU) corresponds to one decoded frame. Detecting AU boundaries is necessary for frame-by-frame decoding.

### Detection rules

A new AU starts when one of these conditions is met:

1. **AUD**: An `AUD_NUT` (type 35) always marks the start of an AU
2. **First VCL**: A VCL NAL with `first_slice_segment_in_pic_flag == 1`
3. **Non-VCL -> VCL transition**: Certain non-VCL NAL types (VPS, SPS, PPS, PREFIX_SEI) after a VCL NAL indicate a new AU

```cpp
bool is_new_access_unit(const NalUnit& prev_vcl, const NalUnit& current) {
    // AUD is always a delimiter
    if (current.header.nal_unit_type == AUD_NUT)
        return true;

    // The following non-VCL NAL types, after a VCL, indicate a new AU
    if (prev_vcl.valid && !is_vcl_nal(current.header.nal_unit_type)) {
        uint8_t t = current.header.nal_unit_type;
        if (t == VPS_NUT || t == SPS_NUT || t == PPS_NUT ||
            t == PREFIX_SEI_NUT || t == AUD_NUT ||
            (t >= 41 && t <= 44) || (t >= 48 && t <= 55))
            return true;
    }

    // VCL NAL with first_slice_segment_in_pic_flag
    if (is_vcl_nal(current.header.nal_unit_type)) {
        // Read the first bit of the RBSP = first_slice_segment_in_pic_flag
        return current.rbsp_data[0] & 0x80;  // first bit of the first byte
    }

    return false;
}
```

## Checklist

- [ ] BitstreamReader with read_bits, read_u, read_i, byte_aligned, more_rbsp_data
- [ ] Start code detection (3-byte and 4-byte)
- [ ] Emulation prevention byte removal
- [ ] NAL unit header parsing
- [ ] Classification helpers (is_vcl, is_irap, etc.)
- [ ] Tests: parse a raw bitstream and list the NAL units
- [ ] Validation: compare the NAL listing with libde265 --dump-headers
