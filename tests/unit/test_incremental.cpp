#include <gtest/gtest.h>
#include <fstream>
#include <vector>
#include <numeric>

#include "decoding/decoder.h"

using namespace hevc;

// Helper: read file into byte vector
static std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) return {};
    return {std::istreambuf_iterator<char>(f), {}};
}

// Helper: find NAL unit boundaries (start codes 00 00 01 or 00 00 00 01)
static std::vector<size_t> find_nal_starts(const std::vector<uint8_t>& data) {
    std::vector<size_t> starts;
    for (size_t i = 0; i + 2 < data.size(); i++) {
        if (data[i] == 0 && data[i+1] == 0) {
            if (data[i+2] == 1) {
                starts.push_back(i);
                i += 2;
            } else if (i + 3 < data.size() && data[i+2] == 0 && data[i+3] == 1) {
                starts.push_back(i);
                i += 3;
            }
        }
    }
    return starts;
}

// Helper: get NAL type from start code position
static int get_nal_type(const std::vector<uint8_t>& data, size_t start) {
    // Skip start code (3 or 4 bytes)
    size_t off = start;
    if (data[off] == 0 && data[off+1] == 0 && data[off+2] == 0 && data[off+3] == 1)
        off += 4;
    else
        off += 3;
    if (off >= data.size()) return -1;
    return (data[off] >> 1) & 0x3F;
}

// ============================================================
// Test: feed/drain produces same frames as batch decode
// ============================================================

TEST(IncrementalDecode, FeedDrainMatchesBatch) {
    std::string path = std::string(FIXTURES_DIR) + "/full_qcif_10f.265";
    auto data = read_file(path);
    ASSERT_FALSE(data.empty()) << "Cannot read " << path;

    // --- Batch decode ---
    Decoder batch;
    auto status = batch.decode(data.data(), data.size());
    ASSERT_EQ(status, DecodeStatus::OK);
    auto batch_pics = batch.output_pictures();
    ASSERT_GT(batch_pics.size(), 0u);

    // --- Incremental decode ---
    // Split at the first I-frame NAL after at least 1 VCL NAL
    auto nal_starts = find_nal_starts(data);
    ASSERT_GE(nal_starts.size(), 5u);

    // Find a split point: after the first few NALs (VPS/SPS/PPS + first slice)
    // Split at the boundary between 2 access units
    // We look for a VCL NAL with first_slice_segment_in_pic_flag
    size_t split = data.size() / 2;  // default: split in the middle
    for (size_t i = 1; i < nal_starts.size(); i++) {
        int nal_type = get_nal_type(data, nal_starts[i]);
        // VCL NAL types are 0-31
        if (nal_type >= 0 && nal_type <= 31) {
            // Check first_slice_segment_in_pic_flag (first bit after NAL header)
            size_t hdr_off = nal_starts[i];
            if (data[hdr_off] == 0 && data[hdr_off+1] == 0 && data[hdr_off+2] == 0)
                hdr_off += 4;
            else
                hdr_off += 3;
            hdr_off += 2;  // skip 2-byte NAL header
            if (hdr_off < data.size()) {
                bool first_slice = (data[hdr_off] >> 7) & 1;
                if (first_slice && i > 3) {  // not the very first slice
                    split = nal_starts[i];
                    break;
                }
            }
        }
    }

    // Feed in 2 chunks
    Decoder inc;
    std::vector<Picture*> all_inc_pics;

    // Chunk 1
    status = inc.feed(data.data(), split);
    ASSERT_EQ(status, DecodeStatus::OK);
    auto drained1 = inc.drain();

    // Chunk 2
    status = inc.feed(data.data() + split, data.size() - split);
    ASSERT_EQ(status, DecodeStatus::OK);
    auto drained2 = inc.drain();

    // Flush remaining
    auto flushed = inc.flush();

    all_inc_pics.insert(all_inc_pics.end(), drained1.begin(), drained1.end());
    all_inc_pics.insert(all_inc_pics.end(), drained2.begin(), drained2.end());
    all_inc_pics.insert(all_inc_pics.end(), flushed.begin(), flushed.end());

    // Verify: same number of frames
    EXPECT_EQ(all_inc_pics.size(), batch_pics.size())
        << "Incremental produced " << all_inc_pics.size()
        << " frames vs batch " << batch_pics.size()
        << " (drained1=" << drained1.size()
        << " drained2=" << drained2.size()
        << " flushed=" << flushed.size() << ")";

    // Verify: output order is consistent (CVS then POC increasing)
    for (size_t i = 1; i < all_inc_pics.size(); i++) {
        bool order_ok = false;
        if (all_inc_pics[i]->cvs_id > all_inc_pics[i-1]->cvs_id) {
            order_ok = true;  // new CVS
        } else if (all_inc_pics[i]->cvs_id == all_inc_pics[i-1]->cvs_id) {
            order_ok = (all_inc_pics[i]->poc > all_inc_pics[i-1]->poc);
        }
        EXPECT_TRUE(order_ok)
            << "Output order violated at frame " << i
            << ": pic[" << i-1 << "]=(cvs=" << all_inc_pics[i-1]->cvs_id
            << ",poc=" << all_inc_pics[i-1]->poc << ")"
            << " pic[" << i << "]=(cvs=" << all_inc_pics[i]->cvs_id
            << ",poc=" << all_inc_pics[i]->poc << ")";
    }

    // Verify: same (cvs_id, poc) pairs as batch
    size_t min_count = std::min(all_inc_pics.size(), batch_pics.size());
    for (size_t i = 0; i < min_count; i++) {
        EXPECT_EQ(all_inc_pics[i]->cvs_id, batch_pics[i]->cvs_id)
            << "CVS mismatch at frame " << i;
        EXPECT_EQ(all_inc_pics[i]->poc, batch_pics[i]->poc)
            << "POC mismatch at frame " << i;
    }

    // Verify: PIXEL-PERFECT match between batch and incremental
    for (size_t i = 0; i < min_count; i++) {
        auto* bp = batch_pics[i];
        auto* ip = all_inc_pics[i];
        ASSERT_EQ(bp->planes[0].size(), ip->planes[0].size())
            << "Y plane size mismatch at frame " << i;
        bool y_match = (bp->planes[0] == ip->planes[0]);
        bool cb_match = (bp->planes[1] == ip->planes[1]);
        bool cr_match = (bp->planes[2] == ip->planes[2]);
        EXPECT_TRUE(y_match) << "Y plane pixel mismatch at frame " << i
            << " (poc=" << bp->poc << ")";
        EXPECT_TRUE(cb_match) << "Cb plane pixel mismatch at frame " << i;
        EXPECT_TRUE(cr_match) << "Cr plane pixel mismatch at frame " << i;
        if (!y_match) {
            // Find first differing pixel
            for (size_t j = 0; j < bp->planes[0].size(); j++) {
                if (bp->planes[0][j] != ip->planes[0][j]) {
                    int row = j / bp->stride[0];
                    int col = j % bp->stride[0];
                    FAIL() << "First Y diff at pixel (" << col << "," << row
                           << ") batch=" << bp->planes[0][j]
                           << " inc=" << ip->planes[0][j];
                }
            }
        }
    }
}

