# Chapter 6 — Source, Coded, Decoded and Output Data Formats

Spec ref: ITU-T H.265 §6

## 6.1 — Source and decoded video formats

### Color space

HEVC works in YCbCr (Y = luma, Cb/Cr = chroma). The spec defines the following formats:

| chroma_format_idc | Format | SubWidthC | SubHeightC | Description |
|-------------------|--------|-----------|------------|-------------|
| 0 | Monochrome | - | - | Luma only |
| 1 | 4:2:0 | 2 | 2 | Chroma subsampled H+V |
| 2 | 4:2:2 | 2 | 1 | Chroma subsampled H |
| 3 | 4:4:4 | 1 | 1 | Full-resolution chroma |

### Bit depth

```cpp
// Spec §7.4.3.2.1
BitDepthY = 8 + bit_depth_luma_minus8       // [8..16]
BitDepthC = 8 + bit_depth_chroma_minus8     // [8..16]
QpBdOffsetY = 6 * bit_depth_luma_minus8
QpBdOffsetC = 6 * bit_depth_chroma_minus8
```

### Dimensions

```cpp
// Dimensions in luma samples
pic_width_in_luma_samples   // must be a multiple of MinCbSizeY
pic_height_in_luma_samples  // must be a multiple of MinCbSizeY

// Dimensions in CTUs
PicWidthInCtbsY  = Ceil(pic_width_in_luma_samples / CtbSizeY)
PicHeightInCtbsY = Ceil(pic_height_in_luma_samples / CtbSizeY)
PicSizeInCtbsY   = PicWidthInCtbsY * PicHeightInCtbsY
```

### Conformance window

The conformance window (§7.4.3.2.1) allows cropping the output picture:

```cpp
// The offsets are in units of SubWidthC/SubHeightC for chroma
CropLeft   = conf_win_left_offset * SubWidthC
CropRight  = conf_win_right_offset * SubWidthC
CropTop    = conf_win_top_offset * SubHeightC
CropBottom = conf_win_bottom_offset * SubHeightC

// Output dimensions
OutputWidth  = pic_width_in_luma_samples - CropLeft - CropRight
OutputHeight = pic_height_in_luma_samples - CropTop - CropBottom
```

## 6.2 — Scan order

### Raster scan vs Z-scan

The spec uses two main scan orders:

**Raster scan** : left->right, top->bottom (for CTUs in a slice/tile).

**Z-scan (Morton order)** : used for CUs/TUs within a CTU.

```
Z-scan order for a 4x4 block divided into 2x2:
┌───┬───┐
│ 0 │ 1 │
├───┼───┤
│ 2 │ 3 │
└───┴───┘
Applied recursively to each sub-block.
```

### Conversion tables

```cpp
// Spec §6.5.1 - Z-scan to raster scan
// MinTbAddrZS[x][y]: (x,y) coordinates in MinTB units → Z-scan address
// Inverse: RasterToZScan and ZScanToRaster

// Implementation: precompute these tables when the SPS is activated
void init_scan_tables(const SPS& sps) {
    // Compute MinTbAddrZS per §6.5.1
    // Compute the tile/slice conversion tables
}
```

### Coefficient scan order

Transform coefficients are scanned diagonally (§6.5.3):

```
Diagonal scan 4x4 :
┌────┬────┬────┬────┐
│  0 │  2 │  5 │  9 │
├────┼────┼────┼────┤
│  1 │  4 │  8 │ 12 │
├────┼────┼────┼────┤
│  3 │  7 │ 11 │ 14 │
├────┼────┼────┼────┤
│  6 │ 10 │ 13 │ 15 │
└────┴────┴────┴────┘
```

The scan tables are precomputed for the sizes 4x4, 8x8, 16x16, 32x32.

## 6.3 — C++ implementation

### Key structures

```cpp
struct ChromaFormat {
    uint8_t chroma_format_idc;  // 0-3
    uint8_t SubWidthC;          // derived from chroma_format_idc
    uint8_t SubHeightC;         // derived from chroma_format_idc
};

struct PictureFormat {
    uint32_t width;             // pic_width_in_luma_samples
    uint32_t height;            // pic_height_in_luma_samples
    uint8_t  bit_depth_y;       // BitDepthY
    uint8_t  bit_depth_c;       // BitDepthC
    ChromaFormat chroma;

    // Conformance window
    uint32_t crop_left, crop_right, crop_top, crop_bottom;

    // Derived
    uint32_t width_in_ctbs;
    uint32_t height_in_ctbs;
    uint32_t ctb_size;
};
```

### Validation oracle

For this section, validation is indirect: if the dimensions, bit depth and chroma format are parsed correctly, the SPS dump will match libde265.

## Checklist

- [ ] ChromaFormat with SubWidthC/SubHeightC derivation
- [ ] PictureFormat with all derived dimensions
- [ ] Conformance window calculation
- [ ] Precomputed Z-scan tables
- [ ] Coefficient scan tables (diagonal, horizontal, vertical) for 4x4->32x32
- [ ] Unit tests for each derivation
