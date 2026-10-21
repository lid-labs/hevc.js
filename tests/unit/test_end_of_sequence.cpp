// End of a coded video sequence (§8.1, §C.5.2.2) — what a new sequence does to
// the pictures of the previous one.
//
// An end-of-sequence NAL makes the next IRAP open a new sequence with
// NoRaslOutputFlag = 1: its RASL pictures are not output, POC restarts, and the
// pictures of the previous sequence still pending output are emptied without
// output when NoOutputOfPriorPicsFlag is 1 — always for a CRA, from the slice
// header for an IDR or a BLA. opengop_qcif_eos.265 carries the EOS case; the
// IDR case is built here from opengop_qcif_12f.265, concatenated to itself
// with the flag set on the second IDR. ffmpeg decodes both to the same frames,
// pixel for pixel (oracle_opengop_qcif_eos for the first).

#include <gtest/gtest.h>

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <utility>
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

using CvsPoc = std::pair<int32_t, int32_t>;

struct DecodeOutcome {
    std::vector<CvsPoc> output;
    std::vector<CvsPoc> suppressed;
};

// Feed/drain per NAL then flush — the transcoder's path. The EOS NAL arrives in
// a feed() of its own, so the state it sets has to outlive the call.
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

        for (const auto& p : dec.take_suppressed_pictures()) {
            outcome.suppressed.emplace_back(p.cvs_id, p.poc);
        }
        for (const Picture* pic : dec.drain()) outcome.output.emplace_back(pic->cvs_id, pic->poc);
    }
    for (const Picture* pic : dec.flush()) outcome.output.emplace_back(pic->cvs_id, pic->poc);
    return outcome;
}

// The whole stream in one decode() — the CLI's path, which never drains.
DecodeOutcome decode_batch(const std::vector<uint8_t>& data) {
    Decoder dec;
    EXPECT_EQ(dec.decode(data.data(), data.size()), DecodeStatus::OK);

    DecodeOutcome outcome;
    for (const auto& p : dec.take_suppressed_pictures()) {
        outcome.suppressed.emplace_back(p.cvs_id, p.poc);
    }
    for (const Picture* pic : dec.output_pictures()) outcome.output.emplace_back(pic->cvs_id, pic->poc);
    return outcome;
}

std::vector<int32_t> pocs(const std::vector<CvsPoc>& v) {
    std::vector<int32_t> out;
    for (const auto& p : v) out.push_back(p.second);
    return out;
}

// Suppressed pictures are reported in decode order, which is not POC order.
std::vector<int32_t> sorted_pocs(const std::vector<CvsPoc>& v) {
    auto out = pocs(v);
    std::sort(out.begin(), out.end());
    return out;
}

// opengop_qcif_12f.265 twice in a row, with no_output_of_prior_pics_flag set on
// the second IDR when asked. The flag is the second bit of the slice header, so
// setting it cannot create an emulation-prevention pattern.
std::vector<uint8_t> concatenated(bool no_output_of_prior_pics) {
    auto data = read_file(FIXTURES_DIR "/opengop_qcif_12f.265");
    if (data.empty()) return {};
    const size_t half = data.size();
    data.insert(data.end(), data.begin(), data.end());
    if (!no_output_of_prior_pics) return data;

    NalParser parser;
    for (const auto& nal : parser.parse(data.data(), data.size())) {
        if (nal.offset >= half && nal.header.nal_unit_type == NalUnitType::IDR_N_LP) {
            data[nal.offset + 2] |= 0x40;  // past the 2-byte NAL header
            return data;
        }
    }
    return {};
}

const char* kEos = FIXTURES_DIR "/opengop_qcif_eos.265";

}  // namespace

