# §7.3.8.1 — Slice Segment Data

Spec ref: §7.3.8.1 (general slice segment data syntax)

## Overview

`slice_segment_data()` is the main loop that iterates over the CTUs of a slice. It is the core of the decoder.

## Pseudo-code (spec)

```
slice_segment_data() {
    do {
        CtbAddrInTs = CtbAddrRsToTs[CtbAddrInRs]

        coding_tree_unit()

        end_of_slice_segment_flag                ae(v)  // decode_terminate()

        CtbAddrInTs++
        CtbAddrInRs = CtbAddrTsToRs[CtbAddrInTs]
    } while (!end_of_slice_segment_flag)
}
```

## Critical points

### `end_of_slice_segment_flag`

- Decoded via `decode_terminate()` (CABAC terminate mode, §9.3.4.5), **NOT** via `decode_decision()`
- `decode_terminate()` uses a fixed sub-range of 2:
  - `ivlCurrRange -= 2`
  - Si `ivlOffset >= ivlCurrRange` → flag = 1 (end of slice), then read `alignment bits`
  - Otherwise → flag = 0, renormalize
- Parsed after **every** CTU without exception
- Forgetting this flag causes a bitstream overrun or a CABAC desync

### Scan order (tiles)

- `CtbAddrInRs`: raster scan address (left→right, top→bottom in the picture)
- `CtbAddrInTs`: tile scan address (left→right, top→bottom **within each tile**)
- The conversion tables `CtbAddrRsToTs[]` and `CtbAddrTsToRs[]` are derived from the tile layout (PPS)
- Without tiles, the two orders are identical

### CABAC reinitialization at tile boundaries

If `tiles_enabled_flag == 1` and a new tile is entered (the current CTU is the first of a tile):
- Reinitialize all CABAC contexts
- Reinitialize the arithmetic decoder (read the init bits)
- Unless `dependent_slice_segment_flag == 1` for this slice

### WPP (Wavefront Parallel Processing)

If `entropy_coding_sync_enabled_flag == 1`:
- At the start of each CTU row (except the first):
  - Restore the CABAC contexts saved at the end of the 2nd CTU of the previous row
  - Reinitialize the arithmetic decoder
- At the end of the 2nd CTU of each row:
  - Save the state of all CABAC contexts

### `end_of_sub_stream_one_bit`

If the slice contains entry points (tiles or WPP), `end_of_sub_stream_one_bit` is read at the end of each sub-stream (except the last) instead of `end_of_slice_segment_flag`:
- `end_of_sub_stream_one_bit` must be 1
- Followed by `byte_alignment()` to align the reader before the next sub-stream

## C++ implementation

```cpp
void Decoder::decode_slice_segment_data(SliceHeader& sh) {
    int ctb_addr_rs = sh.slice_segment_address;

    do {
        int ctb_addr_ts = ctb_addr_rs_to_ts[ctb_addr_rs];

        // Reinit CABAC if new tile (except dependent slice)
        if (is_first_ctb_in_tile(ctb_addr_ts) && ctb_addr_rs != sh.slice_segment_address) {
            cabac.init_contexts(sh);
            cabac.init_decoder(bitstream);
        }

        // WPP: restore the contexts at the start of a CTU row
        if (entropy_coding_sync_enabled && is_first_ctb_in_row(ctb_addr_rs)) {
            if (has_saved_wpp_contexts) {
                cabac.restore_contexts(saved_wpp_contexts);
                cabac.init_decoder(bitstream);
            }
        }

        decode_coding_tree_unit(ctb_addr_rs);

        // WPP: save the contexts after the 2nd CTU of the row
        if (entropy_coding_sync_enabled && is_second_ctb_in_row(ctb_addr_rs)) {
            cabac.save_contexts(saved_wpp_contexts);
            has_saved_wpp_contexts = true;
        }

        // Detect end of sub-stream (tiles/WPP) or end of slice
        if (is_end_of_sub_stream(ctb_addr_ts, sh)) {
            // end_of_sub_stream_one_bit (must be 1)
            assert(cabac.decode_terminate() == 1);
            bitstream.byte_alignment();
            end_of_slice_segment_flag = false;
        } else {
            end_of_slice_segment_flag = cabac.decode_terminate();
        }

        ctb_addr_ts++;
        ctb_addr_rs = ctb_addr_ts_to_rs[ctb_addr_ts];

    } while (!end_of_slice_segment_flag);
}
```

## Checklist

- [ ] do-while loop with `end_of_slice_segment_flag` via `decode_terminate()`
- [ ] `decode_terminate()` implemented correctly (range -= 2, offset test)
- [ ] Tile-scan order (CtbAddrInTs / CtbAddrInRs conversion)
- [ ] CABAC reinit at tile boundaries
- [ ] WPP: saving/restoring contexts at CTU rows
- [ ] `end_of_sub_stream_one_bit` + `byte_alignment()` at sub-stream boundaries
- [ ] Tests: verify the number of CTUs decoded per slice
- [ ] Tests: multi-tile bitstream, verify the CABAC reinit
