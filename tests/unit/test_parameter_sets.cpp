#include <gtest/gtest.h>
#include <fstream>
#include <string>
#include <vector>

#include "bitstream/bitstream_reader.h"
#include "bitstream/nal_unit.h"
#include "syntax/parameter_sets.h"

using namespace hevc;

#ifndef FIXTURES_DIR
#define FIXTURES_DIR "tests/conformance/fixtures"
#endif

static std::string fixture(const char* name) {
    return std::string(FIXTURES_DIR) + "/" + name;
}

// Helper: read a file into a byte vector
static std::vector<uint8_t> read_file(const std::string& path) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) return {};
    auto size = file.tellg();
    file.seekg(0, std::ios::beg);
    std::vector<uint8_t> data(static_cast<size_t>(size));
    file.read(reinterpret_cast<char*>(data.data()), size);
    return data;
}

// Helper: parse a bitstream file into NALs and process parameter sets
static bool setup_from_file(const std::string& path, ParameterSetManager& mgr, std::vector<NalUnit>& nals) {
    auto data = read_file(path);
    if (data.empty()) return false;
    NalParser parser;
    nals = parser.parse(data.data(), data.size());
    for (const auto& nal : nals) {
        if (nal.header.nal_unit_type == NalUnitType::VPS_NUT ||
            nal.header.nal_unit_type == NalUnitType::SPS_NUT ||
            nal.header.nal_unit_type == NalUnitType::PPS_NUT) {
            mgr.process_nal(nal);
        }
    }
    return true;
}

// ---- ProfileTierLevel tests ----

TEST(ProfileTierLevel, ParseMainProfile) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(sps, nullptr);
    EXPECT_EQ(sps->profile_tier_level.general_profile_idc, 3);
    EXPECT_EQ(sps->profile_tier_level.general_tier_flag, false);
    EXPECT_EQ(sps->profile_tier_level.general_level_idc, 30);
}

// ---- VPS tests ----

TEST(VPS, ParseToy) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    const VPS* vps = mgr.get_vps(0);
    ASSERT_NE(vps, nullptr);
    EXPECT_EQ(vps->vps_video_parameter_set_id, 0);
    EXPECT_EQ(vps->vps_max_layers_minus1, 0);
    EXPECT_EQ(vps->vps_max_sub_layers_minus1, 0);
    EXPECT_TRUE(vps->vps_temporal_id_nesting_flag);
}

// ---- SPS tests ----

TEST(SPS, ParseDimensions64x64) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(sps, nullptr);
    EXPECT_EQ(sps->pic_width_in_luma_samples, 64u);
    EXPECT_EQ(sps->pic_height_in_luma_samples, 64u);
    EXPECT_EQ(sps->chroma_format_idc, 1u);
    EXPECT_EQ(sps->BitDepthY, 8);
    EXPECT_EQ(sps->BitDepthC, 8);
}

TEST(SPS, DerivedValues) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(sps, nullptr);

    EXPECT_EQ(sps->ChromaArrayType, 1);
    EXPECT_EQ(sps->QpBdOffsetY, 0);
    EXPECT_EQ(sps->QpBdOffsetC, 0);
    EXPECT_EQ(sps->CtbSizeY, 32);
    EXPECT_EQ(sps->MinCbSizeY, 16);
    EXPECT_EQ(sps->PicWidthInCtbsY, 2);
    EXPECT_EQ(sps->PicHeightInCtbsY, 2);
    EXPECT_EQ(sps->PicSizeInCtbsY, 4);
    EXPECT_GT(sps->MaxPicOrderCntLsb, 0);
    EXPECT_EQ(sps->SubWidthC, 2);
    EXPECT_EQ(sps->SubHeightC, 2);
}

TEST(SPS, ParseQCIF) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("p_qcif_10f.265"), mgr, nals));

    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(sps, nullptr);
    EXPECT_EQ(sps->pic_width_in_luma_samples, 176u);
    EXPECT_EQ(sps->pic_height_in_luma_samples, 144u);
    EXPECT_EQ(sps->CtbSizeY, 64);
    EXPECT_EQ(sps->PicWidthInCtbsY, 3);
    EXPECT_EQ(sps->PicHeightInCtbsY, 3);
    EXPECT_EQ(sps->MinCbSizeY, 8);
}