// ============================================================
// Test: DPB stays bounded during incremental decode
// ============================================================

TEST(IncrementalDecode, DPBBounded) {
    std::string path = std::string(FIXTURES_DIR) + "/full_qcif_10f.265";
    auto data = read_file(path);
    ASSERT_FALSE(data.empty());

    // Split into individual NAL units and feed one by one
    auto nal_starts = find_nal_starts(data);
    ASSERT_GE(nal_starts.size(), 3u);

    Decoder dec;
    size_t max_dpb = 0;
    size_t total_drained = 0;

    for (size_t i = 0; i < nal_starts.size(); i++) {
        size_t start = nal_starts[i];
        size_t end = (i + 1 < nal_starts.size()) ? nal_starts[i+1] : data.size();
        size_t len = end - start;

        auto status = dec.feed(data.data() + start, len);
        ASSERT_EQ(status, DecodeStatus::OK) << "Feed failed at NAL " << i;

        auto drained = dec.drain();
        total_drained += drained.size();

        size_t dpb_size = dec.dpb().pictures().size();
        if (dpb_size > max_dpb) max_dpb = dpb_size;
    }

    auto flushed = dec.flush();
    total_drained += flushed.size();

    // DPB should stay bounded (Main profile max DPB = 16)
    EXPECT_LE(max_dpb, 16u) << "DPB grew too large: " << max_dpb;

    // Should have output all frames
    EXPECT_EQ(total_drained, 10u)
        << "Expected 10 frames, got " << total_drained;
}

// ============================================================
// Test: interleaved drain outputs the same pictures, in the same order
// ============================================================
// The batched caller (feed everything, drain once) bumped the whole DPB in
// one pass, so it always emitted in POC order. Draining after every feed
// exercises §C.5.2.2 on every picture instead, which is where an off-by-one
// on the bumping conditions shows up: it bumps a picture before its
// lower-POC neighbours are decoded, and the stream plays out of order.
// B-frame fixtures are the ones that catch it — P-only streams decode in
// display order and cannot.

