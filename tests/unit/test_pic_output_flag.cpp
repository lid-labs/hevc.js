// PicOutputFlag (§C.3.1) — a picture the bitstream marks as not for output is
// decoded, may serve as a reference, and is never bumped out of the DPB.
//
// x265 leaves output_flag_present_flag at 0, so no fixture in the suite
// carries the flag. These tests patch one that does: the flag is a single bit
// already present in the PPS, and turning it on only grows each slice header
// by the one bit it gates. Everything past the header is byte-aligned slice
// data, copied through untouched, so the pictures decode exactly as before —
// which PatchIsNeutralWhenEveryPictureIsOutput asserts before the rest relies
// on it.

#include <gtest/gtest.h>

#include <cstdint>
#include <fstream>
#include <set>
#include <vector>

#include "bitstream/bitstream_reader.h"
#include "bitstream/nal_unit.h"
#include "decoding/decoder.h"
#include "syntax/parameter_sets.h"

using namespace hevc;

namespace {

std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    return {std::istreambuf_iterator<char>(f), {}};
}

uint32_t get_bit(const std::vector<uint8_t>& d, size_t i) {
    return (d[i >> 3] >> (7 - (i & 7))) & 1u;
}

void set_bit(std::vector<uint8_t>& d, size_t i, uint32_t v) {
    const uint8_t mask = static_cast<uint8_t>(0x80u >> (i & 7));
    if (v) d[i >> 3] |= mask;
    else   d[i >> 3] = static_cast<uint8_t>(d[i >> 3] & ~mask);
}

// Appends bits MSB-first, growing the buffer a byte at a time.
class BitWriter {
public:
    void put_bit(uint32_t b) {
        if (nbits_ % 8 == 0) bytes_.push_back(0);
        if (b) bytes_.back() |= static_cast<uint8_t>(0x80u >> (nbits_ % 8));
        nbits_++;
    }
    void copy_bits(const std::vector<uint8_t>& src, size_t from, size_t to) {
        for (size_t i = from; i < to; i++) put_bit(get_bit(src, i));
    }
    std::vector<uint8_t> take() { return std::move(bytes_); }

private:
    std::vector<uint8_t> bytes_;
    size_t nbits_ = 0;
};

// §7.3.1.1 — re-insert the emulation prevention bytes NalParser stripped.
std::vector<uint8_t> escape_rbsp(const std::vector<uint8_t>& rbsp) {
    std::vector<uint8_t> out;
    out.reserve(rbsp.size() + 8);
    int zeros = 0;
    for (uint8_t b : rbsp) {
        if (zeros >= 2 && b <= 3) {
            out.push_back(0x03);
            zeros = 0;
        }
        out.push_back(b);
        zeros = (b == 0) ? zeros + 1 : 0;
    }
    return out;
}

