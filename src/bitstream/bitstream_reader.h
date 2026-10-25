#pragma once

#include <cstdint>
#include <cstddef>
#include <vector>

namespace hevc {

// BitstreamReader — Reads bits from an RBSP buffer
// Spec refs: §7.2 (more_rbsp_data), §9.1 (parsing)
//
// Uses a 64-bit cache with lazy refill for O(1) read_bits.
// The last-one-bit position (for more_rbsp_data) is computed once at construction.
class BitstreamReader {
public:
    BitstreamReader() = default;
    BitstreamReader(const uint8_t* data, size_t size);

    // Fixed-length reads
    uint32_t read_bits(int n);
    uint32_t read_u(int n) { return read_bits(n); }
    int32_t  read_i(int n);
    bool     read_flag() { return read_bits(1) != 0; }
    uint8_t  read_byte();

    // Read bits with zero-padding past end (for CABAC renormalization).
    // Inline: called from CABAC hot path (renormalize, decode_bypass_bins).
    inline uint32_t read_bits_safe(int n) {
        if (n == 0) return 0;
        if (cache_bits_ < n) refill();
        if (cache_bits_ < n) {
            // Past end — return zero-padded
            uint32_t result = 0;
            if (cache_bits_ > 0)
                result = static_cast<uint32_t>(cache_ >> (64 - n));
            cache_ = 0;
            bit_pos_ += n;
            cache_bits_ = 0;
            return result;
        }
        uint32_t result = static_cast<uint32_t>(cache_ >> (64 - n));
        cache_ <<= n;
        cache_bits_ -= n;
        bit_pos_ += n;
        return result;
    }

    // Fast single-bit read for CABAC hot path (inline, no n==0 check)
    inline uint32_t read_bit_fast() {
        if (cache_bits_ < 1) refill();
        uint32_t bit = static_cast<uint32_t>(cache_ >> 63);
        cache_ <<= 1;
        cache_bits_--;
        bit_pos_++;
        return bit;
    }

    // Exp-Golomb (§9.2)
    uint32_t read_ue();
    int32_t  read_se();

    // Alignment (§7.2)
    bool byte_aligned() const;
    void byte_alignment();

    // RBSP trailing (§7.2)
    bool more_rbsp_data() const;

    // Position
    size_t bits_read() const { return bit_pos_; }
    size_t bits_remaining() const;
    size_t byte_position() const { return bit_pos_ / 8; }

    // Seek to absolute byte position (resets cache).
    // Used by WPP to jump to the start of each substream.
    void seek_to_byte(size_t pos);
    // Moves to any bit position, as if exactly pos bits had been read
    void seek_to_bit(size_t pos);

    // State
    bool eof() const;
    const uint8_t* data() const { return data_; }
    size_t size() const { return size_; }

private:
    const uint8_t* data_ = nullptr;
    size_t size_ = 0;            // in bytes
    size_t bit_pos_ = 0;         // current bit position (logical)

    // 64-bit read cache
    uint64_t cache_ = 0;
    int cache_bits_ = 0;         // valid bits remaining in cache (MSB-aligned)
    size_t byte_pos_ = 0;        // next byte to load into cache

    void refill();

    // Precomputed position of rbsp_stop_one_bit (§7.2)
    size_t last_one_bit_pos_ = 0;
    static size_t find_last_one_bit(const uint8_t* data, size_t size);
};

// RBSP extraction — remove emulation prevention bytes (§7.3.1.1)
std::vector<uint8_t> extract_rbsp(const uint8_t* nal_data, size_t nal_size);

// RBSP extraction with EP byte position tracking.
// epb_positions receives the byte positions (in the original NAL) of each removed 0x03 byte.
std::vector<uint8_t> extract_rbsp(const uint8_t* nal_data, size_t nal_size,
                                   std::vector<size_t>& epb_positions);

// Convert a byte offset in coded slice data (which counts EP bytes) to the
// corresponding byte offset in the RBSP buffer.
// slice_data_start_coded = byte offset of slice data start in the original NAL.
// epb_positions = positions of removed EP bytes from extract_rbsp.
size_t coded_to_rbsp_offset(size_t coded_offset, size_t slice_data_start_coded,
                            const std::vector<size_t>& epb_positions);

} // namespace hevc