TEST(SPS, Parse1080p) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("bbb1080_50f.265"), mgr, nals));

    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(sps, nullptr);
    EXPECT_EQ(sps->pic_width_in_luma_samples, 1920u);
    EXPECT_EQ(sps->pic_height_in_luma_samples, 1088u);
    EXPECT_EQ(sps->profile_tier_level.general_profile_idc, 1);
    EXPECT_EQ(sps->profile_tier_level.general_level_idc, 120);
    EXPECT_TRUE(sps->conformance_window_flag);
    EXPECT_EQ(sps->conf_win_bottom_offset, 4u);
    EXPECT_TRUE(sps->scaling_list_enabled_flag);
    EXPECT_TRUE(sps->sample_adaptive_offset_enabled_flag);
}

TEST(SPS, ShortTermRPS) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("bbb1080_50f.265"), mgr, nals));

    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(sps, nullptr);
    EXPECT_EQ(sps->num_short_term_ref_pic_sets, 4u);
    EXPECT_EQ(sps->st_ref_pic_sets[0].NumNegativePics, 4u);
    EXPECT_EQ(sps->st_ref_pic_sets[0].NumPositivePics, 0u);
    EXPECT_EQ(sps->st_ref_pic_sets[1].NumNegativePics, 1u);
}

// ---- PPS tests ----

TEST(PPS, ParseToy) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    const PPS* pps = mgr.get_pps(0);
    ASSERT_NE(pps, nullptr);
    EXPECT_EQ(pps->pps_pic_parameter_set_id, 0u);
    EXPECT_EQ(pps->pps_seq_parameter_set_id, 0u);
    EXPECT_TRUE(pps->pps_deblocking_filter_disabled_flag);
    EXPECT_FALSE(pps->tiles_enabled_flag);
}

TEST(PPS, TileScanNoTiles) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    const PPS* pps = mgr.get_pps(0);
    const SPS* sps = mgr.get_sps(0);
    ASSERT_NE(pps, nullptr);
    ASSERT_NE(sps, nullptr);

    EXPECT_EQ(static_cast<int>(pps->CtbAddrRsToTs.size()), sps->PicSizeInCtbsY);
    for (int i = 0; i < sps->PicSizeInCtbsY; i++) {
        EXPECT_EQ(pps->CtbAddrRsToTs[i], i);
        EXPECT_EQ(pps->CtbAddrTsToRs[i], i);
        EXPECT_EQ(pps->TileId[i], 0);
    }
}

TEST(PPS, WPP) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("bbb1080_50f.265"), mgr, nals));

    const PPS* pps = mgr.get_pps(0);
    ASSERT_NE(pps, nullptr);
    EXPECT_TRUE(pps->entropy_coding_sync_enabled_flag);
    EXPECT_FALSE(pps->tiles_enabled_flag);
}

// ---- Slice Header tests ----

TEST(SliceHeader, ParseIDRSlice) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("toy_qp30.265"), mgr, nals));

    for (const auto& nal : nals) {
        if (is_vcl(nal.header.nal_unit_type)) {
            SliceHeader sh;
            ASSERT_TRUE(mgr.parse_slice_header(sh, nal));
            EXPECT_TRUE(sh.first_slice_segment_in_pic_flag);
            EXPECT_EQ(sh.slice_type, SliceType::I);
            EXPECT_EQ(sh.slice_pic_order_cnt_lsb, 0u);
            EXPECT_EQ(sh.SliceQpY, 27);
            EXPECT_FALSE(sh.dependent_slice_segment_flag);
            break;
        }
    }
}

