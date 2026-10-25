#pragma once

// CABAC syntax element decoding — Spec §9.3.2, §9.3.3
// Each function decodes one syntax element using the appropriate
// binarization and context model(s).

#include "decoding/cabac.h"
#include "common/types.h"

namespace hevc {

// Forward declarations
struct SPS;
struct PPS;
struct SliceHeader;

// ============================================================
// Syntax element decoders
// Each takes the CABAC engine + any context derivation parameters
// ============================================================

// §9.3.3.4 — end_of_slice_segment_flag (decoded via terminate)
inline int decode_end_of_slice_segment_flag(CabacEngine& cabac) {
    return cabac.decode_terminate();
}

// §7.3.8.5 — sao_merge_left_flag, sao_merge_up_flag
inline int decode_sao_merge_flag(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_SAO_MERGE_FLAG);
}

// §7.3.8.5 — sao_type_idx_luma, sao_type_idx_chroma
int decode_sao_type_idx(CabacEngine& cabac);

// §7.3.8.6 — split_cu_flag
// ctxInc depends on depth of left and above neighbours
int decode_split_cu_flag(CabacEngine& cabac, int ctxInc);

// §7.3.8.6 — cu_transquant_bypass_flag
inline int decode_cu_transquant_bypass_flag(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_CU_TRANSQUANT_BYPASS);
}

// §7.3.8.6 — cu_skip_flag
int decode_cu_skip_flag(CabacEngine& cabac, int ctxInc);

// §7.3.8.7 — pred_mode_flag
inline int decode_pred_mode_flag(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_PRED_MODE_FLAG);
}

// §7.3.8.7 — part_mode (depends on pred_mode, log2CbSize, amp_enabled)
int decode_part_mode(CabacEngine& cabac, PredMode pred_mode,
                     int log2CbSize, int log2MinCbSize, bool amp_enabled);

// §7.3.8.8 — prev_intra_luma_pred_flag
inline int decode_prev_intra_luma_pred_flag(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_PREV_INTRA_LUMA_PRED);
}

// §7.3.8.8 — mpm_idx (FL, 2 bins bypass)
inline int decode_mpm_idx(CabacEngine& cabac) {
    // TR binarization cMax=2: bin0 bypass, if 1 then bin1 bypass
    int bin0 = cabac.decode_bypass();
    if (bin0 == 0) return 0;
    int bin1 = cabac.decode_bypass();
    return bin1 ? 2 : 1;
}

// §7.3.8.8 — rem_intra_luma_pred_mode (FL, 5 bins bypass)
inline int decode_rem_intra_luma_pred_mode(CabacEngine& cabac) {
    return cabac.decode_bypass_bins(5);
}

// §7.3.8.8 — intra_chroma_pred_mode
int decode_intra_chroma_pred_mode(CabacEngine& cabac);

// §7.3.8.9 — merge_flag
inline int decode_merge_flag(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_MERGE_FLAG);
}

// §7.3.8.9 — merge_idx (TU, cMax = MaxNumMergeCand - 1)
int decode_merge_idx(CabacEngine& cabac, int maxNumMergeCand);

// §7.3.8.9 — inter_pred_idc (PRED_L0=0, PRED_L1=1, PRED_BI=2)
int decode_inter_pred_idc(CabacEngine& cabac, int nPbW, int nPbH, int ctDepth);

// §7.3.8.9 — ref_idx_l0 / ref_idx_l1
int decode_ref_idx(CabacEngine& cabac, int numRefIdxActive);

// §7.3.8.10 — mvd_coding (returns MV with x,y components)
MV decode_mvd(CabacEngine& cabac);

// §7.3.8.9 — mvp_l0_flag / mvp_l1_flag
inline int decode_mvp_flag(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_MVP_FLAG);
}

// §7.3.8.5 — rqt_root_cbf (for inter CU)
inline int decode_rqt_root_cbf(CabacEngine& cabac) {
    return cabac.decode_decision(CTX_RQT_ROOT_CBF);
}

// §7.3.8.11 — split_transform_flag
int decode_split_transform_flag(CabacEngine& cabac, int log2TrafoSize);

// §7.3.8.11 — cbf_luma
int decode_cbf_luma(CabacEngine& cabac, int trafoDepth);

// §7.3.8.11 — cbf_cb, cbf_cr
int decode_cbf_chroma(CabacEngine& cabac, int trafoDepth);

// §7.3.8.11 — cu_qp_delta
int decode_cu_qp_delta(CabacEngine& cabac);

// §7.3.8.11 — transform_skip_flag
int decode_transform_skip_flag(CabacEngine& cabac, int cIdx);

// §7.3.8.12 — last_sig_coeff_x_prefix, last_sig_coeff_y_prefix
// Defined below, inline: called once per bin from the coefficient loop.

