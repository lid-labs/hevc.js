#pragma once

// CABAC Engine — Spec §9.3
// Arithmetic decoding: decode_decision, decode_bypass, decode_terminate
// Context initialization: init_contexts with all Tables 9-5 to 9-31
//
// Hot path functions (decode_decision, decode_bypass, decode_bypass_bins,
// renormalize) are defined inline in this header to enable cross-TU inlining,
// which is critical for WASM builds without LTO.

#include <cstdint>
#include <cstring>

#include "bitstream/bitstream_reader.h"
#include "common/types.h"
#include "decoding/cabac_tables.h"

namespace hevc {

// Single CABAC context (AD-005)
struct CabacContext {
    uint8_t pStateIdx;
    uint8_t valMps;
};

// CABAC arithmetic decoder engine
class CabacEngine {
public:
    CabacEngine() = default;

    // Initialize the arithmetic decoder (§9.3.4.3.1)
    // Must be called at the start of each independent slice segment
    void init_decoder(BitstreamReader& bs);

    // Initialize all contexts for a given slice type and QP (§9.3.1.1)
    // sliceType: 0=I, 1=P, 2=B
    // cabac_init_flag: permutes P/B tables when true
    void init_contexts(int sliceType, int SliceQpY, bool cabac_init_flag);

    // The engine reads ahead: value_ holds ivlOffset (§9.3.4.3) in its top 9
    // bits, followed by bits_ bits of the bitstream not consumed yet. Comparing
    // value_ with ivlCurrRange << bits_ is comparing ivlOffset with
    // ivlCurrRange, and a renormalisation only lowers bits_, so the reader is
    // called once per 32 bits instead of once per renormalisation.

    // §9.3.4.3.2 — Arithmetic decoding of a bin with context (inline hot path)
    inline int decode_decision(int ctxIdx) {
        auto& ctx = contexts_[ctxIdx];
        uint8_t pStateIdx = ctx.pStateIdx;
        uint8_t valMps    = ctx.valMps;

        uint32_t range = ivlCurrRange_;
        uint32_t ivlLpsRange = rangeTabLps[pStateIdx][(range >> 6) & 3];
        range -= ivlLpsRange;
        const uint64_t scaled = static_cast<uint64_t>(range) << bits_;

        int binVal;
        if (value_ >= scaled) {
            // LPS path
            binVal = 1 - valMps;
            value_ -= scaled;
            range = ivlLpsRange;
            if (pStateIdx == 0)
                ctx.valMps = 1 - valMps;
            ctx.pStateIdx = transIdxLps[pStateIdx];
        } else {
            // MPS path
            binVal = valMps;
            ctx.pStateIdx = transIdxMps[pStateIdx];
        }

        // §9.3.4.3.3 — Renormalization: the offset takes its new low bits
        // from the look-ahead
        if (range < 256) {
            int shift = __builtin_clz(range) - 23;
            range <<= shift;
            bits_ -= shift;
            if (bits_ < kMinBits) refill();
        }
        ivlCurrRange_ = range;

#ifdef HEVC_DEBUG
        bin_count_++;
#endif
        return binVal;
    }

    // §9.3.4.3.4 — Bypass decoding (inline, branchless)
    inline int decode_bypass() {
        // ivlOffset = (ivlOffset << 1) | read_bits(1): one more look-ahead bit
        bits_--;
        const uint64_t scaled = static_cast<uint64_t>(ivlCurrRange_) << bits_;
        // Branchless: avoid unpredictable branch on 50/50 bypass bins
        int val = (value_ >= scaled);
        value_ -= scaled & (0 - static_cast<uint64_t>(val));
        if (bits_ < kMinBits) refill();

#ifdef HEVC_DEBUG
        bin_count_++;
#endif
        return val;
    }

    // Decode multiple bypass bins, MSB first
    inline int decode_bypass_bins(int numBins) {
        int value = 0;
        for (int i = 0; i < numBins; i++)
            value = (value << 1) | decode_bypass();
        return value;
    }

    // §9.3.4.3.5 — Terminate decoding (cold path, stays out-of-line)
    int decode_terminate();

    // §9.3.4.3.6: Alignment prior to bypass decoding of coeff_sign_flag
    // and coeff_abs_level_remaining. Sets ivlCurrRange to 256.
    void align_bypass() { ivlCurrRange_ = 256; }

    // Context access
    CabacContext& context(int ctxIdx) { return contexts_[ctxIdx]; }
    const CabacContext& context(int ctxIdx) const { return contexts_[ctxIdx]; }

    // Save/restore state (for WPP)
    void save_contexts(CabacContext* dst) const {
        std::memcpy(dst, contexts_, sizeof(contexts_));
    }
    void load_contexts(const CabacContext* src) {
        std::memcpy(contexts_, src, sizeof(contexts_));
    }

    BitstreamReader* bitstream() { return bs_; }

    // Bin counter for debugging — compiled out in release
#ifdef HEVC_DEBUG
    int bin_count() const { return bin_count_; }
    void reset_bin_count() { bin_count_ = 0; }
#else
    int bin_count() const { return 0; }
    void reset_bin_count() {}
#endif
    uint16_t dbg_range() const { return static_cast<uint16_t>(ivlCurrRange_); }
    uint16_t dbg_offset() const { return static_cast<uint16_t>(value_ >> bits_); }

private:
    // Look-ahead kept at or above kMinBits, enough for one renormalisation
    // (at most 6 bits) or one bypass bin; a refill adds 32, so value_ never
    // holds more than 9 + kMinBits + 31 bits.
    static constexpr int kMinBits = 16;
    inline void refill() {
        value_ = (value_ << 32) | bs_->read_bits_safe(32);
        bits_ += 32;
    }

    // Puts the reader back at the position the arithmetic decoder has
    // consumed, dropping the look-ahead, for the raw reads that may follow a
    // terminating bin (PCM samples, alignment, next substream).
    void sync_reader() {
        bs_->seek_to_bit(bs_->bits_read() - bits_);
        bits_ = 0;
    }

    CabacContext contexts_[NUM_CABAC_CONTEXTS] = {};
    uint32_t ivlCurrRange_ = 0;
    uint64_t value_ = 0;   // ivlOffset, then bits_ look-ahead bits
    int bits_ = 0;
    BitstreamReader* bs_ = nullptr;
#ifdef HEVC_DEBUG
    int bin_count_ = 0;
#endif
};

} // namespace hevc