TEST(SliceHeader, ParsePSlice) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("p_qcif_10f.265"), mgr, nals));

    int p_count = 0;
    for (const auto& nal : nals) {
        if (is_vcl(nal.header.nal_unit_type)) {
            SliceHeader sh;
            ASSERT_TRUE(mgr.parse_slice_header(sh, nal));
            if (sh.slice_type == SliceType::P) {
                p_count++;
                EXPECT_GT(sh.slice_pic_order_cnt_lsb, 0u);
                EXPECT_GE(sh.MaxNumMergeCand, 1);
                EXPECT_LE(sh.MaxNumMergeCand, 5);
            }
        }
    }
    EXPECT_GT(p_count, 0);
}

TEST(SliceHeader, ParseAllSlicesB) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("b_qcif_10f.265"), mgr, nals));

    int slice_count = 0;
    for (const auto& nal : nals) {
        if (is_vcl(nal.header.nal_unit_type)) {
            SliceHeader sh;
            ASSERT_TRUE(mgr.parse_slice_header(sh, nal));
            slice_count++;
        }
    }
    EXPECT_EQ(slice_count, 10);
}

TEST(SliceHeader, ParseAllSlices1080p) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("bbb1080_50f.265"), mgr, nals));

    int slice_count = 0;
    for (const auto& nal : nals) {
        if (is_vcl(nal.header.nal_unit_type)) {
            SliceHeader sh;
            ASSERT_TRUE(mgr.parse_slice_header(sh, nal));
            slice_count++;
            if (slice_count == 1) {
                EXPECT_EQ(sh.num_entry_point_offsets, 33u);
            }
        }
    }
    EXPECT_EQ(slice_count, 50);
}

TEST(SliceHeader, ParseAllSlices4K) {
    ParameterSetManager mgr;
    std::vector<NalUnit> nals;
    ASSERT_TRUE(setup_from_file(fixture("bbb4k_25f.265"), mgr, nals));

    int slice_count = 0;
    for (const auto& nal : nals) {
        if (is_vcl(nal.header.nal_unit_type)) {
            SliceHeader sh;
            ASSERT_TRUE(mgr.parse_slice_header(sh, nal));
            slice_count++;
        }
    }
    EXPECT_EQ(slice_count, 25);
}

// ---- ScalingListData tests ----

TEST(ScalingListData, DefaultValues) {
    ScalingListData sld;
    sld.set_defaults();

    for (int i = 0; i < 16; i++) {
        EXPECT_EQ(sld.scaling_list[0][0][i], 16);
    }
    EXPECT_EQ(sld.scaling_list[1][0][0], 16);
    EXPECT_EQ(sld.scaling_list[1][0][63], 115);
    EXPECT_EQ(sld.scaling_list[1][3][63], 91);
    EXPECT_EQ(sld.scaling_list_dc[0][0], 16);
    EXPECT_EQ(sld.scaling_list_dc[1][0], 16);
}

// ---- SPS validation tests (malicious bitstreams) ----

// Minimal bit writer to craft SPS RBSP payloads in-memory
class BitWriter {
public:
    void put_bit(int b) {
        cur_ = static_cast<uint8_t>((cur_ << 1) | (b & 1));
        if (++nbits_ == 8) { bytes_.push_back(cur_); cur_ = 0; nbits_ = 0; }
    }
    void put_bits(uint32_t v, int n) {
        for (int i = n - 1; i >= 0; i--) put_bit((v >> i) & 1);
    }
    void put_ue(uint32_t v) {
        uint64_t vp1 = static_cast<uint64_t>(v) + 1;
        int len = 0;
        while ((vp1 >> len) > 1) len++;
        put_bits(0, len);
        for (int i = len; i >= 0; i--) put_bit(static_cast<int>((vp1 >> i) & 1));
    }
    std::vector<uint8_t> finish() {
        put_bit(1);                       // rbsp_stop_one_bit
        while (nbits_ != 0) put_bit(0);   // byte alignment
        return bytes_;
    }
private:
    std::vector<uint8_t> bytes_;
    uint8_t cur_ = 0;
    int nbits_ = 0;
};

struct SpsFields {
    uint32_t max_sub_layers_minus1 = 0;
    uint32_t chroma_format_idc = 1;
    uint32_t width = 64;
    uint32_t height = 64;
    uint32_t log2_min_cb_minus3 = 0;   // MinCbSizeY = 8
    uint32_t log2_diff_cb = 3;         // CtbSizeY = 64
    uint32_t num_st_rps = 0;
    bool long_term_present = false;
    uint32_t num_lt_sps = 0;
};