TEST(IncrementalDecode, InterleavedDrainMatchesBatchedOutputOrder) {
    const char* fixtures[] = {
        "b_qcif_10f.265",
        "full_qcif_10f.265",
        "full_qcif_10f_10bit.265",
        "p_qcif_10f.265",
        "bbb1080_50f.265",
        "bbb4k_25f.265",
    };

    for (const char* name : fixtures) {
        std::string path = std::string(FIXTURES_DIR) + "/" + name;
        auto data = read_file(path);
        ASSERT_FALSE(data.empty()) << "Cannot read " << path;

        // Batched: one feed, one drain — the reference output order.
        Decoder batched;
        ASSERT_EQ(batched.feed(data.data(), data.size()), DecodeStatus::OK) << name;
        std::vector<int32_t> batched_poc;
        for (auto* pic : batched.drain()) batched_poc.push_back(pic->poc);
        for (auto* pic : batched.flush()) batched_poc.push_back(pic->poc);

        // Interleaved: drain after every feed.
        Decoder interleaved;
        std::vector<int32_t> interleaved_poc;
        auto nal_starts = find_nal_starts(data);
        for (size_t i = 0; i < nal_starts.size(); i++) {
            size_t start = nal_starts[i];
            size_t end = (i + 1 < nal_starts.size()) ? nal_starts[i+1] : data.size();
            ASSERT_EQ(interleaved.feed(data.data() + start, end - start), DecodeStatus::OK)
                << name << " at NAL " << i;
            for (auto* pic : interleaved.drain()) interleaved_poc.push_back(pic->poc);
        }
        for (auto* pic : interleaved.flush()) interleaved_poc.push_back(pic->poc);

        EXPECT_EQ(interleaved_poc, batched_poc) << "output order differs on " << name;
    }
}

// ============================================================
// Test: the DPB bound holds over a sequence longer than the DPB
// ============================================================
// DPBBounded above runs on a 10-frame fixture, so its `max_dpb <= 16`
// assertion passes even if nothing is ever released. This one runs on 50
// frames, where the bound only holds if pictures are actually reclaimed.

TEST(IncrementalDecode, DPBBoundedOverSequenceLongerThanDPB) {
    std::string path = std::string(FIXTURES_DIR) + "/bbb1080_50f.265";
    auto data = read_file(path);
    ASSERT_FALSE(data.empty()) << "Cannot read " << path;

    auto nal_starts = find_nal_starts(data);
    ASSERT_GE(nal_starts.size(), 3u);

    Decoder dec;
    size_t max_dpb = 0;
    size_t total_drained = 0;

    for (size_t i = 0; i < nal_starts.size(); i++) {
        size_t start = nal_starts[i];
        size_t end = (i + 1 < nal_starts.size()) ? nal_starts[i+1] : data.size();

        ASSERT_EQ(dec.feed(data.data() + start, end - start), DecodeStatus::OK)
            << "Feed failed at NAL " << i;
        total_drained += dec.drain().size();

        max_dpb = std::max(max_dpb, dec.dpb().pictures().size());
    }
    total_drained += dec.flush().size();

    // §A.4.1 caps DPB size at 16 storage buffers, plus the current picture.
    EXPECT_LE(max_dpb, 17u) << "DPB grew to " << max_dpb
                            << " over 50 frames — pictures are not being released";
    EXPECT_EQ(total_drained, 50u);
}

// ============================================================
// Test: deferring drain() retains every picture — memory envelope
// ============================================================
// The counterpart of the test above, and the reason a 4K segment blows past
// the WASM 2GB ceiling: a caller that feeds a whole segment before draining
// keeps one picture per frame alive, because eviction needs a bump first.
// If this ever stops holding, the memory envelope documented in
// docs/memory-envelope.md is stale and must be updated with it.

TEST(IncrementalDecode, DPBRetainsEveryPictureWhenDrainIsDeferred) {
    std::string path = std::string(FIXTURES_DIR) + "/bbb1080_50f.265";
    auto data = read_file(path);
    ASSERT_FALSE(data.empty()) << "Cannot read " << path;

    Decoder dec;
    ASSERT_EQ(dec.feed(data.data(), data.size()), DecodeStatus::OK);

    EXPECT_EQ(dec.dpb().pictures().size(), 50u)
        << "One picture per decoded frame is retained until the caller drains";
}