// The fixture is only worth anything if it carries what it claims: an EOS NAL
// right before a CRA.
TEST(EndOfSequence, FixtureCarriesEosBeforeCra) {
    const auto data = read_file(kEos);
    ASSERT_FALSE(data.empty()) << "cannot read " << kEos;

    NalParser parser;
    const auto nals = parser.parse(data.data(), data.size());
    bool found = false;
    for (size_t i = 0; i + 1 < nals.size(); i++) {
        if (nals[i].header.nal_unit_type == NalUnitType::EOS_NUT) {
            EXPECT_EQ(nals[i + 1].header.nal_unit_type, NalUnitType::CRA_NUT);
            found = true;
        }
    }
    EXPECT_TRUE(found) << "no end-of-sequence NAL in the fixture";
}

// What ffmpeg outputs: the first sequence up to POC 2, then the second CRA and
// its trailing pictures. POC 3 and 4 were pending output when the CRA arrived
// (§C.5.2.2), 5 to 7 are that CRA's RASL set (§8.1).
TEST(EndOfSequence, CraAfterEosDropsItsRaslAndThePriorPendingPictures) {
    const auto data = read_file(kEos);
    ASSERT_FALSE(data.empty()) << "cannot read " << kEos;

    const auto outcome = decode_incremental(data);
    EXPECT_EQ(pocs(outcome.output), (std::vector<int32_t>{0, 1, 2, 8, 9, 10, 11}));
    EXPECT_EQ(sorted_pocs(outcome.suppressed), (std::vector<int32_t>{3, 4, 5, 6, 7}))
        << "every coded picture that produces no frame is reported";
}

// POC restarts at the CRA, so the two sequences need distinct ids: the caller
// orders pictures by (cvs_id, poc), and a shared id would interleave them.
TEST(EndOfSequence, CraAfterEosOpensANewCvsId) {
    const auto data = read_file(kEos);
    ASSERT_FALSE(data.empty()) << "cannot read " << kEos;

    const auto outcome = decode_incremental(data);
    ASSERT_EQ(outcome.output.size(), 7u);
    const int32_t first = outcome.output.front().first;
    const int32_t second = outcome.output.back().first;
    EXPECT_LT(first, second);
    for (const auto& [cvs, poc] : outcome.output) {
        EXPECT_EQ(cvs, poc < 8 ? first : second) << "POC " << poc;
    }
    // The dropped pictures keep the id of the sequence they belong to.
    for (const auto& [cvs, poc] : outcome.suppressed) {
        EXPECT_EQ(cvs, poc < 5 ? first : second) << "POC " << poc;
    }
}

// The batch path holds every picture until the end, so what is pending at the
// CRA differs from the incremental path; the output must not.
TEST(EndOfSequence, BatchAndIncrementalAgree) {
    const auto data = read_file(kEos);
    ASSERT_FALSE(data.empty()) << "cannot read " << kEos;

    const auto incremental = decode_incremental(data);
    const auto batch = decode_batch(data);
    EXPECT_EQ(batch.output, incremental.output);
    EXPECT_EQ(batch.suppressed, incremental.suppressed);
}

// An IDR follows the slice header's no_output_of_prior_pics_flag: 0 outputs
// every prior picture, 1 drops the two still pending (POC 10 and 11 of the
// first copy, with sps_max_num_reorder_pics = 2).
TEST(EndOfSequence, IdrHonoursNoOutputOfPriorPicsFlag) {
    const auto plain = concatenated(false);
    const auto flagged = concatenated(true);
    ASSERT_FALSE(plain.empty());
    ASSERT_FALSE(flagged.empty()) << "no second IDR to set the flag on";

    const auto kept = decode_incremental(plain);
    EXPECT_EQ(kept.output.size(), 24u);
    EXPECT_TRUE(kept.suppressed.empty());

    const auto dropped = decode_incremental(flagged);
    EXPECT_EQ(dropped.output.size(), 22u);
    EXPECT_EQ(sorted_pocs(dropped.suppressed), (std::vector<int32_t>{10, 11}));

    const auto batch = decode_batch(flagged);
    EXPECT_EQ(batch.output, dropped.output);
}