// Mirrors the exact read order of SPS::parse for a Main-profile SPS
static std::vector<uint8_t> build_sps_rbsp(const SpsFields& f) {
    BitWriter w;
    w.put_bits(0, 4);                       // sps_video_parameter_set_id
    w.put_bits(f.max_sub_layers_minus1, 3);
    w.put_bit(1);                           // sps_temporal_id_nesting_flag
    // profile_tier_level(1, 0): Main profile, all-zero constraint bits
    w.put_bits(0, 2);                       // general_profile_space
    w.put_bit(0);                           // general_tier_flag
    w.put_bits(1, 5);                       // general_profile_idc = Main
    w.put_bits(0, 32);                      // compatibility flags
    w.put_bits(0, 4);                       // progressive/interlaced/non_packed/frame_only
    w.put_bits(0, 32);
    w.put_bits(0, 11);                      // reserved 43 bits
    w.put_bit(0);                           // inbld
    w.put_bits(120, 8);                     // general_level_idc
    w.put_ue(0);                            // sps_seq_parameter_set_id
    w.put_ue(f.chroma_format_idc);
    if (f.chroma_format_idc == 3) w.put_bit(0);
    w.put_ue(f.width);
    w.put_ue(f.height);
    w.put_bit(0);                           // conformance_window_flag
    w.put_ue(0);                            // bit_depth_luma_minus8
    w.put_ue(0);                            // bit_depth_chroma_minus8
    w.put_ue(4);                            // log2_max_pic_order_cnt_lsb_minus4
    w.put_bit(1);                           // sps_sub_layer_ordering_info_present_flag
    w.put_ue(1); w.put_ue(0); w.put_ue(0);  // ordering info, layer 0
    w.put_ue(f.log2_min_cb_minus3);
    w.put_ue(f.log2_diff_cb);
    w.put_ue(0);                            // log2_min_luma_transform_block_size_minus2
    w.put_ue(3);                            // log2_diff_max_min_luma_transform_block_size
    w.put_ue(0); w.put_ue(0);               // max_transform_hierarchy_depth inter/intra
    w.put_bit(0);                           // scaling_list_enabled_flag
    w.put_bit(0); w.put_bit(0);             // amp, sao
    w.put_bit(0);                           // pcm_enabled_flag
    w.put_ue(f.num_st_rps);
    for (uint32_t i = 0; i < f.num_st_rps; i++) {
        if (i != 0) w.put_bit(0);           // inter_ref_pic_set_prediction_flag
        w.put_ue(1); w.put_ue(0);           // 1 negative pic, 0 positive
        w.put_ue(0); w.put_bit(1);          // delta_poc_s0_minus1, used flag
    }
    w.put_bit(f.long_term_present ? 1 : 0);
    if (f.long_term_present) {
        w.put_ue(f.num_lt_sps);
        for (uint32_t i = 0; i < f.num_lt_sps; i++) {
            w.put_bits(0, 8);               // lt_ref_pic_poc_lsb_sps (8 bits)
            w.put_bit(0);                   // used_by_curr_pic_lt_sps_flag
        }
    }
    w.put_bit(0);                           // sps_temporal_mvp_enabled_flag
    w.put_bit(0);                           // strong_intra_smoothing_enabled_flag
    w.put_bit(0);                           // vui_parameters_present_flag
    w.put_bit(0);                           // sps_extension_present_flag
    return w.finish();
}

static bool parse_sps_bytes(const std::vector<uint8_t>& rbsp, SPS& sps) {
    BitstreamReader bs(rbsp.data(), rbsp.size());
    return sps.parse(bs);
}

