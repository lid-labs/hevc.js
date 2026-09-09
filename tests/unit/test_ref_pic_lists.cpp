#include <gtest/gtest.h>
#include <algorithm>
#include <vector>

#include "bitstream/bitstream_reader.h"
#include "common/picture.h"
#include "decoding/coding_tree.h"
#include "decoding/dpb.h"
#include "decoding/interpolation.h"
#include "syntax/pps.h"
#include "syntax/slice_header.h"
#include "syntax/sps.h"

using namespace hevc;

// Minimal RBSP writer — just enough to build a slice header by hand.
// No fixture exercises these paths: x265 emits neither of them.
namespace {

class BitWriter {
public:
    void bit(uint32_t v) {
        if (nbits_ % 8 == 0) bytes_.push_back(0);
        bytes_.back() |= static_cast<uint8_t>((v & 1) << (7 - nbits_ % 8));
        nbits_++;
    }
    // 64-bit throughout: ue(0xffffffff) emits 33 information bits, which neither a
    // uint32_t value nor a shift by 32 can carry.
    void bits(uint64_t v, int n) {
        for (int i = n - 1; i >= 0; i--) bit(static_cast<uint32_t>(v >> i));
    }
    void ue(uint32_t v) {
        uint64_t code = static_cast<uint64_t>(v) + 1;
        int n = 0;
        while (code >> (n + 1)) n++;
        bits(0, n);
        bits(code, n + 1);
    }
    // Trailing zeros keep the reader inside the buffer past the rejection point.
    std::vector<uint8_t> data() const {
        std::vector<uint8_t> out = bytes_;
        out.resize(out.size() + 4, 0);
        return out;
    }

private:
    std::vector<uint8_t> bytes_;
    size_t nbits_ = 0;
};

// SPS/PPS with every optional slice-header field switched off, so the written
// bits map one-to-one onto the fields the tests care about.
SPS minimal_sps(uint32_t num_used_negative_pics) {
    SPS sps;
    sps.num_short_term_ref_pic_sets = 1;
    sps.st_ref_pic_sets.resize(1);
    sps.st_ref_pic_sets[0].NumNegativePics = num_used_negative_pics;
    for (uint32_t i = 0; i < num_used_negative_pics; i++) {
        sps.st_ref_pic_sets[0].DeltaPocS0[i] = -1 - static_cast<int32_t>(i);
        sps.st_ref_pic_sets[0].UsedByCurrPicS0[i] = true;
    }
    return sps;
}

// slice_segment_header() up to num_ref_idx_active_override_flag, for a P slice
// of a non-IDR picture: first_slice, pps_id, slice_type, poc_lsb, st_rps_sps_flag.
void write_p_slice_prologue_head(BitWriter& w) {
    w.bit(1);                                       // first_slice_segment_in_pic_flag
    w.ue(0);                                        // slice_pic_parameter_set_id
    w.ue(static_cast<uint32_t>(SliceType::P));      // slice_type
    w.bits(1, 4);                                   // slice_pic_order_cnt_lsb
    w.bit(1);                                       // short_term_ref_pic_set_sps_flag
}

void write_p_slice_prologue(BitWriter& w) {
    write_p_slice_prologue_head(w);
    w.bit(0);                                       // num_ref_idx_active_override_flag
}

} // namespace

// §7.4.7.1: NumPicTotalCurr shall not be 0 for a P or B slice. Accepting one
// leaves §8.3.4's RefPicListTemp loop with nothing to advance rIdx on.
TEST(RefPicLists, ParserRejectsZeroNumPicTotalCurr) {
    SPS sps = minimal_sps(0);
    PPS pps;
    BitWriter w;
    write_p_slice_prologue(w);

    auto buf = w.data();
    BitstreamReader bs(buf.data(), buf.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));
}

// §7.4.7.2 bounds list_entry_lX to NumPicTotalCurr - 1, while its width,
// Ceil(Log2(NumPicTotalCurr)), represents more — 3 here, of a three-entry list.
TEST(RefPicLists, ParserRejectsOutOfRangeListEntry) {
    SPS sps = minimal_sps(3);
    PPS pps;
    pps.lists_modification_present_flag = true;
    BitWriter w;
    write_p_slice_prologue(w);
    w.bit(1);        // ref_pic_list_modification_flag_l0
    w.bits(3, 2);    // list_entry_l0[0] — one past the last valid index

    auto buf = w.data();
    BitstreamReader bs(buf.data(), buf.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));
}

// Same two cases at the DPB entry point, which is public and reachable without
// the parser. The first hangs without the guard, hence the ctest timeout.
TEST(RefPicLists, ZeroNumPicTotalCurrBuildsNoList) {
    DPB dpb;
    SPS sps;
    PPS pps;
    SliceHeader sh;
    sh.slice_type = SliceType::P;

    dpb.construct_ref_pic_lists(sh, sps, pps);

    EXPECT_EQ(dpb.num_ref_list0(), 0);
}

