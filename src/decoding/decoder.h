#pragma once

// Top-level HEVC decoder
// Orchestrates NAL parsing, parameter set management, and frame decoding

#include <cstdint>
#include <cstddef>
#include <vector>

#include "common/picture.h"
#include "common/thread_pool.h"
#include "syntax/parameter_sets.h"
#include "decoding/coding_tree.h"
#include "decoding/dpb.h"

namespace hevc {

enum class DecodeStatus {
    OK,
    NEED_MORE_DATA,
    ERROR,
};

// A picture decoded with PicOutputFlag = 0. The pair orders it the way
// DPB::bump does — by CVS first, then POC.
struct SuppressedPicture {
    int32_t cvs_id;
    int32_t poc;
};

class Decoder {
public:
    Decoder() = default;

    // Decode a complete bitstream (batch mode)
    DecodeStatus decode(const uint8_t* data, size_t size);

    // Feed a chunk of data (incremental mode — one or more complete NAL units)
    // Same as decode() but named for clarity in streaming context.
    DecodeStatus feed(const uint8_t* data, size_t size);

    // Drain newly output-ready pictures (§C.5.2 bumping process)
    // Returns pictures in display order. Only returns pictures that are
    // ready according to sps_max_num_reorder_pics / DPB size constraints.
    std::vector<Picture*> drain();

    // Flush all remaining pictures from the DPB (end-of-stream)
    // Returns all pictures still marked as "needed for output", in POC order.
    std::vector<Picture*> flush();

    // Get decoded pictures — batch mode (legacy, returns every picture the DPB
    // still holds for output). Pictures with PicOutputFlag = 0 are skipped, as
    // the incremental path skips them.
    std::vector<Picture*> output_pictures();

    // The pictures decoded since the last call whose PicOutputFlag was 0
    // (§C.3.1) — decoded, possibly used as reference, never output. Empties
    // the list. A caller that maps output frames onto per-sample timestamps
    // needs these to know which samples produced no frame, and needs the CVS
    // alongside the POC: POC restarts at each IRAP, so it only orders
    // pictures within one coded video sequence (§8.3.1).
    std::vector<SuppressedPicture> take_suppressed_pictures();

    // Get DPB (for testing)
    const DPB& dpb() const { return dpb_; }

private:
    DecodeStatus decode_picture(const std::vector<NalUnit>& nals,
                                 size_t first_vcl_idx, size_t vcl_count);

    ParameterSetManager ps_mgr_;
    DPB dpb_;

    // Output pictures (accumulated across all decoded pictures)
    std::vector<Picture*> output_pics_;

    // Decoded pictures with PicOutputFlag = 0, drained by
    // take_suppressed_pictures()
    std::vector<SuppressedPicture> suppressed_;

    // CVS counter — incremented at each IRAP with NoRaslOutputFlag
    int32_t cvs_id_ = 0;

    // Decoding context allocations (per-picture)
    std::vector<CUInfo> cu_info_buf_;
    std::vector<int> intra_mode_buf_;
    std::vector<int> chroma_mode_buf_;
    std::vector<PUMotionInfo> motion_info_buf_;

    // Phase 6: filter data (per-picture)
    std::vector<uint8_t> cbf_luma_buf_;
    std::vector<uint8_t> log2_tu_size_buf_;
    std::vector<uint8_t> edge_flags_v_buf_;
    std::vector<uint8_t> edge_flags_h_buf_;
    std::vector<DecodingContext::SaoParams> sao_params_buf_;

    // Phase 9: SAO backup buffers (reused across frames to avoid per-frame allocation)
    std::vector<uint16_t> sao_backup_[3];

    // Phase 10: slice index per CTU
    std::vector<uint8_t> slice_idx_buf_;

    // Phase 9B: persistent thread pool for WPP parallel decode
    ThreadPool thread_pool_;
};

} // namespace hevc