TEST(SPSValidation, AcceptsMinimalValidSps) {
    SPS sps;
    ASSERT_TRUE(parse_sps_bytes(build_sps_rbsp(SpsFields{}), sps));
    EXPECT_EQ(sps.pic_width_in_luma_samples, 64u);
    EXPECT_EQ(sps.pic_height_in_luma_samples, 64u);
    EXPECT_EQ(sps.CtbSizeY, 64);
    EXPECT_EQ(sps.MinCbSizeY, 8);
}

TEST(SPSValidation, AcceptsValidSpsWithRpsAndLongTerm) {
    SpsFields f;
    f.num_st_rps = 2;
    f.long_term_present = true;
    f.num_lt_sps = 2;
    SPS sps;
    ASSERT_TRUE(parse_sps_bytes(build_sps_rbsp(f), sps));
    EXPECT_EQ(sps.num_short_term_ref_pic_sets, 2u);
    EXPECT_EQ(sps.num_long_term_ref_pics_sps, 2u);
}

TEST(SPSValidation, RejectsOversizedWidth) {
    SpsFields f;
    f.width = 100000;  // > Sqrt(MaxLumaPs * 8) = 16888
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsOversizedPictureArea) {
    SpsFields f;
    f.width = 16384;   // each dimension legal, area > MaxLumaPs (level 6.2)
    f.height = 8192;
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsZeroDimensions) {
    SpsFields f;
    f.width = 0;
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsNonMultipleOfMinCb) {
    SpsFields f;
    f.width = 65;      // MinCbSizeY = 8
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsTooManySubLayers) {
    SpsFields f;
    f.max_sub_layers_minus1 = 7;  // spec range 0..6; would overflow sub_layer_ordering[7]
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsInvalidChromaFormat) {
    SpsFields f;
    f.chroma_format_idc = 4;
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsOversizedCtb) {
    SpsFields f;
    f.log2_min_cb_minus3 = 1;  // MinCb = 16, CTB would be 128 (log2 = 7)
    f.log2_diff_cb = 3;
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsTooManyShortTermRps) {
    SpsFields f;
    f.num_st_rps = 65;  // spec range 0..64
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

TEST(SPSValidation, RejectsTooManyLongTermRefs) {
    SpsFields f;
    f.long_term_present = true;
    f.num_lt_sps = 33;  // spec range 0..32; would overflow lt_ref_pic_poc_lsb_sps[32]
    SPS sps;
    EXPECT_FALSE(parse_sps_bytes(build_sps_rbsp(f), sps));
}

// Parse a builder-crafted SPS into a ready-to-use struct for slice header tests
static SPS make_sps(const SpsFields& f) {
    SPS sps;
    auto bytes = build_sps_rbsp(f);
    BitstreamReader bs(bytes.data(), bytes.size());
    EXPECT_TRUE(sps.parse(bs));
    return sps;
}

TEST(SliceHeaderValidation, RejectsSegmentAddressOutOfRange) {
    SpsFields f;
    f.width = 176;   // 3x3 CTBs of 64 → PicSizeInCtbsY = 9, address read as 4 bits
    f.height = 144;
    SPS sps = make_sps(f);
    PPS pps{};
    BitWriter w;
    w.put_bit(0);       // first_slice_segment_in_pic_flag
    w.put_ue(0);        // slice_pic_parameter_set_id
    w.put_bits(12, 4);  // slice_segment_address = 12 ≥ 9
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));
}

TEST(SliceHeaderValidation, RejectsSpsRpsFlagWithNoSets) {
    SPS sps = make_sps(SpsFields{});  // num_short_term_ref_pic_sets = 0
    PPS pps{};
    BitWriter w;
    w.put_bit(1);       // first_slice_segment_in_pic_flag
    w.put_ue(0);        // slice_pic_parameter_set_id
    w.put_ue(2);        // slice_type = I
    w.put_bits(0, 8);   // slice_pic_order_cnt_lsb (log2_max_poc_lsb = 8)
    w.put_bit(1);       // short_term_ref_pic_set_sps_flag — but the SPS has 0 sets
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));
}