TEST(RefPicLists, OutOfRangeListEntryYieldsNoReference) {
    DPB dpb;
    SPS sps = minimal_sps(1);
    PPS pps;
    SliceHeader sh;
    sh.slice_type = SliceType::P;
    sh.active_rps = &sps.st_ref_pic_sets[0];
    // The reference is absent from the empty DPB, so the set holds one nullptr —
    // enough for NumPicTotalCurr to be 1 and RefPicListTemp0 to hold one entry.
    dpb.derive_rps(sh, sps, NalUnitType::TRAIL_R, 1);

    sh.ref_pic_list_modification_flag_l0 = true;
    sh.list_entry_l0[0] = 7;
    dpb.construct_ref_pic_lists(sh, sps, pps);

    ASSERT_EQ(dpb.num_ref_list0(), 1);
    EXPECT_EQ(dpb.ref_pic_list0(0), nullptr);
}

// ============================================================
// §8.5.3.3 — inter prediction against a reference list holding a null entry
// ============================================================

namespace {

// A DPB whose list0 holds one null entry: the RPS names a POC the DPB never
// received, which is what a mid-stream start looks like to the transcoder.
SPS inter_sps() {
    SPS sps;
    sps.SubWidthC = 2;
    sps.SubHeightC = 2;
    return sps;
}

} // namespace

// The prediction buffers are raw stack arrays, written only inside `if (refPic)`.
// With the flag left set, weighted prediction read all nSamples of a buffer
// nothing wrote — undefined behaviour, and output that varies between runs.
TEST(InterPrediction, NullReferenceYieldsNeutralGrey) {
    DPB dpb;
    SPS sps = inter_sps();
    PPS pps;
    SliceHeader sh;
    sh.slice_type = SliceType::P;

    SPS rps_holder = minimal_sps(1);
    sh.active_rps = &rps_holder.st_ref_pic_sets[0];
    dpb.derive_rps(sh, rps_holder, NalUnitType::TRAIL_R, 1);
    dpb.construct_ref_pic_lists(sh, rps_holder, pps);
    ASSERT_EQ(dpb.num_ref_list0(), 1);
    ASSERT_EQ(dpb.ref_pic_list0(0), nullptr);

    DecodingContext ctx;
    ctx.sps = &sps;
    ctx.pps = &pps;
    ctx.sh = &sh;
    ctx.dpb = &dpb;

    constexpr int kSize = 8;
    // 16 is what the SPS allows at most, and 1 << 15 does not fit an int16_t.
    for (int bitDepth : {8, 10, 16}) {
        sps.BitDepthY = bitDepth;
        int16_t pred[kSize * kSize];
        std::fill_n(pred, kSize * kSize, static_cast<int16_t>(-1));

        perform_inter_prediction(ctx, 0, 0, kSize, kSize, 0, MV{}, MV{}, 0, -1,
                                 true, false, pred);

        const int expected = std::min(1 << (bitDepth - 1), 32767);
        for (int i = 0; i < kSize * kSize; i++)
            EXPECT_EQ(pred[i], expected) << "bitDepth " << bitDepth << " sample " << i;
    }
}

// A B slice whose list0 starts on the missing picture and list1 on the present
// one. Without clearing predFlagL0, this reaches the bi-prediction branch and
// averages the real samples with whatever the stack held.
TEST(InterPrediction, MissingL0FallsBackToUniPredL1) {
    DPB dpb;
    SPS sps = inter_sps();
    PPS pps;

    // POC 2 is present and marked as a reference; POC 0 never arrives.
    Picture* ref = dpb.alloc_picture(16, 16, ChromaFormat::YUV420, 8, 8);
    ref->poc = 2;
    ref->used_for_short_term_ref = true;
    std::fill(ref->planes[0].begin(), ref->planes[0].end(), static_cast<uint16_t>(100));

    // The picture being decoded is allocated last, as the decoder does: the DPB
    // excludes current_pic_ from reference lookups.
    Picture* cur = dpb.alloc_picture(16, 16, ChromaFormat::YUV420, 8, 8);
    cur->poc = 1;

    SPS rps_holder;
    rps_holder.num_short_term_ref_pic_sets = 1;
    rps_holder.st_ref_pic_sets.resize(1);
    auto& rps = rps_holder.st_ref_pic_sets[0];
    rps.NumNegativePics = 1;                 // POC 1 - 1 = 0, absent
    rps.DeltaPocS0[0] = -1;
    rps.UsedByCurrPicS0[0] = true;
    rps.NumPositivePics = 1;                 // POC 1 + 1 = 2, present
    rps.DeltaPocS1[0] = 1;
    rps.UsedByCurrPicS1[0] = true;

    SliceHeader sh;
    sh.slice_type = SliceType::B;
    sh.active_rps = &rps;
    dpb.derive_rps(sh, rps_holder, NalUnitType::TRAIL_R, 1);
    dpb.construct_ref_pic_lists(sh, rps_holder, pps);

    // §8.3.4: list0 leads with StCurrBefore, list1 with StCurrAfter.
    ASSERT_EQ(dpb.ref_pic_list0(0), nullptr);
    ASSERT_EQ(dpb.ref_pic_list1(0), ref);

    DecodingContext ctx;
    ctx.sps = &sps;
    ctx.pps = &pps;
    ctx.sh = &sh;
    ctx.dpb = &dpb;

    constexpr int kSize = 8;
    int16_t pred[kSize * kSize];
    std::fill_n(pred, kSize * kSize, static_cast<int16_t>(-1));

    perform_inter_prediction(ctx, 0, 0, kSize, kSize, 0, MV{}, MV{}, 0, 0,
                             true, true, pred);

    // Uni-prediction from L1 alone reproduces the reference samples exactly.
    for (int i = 0; i < kSize * kSize; i++)
        EXPECT_EQ(pred[i], 100) << "sample " << i;
}