// Rewrites `data` so the PPS sets output_flag_present_flag and every slice
// carries pic_output_flag: 1, except for the pictures whose decode-order
// index is in `suppress`, which get 0.
//
// Single-slice pictures only — every fixture in the suite is one slice per
// picture, and a dependent slice segment has no pic_output_flag of its own.
std::vector<uint8_t> patch_pic_output_flag(const std::vector<uint8_t>& data,
                                           const std::set<int>& suppress) {
    NalParser parser;
    auto nals = parser.parse(data.data(), data.size());

    // Parameter sets as the original bitstream has them: the slice headers to
    // measure are the ones written against this PPS, with the flag still off.
    ParameterSetManager psm;
    for (const auto& nal : nals) {
        auto t = nal.header.nal_unit_type;
        if (t == NalUnitType::VPS_NUT || t == NalUnitType::SPS_NUT || t == NalUnitType::PPS_NUT)
            psm.process_nal(nal);
    }

    std::vector<uint8_t> out;
    int pic_index = 0;

    for (const auto& nal : nals) {
        std::vector<uint8_t> rbsp = nal.rbsp;
        const auto type = nal.header.nal_unit_type;

        if (type == NalUnitType::PPS_NUT) {
            BitstreamReader bs(rbsp.data(), rbsp.size());
            bs.read_ue();    // pps_pic_parameter_set_id
            bs.read_ue();    // pps_seq_parameter_set_id
            bs.read_flag();  // dependent_slice_segments_enabled_flag
            set_bit(rbsp, bs.bits_read(), 1);  // output_flag_present_flag
        } else if (is_vcl(type)) {
            // Walk the header up to where pic_output_flag would sit (§7.3.6.1)
            BitstreamReader probe(rbsp.data(), rbsp.size());
            EXPECT_TRUE(probe.read_flag()) << "helper handles single-slice pictures only";
            if (is_irap(type)) probe.read_flag();  // no_output_of_prior_pics_flag
            const uint32_t pps_id = probe.read_ue();
            const PPS* pps = psm.get_pps(static_cast<int>(pps_id));
            const SPS* sps = pps ? psm.get_sps(static_cast<int>(pps->pps_seq_parameter_set_id))
                                 : nullptr;
            EXPECT_TRUE(pps && sps) << "slice references a parameter set the fixture lacks";
            if (!pps || !sps) return {};
            for (int i = 0; i < pps->num_extra_slice_header_bits; i++) probe.read_flag();
            probe.read_ue();  // slice_type
            const size_t insert_at = probe.bits_read();

            // Full parse for the header's length, byte_alignment() included
            SliceHeader sh;
            BitstreamReader full(rbsp.data(), rbsp.size());
            EXPECT_TRUE(sh.parse(full, *sps, *pps, type, nal.header.TemporalId()));
            const size_t header_bits = full.bits_read();
            EXPECT_EQ(header_bits % 8, 0u) << "byte_alignment() should leave the header aligned";

            const bool output = suppress.count(pic_index) == 0;
            pic_index++;

            BitWriter w;
            w.copy_bits(rbsp, 0, insert_at);
            w.put_bit(output ? 1 : 0);
            w.copy_bits(rbsp, insert_at, header_bits);
            // The header grew by one bit, so the byte_alignment just copied no
            // longer aligns: pad it out to a whole extra byte. Its
            // alignment_bit_equal_to_one is still the first bit of the run,
            // and zeros follow to the boundary — which is all §7.3.2.11 asks.
            for (int i = 0; i < 7; i++) w.put_bit(0);

            std::vector<uint8_t> patched = w.take();
            patched.insert(patched.end(), rbsp.begin() + static_cast<long>(header_bits / 8),
                           rbsp.end());
            rbsp = std::move(patched);
        }

        const std::vector<uint8_t> payload = escape_rbsp(rbsp);
        const uint8_t start_code[4] = {0, 0, 0, 1};
        out.insert(out.end(), start_code, start_code + 4);
        out.push_back(data[nal.offset]);      // NAL header, 2 bytes, unchanged
        out.push_back(data[nal.offset + 1]);
        out.insert(out.end(), payload.begin(), payload.end());
    }

    return out;
}

struct DecodeOutcome {
    std::vector<int32_t> output_pocs;      // in output order
    std::vector<int32_t> suppressed_pocs;  // as the decoder reported them
};

// Feed/drain per NAL then flush — the transcoder's path.
DecodeOutcome decode_incremental(const std::vector<uint8_t>& data) {
    NalParser parser;
    auto nals = parser.parse(data.data(), data.size());

    Decoder dec;
    DecodeOutcome outcome;

    for (const auto& nal : nals) {
        // Re-emit the NAL with a start code: feed() takes Annex B
        std::vector<uint8_t> chunk = {0, 0, 0, 1};
        chunk.insert(chunk.end(), data.begin() + static_cast<long>(nal.offset),
                     data.begin() + static_cast<long>(nal.offset + nal.size));
        EXPECT_EQ(dec.feed(chunk.data(), chunk.size()), DecodeStatus::OK);

        for (int32_t poc : dec.take_suppressed_pocs()) outcome.suppressed_pocs.push_back(poc);
        for (const Picture* pic : dec.drain()) outcome.output_pocs.push_back(pic->poc);
    }
    for (const Picture* pic : dec.flush()) outcome.output_pocs.push_back(pic->poc);

    return outcome;
}

const char* kFixture = FIXTURES_DIR "/full_qcif_10f.265";

}  // namespace

