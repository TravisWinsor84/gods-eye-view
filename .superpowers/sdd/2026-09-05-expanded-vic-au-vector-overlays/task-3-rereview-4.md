# Task 3 fix round 4 final independent re-review

## Findings

1. **[P2] Capped parking output is still provider-order dependent, so the
   parking identity pipeline is not deterministic as a whole.**
   `src/data/melbourneCivicSources.js:267-295` inserts joined sensor rows into
   the spatial cells in provider order. The query then preserves first
   encounter order in `entriesByIdentity` and `groups` at
   `src/data/melbourneCivicSources.js:319-335`, and stops at `maxFeatures`
   without globally sorting those identity groups at lines 337-343. A fresh
   read-only probe downloaded the current 6,324 sensor rows and 5,072 joined-bay
   candidates, queried the documented Melbourne bbox with `maxFeatures: 1000`,
   and repeated the query after reversing only the sensor array. Both results
   were capped at 1,000, but only 422 public IDs overlapped: 578 displayed
   features changed solely because input order changed. The new permutation
   regression at `src/data/melbourneCivicSources.test.mjs:119-143` puts every
   row in one identical-public-projection group below the cap, so its internal
   key sort cannot expose this cross-group cap-order defect. The same first-win
   map at lines 324-325 also makes conflicting duplicate sensor rows for one
   kerbside identity order-dependent; a small synthetic reversal switched the
   emitted status and public ID between `vacant` and `occupied`.

## Requested correctness checks

- **Parking key privacy and digest inputs:** clean. The parking normalizer at
  `src/data/melbourneCivicSources.js:227-247` uses `kerbsideid` only to validate
  the sensor/bay join, then calls the common feature builder. The public-ID path
  at `src/data/melbourneCivicSources.js:101-127` digests only fixed
  source/dataset names plus canonical public coordinates/properties. An
  independent 20,000-candidate probe produced one invariant parking base ID;
  neither direct text nor an enumerable key transform was emitted. Opaque keys
  affect only deduplication and stable ordinal assignment within an identical
  public-projection collision group, not the digest.
- **Parking duplicate-bay join selection:** clean for the intended nearest,
  recency and tie path. `src/data/melbourneCivicSources.js:256-298` retains all
  bay candidates and ranks valid geometry by sensor distance, finite update
  recency and a coordinate/text tie. The focused nearest/recency tests
  passed. A live export contained 19 duplicate bay keys; reversing all bay rows
  produced identical uncapped normalized feature content. Finding 1 concerns
  cross-group/duplicate-sensor ordering after the join.
- **Development and civic projection IDs:** clean. The shared public projection
  digest excludes `assetid`, `development_key`, and `asset_id`; source keys stay
  in the separate identity path at `src/data/melbourneCivicSources.js:109-119`
  and grouping at lines 403-437. Independent key-mutation and reversed-input
  probes preserved the same base and ordinal IDs while true source repeats
  deduplicated.
- **Artwork/memorial report accuracy:** clean. The live-smoke table at
  `.superpowers/sdd/2026-09-05-expanded-vic-au-vector-overlays/task-3-report.md:77-83`
  and both later statements at lines 183-184 and 207-208 consistently say two
  artwork record pages plus one memorial export. A fresh live client run
  returned 319 current culture features and observed exactly requests
  `artwork offset=0`, `artwork offset=100`, and one memorial JSON export. No
  contradictory three-artwork-page statement remains.

## Exact verification

- Scope inspected: `b95e7df..80a79d810b8f681150556fe1e9689001155b1d16`,
  current `src/data/melbourneCivicSources.js`,
  `src/data/melbourneCivicSources.test.mjs`, `task-3-report.md`, and
  `task-3-rereview-3.md`.
- Focused affected command passed 118 tests, 0 failed, 0 skipped:
  `node --test src/data/melbourneCivicSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalSources.test.mjs src/data/dataCredits.test.mjs src/data/gaRegionalSources.test.mjs src/data/transportVicGtfs.test.mjs`.
- `git diff --check b95e7df..80a79d810b8f681150556fe1e9689001155b1d16`
  passed.
- Read-only probes covered 20,000 parking-key candidates, parking and
  development key mutation, equal-projection ordinal permutations, current
  duplicate-bay reversal, duplicate-sensor conflict reversal, current capped
  parking order reversal, and the live culture request shape.
- The worktree was clean before review. Only this requested review artifact was
  added; no product source, tests, commits, pushes, deployments, accounts,
  credentials or provider configuration changed.

## Verdict

**FAIL - one P2 parking determinism defect remains.** Parking public IDs no
longer reveal or enumerate `kerbsideid`, no provider key enters a public-ID
digest, civic/development projection IDs remain correct, duplicate-bay joining
is stable for the current provider data, and the report consistently records
two artwork pages plus one memorial export. Task 3 cannot pass the requested
determinism gate while capped parking membership and conflicting duplicate
sensor resolution still depend on provider row order.
