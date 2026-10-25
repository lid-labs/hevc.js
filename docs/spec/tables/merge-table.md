# Merge Candidate Combination Table

Complete table of pairs for the combined bi-predictive merge candidates (spec ITU-T H.265, Table 8-8).

## Table 8-8 — combIdx to l0CandIdx and l1CandIdx

Used in §8.5.3.2.4 to generate the combined bi-predictive candidates from the existing uni-directional candidates.

```cpp
// Max number of combinations to test
// numOrigMergeCand * (numOrigMergeCand - 1) possible pairs
// but we stop as soon as numMergeCand == MaxNumMergeCand

struct MergeCombination {
    int l0CandIdx;
    int l1CandIdx;
};

// Table ordered by combIdx (for MaxNumMergeCand = 5)
const MergeCombination mergeCombTable[] = {
    { 0, 1 },  // combIdx 0
    { 1, 0 },  // combIdx 1
    { 0, 2 },  // combIdx 2
    { 2, 0 },  // combIdx 3
    { 1, 2 },  // combIdx 4
    { 2, 1 },  // combIdx 5
    { 0, 3 },  // combIdx 6
    { 3, 0 },  // combIdx 7
    { 1, 3 },  // combIdx 8
    { 3, 1 },  // combIdx 9
    { 2, 3 },  // combIdx 10
    { 3, 2 },  // combIdx 11
};
```

## Generation algorithm

```cpp
void generateCombinedBiPredCandidates(
    MergeCandidate* mergeCandList,
    int& numMergeCand,
    int MaxNumMergeCand,
    int numOrigMergeCand
) {
    // B-slices only
    int combIdx = 0;
    int numCombinations = numOrigMergeCand * (numOrigMergeCand - 1);

    for (combIdx = 0;
         combIdx < numCombinations && numMergeCand < MaxNumMergeCand;
         combIdx++)
    {
        int l0CandIdx = mergeCombTable[combIdx].l0CandIdx;
        int l1CandIdx = mergeCombTable[combIdx].l1CandIdx;

        if (l0CandIdx >= numOrigMergeCand || l1CandIdx >= numOrigMergeCand)
            continue;

        MergeCandidate& l0Cand = mergeCandList[l0CandIdx];
        MergeCandidate& l1Cand = mergeCandList[l1CandIdx];

        // Condition: the ref pics must be different
        // so that the combined candidate brings new information
        if (l0Cand.predFlagL0 == 1 && l1Cand.predFlagL1 == 1) {
            if (RefPicList0[l0Cand.refIdxL0] != RefPicList1[l1Cand.refIdxL1] ||
                l0Cand.mvL0 != l1Cand.mvL1)
            {
                MergeCandidate combined;
                combined.predFlagL0 = 1;
                combined.predFlagL1 = 1;
                combined.mvL0 = l0Cand.mvL0;
                combined.refIdxL0 = l0Cand.refIdxL0;
                combined.mvL1 = l1Cand.mvL1;
                combined.refIdxL1 = l1Cand.refIdxL1;

                mergeCandList[numMergeCand++] = combined;
            }
        }
    }
}
```

## Zero MV Candidates (padding)

After the combined bi-pred candidates, if `numMergeCand < MaxNumMergeCand`, zero MV candidates are added:

```cpp
void addZeroMVCandidates(
    MergeCandidate* mergeCandList,
    int& numMergeCand,
    int MaxNumMergeCand,
    int numRefFrames
) {
    int zeroIdx = 0;
    while (numMergeCand < MaxNumMergeCand) {
        MergeCandidate zero;
        zero.predFlagL0 = 1;
        zero.predFlagL1 = (slice_type == B) ? 1 : 0;
        zero.mvL0 = { 0, 0 };
        zero.mvL1 = { 0, 0 };
        zero.refIdxL0 = min(zeroIdx, numRefFramesL0 - 1);
        zero.refIdxL1 = (slice_type == B) ? min(zeroIdx, numRefFramesL1 - 1) : -1;

        mergeCandList[numMergeCand++] = zero;
        zeroIdx++;
    }
}
```
