# Architecture Decisions

## AD-001 : Bit depth — Runtime, pas templates

**Contexte** : Le plan mentionne "templates pour le bit depth (8/10/16)". Deux approches possibles :
- Template `<int BitDepth>` : specialisation compile-time, performance max, code duplique
- Runtime `int bit_depth` : un seul chemin de code, plus simple, branchement runtime

**Decision** : Runtime avec `uint16_t` comme type de sample universel.

**Justification** :
- Le Main profile (Phase 4-6) est 8-bit only. Pas besoin de templates avant Phase 7
- `uint16_t` contient 8-bit et 10-bit sans surcharge
- La performance viendra du SIMD (Phase 9), pas des templates
- Moins de code = moins de bugs de conformite

**Consequence** : `Pixel = uint16_t` partout. Les shifts/clips utilisent `BitDepth` en runtime.

## AD-002 : Picture layout — Planar (separate planes)

**Decision** : 3 buffers separes Y, Cb, Cr avec stride independant.

**Justification** :
- La spec traite chaque composante independamment
- Le deblocking et SAO operent plan par plan
- L'interpolation chroma a des dimensions differentes
- Les filtres SIMD preferent les donnees contiguees par plan

**Structure** :
```cpp
struct Picture {
    std::vector<uint16_t> planes[3];  // Y=0, Cb=1, Cr=2
    int width[3], height[3];           // dimensions par plan
    int stride[3];                     // stride par plan (en samples)
    int bit_depth;
    int chroma_format_idc;             // 1=420, 2=422, 3=444
    int poc;
};
```

## AD-003 : Parameter set ownership — Stored by value, indexed by ID

**Decision** : `std::array<std::optional<VPS>, 16>` pour les VPS, idem SPS (16 max), PPS (64 max).

**Justification** :
- Les IDs sont bornes par la spec (VPS: 0-15, SPS: 0-15, PPS: 0-63)
- Pas besoin de map dynamique
- Copie complete a chaque mise a jour (les PS sont petits)
- Le slice header reference le PPS actif par ID

## AD-004 : Error handling — Assertions en debug, codes d'erreur en release

**Decision** :
- Debug : `assert()` + `HEVC_DEBUG` logging pour tracer les valeurs intermediaires
- Release : fonctions retournent `bool` ou `enum HEVCError`
- Pas d'exceptions C++ (requis pour l'API C WASM)

## AD-005 : CABAC — Struct of arrays pour les contextes

**Decision** : Tous les contextes dans un seul tableau flat, indexes par ctxIdx global.

```cpp
struct CabacContext {
    uint8_t pStateIdx;
    uint8_t valMps;
};

struct CabacEngine {
    CabacContext contexts[256];  // tous les contextes
    uint16_t ivlCurrRange;
    uint16_t ivlOffset;
    BitstreamReader* bs;
};
```

**Justification** :
- Acces O(1) par ctxIdx
- Init simple (boucle sur le tableau)
- Save/restore pour WPP en un memcpy

## AD-006 : Intermediate buffers — Stack-allocated, taille max CTU

**Decision** : Les buffers temporaires (prediction, residual, transform) sont alloues sur la stack avec la taille max du CTU (64x64).

```cpp
// Dans la fonction de decodage d'un CU :
int16_t pred_samples[64 * 64];
int16_t residual[64 * 64];
int32_t transform_buf[64 * 64];  // precision etendue pour transform
```

**Justification** :
- Pas d'allocation dynamique dans le hot path
- 64*64*4 = 16KB par buffer, ~48KB total — acceptable sur la stack
- WASM : la stack par defaut Emscripten est ~64KB (le heap est extensible, pas la stack). Prevoir `-sSTACK_SIZE=1048576` en Phase 8, ou restructurer pour allouer les buffers au niveau CTU

## AD-007 : DPB — L'appelant décide de l'enveloppe mémoire, le décodeur ne libère qu'au bump

**Contexte** : Un buffer d'image n'est recyclé que lorsqu'elle n'est ni référence ni
en attente de sortie. `drain()` n'évince pas lui-même : il retourne des `Picture*`
bruts qui doivent rester valides jusqu'au prochain `feed()`. L'éviction est donc
différée à `alloc_picture()`.

Conséquence : un appelant qui enchaîne les `feed()` avant de drainer retient une
image par frame décodée (~24 Mo en 4K), et la longueur de segment qu'il peut
traiter devient bornée par le plafond WASM de 2 Go.

**Décision** : Ne pas faire évincer `drain()`, et exiger des appelants qu'ils
alternent `feed()` / `drain()`. Le wrapper JS copie les plans hors du tas WASM,
donc drainer tôt ne coûte rien.

**Justification** :
- Faire évincer `drain()` invaliderait les pointeurs qu'il vient de retourner
- L'API batch (`decode()` + `get_frame(i)`) a besoin de la rétention : c'est son
  contrat, pas une fuite
- Déplacer la décision chez l'appelant garde un seul modèle mémoire pour les deux

**Conséquence** : `DPB::drain` est appelé une fois par image et non une fois par
segment, ce qui met ses conditions §C.5.2.2 sur le chemin critique. Elles doivent
donc exclure l'image courante (le processus s'applique avant son stockage) et
mesurer le remplissage du DPB en buffers occupés — un compteur qui décroît à
mesure qu'on bump. Avec `pictures_.size()`, qui ne décroît jamais, la condition
reste vraie et vide tout le DPB en ordre de décodage.

Enveloppe chiffrée et garde-fous : `docs/memory-envelope.md`.
