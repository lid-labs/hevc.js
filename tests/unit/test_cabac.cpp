#include <gtest/gtest.h>
#include <vector>

#include "decoding/cabac.h"

using namespace hevc;

// Helper: create a BitstreamReader from raw bytes
static BitstreamReader make_bs(const std::vector<uint8_t>& data) {
    return BitstreamReader(data.data(), data.size());
}

// ============================================================
// Context initialization tests
// ============================================================

TEST(CabacContextInit, InitValueFormula) {
    // Test the init formula manually for a known context
    // split_cu_flag[0], I-slice, initValue=139, QP=26
    // slope = (139 >> 4) * 5 - 45 = 8 * 5 - 45 = -5
    // offset = ((139 & 15) << 3) - 16 = (11 << 3) - 16 = 88 - 16 = 72
    // preCtxState = Clip3(1, 126, ((-5 * 26) >> 4) + 72)
    //            = Clip3(1, 126, (-130 >> 4) + 72) = Clip3(1, 126, -9 + 72) = 63
    // preCtxState=63 <= 63 => pStateIdx=63-63=0, valMps=0

    CabacEngine engine;
    engine.init_contexts(2, 26, false); // I-slice (SliceType::I=2), QP=26

    auto ctx = engine.context(CTX_SPLIT_CU_FLAG);
    EXPECT_EQ(ctx.pStateIdx(), 0);
    EXPECT_EQ(ctx.valMps(), 0);
}

TEST(CabacContextInit, AllContextsInRange) {
    // Verify all contexts are initialized with valid ranges
    CabacEngine engine;

    for (int st = 0; st < 3; st++) {
        for (int qp = 0; qp <= 51; qp++) {
            engine.init_contexts(st, qp, false);
            for (int i = 0; i < NUM_CABAC_CONTEXTS; i++) {
                EXPECT_LT(engine.context(i).pStateIdx(), 64)
                    << "sliceType=" << st << " QP=" << qp << " ctxIdx=" << i;
                EXPECT_LE(engine.context(i).valMps(), 1)
                    << "sliceType=" << st << " QP=" << qp << " ctxIdx=" << i;
            }
        }
    }
}

TEST(CabacContextInit, CabacInitFlagPermutation) {
    // P-slice with cabac_init_flag=1 should use B-slice init values
    CabacEngine engine_p_normal, engine_p_swapped, engine_b_normal;

    // SliceType enum: B=0, P=1, I=2
    engine_p_normal.init_contexts(1, 26, false);  // P, no swap
    engine_p_swapped.init_contexts(1, 26, true);  // P, swap -> uses B
    engine_b_normal.init_contexts(0, 26, false);  // B, no swap

    // The swapped P should match normal B
    for (int i = 0; i < NUM_CABAC_CONTEXTS; i++) {
        EXPECT_EQ(engine_p_swapped.context(i).pStateIdx(),
                  engine_b_normal.context(i).pStateIdx()) << "ctxIdx=" << i;
        EXPECT_EQ(engine_p_swapped.context(i).valMps(),
                  engine_b_normal.context(i).valMps()) << "ctxIdx=" << i;
    }
}

// ============================================================
// P-slice context initialization — spec §9.3.1.1 eq 9-4..9-7
// Reference values computed from Tables 9-5..9-31 column P (initType=1)
// ============================================================

TEST(CabacContextInit, PSliceInitQP22) {
    // P-slice (sliceType=1), QP=22, cabac_init_flag=0 → initType=1
    CabacEngine engine;
    engine.init_contexts(1, 22, false);

    // Verify key contexts used in inter prediction parsing
    struct Expected { int ctxIdx; uint8_t pStateIdx; uint8_t valMps; const char* name; };
    Expected tests[] = {
        {  0,  7, 0, "SAO_MERGE_FLAG" },
        {  1,  5, 1, "SAO_TYPE_IDX" },
        {  2, 12, 0, "SPLIT_CU_FLAG[0]" },
        {  3,  1, 1, "SPLIT_CU_FLAG[1]" },
        {  4, 18, 1, "SPLIT_CU_FLAG[2]" },
        {  6, 19, 0, "CU_SKIP_FLAG[0]" },
        {  7,  5, 1, "CU_SKIP_FLAG[1]" },
        {  8, 12, 1, "CU_SKIP_FLAG[2]" },
        {  9, 39, 0, "PRED_MODE_FLAG" },
        { 10,  0, 1, "PART_MODE[0]" },
        { 16, 11, 1, "MERGE_FLAG" },
        { 17, 13, 0, "MERGE_IDX" },
        { 29,  7, 0, "CBF_LUMA[0]" },
        { 30, 19, 1, "CBF_LUMA[1]" },
    };
    for (auto& t : tests) {
        EXPECT_EQ(engine.context(t.ctxIdx).pStateIdx(), t.pStateIdx)
            << t.name << " (ctxIdx=" << t.ctxIdx << ") pStateIdx";
        EXPECT_EQ(engine.context(t.ctxIdx).valMps(), t.valMps)
            << t.name << " (ctxIdx=" << t.ctxIdx << ") valMps";
    }
}

