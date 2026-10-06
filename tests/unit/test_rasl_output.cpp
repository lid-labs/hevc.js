// RASL output (§8.1) — a RASL picture whose associated IRAP has
// NoRaslOutputFlag = 1 is decoded but never output: the references it needs
// precede that IRAP in decode order and were never decoded, so it cannot be
// reconstructed.
//
// Unlike pic_output_flag (§C.3.1, test_pic_output_flag.cpp), this clause needs
// no patched bitstream: two fixtures carry it. opengop_qcif_12f.265 has its CRA
// mid-stream, where NoRaslOutputFlag is 0 and the RASL pictures are decodable
// and output; opengop_qcif_cra_first.265 is the same stream cut at that CRA, so
// it opens the bitstream and takes NoRaslOutputFlag = 1. Both are produced by
// tools/gen_open_gop_fixtures.sh.

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <optional>
#include <vector>

#include "bitstream/nal_unit.h"
#include "decoding/decoder.h"

using namespace hevc;

namespace {

std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    return {std::istreambuf_iterator<char>(f), {}};
}

struct DecodeOutcome {
    std::vector<int32_t> output_pocs;
    std::vector<SuppressedPicture> suppressed;
};

// Feed/drain per NAL then flush — the transcoder's path.
DecodeOutcome decode_incremental(const std::vector<uint8_t>& data) {
    NalParser parser;
    auto nals = parser.parse(data.data(), data.size());

    Decoder dec;
    DecodeOutcome outcome;

    for (const auto& nal : nals) {
        std::vector<uint8_t> chunk = {0, 0, 0, 1};
        chunk.insert(chunk.end(), data.begin() + static_cast<long>(nal.offset),
                     data.begin() + static_cast<long>(nal.offset + nal.size));
        EXPECT_EQ(dec.feed(chunk.data(), chunk.size()), DecodeStatus::OK);

        for (const auto& p : dec.take_suppressed_pictures()) outcome.suppressed.push_back(p);
        for (const Picture* pic : dec.drain()) outcome.output_pocs.push_back(pic->poc);
    }
    for (const Picture* pic : dec.flush()) outcome.output_pocs.push_back(pic->poc);

    return outcome;
}

// Counts the RASL pictures a bitstream carries, so the expectations below are
// stated against the fixture rather than against a number written by hand.
size_t count_rasl(const std::vector<uint8_t>& data) {
    NalParser parser;
    size_t n = 0;
    for (const auto& nal : parser.parse(data.data(), data.size())) {
        if (is_rasl(nal.header.nal_unit_type)) n++;
    }
    return n;
}

// Cuts a bitstream at its first RASL picture, keeping the parameter sets. The
// result opens before any IRAP — what a player hands a decoder when a segment
// is not aligned on one. Done in memory rather than as a third fixture: it is
// the same bitstream, and the cut is the point being made.
std::vector<uint8_t> cut_at_first_rasl(const std::vector<uint8_t>& data) {
    NalParser parser;
    auto nals = parser.parse(data.data(), data.size());

    size_t params_end = 0;
    size_t rasl_start = 0;
    bool found = false;
    for (const auto& nal : nals) {
        // nal.offset points past the start code, which the cut has to keep
        const size_t start = nal.offset >= 4 ? nal.offset - 4 : 0;
        if (params_end == 0 && static_cast<uint8_t>(nal.header.nal_unit_type) < 32) {
            params_end = start;
        }
        if (!found && is_rasl(nal.header.nal_unit_type)) {
            rasl_start = start;
            found = true;
        }
    }
    if (!found) return {};

    std::vector<uint8_t> cut(data.begin(), data.begin() + static_cast<long>(params_end));
    cut.insert(cut.end(), data.begin() + static_cast<long>(rasl_start), data.end());
    return cut;
}

const char* kFull = FIXTURES_DIR "/opengop_qcif_12f.265";
const char* kCraFirst = FIXTURES_DIR "/opengop_qcif_cra_first.265";

}  // namespace

// The fixtures are only worth anything if they carry what they claim to. Both
// hold RASL pictures, and the cut one opens on the CRA they belong to.
TEST(RaslOutput, FixturesCarryRaslPictures) {
    const auto full = read_file(kFull);
    const auto cut = read_file(kCraFirst);
    ASSERT_FALSE(full.empty()) << "cannot read " << kFull;
    ASSERT_FALSE(cut.empty()) << "cannot read " << kCraFirst;

    EXPECT_GT(count_rasl(full), 0u);
    EXPECT_GT(count_rasl(cut), 0u);

    NalParser parser;
    std::optional<NalUnitType> first_vcl;
    for (const auto& nal : parser.parse(cut.data(), cut.size())) {
        if (static_cast<uint8_t>(nal.header.nal_unit_type) < 32) {
            first_vcl = nal.header.nal_unit_type;
            break;
        }
    }
    ASSERT_TRUE(first_vcl.has_value()) << "the cut fixture holds no coded picture";
    EXPECT_EQ(*first_vcl, NalUnitType::CRA_NUT)
        << "the cut fixture must open on the CRA, which is what gives it "
           "NoRaslOutputFlag = 1";
}

