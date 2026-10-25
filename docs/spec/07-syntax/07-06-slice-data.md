# §7.3.8-11 — Slice Data (CTU, CU, PU, TU)

Spec ref: §7.3.8 (coding_tree_unit), §7.3.9 (coding_quadtree), §7.3.10 (coding_unit), §7.3.11 (prediction_unit), §7.3.12 (transform_tree), §7.3.13 (transform_unit)

## Quad-tree overview

```
CTU (Coding Tree Unit) — fixed size (e.g. 64x64)
│
├── coding_quadtree() — recursive split
│   ├── split_cu_flag = 1 → 4 sub-blocks
│   └── split_cu_flag = 0 → CU (Coding Unit)
│       │
│       ├── PU (Prediction Unit) — 1 or more
│       │   ├── Intra: 1 PU (2Nx2N) or 4 PUs (NxN if CU = MinCB)
│       │   └── Inter: 2Nx2N, 2NxN, Nx2N, 2NxnU, 2NxnD, nLx2N, nRx2N
│       │
│       └── TU (Transform Unit) — recursive quad-tree
│           ├── split_transform_flag = 1 → 4 sub-TUs
│           └── split_transform_flag = 0 → TU leaf
│               └── Residual coefficients (CABAC)
```

## §7.3.8 — coding_tree_unit

```
coding_tree_unit() {
    xCtb = (CtbAddrInRs % PicWidthInCtbsY) * CtbSizeY
    yCtb = (CtbAddrInRs / PicWidthInCtbsY) * CtbSizeY
    // SAO params for this CTB
    if(slice_sao_luma_flag || slice_sao_chroma_flag)
        sao(rx, ry)
    coding_quadtree(xCtb, yCtb, CtbLog2SizeY, 0)
}
```

## §7.3.9 — coding_quadtree

```
coding_quadtree(x0, y0, log2CbSize, cqtDepth) {
    if(x0 + (1 << log2CbSize) <= pic_width &&
       y0 + (1 << log2CbSize) <= pic_height &&
       log2CbSize > MinCbLog2SizeY)
        split_cu_flag[x0][y0]    ae(v)

    if(cu_qp_delta_enabled_flag && log2CbSize >= Log2MinCuQpDeltaSize) {
        IsCuQpDeltaCoded = 0
        CuQpDeltaVal = 0
    }

    if(split_cu_flag[x0][y0]) {
        x1 = x0 + (1 << (log2CbSize - 1))
        y1 = y0 + (1 << (log2CbSize - 1))
        coding_quadtree(x0, y0, log2CbSize - 1, cqtDepth + 1)
        if(x1 < pic_width)
            coding_quadtree(x1, y0, log2CbSize - 1, cqtDepth + 1)
        if(y1 < pic_height)
            coding_quadtree(x0, y1, log2CbSize - 1, cqtDepth + 1)
        if(x1 < pic_width && y1 < pic_height)
            coding_quadtree(x1, y1, log2CbSize - 1, cqtDepth + 1)
    } else {
        coding_unit(x0, y0, log2CbSize)
    }
}
```

### Note: forced split at the edges

If the block exceeds the picture dimensions, `split_cu_flag` is not coded — the split is implicit (forced to 1).

## §7.3.10 — coding_unit

```
coding_unit(x0, y0, log2CbSize) {
    if(transquant_bypass_enabled_flag)
        cu_transquant_bypass_flag    ae(v)
    if(!IntraSplitFlag)  // not in an I slice with forced split
        cu_skip_flag[x0][y0]         ae(v)

    nCbS = 1 << log2CbSize

    if(cu_skip_flag[x0][y0]) {
        prediction_unit(x0, y0, nCbS, nCbS)  // merge mode, no residual
    } else {
        if(slice_type != I)
            pred_mode_flag               ae(v)
        // pred_mode_flag: 0=inter, 1=intra

        if(CuPredMode == MODE_INTRA) {
            if(log2CbSize == MinCbLog2SizeY)  // NxN only possible if CU = min size
                part_mode                ae(v)  // 0=2Nx2N, 1=NxN
            // ... PCM flag
            // Intra prediction modes
            prev_intra_luma_pred_flag[i]  ae(v)
            if(prev_intra_luma_pred_flag)
                mpm_idx[i]                ae(v)  // Most Probable Mode index
            else
                rem_intra_luma_pred_mode[i]  ae(v)  // mode in the remaining list
            intra_chroma_pred_mode        ae(v)
        } else {  // MODE_INTER
            part_mode                     ae(v)
            // Depending on part_mode: 1, 2 or 4 PUs
            for each PU:
                prediction_unit(xPb, yPb, nPbW, nPbH)
        }
        // PCM check
        if(!pcm_flag) {
            // ... rqt_root_cbf
            if(rqt_root_cbf)
                transform_tree(x0, y0, ...)
        }
    }
}
```

