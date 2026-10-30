#include "decoding/cabac.h"
#include "common/debug.h"
#include <cstdlib>
#include <cstdio>

namespace hevc {

#ifdef HEVC_TRACE_CABAC
// Bin-by-bin trace — enabled by HEVC_TRACE_BINS environment variable
static FILE* trace_file() {
    static FILE* f = nullptr;
    static bool checked = false;
    if (!checked) {
        checked = true;
        const char* path = std::getenv("HEVC_TRACE_BINS");
        if (path && path[0])
            f = std::fopen(path, "w");
    }
    return f;
}
#endif

// §9.3.4.3.1 — Initialization of the arithmetic decoding engine
void CabacEngine::init_decoder(BitstreamReader& bs) {
    bs_ = &bs;
    ivlCurrRange_ = 510;
    value_ = bs.read_bits(9);
    bits_ = 0;
    refill();
    HEVC_LOG(CABAC, "init_decoder: ivlCurrRange=%d ivlOffset=%d", dbg_range(), dbg_offset());

#ifdef HEVC_TRACE_CABAC
    if (FILE* f = trace_file())
        std::fprintf(f, "=== INIT_DECODER R=%d O=%d binCount=%d ===\n",
                     dbg_range(), dbg_offset(), bin_count());
#endif
}

// §9.3.1.1 — Context initialization
void CabacEngine::init_contexts(int sliceType, int SliceQpY, bool cabac_init_flag) {
    // Map SliceType enum (B=0, P=1, I=2) to init table index (I=0, P=1, B=2)
    int initType;
    switch (sliceType) {
        case 2: initType = 0; break; // I -> table index 0
        case 1: initType = 1; break; // P -> table index 1
        case 0: initType = 2; break; // B -> table index 2
        default: initType = 0; break;
    }

    // cabac_init_flag permutation (§9.2.1.1):
    // P slice with cabac_init_flag=1 uses B init values
    // B slice with cabac_init_flag=1 uses P init values
    if (cabac_init_flag) {
        if (initType == 1) initType = 2; // P uses B
        else if (initType == 2) initType = 1; // B uses P
    }

    int qp = Clip3(0, 51, SliceQpY);

    for (int i = 0; i < NUM_CABAC_CONTEXTS; i++) {
        uint8_t initValue = cabacInitValues[i].initValue[initType];
        int slope  = (initValue >> 4) * 5 - 45;
        int offset = ((initValue & 15) << 3) - 16;
        int preCtxState = Clip3(1, 126, ((slope * qp) >> 4) + offset);

        if (preCtxState <= 63) {
            contexts_[i].state = static_cast<uint8_t>((63 - preCtxState) << 1);
        } else {
            contexts_[i].state = static_cast<uint8_t>(((preCtxState - 64) << 1) | 1);
        }
    }

    HEVC_LOG(CABAC, "init_contexts: sliceType=%d QP=%d cabac_init=%d initType=%d",
             sliceType, SliceQpY, cabac_init_flag, initType);
}

// §9.3.4.3.5 — Terminate decoding (cold path)
int CabacEngine::decode_terminate() {
    ivlCurrRange_ -= 2;
#ifdef HEVC_DEBUG
    bin_count_++;
#endif

    if (value_ >= (static_cast<uint64_t>(ivlCurrRange_) << bits_)) {
#ifdef HEVC_TRACE_CABAC
        if (FILE* f = trace_file())
            std::fprintf(f, "T %d R=%d O=%d val=1\n",
                         bin_count(), dbg_range(), dbg_offset());
#endif
        // end_of_slice_segment_flag, end_of_subset_one_bit or pcm_flag: what
        // follows is read from the bitstream directly, or by a new init_decoder
        sync_reader();
        return 1;
    }
    // §9.3.4.3.3: ivlCurrRange was at least 256, so one shift at most
    if (ivlCurrRange_ < 256) {
        ivlCurrRange_ <<= 1;
        bits_--;
        if (bits_ < kMinBits) refill();
    }

#ifdef HEVC_TRACE_CABAC
    if (FILE* f = trace_file())
        std::fprintf(f, "T %d R=%d O=%d val=0\n",
                     bin_count(), dbg_range(), dbg_offset());
#endif

    return 0;
}

} // namespace hevc
