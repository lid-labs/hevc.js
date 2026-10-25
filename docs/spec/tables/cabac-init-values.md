# CABAC Context Initialization Values

CABAC context initialization tables (spec ITU-T H.265, Tables 9-5 to 9-42).

Each context is initialized with: `initValue = (slope << 4) | offset`
The init formula: `preCtxState = Clip3(1, 126, ((slope * (SliceQpY - 16)) >> 4) + offset)`

```cpp
void init_context(CabacContext& ctx, int initValue, int SliceQpY) {
    int slope  = (initValue >> 4) * 5 - 45;
    int offset = ((initValue & 15) << 3) - 16;
    int preCtxState = Clip3(1, 126, ((slope * Clip3(0, 51, SliceQpY)) >> 4) + offset);

    if (preCtxState <= 63) {
        ctx.pStateIdx = 63 - preCtxState;
        ctx.valMps = 0;
    } else {
        ctx.pStateIdx = preCtxState - 64;
        ctx.valMps = 1;
    }
}
```

## Convention

For each table below:
- 3 columns: `[I slice][P slice][B slice]`
- Each value is an `initValue` (uint8_t)
- The tables are indexed by `ctxIdx` (relative to the start of the syntax element's table)

## Table 9-5 — sao_merge_flag (ctxIdx 0)

```cpp
const uint8_t initValue_sao_merge_flag[3][1] = {
    { 153 },  // I
    { 153 },  // P
    { 153 },  // B
};
```

## Table 9-6 — sao_type_idx (ctxIdx 0)

```cpp
const uint8_t initValue_sao_type_idx[3][1] = {
    { 200 },  // I
    { 185 },  // P
    { 160 },  // B
};
```

## Table 9-7 — split_cu_flag (ctxIdx 0-2)

```cpp
const uint8_t initValue_split_cu_flag[3][3] = {
    { 139, 141, 157 },  // I
    { 107, 139, 126 },  // P
    { 107, 139, 126 },  // B
};
```

## Table 9-8 — cu_transquant_bypass_flag (ctxIdx 0)

```cpp
const uint8_t initValue_cu_transquant_bypass_flag[3][1] = {
    { 154 },  // I
    { 154 },  // P
    { 154 },  // B
};
```

## Table 9-9 — cu_skip_flag (ctxIdx 0-2)

```cpp
const uint8_t initValue_cu_skip_flag[3][3] = {
    {   0,   0,   0 },  // I (unused)
    { 197, 185, 201 },  // P
    { 197, 185, 201 },  // B
};
```

## Table 9-10 — pred_mode_flag (ctxIdx 0)

```cpp
const uint8_t initValue_pred_mode_flag[3][1] = {
    {   0 },  // I (unused)
    { 149 },  // P
    { 134 },  // B
};
```

## Table 9-11 — part_mode (ctxIdx 0-3)

```cpp
const uint8_t initValue_part_mode[3][4] = {
    { 184,   0,   0,   0 },  // I
    { 154, 139, 154, 154 },  // P
    { 154, 139, 154, 154 },  // B
};
```

## Table 9-12 — prev_intra_luma_pred_flag (ctxIdx 0)

```cpp
const uint8_t initValue_prev_intra_luma_pred_flag[3][1] = {
    { 184 },  // I
    { 154 },  // P
    { 183 },  // B
};
```

## Table 9-13 — intra_chroma_pred_mode (ctxIdx 0)

```cpp
const uint8_t initValue_intra_chroma_pred_mode[3][1] = {
    { 63 },  // I
    { 152 },  // P
    { 152 },  // B
};
```

## Table 9-14 — merge_flag (ctxIdx 0)

```cpp
const uint8_t initValue_merge_flag[3][1] = {
    {   0 },  // I (unused)
    { 110 },  // P
    { 154 },  // B
};
```

## Table 9-15 — merge_idx (ctxIdx 0)

```cpp
const uint8_t initValue_merge_idx[3][1] = {
    {   0 },  // I (unused)
    { 122 },  // P
    { 137 },  // B
};
```

## Table 9-16 — inter_pred_idc (ctxIdx 0-4)

```cpp
const uint8_t initValue_inter_pred_idc[3][5] = {
    {   0,   0,   0,   0,   0 },  // I (unused)
    {  95,  79,  63,  31, 31 },  // P
    {  95,  79,  63,  31, 31 },  // B
};
```

## Table 9-17 — ref_idx (ctxIdx 0-1)

```cpp
const uint8_t initValue_ref_idx[3][2] = {
    {   0,   0 },  // I (unused)
    { 153, 153 },  // P
    { 153, 153 },  // B
};
```

## Table 9-18 — mvp_flag (ctxIdx 0)

```cpp
const uint8_t initValue_mvp_flag[3][1] = {
    {   0 },  // I (unused)
    { 168 },  // P
    { 168 },  // B
};
```

## Table 9-19 — split_transform_flag (ctxIdx 0-2)

```cpp
const uint8_t initValue_split_transform_flag[3][3] = {
    { 153, 138, 138 },  // I
    { 124, 138, 94 },   // P
    { 124, 138, 94 },   // B
};
```

## Table 9-20 — cbf_luma (ctxIdx 0-1)

```cpp
const uint8_t initValue_cbf_luma[3][2] = {
    { 111, 141 },  // I
    { 153, 111 },  // P
    { 153, 111 },  // B
};
```

## Table 9-21 — cbf_cb, cbf_cr (ctxIdx 0-3)

```cpp
const uint8_t initValue_cbf_chroma[3][4] = {
    {  94, 138, 182, 154 },  // I
    { 149, 107, 167, 154 },  // P
    { 149, 92, 167, 154 },   // B
};
```

## Table 9-22 — abs_mvd_greater0_flag (ctxIdx 0)

```cpp
const uint8_t initValue_abs_mvd_greater0[3][1] = {
    {   0 },  // I (unused)
    { 140 },  // P
    { 169 },  // B
};
```

## Table 9-23 — abs_mvd_greater1_flag (ctxIdx 0)

```cpp
const uint8_t initValue_abs_mvd_greater1[3][1] = {
    {   0 },  // I (unused)
    { 198 },  // P
    { 198 },  // B
};
```

## Table 9-24 — cu_qp_delta_abs (ctxIdx 0-1)

```cpp
const uint8_t initValue_cu_qp_delta_abs[3][2] = {
    { 154, 154 },  // I
    { 154, 154 },  // P
    { 154, 154 },  // B
};
```

## Table 9-25 — transform_skip_flag (ctxIdx 0-1)

```cpp
const uint8_t initValue_transform_skip_flag[3][2] = {
    { 139, 139 },  // I
    { 139, 139 },  // P
    { 139, 139 },  // B
};
```

## Table 9-26 — last_sig_coeff_x_prefix (ctxIdx 0-17)

```cpp
const uint8_t initValue_last_sig_coeff_x[3][18] = {
    { 110, 110, 124, 125, 140, 153, 125, 127, 140, 109, 111, 143, 127, 111,  79, 108, 123,  63 },  // I
    { 125, 110,  94, 110,  95,  79, 125, 111, 110,  78, 110, 111, 111,  95,  94, 108, 123, 108 },  // P
    { 125, 110,  94, 110,  95,  79, 125, 111, 110,  78, 110, 111, 111,  95,  94, 108, 123, 108 },  // B
};
```

## Table 9-27 — last_sig_coeff_y_prefix (ctxIdx 0-17)

```cpp
const uint8_t initValue_last_sig_coeff_y[3][18] = {
    { 110, 110, 124, 125, 140, 153, 125, 127, 140, 109, 111, 143, 127, 111,  79, 108, 123,  63 },  // I
    { 125, 110,  94, 110,  95,  79, 125, 111, 110,  78, 110, 111, 111,  95,  94, 108, 123, 108 },  // P
    { 125, 110,  94, 110,  95,  79, 125, 111, 110,  78, 110, 111, 111,  95,  94, 108, 123, 108 },  // B
};
```

## Table 9-28 — coded_sub_block_flag (ctxIdx 0-3)

```cpp
const uint8_t initValue_coded_sub_block_flag[3][4] = {
    { 91, 171, 134, 141 },  // I
    { 121, 140, 61, 154 },  // P
    { 121, 140, 61, 154 },  // B
};
```

## Table 9-29 — sig_coeff_flag (ctxIdx 0-43 luma + 0-15 chroma)

The most complex CABAC context. 44 luma contexts + 16 chroma contexts = 60 total.

```cpp
// Luma (44 contexts)
const uint8_t initValue_sig_coeff_flag_luma[3][44] = {
    // I slice
    { 111, 111, 125, 110, 110,  94, 124, 108, 124, 107, 125, 141, 179, 153, 125, 107,
      125, 141, 179, 153, 125, 107, 125, 141, 179, 153, 125, 140, 139, 182, 182, 152,
      136, 152, 136, 153, 136, 139, 111, 136, 139, 111, 141, 111 },
    // P slice
    { 155, 154, 139, 153, 139, 123, 123,  63, 153, 166, 183, 140, 136, 153, 154, 166,
      183, 140, 136, 153, 154, 166, 183, 140, 136, 153, 154, 170, 153, 123, 123, 107,
      121, 107, 121, 167, 151, 183, 140, 151, 183, 140, 140, 140 },
    // B slice
    { 170, 154, 139, 153, 139, 123, 123,  63, 124, 166, 183, 140, 136, 153, 154, 166,
      183, 140, 136, 153, 154, 166, 183, 140, 136, 153, 154, 170, 153, 138, 138, 122,
      121, 122, 121, 167, 151, 183, 140, 151, 183, 140, 140, 140 },
};

// Chroma (16 contexts)
const uint8_t initValue_sig_coeff_flag_chroma[3][16] = {
    { 170, 154, 139, 153, 139, 123, 123,  63, 124, 166, 183, 140, 136, 153, 154, 166 },  // I
    { 170, 153, 138, 138, 122, 121, 122, 121, 167, 151, 183, 140, 151, 183, 140, 140 },  // P
    { 170, 153, 138, 138, 122, 121, 122, 121, 167, 151, 183, 140, 151, 183, 140, 140 },  // B
};
```

## Table 9-30 — coeff_abs_level_greater1_flag (ctxIdx 0-23)

```cpp
const uint8_t initValue_coeff_abs_level_greater1[3][24] = {
    // I slice
    { 140,  92, 137, 138, 140, 152, 138, 139, 153,  74, 149,  92, 139, 107, 122, 152,
      140, 179, 166, 182, 140, 227, 122, 197 },
    // P slice
    { 154, 196, 196, 167, 154, 152, 167, 182, 182, 134, 149, 136, 153, 121, 136, 137,
      169, 194, 166, 167, 154, 167, 137, 182 },
    // B slice
    { 154, 196, 167, 167, 154, 152, 167, 182, 182, 134, 149, 136, 153, 121, 136, 122,
      169, 208, 166, 167, 154, 152, 167, 182 },
};
```

## Table 9-31 — coeff_abs_level_greater2_flag (ctxIdx 0-5)

```cpp
const uint8_t initValue_coeff_abs_level_greater2[3][6] = {
    { 138, 153, 136, 167, 152, 152 },  // I
    { 107, 167,  91, 122, 107, 167 },  // P
    { 107, 167,  91, 107, 107, 167 },  // B
};
```

## Implementation notes

### Total number of contexts

For the Main profile:
- sao_merge_flag : 1
- sao_type_idx : 1
- split_cu_flag : 3
- cu_transquant_bypass_flag : 1
- cu_skip_flag : 3
- pred_mode_flag : 1
- part_mode : 4
- prev_intra_luma_pred_flag : 1
- intra_chroma_pred_mode : 1
- merge_flag : 1
- merge_idx : 1
- inter_pred_idc : 5
- ref_idx : 2
- mvp_flag : 1
- split_transform_flag : 3
- cbf_luma : 2
- cbf_cb/cr : 4
- abs_mvd_greater0 : 1
- abs_mvd_greater1 : 1
- cu_qp_delta_abs : 2
- transform_skip_flag : 2
- last_sig_coeff_x : 18
- last_sig_coeff_y : 18
- coded_sub_block_flag : 4
- sig_coeff_flag : 44 + 16 = 60
- coeff_abs_level_greater1 : 24
- coeff_abs_level_greater2 : 6

**Total: ~167 contexts** (Main profile)

### cabac_init_flag permutation

When `cabac_init_flag == 1`:
- P slice uses the init values of B slice
- B slice uses the init values of P slice
- I slice is not affected
