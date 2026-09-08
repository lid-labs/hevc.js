#include <gtest/gtest.h>
#include <vector>

#include "bitstream/bitstream_reader.h"
#include "decoding/dpb.h"
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
void write_p_slice_prologue(BitWriter& w) {
    w.bit(1);                                       // first_slice_segment_in_pic_flag
    w.ue(0);                                        // slice_pic_parameter_set_id
    w.ue(static_cast<uint32_t>(SliceType::P));      // slice_type
    w.bits(1, 4);                                   // slice_pic_order_cnt_lsb
    w.bit(1);                                       // short_term_ref_pic_set_sps_flag
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
