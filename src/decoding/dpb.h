#pragma once

// Decoded Picture Buffer — spec §8.3
// POC derivation (§8.3.1), RPS derivation (§8.3.2),
// Ref picture list construction (§8.3.4), ColPic derivation (§8.3.5)

#include <cstdint>
#include <vector>
#include <memory>

#include "common/picture.h"
#include "syntax/sps.h"
#include "syntax/slice_header.h"

namespace hevc {

struct PPS;

// Reference Picture List entry — pointer to a decoded picture in the DPB
struct RefPicListEntry {
    Picture* pic = nullptr;  // nullptr = "no reference picture"
};

// Decoded Picture Buffer
class DPB {
public:
    DPB() = default;

    // ============================================================
    // §8.3.1 — POC derivation
    // ============================================================
    // Returns PicOrderCntVal for the current picture.
    // Must be called once per picture, after slice header parsing.
    int32_t derive_poc(const SliceHeader& sh, const SPS& sps,
                       NalUnitType nal_type, uint8_t nuh_temporal_id);

    // ============================================================
    // §8.3.2 — RPS derivation + picture marking
    // ============================================================
    // Derives the 5 RPS lists, marks pictures in the DPB.
    // Must be called once per picture, after POC derivation.
    void derive_rps(const SliceHeader& sh, const SPS& sps,
                    NalUnitType nal_type, int32_t picOrderCntVal);

    // ============================================================
    // §8.3.4 — Reference picture list construction
    // ============================================================
    // Builds RefPicList0 and (for B slices) RefPicList1.
    // Must be called at the beginning of each P or B slice.
    void construct_ref_pic_lists(const SliceHeader& sh, const SPS& sps,
                                 const PPS& pps);

    // ============================================================
    // §8.3.5 — Collocated picture + NoBackwardPredFlag
    // ============================================================
    void derive_colpic(const SliceHeader& sh);

    // ============================================================
    // DPB management
    // ============================================================

    // Allocate a new picture in the DPB for decoding
    Picture* alloc_picture(int width, int height, ChromaFormat fmt,
                           int bd_luma, int bd_chroma);

    // Mark current picture as short-term reference after decoding (§8.1 step 4)
    void mark_current_as_short_term_ref();

    // Output and bumping process (§C.5 simplified — legacy batch mode)
    // Returns pictures that should be output (in POC order)
    std::vector<Picture*> get_output_pictures();

    // ============================================================
    // §C.5.2 — Incremental output (bumping process)
    // ============================================================

    // §C.5.2.4 — "Bumping" process: output the picture with smallest POC
    // that is marked as "needed for output". Returns nullptr if no picture to bump.
    // skip_current leaves the picture being decoded out of the selection:
    // §C.5.2.2 runs before it is stored, so drain() must not pick it, while
    // flush() at end of stream must.
    Picture* bump(bool skip_current = false);

    // §C.5.2.2/C.5.2.3 — Drain: bump pictures while bumping conditions are met.
    // Uses sps_max_num_reorder_pics and sps_max_dec_pic_buffering_minus1 from the active SPS.
    // Returns newly output pictures in display order.
    std::vector<Picture*> drain(const SPS& sps);

    // Flush: output ALL remaining pictures marked as "needed for output", in POC order.
    // Called at end-of-stream.
    std::vector<Picture*> flush();

    // Remove pictures from DPB that are neither reference nor needed for output.
    // §C.5.2.4 step 3 + §C.5.2.2
    void evict_unused();

    // Get all stored pictures (for external access)
    const std::vector<std::shared_ptr<Picture>>& pictures() const { return pictures_; }

    // Access ref pic lists (valid after construct_ref_pic_lists)
    Picture* ref_pic_list0(int idx) const {
        return (idx < static_cast<int>(ref_pic_list0_.size())) ? ref_pic_list0_[idx].pic : nullptr;
    }
    Picture* ref_pic_list1(int idx) const {
        return (idx < static_cast<int>(ref_pic_list1_.size())) ? ref_pic_list1_[idx].pic : nullptr;
    }
    int num_ref_list0() const { return static_cast<int>(ref_pic_list0_.size()); }
    int num_ref_list1() const { return static_cast<int>(ref_pic_list1_.size()); }

    // Collocated picture (valid after derive_colpic)
    Picture* col_pic() const { return col_pic_; }
    bool no_backward_pred_flag() const { return no_backward_pred_flag_; }

    // Current picture being decoded
    Picture* current_pic() const { return current_pic_; }

private:
    // DPB storage
    std::vector<std::shared_ptr<Picture>> pictures_;
    Picture* current_pic_ = nullptr;

    // POC state (§8.3.1) — "prevTid0Pic" values
    int32_t prev_poc_lsb_ = 0;
    int32_t prev_poc_msb_ = 0;
    bool first_picture_ = true;

    // RPS lists (§8.3.2) — pictures from the DPB
    // "StCurrBefore" = short-term, used by current, POC < current
    std::vector<Picture*> ref_pic_set_st_curr_before_;
    std::vector<Picture*> ref_pic_set_st_curr_after_;
    std::vector<Picture*> ref_pic_set_st_foll_;
    std::vector<Picture*> ref_pic_set_lt_curr_;
    std::vector<Picture*> ref_pic_set_lt_foll_;

    // Ref pic lists (§8.3.4)
    std::vector<RefPicListEntry> ref_pic_list0_;
    std::vector<RefPicListEntry> ref_pic_list1_;

    // Collocated picture (§8.3.5)
    Picture* col_pic_ = nullptr;
    bool no_backward_pred_flag_ = false;

    // Helper: find picture in DPB by POC
    Picture* find_short_term_by_poc(int32_t poc) const;
    Picture* find_by_poc(int32_t poc) const;
    Picture* find_by_poc_lsb(int32_t poc_lsb, int32_t max_poc_lsb) const;
};

} // namespace hevc