// §7.3.8.12 — last_sig_coeff_x_suffix, last_sig_coeff_y_suffix
int decode_last_sig_coeff_suffix(CabacEngine& cabac, int prefix);

// §7.3.8.12 — coded_sub_block_flag
// Defined below, inline: called once per bin from the coefficient loop.

// §7.3.8.12 — sig_coeff_flag
// Defined below, inline: called once per bin from the coefficient loop.

// §7.3.8.12 — coeff_abs_level_greater1_flag
// Defined below, inline: called once per bin from the coefficient loop.

// §7.3.8.12 — coeff_abs_level_greater2_flag
// Defined below, inline: called once per bin from the coefficient loop.

// §7.3.8.12 — coeff_abs_level_remaining (Golomb-Rice + EGk bypass)
// Defined below, inline: called once per bin from the coefficient loop.

// §7.3.8.12 — coeff_sign_flag (bypass)
inline int decode_coeff_sign_flag(CabacEngine& cabac) {
    return cabac.decode_bypass();
}

// ============================================================
// Residual coding syntax elements (§7.3.8.11), inline so that the coefficient
// loop of residual_coding.cpp does not pay a call per bin
// ============================================================

inline int decode_last_sig_coeff_prefix(CabacEngine& cabac, int ctxOffset, int cIdx,
                                  int log2TrafoSize) {
    // Context index offset and shift depend on component and size
    int ctxShift, ctxOff;
    if (cIdx == 0) {
        // Luma
        ctxOff = 3 * (log2TrafoSize - 2) + ((log2TrafoSize - 1) >> 2);
        ctxShift = (log2TrafoSize + 1) >> 2;
    } else {
        // Chroma
        ctxOff = 15;
        ctxShift = log2TrafoSize - 2;
    }

    int maxBins = (log2TrafoSize << 1) - 1;
    int prefix = 0;
    for (int i = 0; i < maxBins; i++) {
        int ctxIdx = ctxOffset + ctxOff + (i >> ctxShift);
        int bin = cabac.decode_decision(ctxIdx);
        if (bin == 0) break;
        prefix++;
    }
    return prefix;
}

inline int decode_coded_sub_block_flag(CabacEngine& cabac, int ctxInc) {
    return cabac.decode_decision(CTX_CODED_SUB_BLOCK_FLAG + ctxInc);
}

inline int decode_sig_coeff_flag(CabacEngine& cabac, int ctxInc) {
    return cabac.decode_decision(CTX_SIG_COEFF_FLAG + ctxInc);
}

inline int decode_coeff_abs_level_greater1_flag(CabacEngine& cabac, int ctxSet,
                                          int greater1Ctx, int cIdx) {
    int ctxIdx;
    if (cIdx == 0) {
        ctxIdx = CTX_COEFF_ABS_LEVEL_GREATER1 + ctxSet * 4 + greater1Ctx;
    } else {
        ctxIdx = CTX_COEFF_ABS_LEVEL_GREATER1 + 16 + ctxSet * 4 + greater1Ctx;
    }
    return cabac.decode_decision(ctxIdx);
}

inline int decode_coeff_abs_level_greater2_flag(CabacEngine& cabac, int ctxSet, int cIdx) {
    int ctxIdx;
    if (cIdx == 0) {
        ctxIdx = CTX_COEFF_ABS_LEVEL_GREATER2 + ctxSet;
    } else {
        ctxIdx = CTX_COEFF_ABS_LEVEL_GREATER2 + 4 + (ctxSet & 1);
    }
    return cabac.decode_decision(ctxIdx);
}

inline int decode_coeff_abs_level_remaining(CabacEngine& cabac, int cRiceParam) {
    // Prefix: unary in bypass
    int prefix = 0;
    while (prefix < 4 && cabac.decode_bypass()) {
        prefix++;
    }

    if (prefix < 4) {
        // Suffix: FL with cRiceParam bins
        int suffix = 0;
        if (cRiceParam > 0) {
            suffix = cabac.decode_bypass_bins(cRiceParam);
        }
        return (prefix << cRiceParam) + suffix;
    } else {
        // EGk suffix with k = cRiceParam + 1
        // §9.3.3.3: read 1's incrementing k, then 0, then k bits
        int kStart = cRiceParam + 1;
        int k = kStart;
        // Bounded: a conforming level fits in 16 bits (§7.4.9.11), which k
        // never needs to pass 16 for. Unbounded, a corrupt or desynchronised
        // stream that keeps decoding 1s here never returns.
        while (k < 20 && cabac.decode_bypass()) k++;
        int suffix = cabac.decode_bypass_bins(k);
        // Reconstruct: sum of (1<<k_j) for each '1' read + final k bits
        // = (1 << k) - (1 << kStart) + suffix
        suffix += (1 << k) - (1 << kStart);
        return (4 << cRiceParam) + suffix;
    }
}

} // namespace hevc
