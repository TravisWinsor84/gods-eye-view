# Final-gap Task 1 report - six DataVic WFS sources

Date: 2026-09-05 AEST

## Scope and commits

Task 1 added fixed WFS request contracts, public normalizers, source registry
metadata and proxy admission for:

- `vic-ev-chargers`
- `vic-renewable-facilities`
- `vic-flood-history-2022`
- `vic-epa-priority-sites`
- `vic-landfill-register`
- `vic-recreation-assets`

Commit `689c101` contains the exact type/property request allow-lists. Commit
`4519201` contains exactly the six assigned adapter, registry and proxy source/
test files. It does not include the concurrent waste or Vicmap tasks.

All sources use anonymous HTTPS, WFS 2.0, EPSG:4326 bbox/output CRS, GeoJSON,
fixed `count` plus `maxFeatures`, source-specific public property allow-lists,
deterministic sanitized IDs/order, the shared provider semaphore and finite
source-local last-good windows. They are off by default because no category
pack membership was added in this task.

Provider IDs and the excluded address, free-text, comment, notice, licence,
reference, raw-coordinate, serial/photo and external-link fields are never
copied to output. Every source carries `State of Victoria (DataVic)` credit and
an explicit reference/historical meaning that prevents live operational or
safety inference.

## Flood-specific bounds

The committed flood path retains the global attack boundaries for other OGC
sources and adds source-only limits:

- one feature per WFS request;
- 1,500,000 response bytes;
- 60,000 input coordinates per feature and 75,000 per response;
- 4,000 output coordinates per feature; and
- 500,000 topology comparisons.

Input topology is validated before deterministic ring reduction and output is
validated again. Simplification marks source status `partial`; feature-local
invalid geometry is omitted while response-wide byte, coordinate, nesting and
topology exhaustion remains fatal.

## TDD and automated evidence

The new request tests first failed on unknown source IDs. Public normalizer,
registry and proxy tests then failed on heritage fallback/404 behavior. Flood
tests first failed because the 56,001-coordinate fixture left no valid feature
and because a 1.6 MB flood body passed the shared 2 MB cap. After the bounded
implementation, the focused command passed:

`node --test src/data/ogcRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Result at implementation checkpoint: 98 passed, 0 failed, 0 skipped.

## Live proxy smoke

The actual `createRegionalProxy()` middleware was invoked sequentially against
the official WFS with bbox `140.9,-39.3,150,-33.9` on 2026-09-05. The harness
captured the upstream byte count before rebuilding an equivalent response for
the production capped reader. Values below are from that run.

| Source | HTTP/header | Upstream bytes | Output features/bytes | Source status |
|--------|-------------|----------------|-----------------------|---------------|
| `vic-ev-chargers` | 200 / fresh / MISS | 61,214 | 152 / 83,938 | current; 152 coordinates; 0 invalid; 0 duplicate |
| `vic-renewable-facilities` | 502 / sanitized invalid data | 509,437 | none / 49 | failed bounded topology validation |
| `vic-flood-history-2022` | 502 / sanitized invalid data | 1,347,612 | none / 49 | selected feature rejected before simplification |
| `vic-epa-priority-sites` | 200 / degraded / MISS | 45,477 | 66 / 58,246 | partial; 69 matched; 3 invalid; 0 duplicate; 857 output coordinates |
| `vic-landfill-register` | 200 / degraded / MISS | 343,257 | 275 / 388,550 | partial; 277 matched; 1 invalid; 1 duplicate; 8,586 output coordinates |
| `vic-recreation-assets` | 200 / degraded / MISS | 390,131 | 996 / 563,410 | partial/capped; 3,173 matched; 0 invalid; 4 duplicate; 996 output coordinates |

All four successful responses omitted the tested private/unsafe fields and used
only stable public IDs. Partial/capped outcomes were surfaced as degraded; they
were not mislabeled fresh/current.

## Live blockers found

The live smoke is not a six-source pass.

For renewables, 247 of 252 features normalize individually. Three fail sibling
multipolygon topology, one fails polygon topology, and one otherwise complex
feature exhausts the 150,000-comparison source path. In the collection that
response-wide exhaustion correctly fails closed, so no useful 247-feature
partial layer is currently returned.

For flood history, the selected feature has 87 polygons, 1,410 rings and 56,522
coordinates. It is under the source byte and coordinate ceilings but exceeds
the inherited 512-ring cap. Preserving 1,410 closed rings requires at least
5,640 coordinates, so the current 4,000-output-coordinate target cannot be met
without dropping topology. The correct follow-up is a reviewed source-specific
ring/output contract; silently deleting rings or claiming a live pass is not
acceptable.

Source/test files were not changed after these findings because ownership was
explicitly handed to the concurrent waste-source integration. The findings are
recorded here for the next bounded fix/review.

## Final verification

The full suite was run twice after the six-file implementation commit. Both
runs were against a moving shared worktree while the separate Vicmap Task 3
source/tests were untracked and under active implementation. The latest run
failed two Vicmap-only tests because `normalizeVicmapPropertyPayload` and its
501-feature overflow behavior were still undefined. No Task 1 test failed, and
those unrelated files were not modified. This is not recorded as a repository-
wide green suite.

`npm run build` passed with Vite 6.4.3, 163 modules transformed, and the existing
large-chunk advisory. `git diff --check` passed. The earlier isolated Task 1
focused suite passed 98/98 before the waste/Vicmap integrations changed shared
state.

No push or deployment occurred.