// A CRA that follows a decodable sequence has NoRaslOutputFlag = 0, so its RASL
// pictures reference pictures that were decoded and must be output as usual.
// This is the regression half: the override must not reach them.
TEST(RaslOutput, RaslOfMidStreamCraIsOutput) {
    const auto data = read_file(kFull);
    ASSERT_FALSE(data.empty()) << "cannot read " << kFull;

    const auto outcome = decode_incremental(data);

    EXPECT_TRUE(outcome.suppressed.empty())
        << "nothing in this stream has PicOutputFlag = 0";
    EXPECT_EQ(outcome.output_pocs.size(), 12u)
        << "every coded picture of the fixture should come out";
}

// The fix: the RASL pictures of the opening CRA are held back, and every other
// picture still comes out.
TEST(RaslOutput, RaslOfOpeningCraIsNotOutput) {
    const auto data = read_file(kCraFirst);
    ASSERT_FALSE(data.empty()) << "cannot read " << kCraFirst;

    const size_t rasl = count_rasl(data);
    ASSERT_GT(rasl, 0u);

    NalParser parser;
    size_t coded = 0;
    for (const auto& nal : parser.parse(data.data(), data.size())) {
        if (static_cast<uint8_t>(nal.header.nal_unit_type) < 32) coded++;
    }

    const auto outcome = decode_incremental(data);

    EXPECT_EQ(outcome.suppressed.size(), rasl)
        << "each RASL picture of an IRAP with NoRaslOutputFlag = 1 is suppressed";
    EXPECT_EQ(outcome.output_pocs.size(), coded - rasl)
        << "and nothing else is";
}

// A suppressed picture that is not reported would leave a caller assigning
// timestamps by output position one slot ahead for the rest of the segment.
TEST(RaslOutput, SuppressedRaslAreReportedWithTheirCvs) {
    const auto data = read_file(kCraFirst);
    ASSERT_FALSE(data.empty()) << "cannot read " << kCraFirst;

    const auto outcome = decode_incremental(data);
    ASSERT_FALSE(outcome.suppressed.empty());

    for (const auto& p : outcome.suppressed) {
        for (int32_t out : outcome.output_pocs) {
            EXPECT_NE(p.poc, out) << "a reported POC must not also be output";
        }
    }
}

// Every suppressed picture displays *before* the CRA, since a RASL picture
// precedes its IRAP in output order. That is the fact the caller's timestamp
// mapping leans on — the consumed slots are the segment's first — and nothing
// else here asserts it: the counts hold wherever the holes sit.
TEST(RaslOutput, SuppressedRaslPrecedeEveryOutputPicture) {
    const auto data = read_file(kCraFirst);
    ASSERT_FALSE(data.empty()) << "cannot read " << kCraFirst;

    const auto outcome = decode_incremental(data);
    ASSERT_FALSE(outcome.suppressed.empty()) << "nothing was suppressed";
    ASSERT_FALSE(outcome.output_pocs.empty());

    int32_t latest_suppressed = outcome.suppressed.front().poc;
    for (const auto& p : outcome.suppressed) {
        latest_suppressed = std::max(latest_suppressed, p.poc);
    }
    int32_t first_output = outcome.output_pocs.front();
    for (int32_t poc : outcome.output_pocs) {
        first_output = std::min(first_output, poc);
    }

    EXPECT_LT(latest_suppressed, first_output)
        << "the CRA must open the output, with its RASL set behind it";
}

// A segment that is not aligned on an IRAP — what a seek can hand the decoder —
// opens on RASL pictures with no references at all, and reaches its first IRAP
// with nothing decoded before it. Both sets are suppressed: the leading ones
// because no IRAP has been seen, the IRAP's own because that IRAP is the one
// opening decoding (§8.1). ffmpeg decodes this cut to the same four frames,
// pixel for pixel, which is what oracle_opengop_qcif_cra_first asserts for the
// aligned case.
TEST(RaslOutput, NoRaslSurvivesAStreamStartingBeforeItsIrap) {
    const auto full = read_file(kFull);
    ASSERT_FALSE(full.empty()) << "cannot read " << kFull;

    const auto cut = cut_at_first_rasl(full);
    ASSERT_FALSE(cut.empty()) << "the fixture should carry a RASL picture";

    NalParser parser;
    const auto nals = parser.parse(cut.data(), cut.size());
    size_t rasl = 0, coded = 0, leading_rasl = 0;
    bool still_leading = true;
    for (const auto& nal : nals) {
        if (static_cast<uint8_t>(nal.header.nal_unit_type) >= 32) continue;
        coded++;
        if (is_rasl(nal.header.nal_unit_type)) {
            rasl++;
            if (still_leading) leading_rasl++;
        } else {
            still_leading = false;
        }
    }
    ASSERT_GT(leading_rasl, 0u) << "the cut must open on a RASL picture";
    ASSERT_GT(rasl, leading_rasl)
        << "the cut must also carry the RASL set of the IRAP that follows";

    const auto outcome = decode_incremental(cut);

    EXPECT_EQ(outcome.suppressed.size(), rasl)
        << "both the leading RASL pictures and those of the opening IRAP";
    EXPECT_EQ(outcome.output_pocs.size(), coded - rasl);
}