## §7.3.11 — prediction_unit (Inter)

```
prediction_unit(x0, y0, nPbW, nPbH) {
    if(cu_skip_flag) {
        merge_idx    ae(v)
    } else {
        merge_flag   ae(v)
        if(merge_flag) {
            merge_idx    ae(v)
        } else {
            // AMVP mode
            if(slice_type == B)
                inter_pred_idc    ae(v)  // Pred_L0, Pred_L1, Pred_BI

            if(inter_pred_idc != Pred_L1) {
                ref_idx_l0        ae(v)
                mvd_coding(x0, y0, 0)
                mvp_l0_flag       ae(v)
            }
            if(inter_pred_idc != Pred_L0) {
                ref_idx_l1        ae(v)
                // mvd_l1_zero_flag optimization
                if(!mvd_l1_zero_flag)
                    mvd_coding(x0, y0, 1)
                mvp_l1_flag       ae(v)
            }
        }
    }
}
```

## §7.3.12-13 — transform_tree / transform_unit

```
transform_tree(x0, y0, xBase, yBase, log2TrafoSize, trafoDepth, blkIdx) {
    // Split if too large or if depth is insufficient
    if(split conditions)
        split_transform_flag    ae(v)

    if(split_transform_flag) {
        // 4 recursive sub-TUs
        transform_tree(x0, y0, x0, y0, log2TrafoSize-1, trafoDepth+1, 0)
        transform_tree(x1, y0, x0, y0, log2TrafoSize-1, trafoDepth+1, 1)
        transform_tree(x0, y1, x0, y0, log2TrafoSize-1, trafoDepth+1, 2)
        transform_tree(x1, y1, x0, y0, log2TrafoSize-1, trafoDepth+1, 3)
    } else {
        transform_unit(x0, y0, xBase, yBase, log2TrafoSize, trafoDepth, blkIdx)
    }
}

transform_unit(x0, y0, xBase, yBase, log2TrafoSize, trafoDepth, blkIdx) {
    // CBF (Coded Block Flag) — indicates whether non-zero coefficients exist
    if(log2TrafoSize > 2 || ChromaArrayType == 3) {
        cbf_cb    ae(v)
        cbf_cr    ae(v)
    }
    if(trafoDepth == 0 || cbf_luma from parent)
        cbf_luma    ae(v)

    // Residual coefficients
    if(cbf_luma)
        residual_coding(x0, y0, log2TrafoSize, 0)   // luma
    if(cbf_cb)
        residual_coding(xC, yC, log2TrafoSizeC, 1)  // Cb
    if(cbf_cr)
        residual_coding(xC, yC, log2TrafoSizeC, 2)  // Cr
}
```

## residual_coding — §7.3.8.11

This is where the transform coefficients are decoded via CABAC. Complex structure:

```
residual_coding(x0, y0, log2TrafoSize, cIdx) {
    // Scan order
    transform_skip_flag        ae(v)
    last_sig_coeff_x_prefix    ae(v)
    last_sig_coeff_y_prefix    ae(v)
    // ... suffixes if necessary

    // Traversal of the (4x4) sub-blocks in reverse diagonal scan
    for(i = lastSubBlock; i >= 0; i--) {
        // coded_sub_block_flag
        // sig_coeff_flag for each position
        // coeff_abs_level_greater1_flag
        // coeff_abs_level_greater2_flag
        // coeff_sign_flag
        // coeff_abs_level_remaining (bypass-coded)
    }
}
```

## Checklist

- [ ] coding_quadtree: recursive split with edge handling
- [ ] coding_unit: intra/inter dispatch, part_mode
- [ ] prediction_unit (intra): prev_intra_luma_pred_flag, mpm_idx, rem
- [ ] prediction_unit (inter): merge, AMVP, mvd_coding
- [ ] transform_tree: recursive split, max depth
- [ ] transform_unit: cbf flags, luma/chroma dispatch
- [ ] residual_coding: scan order, sub-block decode, coefficient levels
- [ ] SAO params parsing per CTU
- [ ] Tests: decode a simple bitstream and verify the tree structure