TEST(CabacContextInit, BSliceInitQP22) {
    // B-slice (sliceType=0), QP=22, cabac_init_flag=0 → initType=2
    CabacEngine engine;
    engine.init_contexts(0, 22, false);

    // Verify key inter contexts with B init values (column 2)
    // initValue from Tables: SPLIT_CU[0]=107, CU_SKIP[0]=197, MERGE_FLAG=154
    struct Expected { int ctxIdx; uint8_t pStateIdx; uint8_t valMps; const char* name; };
    Expected tests[] = {
        {  2, 12, 0, "SPLIT_CU_FLAG[0]" },   // initValue=107 same as P
        {  6, 19, 0, "CU_SKIP_FLAG[0]" },     // initValue=197 same as P
        {  9, 38, 0, "PRED_MODE_FLAG" },       // initValue=134 (B-specific)
        { 16,  0, 1, "MERGE_FLAG" },           // initValue=154 (B-specific)
        { 18, 12, 1, "INTER_PRED_IDC[0]" },   // initValue=95
    };
    for (auto& t : tests) {
        EXPECT_EQ(engine.context(t.ctxIdx).pStateIdx(), t.pStateIdx)
            << t.name << " (ctxIdx=" << t.ctxIdx << ") pStateIdx";
        EXPECT_EQ(engine.context(t.ctxIdx).valMps(), t.valMps)
            << t.name << " (ctxIdx=" << t.ctxIdx << ") valMps";
    }
}

TEST(CabacContextInit, PSliceAllContextsMatchSpec) {
    // Exhaustive check: compute expected values from init formula for ALL 155 contexts
    // P-slice, QP=22, cabac_init_flag=0 → initType=1
    CabacEngine engine;
    engine.init_contexts(1, 22, false);

    for (int i = 0; i < NUM_CABAC_CONTEXTS; i++) {
        uint8_t initValue = cabacInitValues[i].initValue[1]; // column P
        int slope  = (initValue >> 4) * 5 - 45;
        int offset = ((initValue & 15) << 3) - 16;
        int qp = 22;
        int preCtxState = std::max(1, std::min(126, ((slope * qp) >> 4) + offset));
        uint8_t expectedPS = (preCtxState <= 63) ? (63 - preCtxState) : (preCtxState - 64);
        uint8_t expectedVM = (preCtxState <= 63) ? 0 : 1;

        EXPECT_EQ(engine.context(i).pStateIdx(), expectedPS)
            << "P-slice ctxIdx=" << i << " initValue=" << (int)initValue;
        EXPECT_EQ(engine.context(i).valMps(), expectedVM)
            << "P-slice ctxIdx=" << i << " initValue=" << (int)initValue;
    }
}

TEST(CabacContextInit, BSliceAllContextsMatchSpec) {
    // Exhaustive: B-slice, QP=22
    CabacEngine engine;
    engine.init_contexts(0, 22, false);

    for (int i = 0; i < NUM_CABAC_CONTEXTS; i++) {
        uint8_t initValue = cabacInitValues[i].initValue[2]; // column B
        int slope  = (initValue >> 4) * 5 - 45;
        int offset = ((initValue & 15) << 3) - 16;
        int qp = 22;
        int preCtxState = std::max(1, std::min(126, ((slope * qp) >> 4) + offset));
        uint8_t expectedPS = (preCtxState <= 63) ? (63 - preCtxState) : (preCtxState - 64);
        uint8_t expectedVM = (preCtxState <= 63) ? 0 : 1;

        EXPECT_EQ(engine.context(i).pStateIdx(), expectedPS)
            << "B-slice ctxIdx=" << i << " initValue=" << (int)initValue;
        EXPECT_EQ(engine.context(i).valMps(), expectedVM)
            << "B-slice ctxIdx=" << i << " initValue=" << (int)initValue;
    }
}

