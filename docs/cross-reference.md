# Cross-Reference Index

Mapping entre sections de la spec, fichiers source, docs et tests.

## Comment utiliser

Quand tu travailles sur une section de la spec, ce tableau te dit exactement quels fichiers lire et modifier.

## Index

| Section spec | Sujet | Doc spec | Tables | Source (.h/.cpp) | Test | Phase |
|-------------|-------|----------|--------|------------------|------|-------|
| Annexe B | Byte stream format | `07-03-nal-unit.md` | — | `bitstream/byte_stream.*` | `test_byte_stream.cpp` | 2 |
| §7.3.1 | NAL unit syntax | `07-03-nal-unit.md` | — | `bitstream/nal_unit.*` | `test_nal_unit.cpp` | 2 |
| §7.2 | more_rbsp_data | `07-03-nal-unit.md` | — | `bitstream/bitstream_reader.*` | `test_bitstream_reader.cpp` | 2 |
| §7.4.2.4.4 | AU boundary | `07-03-nal-unit.md` | — | `bitstream/nal_unit.*` | `test_nal_unit.cpp` | 2 |
| §7.3.2.1 | VPS | `07-04-parameter-sets.md` | — | `syntax/vps.*` | `test_vps.cpp` | 3 |
| §7.3.2.2 | SPS | `07-04-parameter-sets.md` | `scaling-list-defaults.md` | `syntax/sps.*` | `test_sps.cpp` | 3 |
| §7.3.2.3 | PPS | `07-04-parameter-sets.md` | — | `syntax/pps.*` | `test_pps.cpp` | 3 |
| §7.3.6 | Slice header | `07-05-slice-header.md` | — | `syntax/slice_header.*` | `test_slice_header.cpp` | 3 |
| Annexe A | Profile/Tier/Level | `07-04-parameter-sets.md` | — | `syntax/profile_tier_level.*` | `test_profile_tier_level.cpp` | 3 |
| §9.3.4 | CABAC arithmetic | `09-parsing.md` | `cabac-arithmetic.md` | `bitstream/cabac.*` | `test_cabac.cpp` | 4 |
| §9.2 | CABAC init | `09-parsing.md` | `cabac-init-values.md` | `bitstream/cabac.*` | `test_cabac.cpp` | 4 |
| §9.3.3 | Binarization | `09-parsing.md` | — | `bitstream/cabac.*` | `test_cabac.cpp` | 4 |
| §7.3.8.1 | slice_segment_data | `07-08-slice-segment-data.md` | — | `syntax/slice_data.*` | `test_slice_data.cpp` | 4 |
| §7.3.8-9 | CTU/CU quad-tree | `07-06-slice-data.md` | — | `syntax/coding_tree.*` | `test_coding_tree.cpp` | 4 |
| §8.4.4 | Intra prediction | `08-05-intra-prediction.md` | `intra-tables.md` | `decoding/intra_prediction.*` | `test_intra.cpp` | 4 |
| §8.6.2 | Scaling (dequant) | `08-06-transform-quant.md` | `scaling-list-defaults.md` | `decoding/transform.*` | `test_transform.cpp` | 4 |
| §8.6.3 | Transform inverse | `08-06-transform-quant.md` | `transform-matrices.md` | `decoding/transform.*` | `test_transform.cpp` | 4 |
| §8.3 | Ref pic management | `08-03-reference-pictures.md` | — | `decoding/dpb.*` | `test_ref_pic_lists.cpp` | 5 |
| §8.5.3 | Inter prediction | `08-04-inter-prediction.md` | `merge-table.md` | `decoding/inter_prediction.*` | `test_inter.cpp` | 5 |
| §8.5.3.2 | Luma interpolation | `08-04-inter-prediction.md` | — | `decoding/inter_prediction.*` | `test_inter.cpp` | 5 |
| §8.7.2 | Deblocking | `08-07-deblocking.md` | — | `filters/deblocking.*` | `test_deblocking.cpp` | 6 |
| §8.7.3 | SAO | `08-08-sao.md` | — | `filters/sao.*` | `test_sao.cpp` | 6 |

## Docs de support

| Doc | Contenu | Quand le lire |
|-----|---------|---------------|
| `MASTER-PLAN.md` | Plan global, dépendances, 23 pièges | Au début de chaque phase |
| `DECISIONS.md` | Choix d'architecture (AD-001 à AD-006) | Avant de créer des structs/interfaces |
| `BACKLOG.md` | Statut et prochaines tâches | Pour savoir quoi faire |
| `docs/spec/test-bitstreams.md` | Mini-bitstreams hex pour les tests | Quand tu écris des tests |
| `docs/oracle/oracle-strategy.md` | Stratégie de validation oracle | Quand tu debuggues un mismatch |
| `docs/phases/phase-XX-*.md` | Détail des tâches par phase | Pendant l'implémentation |
