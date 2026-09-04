#include "decoding/dpb.h"
#include "syntax/pps.h"
#include "common/debug.h"

#include <algorithm>
#include <cstdio>

namespace hevc {

// ============================================================
// §8.3.1 — Decoding process for picture order count
// ============================================================

int32_t DPB::derive_poc(const SliceHeader& sh, const SPS& sps,
                         NalUnitType nal_type, uint8_t nuh_temporal_id) {
    int32_t MaxPicOrderCntLsb = 1 << (sps.log2_max_pic_order_cnt_lsb_minus4 + 4);
    int32_t PicOrderCntMsb;

    // §8.3.1: IRAP with NoRaslOutputFlag = 1 → reset
    bool isIRAP = is_irap(nal_type);
    // Simplified NoRaslOutputFlag: true for IDR, BLA, first picture
    bool NoRaslOutputFlag = false;
    if (nal_type == NalUnitType::IDR_W_RADL || nal_type == NalUnitType::IDR_N_LP) {
        NoRaslOutputFlag = true;
    } else if (nal_type == NalUnitType::BLA_W_LP || nal_type == NalUnitType::BLA_W_RADL ||
               nal_type == NalUnitType::BLA_N_LP) {
        NoRaslOutputFlag = true;
    } else if (isIRAP && first_picture_) {
        NoRaslOutputFlag = true;  // §8.1: first picture in bitstream
    }

    if (isIRAP && NoRaslOutputFlag) {
        // §8.3.1: "PicOrderCntMsb is set equal to 0"
        PicOrderCntMsb = 0;
    } else {
        // §8.3.1 eq 8-1: MSB derivation with wrap-around
        int32_t prevLsb = prev_poc_lsb_;
        int32_t prevMsb = prev_poc_msb_;
        int32_t curLsb = static_cast<int32_t>(sh.slice_pic_order_cnt_lsb);

        if (curLsb < prevLsb && (prevLsb - curLsb) >= MaxPicOrderCntLsb / 2)
            PicOrderCntMsb = prevMsb + MaxPicOrderCntLsb;
        else if (curLsb > prevLsb && (curLsb - prevLsb) > MaxPicOrderCntLsb / 2)
            PicOrderCntMsb = prevMsb - MaxPicOrderCntLsb;
        else
            PicOrderCntMsb = prevMsb;
    }

    // §8.3.1 eq 8-2
    int32_t PicOrderCntVal = PicOrderCntMsb + static_cast<int32_t>(sh.slice_pic_order_cnt_lsb);

    // §8.3.1: Update prevTid0Pic state
    // "Let prevTid0Pic be the previous picture in decoding order that has
    //  TemporalId equal to 0 and that is not a RASL, RADL or SLNR picture."
    bool isRASL = (nal_type == NalUnitType::RASL_R || nal_type == NalUnitType::RASL_N);
    bool isRADL = (nal_type == NalUnitType::RADL_R || nal_type == NalUnitType::RADL_N);
    bool isSLNR = (nuh_temporal_id != 0) &&
                  (nal_type == NalUnitType::TRAIL_N || nal_type == NalUnitType::TSA_N ||
                   nal_type == NalUnitType::STSA_N);
    if (nuh_temporal_id == 0 && !isRASL && !isRADL && !isSLNR) {
        prev_poc_lsb_ = static_cast<int32_t>(sh.slice_pic_order_cnt_lsb);
        prev_poc_msb_ = PicOrderCntMsb;
    }

    // Reset for IRAP with NoRaslOutputFlag
    if (isIRAP && NoRaslOutputFlag) {
        prev_poc_lsb_ = 0;
        prev_poc_msb_ = 0;
    }

    first_picture_ = false;

    HEVC_LOG(PARSE, "POC derived: %d (lsb=%d, msb=%d)",
             PicOrderCntVal, sh.slice_pic_order_cnt_lsb, PicOrderCntMsb);

    return PicOrderCntVal;
}

// ============================================================
// §8.3.2 — Decoding process for reference picture set
// ============================================================

void DPB::derive_rps(const SliceHeader& sh, const SPS& sps,
                      NalUnitType nal_type, int32_t picOrderCntVal) {
    int32_t MaxPicOrderCntLsb = 1 << (sps.log2_max_pic_order_cnt_lsb_minus4 + 4);
    bool isIRAP = is_irap(nal_type);
    bool isIDR = (nal_type == NalUnitType::IDR_W_RADL || nal_type == NalUnitType::IDR_N_LP);

    // §8.3.2: IRAP with NoRaslOutputFlag → mark all as unused
    bool NoRaslOutputFlag = (nal_type == NalUnitType::IDR_W_RADL ||
                              nal_type == NalUnitType::IDR_N_LP ||
                              nal_type == NalUnitType::BLA_W_LP ||
                              nal_type == NalUnitType::BLA_W_RADL ||
                              nal_type == NalUnitType::BLA_N_LP);
    if (isIRAP && NoRaslOutputFlag) {
        for (auto& pic : pictures_) {
            if (pic.get() != current_pic_) {
                pic->used_for_short_term_ref = false;
                pic->used_for_long_term_ref = false;
            }
        }
    }

    // §8.3.2: Build 5 POC lists
    std::vector<int32_t> PocStCurrBefore, PocStCurrAfter, PocStFoll;
    std::vector<int32_t> PocLtCurr, PocLtFoll;
    std::vector<bool> CurrDeltaPocMsbPresentFlag, FollDeltaPocMsbPresentFlag;

    if (isIDR) {
        // §8.3.2: "all set to be empty"
        // Nothing to do
    } else {
        // §8.3.2 eq 8-5: derive short-term POC lists from active RPS
        const ShortTermRefPicSet* rps = sh.active_rps;
        if (!rps) {
            HEVC_LOG(PARSE, "WARNING: no active RPS for non-IDR picture%s", "");
            return;
        }

        // §8.3.2: CurrRpsIdx selects the RPS
        int NumNegativePics = rps->NumNegativePics;
        int NumPositivePics = rps->NumPositivePics;

        // Negative pictures (POC < current)
        for (int i = 0; i < NumNegativePics; i++) {
            int32_t poc = picOrderCntVal + rps->DeltaPocS0[i];
            HEVC_LOG(DPB, "RPS DeltaPocS0[%d]=%d → POC %d used=%d",
                    i, rps->DeltaPocS0[i], poc, rps->UsedByCurrPicS0[i]);
            if (rps->UsedByCurrPicS0[i])
                PocStCurrBefore.push_back(poc);
            else
                PocStFoll.push_back(poc);
        }

        // Positive pictures (POC > current)
        for (int i = 0; i < NumPositivePics; i++) {
            int32_t poc = picOrderCntVal + rps->DeltaPocS1[i];
            if (rps->UsedByCurrPicS1[i])
                PocStCurrAfter.push_back(poc);
            else
                PocStFoll.push_back(poc);
        }

        // §8.3.2 eq 8-5: Long-term references
        int numLtTotal = sh.num_long_term_sps + sh.num_long_term_pics;
        for (int i = 0; i < numLtTotal; i++) {
            int32_t pocLt = static_cast<int32_t>(sh.poc_lsb_lt[i]);
            if (sh.delta_poc_msb_present_flag[i]) {
                pocLt += picOrderCntVal
                         - static_cast<int32_t>(sh.delta_poc_msb_cycle_lt[i]) * MaxPicOrderCntLsb
                         - (picOrderCntVal & (MaxPicOrderCntLsb - 1));
            }
            if (sh.used_by_curr_pic_lt_flag[i]) {
                PocLtCurr.push_back(pocLt);
                CurrDeltaPocMsbPresentFlag.push_back(sh.delta_poc_msb_present_flag[i]);
            } else {
                PocLtFoll.push_back(pocLt);
                FollDeltaPocMsbPresentFlag.push_back(sh.delta_poc_msb_present_flag[i]);
            }
        }
    }

    // §8.3.2 step 1: Build RefPicSetLtCurr and RefPicSetLtFoll (eq 8-6)
    ref_pic_set_lt_curr_.clear();
    for (size_t i = 0; i < PocLtCurr.size(); i++) {
        Picture* picX = nullptr;
        if (i < CurrDeltaPocMsbPresentFlag.size() && !CurrDeltaPocMsbPresentFlag[i])
            picX = find_by_poc_lsb(PocLtCurr[i], MaxPicOrderCntLsb);
        else
            picX = find_by_poc(PocLtCurr[i]);
        ref_pic_set_lt_curr_.push_back(picX);
    }

    ref_pic_set_lt_foll_.clear();
    for (size_t i = 0; i < PocLtFoll.size(); i++) {
        Picture* picX = nullptr;
        if (i < FollDeltaPocMsbPresentFlag.size() && !FollDeltaPocMsbPresentFlag[i])
            picX = find_by_poc_lsb(PocLtFoll[i], MaxPicOrderCntLsb);
        else
            picX = find_by_poc(PocLtFoll[i]);
        ref_pic_set_lt_foll_.push_back(picX);
    }

    // §8.3.2 step 2: Mark long-term pictures
    for (auto* pic : ref_pic_set_lt_curr_) {
        if (pic) {
            pic->used_for_short_term_ref = false;
            pic->used_for_long_term_ref = true;
        }
    }
    for (auto* pic : ref_pic_set_lt_foll_) {
        if (pic) {
            pic->used_for_short_term_ref = false;
            pic->used_for_long_term_ref = true;
        }
    }

    // §8.3.2 step 3: Build RefPicSetStCurr{Before,After} and RefPicSetStFoll (eq 8-7)
    ref_pic_set_st_curr_before_.clear();
    for (auto poc : PocStCurrBefore) {
        ref_pic_set_st_curr_before_.push_back(find_short_term_by_poc(poc));
    }

    ref_pic_set_st_curr_after_.clear();
    for (auto poc : PocStCurrAfter) {
        ref_pic_set_st_curr_after_.push_back(find_short_term_by_poc(poc));
    }

    ref_pic_set_st_foll_.clear();
    for (auto poc : PocStFoll) {
        ref_pic_set_st_foll_.push_back(find_short_term_by_poc(poc));
    }

    // §8.3.2 step 4: Mark all pictures not in any RPS list as "unused for reference"
    for (auto& pic : pictures_) {
        if (pic.get() == current_pic_) continue;

        bool inRPS = false;
        auto in_list = [&](const std::vector<Picture*>& list) {
            for (auto* p : list) if (p == pic.get()) return true;
            return false;
        };
        inRPS = in_list(ref_pic_set_st_curr_before_) ||
                in_list(ref_pic_set_st_curr_after_) ||
                in_list(ref_pic_set_st_foll_) ||
                in_list(ref_pic_set_lt_curr_) ||
                in_list(ref_pic_set_lt_foll_);

        if (!inRPS) {
            pic->used_for_short_term_ref = false;
            pic->used_for_long_term_ref = false;
        }
    }

    HEVC_LOG(PARSE, "RPS: StCurrBefore=%zu StCurrAfter=%zu StFoll=%zu LtCurr=%zu LtFoll=%zu",
             ref_pic_set_st_curr_before_.size(), ref_pic_set_st_curr_after_.size(),
             ref_pic_set_st_foll_.size(), ref_pic_set_lt_curr_.size(),
             ref_pic_set_lt_foll_.size());
}

// ============================================================
// §8.3.4 — Reference picture list construction
// ============================================================

void DPB::construct_ref_pic_lists(const SliceHeader& sh, const SPS& /*sps*/,
                                   const PPS& /*pps*/) {
    if (sh.slice_type == SliceType::I) return;  // No ref lists for I slices

    int NumPocStCurrBefore = static_cast<int>(ref_pic_set_st_curr_before_.size());
    int NumPocStCurrAfter  = static_cast<int>(ref_pic_set_st_curr_after_.size());
    int NumPocLtCurr       = static_cast<int>(ref_pic_set_lt_curr_.size());
    int NumPicTotalCurr    = NumPocStCurrBefore + NumPocStCurrAfter + NumPocLtCurr;

    // §8.3.4 eq 8-8: Build RefPicListTemp0
    int NumRpsCurrTempList0 = std::max<int>(sh.num_ref_idx_l0_active_minus1 + 1, NumPicTotalCurr);
    std::vector<Picture*> RefPicListTemp0;
    {
        int rIdx = 0;
        while (rIdx < NumRpsCurrTempList0) {
            for (int i = 0; i < NumPocStCurrBefore && rIdx < NumRpsCurrTempList0; rIdx++, i++)
                RefPicListTemp0.push_back(ref_pic_set_st_curr_before_[i]);
            for (int i = 0; i < NumPocStCurrAfter && rIdx < NumRpsCurrTempList0; rIdx++, i++)
                RefPicListTemp0.push_back(ref_pic_set_st_curr_after_[i]);
            for (int i = 0; i < NumPocLtCurr && rIdx < NumRpsCurrTempList0; rIdx++, i++)
                RefPicListTemp0.push_back(ref_pic_set_lt_curr_[i]);
        }
    }

    // §8.3.4 eq 8-9: Build RefPicList0
    ref_pic_list0_.clear();
    for (int rIdx = 0; rIdx <= static_cast<int>(sh.num_ref_idx_l0_active_minus1); rIdx++) {
        Picture* pic;
        if (sh.ref_pic_list_modification_flag_l0)
            pic = RefPicListTemp0[sh.list_entry_l0[rIdx]];
        else
            pic = RefPicListTemp0[rIdx];
        ref_pic_list0_.push_back({pic});
    }

    // §8.3.4 eq 8-10, 8-11: Build RefPicList1 (B slices only)
    if (sh.slice_type == SliceType::B) {
        int NumRpsCurrTempList1 = std::max<int>(sh.num_ref_idx_l1_active_minus1 + 1, NumPicTotalCurr);
        std::vector<Picture*> RefPicListTemp1;
        {
            int rIdx = 0;
            while (rIdx < NumRpsCurrTempList1) {
                // §8.3.4 eq 8-10: StCurrAfter FIRST (reversed order vs List0)
                for (int i = 0; i < NumPocStCurrAfter && rIdx < NumRpsCurrTempList1; rIdx++, i++)
                    RefPicListTemp1.push_back(ref_pic_set_st_curr_after_[i]);
                for (int i = 0; i < NumPocStCurrBefore && rIdx < NumRpsCurrTempList1; rIdx++, i++)
                    RefPicListTemp1.push_back(ref_pic_set_st_curr_before_[i]);
                for (int i = 0; i < NumPocLtCurr && rIdx < NumRpsCurrTempList1; rIdx++, i++)
                    RefPicListTemp1.push_back(ref_pic_set_lt_curr_[i]);
            }
        }

        ref_pic_list1_.clear();
        for (int rIdx = 0; rIdx <= static_cast<int>(sh.num_ref_idx_l1_active_minus1); rIdx++) {
            Picture* pic;
            if (sh.ref_pic_list_modification_flag_l1)
                pic = RefPicListTemp1[sh.list_entry_l1[rIdx]];
            else
                pic = RefPicListTemp1[rIdx];
            ref_pic_list1_.push_back({pic});
        }
    }

    HEVC_LOG(PARSE, "RefPicLists: L0=%zu entries, L1=%zu entries",
             ref_pic_list0_.size(), ref_pic_list1_.size());
    for (size_t i = 0; i < ref_pic_list0_.size(); i++) {
        [[maybe_unused]] auto* p = ref_pic_list0_[i].pic;
        HEVC_LOG(PARSE, "  L0[%zu] = POC %d", i, p ? p->poc : -999);
    }
    for (size_t i = 0; i < ref_pic_list1_.size(); i++) {
        [[maybe_unused]] auto* p = ref_pic_list1_[i].pic;
        HEVC_LOG(PARSE, "  L1[%zu] = POC %d", i, p ? p->poc : -999);
    }
}

// ============================================================
// §8.3.5 — Collocated picture and no backward prediction flag
// ============================================================

void DPB::derive_colpic(const SliceHeader& sh) {
    col_pic_ = nullptr;
    no_backward_pred_flag_ = false;

    if (!sh.slice_temporal_mvp_enabled_flag) return;
    if (sh.slice_type == SliceType::I) return;

    // §8.3.5: derive ColPic
    if (sh.slice_type == SliceType::B && !sh.collocated_from_l0_flag) {
        col_pic_ = ref_pic_list1(sh.collocated_ref_idx);
    } else {
        col_pic_ = ref_pic_list0(sh.collocated_ref_idx);
    }

    // §8.3.5: derive NoBackwardPredFlag
    // "If DiffPicOrderCnt(aPic, CurrPic) <= 0 for each picture aPic in
    //  RefPicList0 or RefPicList1 → NoBackwardPredFlag = 1"
    no_backward_pred_flag_ = true;
    if (current_pic_) {
        for (auto& entry : ref_pic_list0_) {
            if (entry.pic && entry.pic->poc > current_pic_->poc) {
                no_backward_pred_flag_ = false;
                break;
            }
        }
        if (no_backward_pred_flag_) {
            for (auto& entry : ref_pic_list1_) {
                if (entry.pic && entry.pic->poc > current_pic_->poc) {
                    no_backward_pred_flag_ = false;
                    break;
                }
            }
        }
    }

    HEVC_LOG(PARSE, "ColPic: POC %d, NoBackwardPredFlag=%d",
             col_pic_ ? col_pic_->poc : -999, no_backward_pred_flag_);
}

// ============================================================
// DPB management
// ============================================================

Picture* DPB::alloc_picture(int width, int height, ChromaFormat fmt,
                             int bd_luma, int bd_chroma) {
    // §C.5.2.2 — free storage buffers that are neither reference nor pending
    // output before growing the DPB. This only has something to reclaim once
    // the caller has bumped pictures out (drain/flush): a caller that feeds a
    // whole segment before draining keeps every picture alive.
    evict_unused();

    auto pic = std::make_shared<Picture>();
    pic->allocate(width, height, fmt, bd_luma, bd_chroma);
    pictures_.push_back(pic);
    current_pic_ = pic.get();
    return current_pic_;
}

void DPB::mark_current_as_short_term_ref() {
    // §8.1 step 4: "the current decoded picture ... is marked as
    //  'used for short-term reference'"
    if (current_pic_) {
        current_pic_->used_for_short_term_ref = true;
        current_pic_->used_for_long_term_ref = false;
    }
}

std::vector<Picture*> DPB::get_output_pictures() {
    // Simplified bumping: return all pictures marked for output, in POC order
    std::vector<Picture*> out;
    for (auto& pic : pictures_) {
        if (pic->needed_for_output) {
            out.push_back(pic.get());
        }
    }
    // Sort by CVS (GOP) first, then by POC within each CVS
    std::sort(out.begin(), out.end(),
              [](const Picture* a, const Picture* b) {
                  if (a->cvs_id != b->cvs_id) return a->cvs_id < b->cvs_id;
                  return a->poc < b->poc;
              });
    // Mark as output
    for (auto* pic : out) {
        pic->needed_for_output = false;
    }
    return out;
}

// ============================================================
// §C.5.2.4 — "Bumping" process
// ============================================================
// 1. Select the picture with the smallest PicOrderCntVal that is
//    marked as "needed for output".
// 2. Output it and mark as "not needed for output".
// 3. If the picture storage buffer is also "unused for reference",
//    it is emptied (handled by evict_unused).

Picture* DPB::bump(bool skip_current) {
    // §C.5.2.4 step 1: select the picture with the smallest PicOrderCntVal
    // that is marked as "needed for output".
    // Within multiple CVS, earlier CVS pictures are output first.
    Picture* smallest = nullptr;
    for (auto& pic : pictures_) {
        if (skip_current && pic.get() == current_pic_) continue;
        if (!pic->needed_for_output) continue;
        if (!smallest ||
            pic->cvs_id < smallest->cvs_id ||
            (pic->cvs_id == smallest->cvs_id && pic->poc < smallest->poc)) {
            smallest = pic.get();
        }
    }
    if (smallest) {
        smallest->needed_for_output = false;  // §C.5.2.4 step 2
    }
    return smallest;
}

// ============================================================
// §C.5.2.2 / §C.5.2.3 — Drain (incremental bumping)
// ============================================================
// Bumps pictures while any of the following conditions are true:
// - The number of pictures marked "needed for output" >
//   sps_max_num_reorder_pics[HighestTid]
// - The number of pictures in the DPB >=
//   sps_max_dec_pic_buffering_minus1[HighestTid] + 1
// - sps_max_latency_increase_plus1 != 0 and a picture has
//   PicLatencyCount >= SpsMaxLatencyPictures
//
// Note: PicLatencyCount tracking is not implemented (would require
// per-picture counter incremented at each subsequent picture decode).
// For most real-world streams, the reorder_pics and DPB size conditions
// are sufficient. Latency-based bumping is a conformance refinement
// that can be added later if needed.
//
// Two details decide whether output comes out in display order:
//
// 1. §C.5.2.2 runs *before* the current picture is stored in the DPB. We are
//    called after feed() decoded it, so both counts must skip current_pic_ —
//    otherwise every condition fires one picture early and bumps a picture
//    whose lower-POC neighbours are not decoded yet.
// 2. The "DPB is full" condition counts *occupied storage buffers*. Bumping
//    empties the buffer of a picture that is no longer a reference (§C.5.2.4
//    step 3), so that count must fall as we bump. Counting pictures_ instead
//    would keep the condition true for the whole loop — it never shrinks,
//    since eviction is deferred to alloc_picture to keep drained pointers
//    valid — and drain the entire DPB in decode order.

std::vector<Picture*> DPB::drain(const SPS& sps) {
    std::vector<Picture*> out;

    // §C.5.2.2: use HighestTid = sps_max_sub_layers_minus1
    int tid = sps.sps_max_sub_layers_minus1;
    int max_reorder = static_cast<int>(sps.sub_layer_ordering[tid].max_num_reorder_pics);
    int max_dpb_size = static_cast<int>(sps.sub_layer_ordering[tid].max_dec_pic_buffering_minus1) + 1;

    // Pictures already in the DPB when §C.5.2.2 is evaluated — the current
    // picture is not one of them.
    auto count_needed_for_output = [this]() {
        int count = 0;
        for (auto& pic : pictures_) {
            if (pic.get() != current_pic_ && pic->needed_for_output) count++;
        }
        return count;
    };

    // Storage buffers still held: a picture that is neither a reference nor
    // pending output is emptied (§C.5.2.4 step 3) and no longer counts.
    auto count_occupied = [this]() {
        int count = 0;
        for (auto& pic : pictures_) {
            if (pic.get() != current_pic_ &&
                (pic->is_reference() || pic->needed_for_output)) count++;
        }
        return count;
    };

    // §C.5.2.2: bump while conditions are met
    while (true) {
        bool should_bump = false;

        // Condition 1: too many pictures waiting for output
        if (count_needed_for_output() > max_reorder) {
            should_bump = true;
        }

        // Condition 2: DPB is full
        if (count_occupied() >= max_dpb_size) {
            if (count_needed_for_output() > 0) {
                should_bump = true;
            }
        }

        if (!should_bump) break;

        // Skip the current picture: the counters above exclude it, so bumping
        // it would output a picture without making either count fall.
        Picture* pic = bump(/*skip_current=*/true);
        if (!pic) break;
        out.push_back(pic);

        // NOTE: Do NOT evict here — the returned raw pointers must stay valid
        // until the next feed() call. alloc_picture() handles eviction.
    }

    return out;
}

// ============================================================
// Flush — output ALL remaining pictures (end of stream)
// ============================================================

std::vector<Picture*> DPB::flush() {
    std::vector<Picture*> out;

    // Bump all pictures marked as "needed for output", in POC order
    while (true) {
        Picture* pic = bump();
        if (!pic) break;
        out.push_back(pic);
    }

    // NOTE: Do NOT evict here — raw pointers must stay valid.
    return out;
}

// ============================================================
// Evict unused — remove pictures that are neither ref nor output
// ============================================================

void DPB::evict_unused() {
    pictures_.erase(
        std::remove_if(pictures_.begin(), pictures_.end(),
            [this](const std::shared_ptr<Picture>& p) {
                // Don't evict the current picture being decoded
                if (p.get() == current_pic_) return false;
                return !p->is_reference() && !p->needed_for_output;
            }),
        pictures_.end());
}

// ============================================================
// Helpers
// ============================================================

Picture* DPB::find_short_term_by_poc(int32_t poc) const {
    for (auto& pic : pictures_) {
        if (pic.get() != current_pic_ && pic->used_for_short_term_ref && pic->poc == poc)
            return pic.get();
    }
    return nullptr;
}

Picture* DPB::find_by_poc(int32_t poc) const {
    for (auto& pic : pictures_) {
        if (pic.get() != current_pic_ && pic->is_reference() && pic->poc == poc)
            return pic.get();
    }
    return nullptr;
}

Picture* DPB::find_by_poc_lsb(int32_t poc_lsb, int32_t max_poc_lsb) const {
    for (auto& pic : pictures_) {
        if (pic.get() != current_pic_ && pic->is_reference() &&
            (pic->poc & (max_poc_lsb - 1)) == poc_lsb)
            return pic.get();
    }
    return nullptr;
}

} // namespace hevc
