# Task 3 fix round 3 independent re-review

## Findings

1. **[P2] Parking public feature IDs still expose the provider `kerbsideid` through cheap enumeration.**
   `src/data/melbourneCivicSources.js:236-259` validates the sensor/bay join with
   `kerbsideid`, then emits `stableHash(kerbsideid|coordinates)` as the public
   feature ID. `stableHash` is an unsalted 32-bit FNV transform at
   `src/data/melbourneCivicSources.js:88-95`; numeric kerbside IDs are a small,
   structured candidate space. A fresh read-only probe generated
   `melbourne-parking-35c4f08f` for key `17212` at `[144.95, -37.85]` and
   recovered `17212` by testing candidates 1 through 20,000 in 15.246 ms. The
   round-3 regression at `src/data/melbourneCivicSources.test.mjs:189-207`
   exercises only development IDs, so it does not cover this separate public-ID
   path. This leaves the report's broad statement that provider row keys are
   never included in a public-ID digest false at
   `.superpowers/sdd/2026-09-05-expanded-vic-au-vector-overlays/task-3-report.md:52-59`.

2. **[P3] The corrected live-smoke table still reports the wrong artwork request count.**
   `.superpowers/sdd/2026-09-05-expanded-vic-au-vector-overlays/task-3-report.md:77-83`
   says the 319-feature culture smoke used three bounded artwork record pages
   plus one memorial export. The default client page size is 100 at
   `src/data/melbourneCivicSources.js:497-507`, and the loader stops once its
   requested offset reaches `total_count` at
   `src/data/melbourneCivicSources.js:687-713`. A fresh read-only execution of
   the exact client and documented Melbourne bbox returned the same 319 current
   features but made only two artwork calls (`offset=0` and `offset=100`, both
   `limit=100`) and one memorial export. The official artwork response currently
   reports `total_count=178`, confirming two pages. The memorial contract itself
   is now accurate: the same run made exactly one
   `/public-memorials-and-sculptures/exports/json` request, and the independent
   response check returned HTTP 200, `application/json; charset=utf-8`, 17,066
   bytes, and 163 array rows.

## Requested correctness checks

- **Civic asset/development/culture public IDs:** clean. The base ID at
  `src/data/melbourneCivicSources.js:125-137` digests only the fixed source and
  dataset plus canonical public coordinates/properties. An independent probe
  changed `assetid`, `development_key`, and `asset_id` while holding each public
  projection fixed; IDs remained unchanged for fountains, barbecues,
  development, and outdoor artwork. Finding 1 is the remaining parking path.
- **Identical public projections:** clean for the round-3 path. At
  `src/data/melbourneCivicSources.js:417-440`, true source identities deduplicate,
  equal base-ID entries sort by internal identity, and stable ordinals are
  assigned. Three input permutations of three distinct equal-projection
  development rows plus one repeated source row always emitted the same base,
  `-2`, and `-3` IDs in the same order.
- **Data preservation/deduplication:** clean for the changed civic grouping.
  The independent probe retained all three distinct source rows, removed only
  the repeated row, and respected a two-feature cap. The existing same-site
  development regression also passed and retained both distinct records while
  counting two repeated page rows as duplicates.
- **Memorial retrieval:** clean in code. `src/data/melbourneCivicSources.js:627-667`
  uses one bounded export snapshot, a six-hour cache/in-flight coalescing, an
  independently sorted/deduplicated spatial index, and bbox filtering after the
  export. Finding 2 concerns the report's artwork page count, not a surviving
  memorial pagination path.

## Exact verification

- Scope inspected: `9737fbf..b95e7dfe06b4940bcb7a11608b496300dd522395`,
  current `src/data/melbourneCivicSources.js`,
  `src/data/melbourneCivicSources.test.mjs`, `task-3-report.md`, and
  `task-3-rereview-2.md`.
- Focused affected command passed 116 tests, 0 failed, 0 skipped:
  `node --test src/data/melbourneCivicSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalSources.test.mjs src/data/dataCredits.test.mjs src/data/gaRegionalSources.test.mjs src/data/transportVicGtfs.test.mjs`.
- `git diff --check 9737fbf..b95e7dfe06b4940bcb7a11608b496300dd522395`
  passed.
- Read-only probes confirmed the parking-key enumeration, civic key invariance,
  permutation-stable ordinal IDs, distinct-row retention, repeated-row
  deduplication, cap behavior, the live two-artwork-page/one-memorial-export
  request shape, and the current official memorial response metadata.
- The worktree was clean before review. Only this requested review artifact was
  added; no product source, tests, commits, pushes, deployments, accounts,
  credentials, or provider configuration changed.

## Verdict

**FAIL — one P2 public-ID privacy defect and one P3 evidence-report accuracy
defect remain.** The round-3 civic projection/ordinal implementation resolves
the development/asset key transform and preserves distinct identical public
projections without deduplication loss. The fix is not complete across all
public feature IDs because parking still exposes `kerbsideid` by enumeration,
and the report still overstates the artwork page count.
