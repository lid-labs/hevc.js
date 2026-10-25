#include <algorithm>
#include "bitstream/bitstream_reader.h"
#include <cassert>
#include <cstring>
#include <stdexcept>

namespace hevc {

BitstreamReader::BitstreamReader(const uint8_t* data, size_t size)
    : data_(data), size_(size), bit_pos_(0),
      cache_(0), cache_bits_(0), byte_pos_(0),
      last_one_bit_pos_(find_last_one_bit(data, size))
{
    refill();
}

// Refill the 64-bit cache from the byte stream (MSB-aligned).
// Fast path: load 8 bytes at once when available (bulk load + byte swap).
// Fallback: byte-by-byte for the last few bytes.
void BitstreamReader::refill() {
    // Fast path: if cache is nearly empty and enough bytes remain, do a bulk load
    if (cache_bits_ <= 0 && byte_pos_ + 8 <= size_) {
        uint64_t raw;
        std::memcpy(&raw, data_ + byte_pos_, 8);
        // Convert from big-endian (network byte order) to host
#if defined(__GNUC__) || defined(__clang__)
        cache_ = __builtin_bswap64(raw);
#else
        // Portable fallback
        cache_ = ((raw & 0x00000000000000FFULL) << 56) |
                 ((raw & 0x000000000000FF00ULL) << 40) |
                 ((raw & 0x0000000000FF0000ULL) << 24) |
                 ((raw & 0x00000000FF000000ULL) <<  8) |
                 ((raw & 0x000000FF00000000ULL) >>  8) |
                 ((raw & 0x0000FF0000000000ULL) >> 24) |
                 ((raw & 0x00FF000000000000ULL) >> 40) |
                 ((raw & 0xFF00000000000000ULL) >> 56);
#endif
        cache_bits_ = 64;
        byte_pos_ += 8;
        return;
    }

    // Slow path: byte-by-byte for remaining bytes
    while (cache_bits_ <= 56 && byte_pos_ < size_) {
        cache_ |= static_cast<uint64_t>(data_[byte_pos_]) << (56 - cache_bits_);
        cache_bits_ += 8;
        byte_pos_++;
    }
}

uint32_t BitstreamReader::read_bits(int n) {
    assert(n >= 0 && n <= 32);
    if (n == 0) return 0;

    if (bit_pos_ + static_cast<size_t>(n) > size_ * 8) {
        throw std::runtime_error("BitstreamReader: read past end of data");
    }

    if (cache_bits_ < n) {
        refill();
    }

    // Extract n bits from the MSB side of the cache
    uint32_t result = static_cast<uint32_t>(cache_ >> (64 - n));
    cache_ <<= n;
    cache_bits_ -= n;
    bit_pos_ += n;

    return result;
}

// read_bits_safe is now inline in the header (CABAC hot path).

int32_t BitstreamReader::read_i(int n) {
    uint32_t val = read_bits(n);
    // Sign extension for 2's complement
    if (val & (1u << (n - 1))) {
        val |= (~0u) << n;
    }
    return static_cast<int32_t>(val);
}

uint8_t BitstreamReader::read_byte() {
    assert(byte_aligned());
    return static_cast<uint8_t>(read_bits(8));
}

// Exp-Golomb unsigned (§9.2)
// Reads leading zeros, then reads (leadingZeros + 1) bits
uint32_t BitstreamReader::read_ue() {
    int leading_zeros = 0;
    while (!eof() && read_bits(1) == 0) {
        leading_zeros++;
        if (leading_zeros > 31) {
            throw std::runtime_error("BitstreamReader: Exp-Golomb overflow");
        }
    }

    if (leading_zeros == 0) return 0;

    uint32_t suffix = read_bits(leading_zeros);
    return (1u << leading_zeros) - 1 + suffix;
}

// Exp-Golomb signed (§9.2)
// Maps: 0->0, 1->1, 2->-1, 3->2, 4->-2, ...
int32_t BitstreamReader::read_se() {
    uint32_t code = read_ue();
    int32_t value = static_cast<int32_t>((code + 1) / 2);
    return (code & 1) ? value : -value;
}

bool BitstreamReader::byte_aligned() const {
    return (bit_pos_ % 8) == 0;
}

void BitstreamReader::byte_alignment() {
    // §7.2 — always read alignment_bit_equal_to_one (1 bit),
    // then alignment_bit_equal_to_zero until byte aligned
    read_bits(1);  // alignment_bit_equal_to_one
    while (!byte_aligned()) {
        read_bits(1);  // alignment_bit_equal_to_zero
    }
}

// §7.2 — more_rbsp_data()
// Returns true if current position is before the rbsp_stop_one_bit.
// last_one_bit_pos_ is precomputed at construction — O(1) per call.
bool BitstreamReader::more_rbsp_data() const {
    if (bit_pos_ >= size_ * 8) return false;
    return bit_pos_ < last_one_bit_pos_;
}

// Scan backward from end to find the last '1' bit (rbsp_stop_one_bit).
// Called once at construction.
size_t BitstreamReader::find_last_one_bit(const uint8_t* data, size_t size) {
    for (size_t i = size; i > 0; i--) {
        uint8_t byte = data[i - 1];
        if (byte != 0) {
            // Find lowest set bit in this byte = last '1' bit in stream order
            int bit = 0;
            while (((byte >> bit) & 1) == 0) bit++;
            return (i - 1) * 8 + (7 - bit);
        }
    }
    return 0;
}

size_t BitstreamReader::bits_remaining() const {
    return (size_ * 8 > bit_pos_) ? (size_ * 8 - bit_pos_) : 0;
}

bool BitstreamReader::eof() const {
    return bit_pos_ >= size_ * 8;
}

void BitstreamReader::seek_to_byte(size_t pos) {
    assert(pos <= size_);
    bit_pos_ = pos * 8;
    byte_pos_ = pos;
    cache_ = 0;
    cache_bits_ = 0;
    refill();
}

void BitstreamReader::seek_to_bit(size_t pos) {
    seek_to_byte(std::min(pos / 8, size_));
    if (pos / 8 < size_) read_bits_safe(static_cast<int>(pos % 8));
    else bit_pos_ = pos;
}

// Emulation prevention byte removal (§7.3.1.1)
// In the byte stream, 0x000003 is an emulation prevention sequence.
// Remove the 0x03 byte to produce the RBSP.
std::vector<uint8_t> extract_rbsp(const uint8_t* nal_data, size_t nal_size) {
    std::vector<uint8_t> rbsp;
    rbsp.reserve(nal_size);

    size_t i = 0;
    while (i < nal_size) {
        // Check for emulation prevention: 0x00 0x00 0x03 followed by 0x00-0x03
        // Spec §7.3.1.1: the 0x03 byte is removed only when followed by
        // 0x00, 0x01, 0x02, or 0x03, or when it's the last byte of the NAL
        if (i + 2 < nal_size &&
            nal_data[i] == 0x00 &&
            nal_data[i + 1] == 0x00 &&
            nal_data[i + 2] == 0x03 &&
            (i + 3 >= nal_size || nal_data[i + 3] <= 0x03))
        {
            // Copy the two 0x00 bytes, skip the 0x03
            rbsp.push_back(0x00);
            rbsp.push_back(0x00);
            i += 3;  // skip emulation_prevention_three_byte
        } else {
            rbsp.push_back(nal_data[i]);
            i++;
        }
    }

    return rbsp;
}

std::vector<uint8_t> extract_rbsp(const uint8_t* nal_data, size_t nal_size,
                                   std::vector<size_t>& epb_positions) {
    std::vector<uint8_t> rbsp;
    rbsp.reserve(nal_size);
    epb_positions.clear();

    size_t i = 0;
    while (i < nal_size) {
        if (i + 2 < nal_size &&
            nal_data[i] == 0x00 &&
            nal_data[i + 1] == 0x00 &&
            nal_data[i + 2] == 0x03 &&
            (i + 3 >= nal_size || nal_data[i + 3] <= 0x03))
        {
            rbsp.push_back(0x00);
            rbsp.push_back(0x00);
            epb_positions.push_back(i + 2);  // position of the 0x03 byte
            i += 3;
        } else {
            rbsp.push_back(nal_data[i]);
            i++;
        }
    }

    return rbsp;
}

size_t coded_to_rbsp_offset(size_t coded_offset, size_t slice_data_start_coded,
                            const std::vector<size_t>& epb_positions) {
    // coded_offset is relative to slice data start in the coded (NAL) domain.
    // We need to subtract the number of EP bytes that fall before this position.
    size_t abs_coded = slice_data_start_coded + coded_offset;
    size_t epb_count = 0;
    for (size_t pos : epb_positions) {
        if (pos < abs_coded)
            epb_count++;
        else
            break;
    }
    // RBSP offset = coded offset from NAL start - EP bytes before it
    // But we want RBSP offset from slice data start in RBSP
    size_t slice_data_start_rbsp = slice_data_start_coded;
    for (size_t pos : epb_positions) {
        if (pos < slice_data_start_coded)
            slice_data_start_rbsp--;
        else
            break;
    }
    return (abs_coded - epb_count) - slice_data_start_rbsp;
}

} // namespace hevc
