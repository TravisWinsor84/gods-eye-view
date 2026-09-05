# Task 3 fix round 5 targeted final verification

## Findings

None.

## Requested verification

- **Current live capped parking membership and order:** clean. A fresh provider
  export returned 6,324 sensor rows and 5,072 bay rows, producing 4,825 joined
  rows. Querying the Melbourne extent with `maxFeatures: 1000` returned 1,000
  features with `capped: true`. The complete result was identical after
  reversing sensors alone, bays alone, and both inputs. Sorting public-ID groups
  before applying the cap at `src/data/melbourneCivicSources.js:348-365` removes
  the prior cross-group provider-order dependency.
- **Synthetic capped parking membership and order:** clean. The focused
  1,005-row regression at `src/data/melbourneCivicSources.test.mjs:146-174`
  returned the same ordered 1,000 public IDs after reversing both provider
  tables.
- **Conflicting duplicate sensors:** clean. Selection at
  `src/data/melbourneCivicSources.js:256-283` ranks the latest finite observation
  timestamp, then the latest finite row update, then ascending canonical row
  content. The focused regression and an independent reversal probe covered all
  three tie-break stages; both directions emitted the same three occupied
  results.
- **Public-ID key exclusion:** clean. `src/data/melbourneCivicSources.js:116-127`
  derives the digest only from source, dataset, coordinates, and public
  properties. An independent 20,000-candidate `kerbsideid` enumeration produced
  one invariant public ID, and no key text or key-derived transform appeared in
  the public feature.

## Exact verification

- Scope inspected: `80a79d8..aa23b708ece5d1f0cd46cd8c82c5ec59355b7d02`,
  limited to the sole prior parking determinism finding in
  `task-3-rereview-4.md`.
- `node --test src/data/melbourneCivicSources.test.mjs` passed 31 tests, 0
  failed, 0 skipped.
- Targeted read-only probes covered the current provider exports, independent
  sensor-only, bay-only and combined reversals, a capped 1,000-feature query,
  all duplicate-sensor tie-break stages, and 20,000 parking-key candidates.
- `git diff --check 80a79d8..aa23b708ece5d1f0cd46cd8c82c5ec59355b7d02`
  passed.
- The worktree was clean before review. Only this requested review artifact was
  added; no product source, tests, commits, pushes, deployments, accounts,
  credentials or provider configuration changed.

## Verdict

**PASS.** The sole prior finding is fixed: capped live and synthetic parking
membership and order are invariant to sensor and bay input reversal,
conflicting duplicate sensors resolve deterministically under reversal, and
public IDs remain independent of provider keys.
