# Chapter 8 — Decoding Process (Index)

This chapter describes the complete decoding process, from the parsed syntax elements to the reconstructed samples.

## Structure

| Section | File | Content | Phase |
|---------|---------|---------|-------|
| 8.3 | `08-03-reference-pictures.md` | Ref pic management, DPB, POC | 5 |
| 8.4 | (inline 8.6) | Quantization matrices | 4 |
| 8.5.3 | `08-04-inter-prediction.md` | Motion compensation, interpolation | 5 |
| 8.5.4 | `08-05-intra-prediction.md` | 35 intra modes (DC, Planar, Angular) | 4 |
| 8.6 | `08-06-transform-quant.md` | Inverse transform, dequant, scaling | 4 |
| 8.7.2 | `08-07-deblocking.md` | Deblocking filter | 6 |
| 8.7.3 | `08-08-sao.md` | Sample Adaptive Offset | 6 |

## CU decoding pipeline

```
+------------------+
| Syntax Parsing   | (CABAC -> syntax elements)
| (Chapter 7+9)    |
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+--------+ +--------+
| Intra  | | Inter  |  Prediction
| 8.5.4  | | 8.5.3  |
+---+----+ +---+----+
    |          |
    +----+-----+
         | predSamples[x][y]
         v
+------------------+
| Transform Inverse|  8.6.2-4
| + Dequant        |  8.6.1-3
+--------+---------+
         | resSamples[x][y]
         v
+------------------+
| Reconstruction   |  recSamples = Clip(predSamples + resSamples)
+--------+---------+
         |
         v  (after all the CUs of the picture)
+------------------+
| Deblocking       |  8.7.2
+--------+---------+
         |
         v
+------------------+
| SAO              |  8.7.3
+--------+---------+
         |
         v
+------------------+
| DPB Storage      |  Frame ready for output/reference
+------------------+
```

## Convention

Each 08-xx file contains:
1. The spec pseudo-code for each sub-process
2. The corresponding C++ translation
3. The edge cases and pitfalls identified
4. The validation checklist
