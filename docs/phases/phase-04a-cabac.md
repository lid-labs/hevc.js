# Phase 4A — CABAC Engine + Context Init

## Status: DONE

## Goal

Working CABAC arithmetic engine with correct initialization of all contexts.

## Spec refs

- §9.3.4.3: Arithmetic decoding (decode_decision, decode_bypass, decode_terminate)
- §9.3.1.1: Context initialization (slope/offset formula, initValue tables)
- §9.3.4.2: Renormalization
- Tables 9-5 to 9-31: Init values for each syntax element

## What is implemented

### CABAC Engine (`cabac.h`, `cabac.cpp`)
- `init_decoder()`: initializes ivlCurrRange and ivlOffset from the bitstream
- `init_contexts()`: slope/offset formula with Clip3, for I/P/B slices
- `decode_decision()`: decodes a bin with context (rangeTabLps, transIdx)
- `decode_bypass()`: decodes a bin without context
- `decode_terminate()`: decodes end_of_slice_segment_flag
- `decode_bypass_bins()`: decodes N bypass bins at once
- `cabac_init_flag`: permutation of the P/B tables

### Tables (`cabac_tables.h`)
- `rangeTabLps[64][4]`: LPS range table (spec Table 9-48)
- `transIdxMps[64]`, `transIdxLps[64]`: transition tables
- `cabacInitValues[155]`: init values for 155 contexts (I/P/B)
- `CabacCtxOffset` enum: offset of each syntax element in the flat array

## Existing tests (`test_cabac.cpp`)

| Test | Verifies |
|------|---------|
| InitValueFormula | split_cu_flag[0] init for I-slice QP=26 |
| AllContextsInRange | pStateIdx [0,63], valMps {0,1} for all ctx, all QP |
| CabacInitFlagPermutation | P-slice with cabac_init_flag=1 == normal B-slice |
| DecodeTerminate | Terminate bin on known data |
| DecodeBypass | Bypass bins on known data |
| DecodeDecision | Decision bin on known data |
| SaveRestoreContexts | Save/restore of the context array |

## Exit criterion

- [x] 7 tests pass
- [x] Init values verified against HM ContextTables.h for the 44 sig_coeff_flag contexts
- [x] Arithmetic engine produces the same bins as HM for the first 326 bins of i_64x64_qp22