TEST(SliceHeaderValidation, RejectsOversizedNumRefIdx) {
    SpsFields f;
    f.num_st_rps = 1;
    SPS sps = make_sps(f);
    PPS pps{};
    BitWriter w;
    w.put_bit(1);       // first_slice_segment_in_pic_flag
    w.put_ue(0);        // slice_pic_parameter_set_id
    w.put_ue(1);        // slice_type = P
    w.put_bits(0, 8);   // slice_pic_order_cnt_lsb
    w.put_bit(1);       // short_term_ref_pic_set_sps_flag → idx = 0 (single set)
    w.put_bit(1);       // num_ref_idx_active_override_flag
    w.put_ue(100);      // num_ref_idx_l0_active_minus1 — spec range 0..14
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));
}

TEST(SliceHeaderValidation, RejectsOversizedLongTermCounts) {
    SpsFields f;
    f.num_st_rps = 1;
    f.long_term_present = true;
    f.num_lt_sps = 2;
    SPS sps = make_sps(f);
    PPS pps{};
    BitWriter w;
    w.put_bit(1);       // first_slice_segment_in_pic_flag
    w.put_ue(0);        // slice_pic_parameter_set_id
    w.put_ue(2);        // slice_type = I
    w.put_bits(0, 8);   // slice_pic_order_cnt_lsb
    w.put_bit(1);       // short_term_ref_pic_set_sps_flag → idx = 0
    w.put_ue(3);        // num_long_term_sps — SPS only defines 2
    w.put_ue(0);        // num_long_term_pics
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::TRAIL_R, 0));
}

TEST(SliceHeaderValidation, RejectsOversizedEntryPointCount) {
    SPS sps = make_sps(SpsFields{});  // 64x64 → PicSizeInCtbsY = 1
    PPS pps{};
    pps.entropy_coding_sync_enabled_flag = true;  // WPP → entry points present
    BitWriter w;
    w.put_bit(1);       // first_slice_segment_in_pic_flag
    w.put_bit(0);       // no_output_of_prior_pics_flag (IRAP)
    w.put_ue(0);        // slice_pic_parameter_set_id
    w.put_ue(2);        // slice_type = I
    w.put_ue(0);        // slice_qp_delta (se) — IDR skips POC/RPS
    w.put_ue(4000000);  // num_entry_point_offsets — would resize() unbounded
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    SliceHeader sh;
    EXPECT_FALSE(sh.parse(bs, sps, pps, NalUnitType::IDR_W_RADL, 0));
}

TEST(ShortTermRPSValidation, RejectsOversizedNegativeCount) {
    BitWriter w;
    w.put_ue(1000);  // num_negative_pics — arrays hold 16 entries
    w.put_ue(0);     // num_positive_pics
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    ShortTermRefPicSet rps;
    EXPECT_FALSE(rps.parse(bs, 0, 0, {}));
}

TEST(ShortTermRPSValidation, RejectsOutOfRangeDeltaIdx) {
    BitWriter w;
    w.put_bit(1);    // inter_ref_pic_set_prediction_flag
    w.put_ue(5);     // delta_idx_minus1 — must be < stRpsIdx (1)
    auto bytes = w.finish();
    BitstreamReader bs(bytes.data(), bytes.size());
    std::vector<ShortTermRefPicSet> prev(1);
    ShortTermRefPicSet rps;
    EXPECT_FALSE(rps.parse(bs, 1, 1, prev));
}

// ---- Edge case conformance tests ----

TEST(SliceHeader, ParseConformanceEdgeCases) {
    const std::string bitstreams[] = {
        fixture("i_64x64_qp22.265"),
        fixture("i_64x64_deblock.265"),
        fixture("i_64x64_sao.265"),
        fixture("i_64x64_full.265"),
        fixture("full_qcif_10f.265"),
    };

    for (const auto& path : bitstreams) {
        ParameterSetManager mgr;
        std::vector<NalUnit> nals;
        if (!setup_from_file(path, mgr, nals)) {
            continue;
        }

        for (const auto& nal : nals) {
            if (is_vcl(nal.header.nal_unit_type)) {
                SliceHeader sh;
                EXPECT_TRUE(mgr.parse_slice_header(sh, nal))
                    << "Failed to parse slice in " << path;
            }
        }
    }
}