// ============================================================
// Arithmetic decoder tests
// ============================================================

TEST(CabacDecode, DecodeTerminate_EndOfSlice) {
    // Construct a bitstream where decode_terminate returns 1
    // ivlCurrRange=510, ivlOffset from 9 bits
    // decode_terminate: ivlCurrRange -= 2 = 508
    // If ivlOffset >= 508, terminate returns 1
    // So we need ivlOffset >= 508 => 9-bit value >= 508
    // 508 = 0b111111100 => let's use 0b111111111 = 511
    // Bytes: 0xFF, 0x80 (first 9 bits = 111111110 = 510... let's be precise)

    // ivlOffset = read_bits(9). To get 510: binary 111111110
    // byte 0: 0xFF = 11111111, byte 1: MSB = 0 => 0b111111110 = 510
    // decode_terminate: range -= 2 -> 508. offset=510 >= 508 -> return 1
    std::vector<uint8_t> data = { 0xFF, 0x00 };
    auto bs = make_bs(data);

    CabacEngine engine;
    engine.init_decoder(bs);
    EXPECT_EQ(engine.decode_terminate(), 1);
}

TEST(CabacDecode, DecodeTerminate_NotEnd) {
    // ivlOffset must be < ivlCurrRange - 2 = 508
    // Use ivlOffset = 0 (9 bits of zero)
    std::vector<uint8_t> data = { 0x00, 0x00, 0x00, 0x00 };
    auto bs = make_bs(data);

    CabacEngine engine;
    engine.init_decoder(bs);
    EXPECT_EQ(engine.decode_terminate(), 0);
}

TEST(CabacDecode, DecodeBypass_Zero) {
    // ivlOffset = 0 initially, read one bit = 0
    // new ivlOffset = (0 << 1) | 0 = 0 < ivlCurrRange -> return 0
    std::vector<uint8_t> data = { 0x00, 0x00, 0x00, 0x00 };
    auto bs = make_bs(data);

    CabacEngine engine;
    engine.init_decoder(bs);
    EXPECT_EQ(engine.decode_bypass(), 0);
}

TEST(CabacDecode, DecodeBypassBins_MultipleZeros) {
    std::vector<uint8_t> data = { 0x00, 0x00, 0x00, 0x00 };
    auto bs = make_bs(data);

    CabacEngine engine;
    engine.init_decoder(bs);
    EXPECT_EQ(engine.decode_bypass_bins(8), 0);
}

TEST(CabacDecode, DecodeDecision_MPS) {
    // With ivlOffset = 0 (very low), we should always get MPS path
    std::vector<uint8_t> data = { 0x00, 0x00, 0x00, 0x00, 0x00 };
    auto bs = make_bs(data);

    CabacEngine engine;
    engine.init_contexts(0, 26, false);
    engine.init_decoder(bs);

    // Decode a decision — with offset=0, we always hit MPS
    int ctxIdx = CTX_SPLIT_CU_FLAG;
    int bin = engine.decode_decision(ctxIdx);
    EXPECT_EQ(bin, engine.context(ctxIdx).valMps());
}

TEST(CabacDecode, SaveRestoreContexts) {
    CabacEngine engine;
    engine.init_contexts(0, 26, false);

    CabacContext saved[NUM_CABAC_CONTEXTS];
    engine.save_contexts(saved);

    // Modify a context: pStateIdx 42, valMps 0, as the combined state holds them
    engine.context(0).state = 42 << 1;

    // Restore
    engine.load_contexts(saved);
    EXPECT_NE(engine.context(0).pStateIdx(), 42);
}

// A non-conforming stream can start the arithmetic decoder with ivlOffset 511,
// above ivlCurrRange (§9.3.2.5). Bypass bins decoded in one batch must still
// fit the number of bins asked for: callers index tables with them.
TEST(CabacEngine, BypassBinsStayWithinTheirWidthOnACorruptStream) {
    std::vector<uint8_t> data(64, 0xFF);
    data[1] = 0x80;  // first 9 bits: 1 1111 1111
    BitstreamReader bs(data.data(), data.size());
    CabacEngine engine;
    engine.init_decoder(bs);
    for (int i = 0; i < 40; i++) {
        int n = 1 + i % 16;
        int v = engine.decode_bypass_bins(n);
        EXPECT_GE(v, 0);
        EXPECT_LT(v, 1 << n) << "batch " << i << " of " << n << " bins";
    }
}