// A patch that leaves every picture output-able must not change the decode:
// this is what lets the suppression tests below attribute any difference to
// the flag rather than to the rewrite.
TEST(PicOutputFlag, PatchIsNeutralWhenEveryPictureIsOutput) {
    auto original = read_file(kFixture);
    ASSERT_FALSE(original.empty()) << "cannot read " << kFixture;

    auto patched = patch_pic_output_flag(original, {});
    ASSERT_FALSE(patched.empty());
    ASSERT_NE(patched, original) << "the patch should have rewritten the slice headers";

    const auto before = decode_incremental(original);
    const auto after = decode_incremental(patched);

    EXPECT_EQ(after.output_pocs, before.output_pocs);
    EXPECT_TRUE(after.suppressed_pocs.empty());
    EXPECT_TRUE(before.suppressed_pocs.empty())
        << "the unpatched fixture has no pic_output_flag to read";
}

// The point of the fix: PicOutputFlag = 0 keeps a picture out of the output.
TEST(PicOutputFlag, SuppressedPictureIsNeverOutput) {
    auto original = read_file(kFixture);
    ASSERT_FALSE(original.empty()) << "cannot read " << kFixture;

    const auto before = decode_incremental(original);
    ASSERT_GT(before.output_pocs.size(), 5u);

    // A picture in the middle of the GOP, so it is a reference for later ones:
    // suppressing its output must not stop it being decoded and referenced.
    const auto after = decode_incremental(patch_pic_output_flag(original, {4}));

    ASSERT_EQ(after.suppressed_pocs.size(), 1u);
    const int32_t dropped = after.suppressed_pocs[0];

    std::vector<int32_t> expected;
    for (int32_t poc : before.output_pocs) {
        if (poc != dropped) expected.push_back(poc);
    }
    ASSERT_EQ(expected.size(), before.output_pocs.size() - 1)
        << "the suppressed POC should have been in the original output";
    EXPECT_EQ(after.output_pocs, expected)
        << "the other pictures must come out unchanged, in the same order";
}

// The reported POCs are what a caller needs to keep timestamps aligned, so
// they must cover every suppressed picture, whatever its position.
TEST(PicOutputFlag, EverySuppressedPocIsReportedOnce) {
    auto original = read_file(kFixture);
    ASSERT_FALSE(original.empty()) << "cannot read " << kFixture;

    const auto before = decode_incremental(original);
    const std::set<int> suppressed = {0, 3, 9};
    const auto after = decode_incremental(patch_pic_output_flag(original, suppressed));

    EXPECT_EQ(after.suppressed_pocs.size(), suppressed.size());
    EXPECT_EQ(after.output_pocs.size() + suppressed.size(), before.output_pocs.size());

    std::set<int32_t> dropped(after.suppressed_pocs.begin(), after.suppressed_pocs.end());
    EXPECT_EQ(dropped.size(), suppressed.size()) << "no POC reported twice";
    for (int32_t poc : after.output_pocs) {
        EXPECT_EQ(dropped.count(poc), 0u) << "POC " << poc << " was both output and suppressed";
    }
}

// take_suppressed_pocs() empties the list: a caller polling it after every
// feed() must not see the same picture again on the next segment.
TEST(PicOutputFlag, TakeSuppressedPocsEmptiesTheList) {
    auto original = read_file(kFixture);
    ASSERT_FALSE(original.empty()) << "cannot read " << kFixture;

    auto patched = patch_pic_output_flag(original, {2});
    Decoder dec;
    ASSERT_EQ(dec.decode(patched.data(), patched.size()), DecodeStatus::OK);

    EXPECT_EQ(dec.take_suppressed_pocs().size(), 1u);
    EXPECT_TRUE(dec.take_suppressed_pocs().empty());
}

// The batch path must agree with the incremental one on what a bitstream
// outputs — output_pictures() is what the native CLI and the oracle use.
TEST(PicOutputFlag, BatchPathSkipsSuppressedPicturesToo) {
    auto original = read_file(kFixture);
    ASSERT_FALSE(original.empty()) << "cannot read " << kFixture;

    Decoder plain;
    ASSERT_EQ(plain.decode(original.data(), original.size()), DecodeStatus::OK);
    const size_t plain_count = plain.output_pictures().size();
    ASSERT_GT(plain_count, 1u);

    auto patched = patch_pic_output_flag(original, {1});
    Decoder dec;
    ASSERT_EQ(dec.decode(patched.data(), patched.size()), DecodeStatus::OK);

    const auto pics = dec.output_pictures();
    EXPECT_EQ(pics.size(), plain_count - 1);

    const int32_t dropped = dec.take_suppressed_pocs().at(0);
    for (const Picture* pic : pics) {
        EXPECT_NE(pic->poc, dropped);
    }
}
