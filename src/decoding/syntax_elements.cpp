#include "decoding/syntax_elements.h"

namespace hevc {

// §7.3.8.5 — sao_type_idx: TU cMax=2, 1 context + 1 bypass
int decode_sao_type_idx(CabacEngine& cabac) {
    int bin0 = cabac.decode_decision(CTX_SAO_TYPE_IDX);
    if (bin0 == 0) return 0;
    int bin1 = cabac.decode_bypass();
    return bin1 ? 2 : 1;
}

// §7.3.8.6 — split_cu_flag: 1 bin, context depends on neighbours
int decode_split_cu_flag(CabacEngine& cabac, int ctxInc) {
    return cabac.decode_decision(CTX_SPLIT_CU_FLAG + ctxInc);
}

// §7.3.8.6 — cu_skip_flag: 1 bin, context depends on neighbours
int decode_cu_skip_flag(CabacEngine& cabac, int ctxInc) {
    return cabac.decode_decision(CTX_CU_SKIP_FLAG + ctxInc);
}

// §7.3.8.7 — part_mode: complex binarization depends on pred_mode and CU size
int decode_part_mode(CabacEngine& cabac, PredMode pred_mode,
                     int log2CbSize, int log2MinCbSize, bool amp_enabled) {
    if (pred_mode == PredMode::MODE_INTRA) {
        // Intra: only 2Nx2N (bin=1) or NxN (bin=0), NxN only at min CB size
        if (log2CbSize == log2MinCbSize) {
            int bin = cabac.decode_decision(CTX_PART_MODE + 0);
            return bin ? static_cast<int>(PartMode::PART_2Nx2N)
                       : static_cast<int>(PartMode::PART_NxN);
        }
        return static_cast<int>(PartMode::PART_2Nx2N);
    }

    // Inter modes
    int bin0 = cabac.decode_decision(CTX_PART_MODE + 0);
    if (bin0) return static_cast<int>(PartMode::PART_2Nx2N);

    if (log2CbSize == log2MinCbSize) {
        // Table 9-45: binarization depends on log2CbSize
        if (log2CbSize > 3) {
            // log2CbSize > 3: NxN available — "01"=2NxN, "001"=Nx2N, "000"=NxN
            int bin1 = cabac.decode_decision(CTX_PART_MODE + 1);
            if (bin1) return static_cast<int>(PartMode::PART_2NxN);
            int bin2 = cabac.decode_decision(CTX_PART_MODE + 2);
            if (bin2) return static_cast<int>(PartMode::PART_Nx2N);
            return static_cast<int>(PartMode::PART_NxN);
        } else {
            // log2CbSize == 3: no NxN for inter — "01"=2NxN, "00"=Nx2N
            int bin1 = cabac.decode_decision(CTX_PART_MODE + 1);
            if (bin1) return static_cast<int>(PartMode::PART_2NxN);
            return static_cast<int>(PartMode::PART_Nx2N);
        }
    }

    if (log2CbSize > 3) {
        int bin1 = cabac.decode_decision(CTX_PART_MODE + 1);
        if (bin1) {
            if (!amp_enabled) return static_cast<int>(PartMode::PART_2NxN);
            int bin2 = cabac.decode_decision(CTX_PART_MODE + 3);
            if (bin2) return static_cast<int>(PartMode::PART_2NxN);
            int bin3 = cabac.decode_bypass();
            return bin3 ? static_cast<int>(PartMode::PART_2NxnD)
                        : static_cast<int>(PartMode::PART_2NxnU);
        } else {
            if (!amp_enabled) return static_cast<int>(PartMode::PART_Nx2N);
            int bin2 = cabac.decode_decision(CTX_PART_MODE + 3);
            if (bin2) return static_cast<int>(PartMode::PART_Nx2N);
            int bin3 = cabac.decode_bypass();
            return bin3 ? static_cast<int>(PartMode::PART_nRx2N)
                        : static_cast<int>(PartMode::PART_nLx2N);
        }
    }

    // log2CbSize == 3, no AMP
    int bin1 = cabac.decode_decision(CTX_PART_MODE + 1);
    if (bin1) return static_cast<int>(PartMode::PART_2NxN);
    return static_cast<int>(PartMode::PART_Nx2N);
}

// §7.3.8.8 — intra_chroma_pred_mode: 1 context + 2 bypass
int decode_intra_chroma_pred_mode(CabacEngine& cabac) {
    int bin0 = cabac.decode_decision(CTX_INTRA_CHROMA_PRED_MODE);
    if (bin0 == 0) return 4; // DM mode (derived from luma)
    return cabac.decode_bypass_bins(2); // 0=Planar, 1=V, 2=H, 3=DC
}

// §7.3.8.9 — merge_idx: TU cMax = maxNumMergeCand - 1
int decode_merge_idx(CabacEngine& cabac, int maxNumMergeCand) {
    if (maxNumMergeCand <= 1) return 0;
    int bin0 = cabac.decode_decision(CTX_MERGE_IDX);
    if (bin0 == 0) return 0;
    // Remaining bins are bypass (TU)
    int idx = 1;
    for (int i = 1; i < maxNumMergeCand - 1; i++) {
        if (cabac.decode_bypass() == 0) break;
        idx++;
    }
    return idx;
}

// §7.3.8.11 — split_transform_flag
int decode_split_transform_flag(CabacEngine& cabac, int log2TrafoSize) {
    int ctxIdx = CTX_SPLIT_TRANSFORM_FLAG + (5 - log2TrafoSize);
    return cabac.decode_decision(ctxIdx);
}

// §7.3.8.11 — cbf_luma
int decode_cbf_luma(CabacEngine& cabac, int trafoDepth) {
    int ctxIdx = CTX_CBF_LUMA + (trafoDepth == 0 ? 1 : 0);
    return cabac.decode_decision(ctxIdx);
}

// §7.3.8.11 — cbf_cb, cbf_cr (shared contexts) — Table 9-48: ctxInc = trafoDepth
int decode_cbf_chroma(CabacEngine& cabac, int trafoDepth) {
    int ctxIdx = CTX_CBF_CHROMA + std::min(trafoDepth, 4);
    return cabac.decode_decision(ctxIdx);
}

// §7.3.8.11 — cu_qp_delta_abs: TU+EGk
int decode_cu_qp_delta(CabacEngine& cabac) {
    // Prefix: TU cMax=5, context 0 for first bin, context 1 for rest
    int prefix = 0;
    int bin = cabac.decode_decision(CTX_CU_QP_DELTA_ABS + 0);
    if (bin == 0) return 0;
    prefix = 1;
    for (int i = 1; i < 5; i++) {
        bin = cabac.decode_decision(CTX_CU_QP_DELTA_ABS + 1);
        if (bin == 0) break;
        prefix++;
    }

    int val = prefix;
    if (prefix >= 5) {
        // Suffix: EG0 bypass
        int k = 0;
        int suffix = 0;
        // Bounded like the EGk loops below: CuQpDeltaVal is a few dozen at most
        while (k < 20 && cabac.decode_bypass()) k++;
        suffix = (1 << k) - 1 + cabac.decode_bypass_bins(k);
        val = prefix + suffix;
    }

    if (val == 0) return 0;
    // Sign
    int sign = cabac.decode_bypass();
    return sign ? -val : val;
}

// §7.3.8.11 — transform_skip_flag: 1 bin
int decode_transform_skip_flag(CabacEngine& cabac, int cIdx) {
    int ctxIdx = CTX_TRANSFORM_SKIP_FLAG + (cIdx > 0 ? 1 : 0);
    return cabac.decode_decision(ctxIdx);
}

// §9.3.3.5 — last_sig_coeff prefix (X or Y)
// ctxOffset = CTX_LAST_SIG_COEFF_X or CTX_LAST_SIG_COEFF_Y

// §9.3.3.5 — last_sig_coeff suffix (bypass, EG0-like)
int decode_last_sig_coeff_suffix(CabacEngine& cabac, int prefix) {
    if (prefix < 4) return 0; // no suffix needed
    int numBins = (prefix >> 1) - 1;
    return cabac.decode_bypass_bins(numBins);
}

// §7.3.8.12 — coded_sub_block_flag

// §7.3.8.12 — sig_coeff_flag

// §7.3.8.12 — coeff_abs_level_greater1_flag

// §7.3.8.12 — coeff_abs_level_greater2_flag

// §9.3.3.11 — coeff_abs_level_remaining (Rice + EGk bypass)

// ============================================================
// Phase 5 — Inter prediction syntax elements
// ============================================================

// §9.3.3.9 — inter_pred_idc: spec Table 9-47
// 0=PRED_L0, 1=PRED_L1, 2=PRED_BI
int decode_inter_pred_idc(CabacEngine& cabac, int nPbW, int nPbH, int ctDepth) {
    // §9.3.4.2.3 Table 9-48: binIdx 0 ctxInc = (nPbW+nPbH != 12) ? CtDepth : 4
    int ctxInc = (nPbW + nPbH != 12) ? ctDepth : 4;
    int bin0 = cabac.decode_decision(CTX_INTER_PRED_IDC + ctxInc);
    // Table 9-47: (nPbW+nPbH)==12: "0"→PRED_L0, "1"→PRED_L1 (no PRED_BI)
    if (nPbW + nPbH == 12)
        return bin0 ? 1 : 0;  // PRED_L1 or PRED_L0
    // Table 9-47: (nPbW+nPbH)!=12: "1"→PRED_BI, "00"→PRED_L0, "01"→PRED_L1
    if (bin0 == 1) return 2;  // PRED_BI
    int bin1 = cabac.decode_decision(CTX_INTER_PRED_IDC + 4);
    return bin1 ? 1 : 0;     // PRED_L1 or PRED_L0
}

// §9.3.3.5 — ref_idx: TU binarization, max=numRefIdxActive
int decode_ref_idx(CabacEngine& cabac, int numRefIdxActive) {
    if (numRefIdxActive == 0) return 0;
    int bin0 = cabac.decode_decision(CTX_REF_IDX + 0);
    if (bin0 == 0) return 0;
    int idx = 1;
    if (numRefIdxActive > 1) {
        int bin1 = cabac.decode_decision(CTX_REF_IDX + 1);
        if (bin1 == 0) return 1;
        idx = 2;
        // Remaining bins: bypass (TU)
        for (int i = 2; i < numRefIdxActive; i++) {
            if (cabac.decode_bypass() == 0) break;
            idx++;
        }
    }
    return idx;
}

// §7.3.8.10 — mvd_coding: abs_mvd_greater0, abs_mvd_greater1, abs_mvd_minus2, sign
MV decode_mvd(CabacEngine& cabac) {
    // §7.3.8.9 mvd_coding — transcription directe de la spec
    MV mvd = {};

    // §9.3.3.3 eq 9-13: k-th order Exp-Golomb with k=1 (Table 9-43)
    auto decode_eg1 = [&cabac]() -> int {
        int k = 1;
        int absV = 0;
        // Bounded: an MVD component fits in 16 bits (§7.4.9.9), so k never
        // needs to pass 16; unbounded, a desynchronised stream never returns
        while (k < 20 && cabac.decode_bypass()) {
            absV += (1 << k);
            k++;
        }
        absV += cabac.decode_bypass_bins(k);
        return absV;
    };

    // abs_mvd_greater0_flag[0], abs_mvd_greater0_flag[1]
    int g0_h = cabac.decode_decision(CTX_ABS_MVD_GREATER0);
    int g0_v = cabac.decode_decision(CTX_ABS_MVD_GREATER0);

    // abs_mvd_greater1_flag[0], abs_mvd_greater1_flag[1]
    int g1_h = 0, g1_v = 0;
    if (g0_h) g1_h = cabac.decode_decision(CTX_ABS_MVD_GREATER1);
    if (g0_v) g1_v = cabac.decode_decision(CTX_ABS_MVD_GREATER1);

    // §7.3.8.9: H component (abs_mvd_minus2[0] + mvd_sign_flag[0])
    int abs_h = 0;
    if (g0_h) {
        abs_h = g1_h + 1;
        if (g1_h)
            abs_h += decode_eg1();
        int sign = cabac.decode_bypass();   // mvd_sign_flag[0]
        mvd.x = static_cast<int16_t>(sign ? -abs_h : abs_h);
    }

    // §7.3.8.9: V component (abs_mvd_minus2[1] + mvd_sign_flag[1])
    int abs_v = 0;
    if (g0_v) {
        abs_v = g1_v + 1;
        if (g1_v)
            abs_v += decode_eg1();
        int sign = cabac.decode_bypass();   // mvd_sign_flag[1]
        mvd.y = static_cast<int16_t>(sign ? -abs_v : abs_v);
    }

    return mvd;
}

} // namespace hevc
