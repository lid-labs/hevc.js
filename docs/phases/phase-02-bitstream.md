# Phase 2 — Bitstream & NAL Unit Parsing

## Goal
Read a raw HEVC stream (Annex B), isolate the NAL units, extract the RBSP.

## Prerequisites
Phase 1 completed (BitstreamReader, infrastructure).

## Spec refs
- Annex B: Byte stream format
- §7.3.1: NAL unit syntax
- §7.4.2: NAL unit semantics

## Tasks

### 2.1 — Start Code Detection
- [ ] Find the 3-byte (0x000001) and 4-byte (0x00000001) start codes
- [ ] Handle leading_zero_8bits and trailing_zero_8bits
- [ ] Split the byte stream into raw NAL units
- [ ] Tests: file with multiple NAL units

### 2.2 — Emulation Prevention Byte Removal
- [ ] Detect and remove the 0x03 bytes in 0x000003xx sequences
- [ ] Produce clean RBSP data
- [ ] Tests: check that 0x000000 and 0x000001 in the data are correctly preserved

### 2.3 — NAL Unit Header Parsing
- [ ] `forbidden_zero_bit` (check)
- [ ] `nal_unit_type` (6 bits)
- [ ] `nuh_layer_id` (6 bits)
- [ ] `nuh_temporal_id_plus1` (3 bits)
- [ ] `TemporalId` derivation
- [ ] Helpers: `is_vcl()`, `is_irap()`, `is_idr()`, etc.

### 2.4 — Exp-Golomb Coding
- [ ] `read_ue()`: unsigned Exp-Golomb
- [ ] `read_se()`: signed Exp-Golomb
- [ ] Edge cases: value 0, large values, bitstream errors
- [ ] Exhaustive unit tests

### 2.5 — Test CLI
- [ ] `hevc-torture --dump-nals input.265` program
- [ ] Prints for each NAL: offset, type, size, TemporalId
- [ ] Tabular format for each NAL: offset, type, size, TemporalId

### 2.6 — Access Unit Boundary Detection (§7.4.2.4.4)
Detect the boundaries between Access Units (= frames) in the NAL stream.

- [ ] Main rule: a new AU starts when a VCL NAL with `first_slice_segment_in_pic_flag == 1` is encountered
- [ ] AUD (Access Unit Delimiter, nal_unit_type == 35): if present, explicitly marks the start of an AU
- [ ] A **prefix SEI** (nal_unit_type == 39) after a VCL NAL triggers a new AU
- [ ] A **suffix SEI** (nal_unit_type == 40) after a VCL NAL **does NOT trigger** a new AU — it belongs to the same AU as the preceding VCL
- [ ] VPS/SPS/PPS (nal_unit_type 32-34) after a VCL NAL trigger a new AU
- [ ] EOS (nal_unit_type == 36) and EOB (nal_unit_type == 37) end the current AU
- [ ] RSV_NVCL (41..47) and UNSPEC (48..63) after a VCL NAL trigger a new AU
- [ ] Store the NAL units grouped by AU for frame-by-frame decoding
- [ ] Tests: check the number of detected frames against the actual number
- [ ] Tests: bitstream with suffix SEI (e.g. decoded_picture_hash) — must NOT create an extra AU

### 2.7 — more_rbsp_data() (§7.2)
Correct implementation of the `more_rbsp_data()` function:

- [ ] It is NOT simply "are there any bits left in the buffer"
- [ ] Algorithm: the end of the RBSP contains an `rbsp_stop_one_bit` (= 1) followed by `rbsp_alignment_zero_bit` (= 0) to fill up to byte alignment
- [ ] `more_rbsp_data()` returns `true` if the current position is BEFORE the `rbsp_stop_one_bit`
- [ ] Practical implementation: scan backwards from the end of the RBSP to find the last bit set to 1. If the current position is before that bit, return `true`.
- [ ] **Pitfall**: a `1` followed by `0000000` at the end of the RBSP is NOT data — it is the stop bit + alignment

```cpp
bool BitstreamReader::more_rbsp_data() {
    // Save the current position
    size_t saved_pos = bit_position;

    // Find the position of the rbsp_stop_one_bit
    // It is the last bit set to 1 in the RBSP
    size_t last_one_bit = find_last_one_bit();  // scan from the end

    // There is more data if we are before the stop bit
    return bit_position < last_one_bit;
}
```

## Exit criterion

- Parse any .265 file and correctly list all the NAL units
- Listing compared with `dec265 --dump-headers`: 100% match on the type and the number of NAL units

## Oracle validation
```bash
# Generate the listings
./hevc-torture --dump-nals test.265 > our_nals.txt
dec265 test.265 --dump-headers 2>&1 | grep "NAL" > ref_nals.txt
diff our_nals.txt ref_nals.txt
```

## Complexity estimate
Low to moderate. Fundamental code but well defined by the spec.