// §7.4.7.1 derives PocLsbLt and UsedByCurrPicLt from the SPS tables for the
// first num_long_term_sps entries. Leaving the slice-header arrays at zero
// dropped those references, and made the parser's NumPicTotalCurr disagree with
// the DPB's — 1 against 0 on a slice whose only used references are SPS ones.
TEST(RefPicLists, LongTermFromSpsReachesTheDpb) {
    SPS sps = minimal_sps(0);
    sps.long_term_ref_pics_present_flag = true;
    sps.num_long_term_ref_pics_sps = 1;
    sps.lt_ref_pic_poc_lsb_sps[0] = 5;
    sps.used_by_curr_pic_lt_sps_flag[0] = true;
    PPS pps;

    BitWriter w;
    write_p_slice_prologue_head(w);
    w.ue(1);     // num_long_term_sps — lt_idx_sps is not coded, one SPS entry
    w.ue(0);     // num_long_term_pics
    w.bit(0);    // delta_poc_msb_present_flag[0]
    w.bit(0);    // num_ref_idx_active_override_flag
    // The header is parsed to the end here, unlike the rejection tests above.
    w.ue(0);     // five_minus_max_num_merge_cand
    w.ue(0);     // slice_qp_delta, se(0)

    auto buf = w.data();
    BitstreamReader bs(buf.data(), buf.size());
    SliceHeader sh;
    ASSERT_TRUE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));

    EXPECT_EQ(sh.poc_lsb_lt[0], 5u);
    EXPECT_TRUE(sh.used_by_curr_pic_lt_flag[0]);

    // The DPB reads the same arrays, so the reference now reaches its lists.
    DPB dpb;
    sh.active_rps = &sps.st_ref_pic_sets[0];
    dpb.derive_rps(sh, sps, NalUnitType::TRAIL_R, 1);
    dpb.construct_ref_pic_lists(sh, sps, pps);
    EXPECT_EQ(dpb.num_ref_list0(), 1);
}

// §7.4.7.1: DeltaPocMsbCycleLt[i] = delta_poc_msb_cycle_lt[i] + DeltaPocMsbCycleLt[i-1]
// unless i starts one of the two runs. Reading the raw syntax element instead
// derives a wrong POC from the second entry on, so the reference is never found.
TEST(RefPicLists, DeltaPocMsbCycleLtAccumulates) {
    SPS sps = minimal_sps(0);
    sps.long_term_ref_pics_present_flag = true;
    PPS pps;

    BitWriter w;
    write_p_slice_prologue_head(w);
    w.ue(2);        // num_long_term_pics — num_long_term_sps is not coded here
    for (uint32_t i = 0; i < 2; i++) {
        w.bits(i + 1, 4);   // poc_lsb_lt[i]
        w.bit(1);           // used_by_curr_pic_lt_flag[i]
        w.bit(1);           // delta_poc_msb_present_flag[i]
        w.ue(i + 1);        // delta_poc_msb_cycle_lt[i] — 1 then 2
    }
    w.bit(0);       // num_ref_idx_active_override_flag
    w.ue(0);        // five_minus_max_num_merge_cand
    w.ue(0);        // slice_qp_delta

    auto buf = w.data();
    BitstreamReader bs(buf.data(), buf.size());
    SliceHeader sh;
    ASSERT_TRUE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));

    EXPECT_EQ(sh.DeltaPocMsbCycleLt[0], 1u);
    EXPECT_EQ(sh.DeltaPocMsbCycleLt[1], 3u);   // 2 + 1, not 2
}

// refIdx defaults to -1 across the decoder, and the accessor is public.
TEST(RefPicLists, NegativeIndexYieldsNoReference) {
    DPB dpb;
    EXPECT_EQ(dpb.ref_pic_list0(-1), nullptr);
    EXPECT_EQ(dpb.ref_pic_list1(-1), nullptr);
}
