# Task 3 report — Melbourne parking and civic amenities

## Result

Implementation commits: `47de6284b1a78bbb3d0272756a145f45b1f6e2e5`,
`680177650320dced7a9dfda79b402ea0b6399f42`, and
`a992614b5f77c4b38acd7f8aa3648666ae903b90`.

Task 3 adds fixed, credential-free City of Melbourne Opendatasoft v2.1
adapters and regional proxy routes for:

- `melbourne-drinking-fountains`;
- `melbourne-barbecues`;
- `melbourne-parking-live`;
- `melbourne-development`; and
- `melbourne-culture` (outdoor artworks plus public memorials/sculptures).

No category-pack membership was added; that remains Task 6. Nothing was pushed
or deployed.

## TDD evidence

The initial RED run failed because the source-specific module, registry
contracts, proxy delegation and City of Melbourne UI credit did not exist.
Subsequent RED/GREEN cycles covered:

- per-sensor five-minute stale transitions and the non-availability caveat;
- strict civic/development/culture field allow-lists and bounded text;
- provider-wide parking download coalescing and source-local last-good tables;
- honest partial/capped/unavailable status;
- exact-at-cap results that must remain current;
- early streaming byte-cap cancellation and a shared aggregate byte budget;
- the cached kerbside join and 0.05-degree spatial index; and
- expiry of stale last-good parking data after ten minutes.

The live contract check rejected the plan's provisional `within_box(...)`
syntax and records pagination beyond 10,000. The corrected implementation uses
the documented ODSQL `in_bbox(...)` predicate for spatial sources and exactly
two fixed v2.1 `exports/json` downloads for the provider-wide parking tables.

## Runtime boundaries

- Browser input remains only an allow-listed source ID and validated bbox.
- Parking makes one sensor export request and one non-null bay-geometry export
  request per two-minute provider refresh, independent of viewport.
- Parking exports have 4 MiB per-table, 32 MiB aggregate, 8,000 sensor-row and
  32,000 bay-row ceilings. The join and spatial index are cached with the
  downloaded tables; viewport calls filter the index after the join.
- Parking output preserves exact `status_timestamp`, sensor `lastupdated` and
  bay `lastupdated`. `Present` and `Unoccupied` become observation labels only;
  no `available` property or legality claim is emitted.
- Rows without joined bay geometry are omitted. Provider row keys are used only
  for server-side joins, stable paging, true-row deduplication and internal
  ordering of records whose public projections are identical. They are never
  returned or included in a public-ID digest. Public feature-ID bases digest
  only the fixed source/dataset name, normalized returned properties and point
  coordinates. Identical public projections are internally sorted by opaque
  source key and receive stable ordinal suffixes (`-2`, `-3`, and so on); the
  suffix is not a hash or other transform of that key.
- Fountains/barbecues omit asset, contract, manager, maintenance, model and
  full location-description fields. Development omits development/property/
  application IDs and full addresses. Culture keeps only bounded public
  title/type/date metadata.
- Partial datasets and retained pages stay source-local. Last-good ceilings are
  ten minutes for parking, 72 hours for daily fountains/barbecues, and thirty
  days for monthly/unknown-cadence development and culture reference sources.
- Public memorials use one provider-wide official JSON export, capped at 2 MiB
  and 2,000 rows, cached for six hours and indexed in 0.05-degree cells before
  bbox filtering. They do not use non-total offset ordering.
- Exact City of Melbourne CC BY 4.0 attribution is registered in the actual
  Cesium data-attribution surface.

## Live official smoke — 2026-09-05

Melbourne bbox: west `144.9`, south `-37.9`, east `145`, north `-37.8`.

| Source | Normalized count | Status | Upstream requests |
| --- | ---: | --- | ---: |
| Drinking fountains | 245 | current | 3 bounded record pages |
| Public barbecues | 44 | current | 1 bounded record page |
| Parking sensors/bays | 1,000 | partial/capped | 2 provider-wide exports |
| Development activity | 1,000 | partial/capped | 10 bounded record pages |
| Culture | 319 | current | 2 bounded artwork record pages + 1 memorial export |

The parking downloads contained 6,324 sensors and 5,072 bays with non-null
join keys. The sampled/capped Melbourne response had maximum
`status_timestamp` `2026-09-05T06:07:49+00:00`; 994 of its 1,000 records were
individually stale. This confirms why whole-feed freshness cannot be inferred
from an arbitrary or maximum row.

## Fresh verification

- Focused Task 3 plus regional/credit suites: 74 passed, 0 failed.
- Full `npm test`: 2,822 passed, 0 failed, 1 expected skip. The skipped
  allocation microbenchmarks are calibrated for Node 24; verification ran on
  Node 26.8.1.
- `npm run build`: passed; Vite transformed 162 modules.
- `git diff --check`: passed.

Independent review and Task 6 browser-visible category integration remain
separate gates.

## Independent-review fixes — current contract

The three fix rounds resolve the findings from `task-3-review.md`,
`task-3-rereview-1.md`, and `task-3-rereview-2.md`:

- each parking table now carries its immutable `lastSuccessfulAt`; a successful
  sibling refresh cannot renew an inherited failed table, and either table is
  removed from joins after the ten-minute last-good ceiling;
- duplicate kerbside bays are retained as candidates and selected by nearest
  valid sensor coordinate, then latest finite provider update, then a stable
  deterministic tie key. The live `17212` shape selects the near-sensor
  Berkeley geometry without returning the provider ID or road address;
- aggregate parking status now counts current and stale observations. Mixed
  results are partial and an all-stale result is stale, producing a degraded
  proxy header rather than a fresh claim;
- one FIFO semaphore now limits actual GA, Melbourne civic, PTV and existing
  regional provider fetch/read operations to four. Permit transfer is atomic,
  queued requests start their timeout only after acquiring a slot, and PTV
  retains its permit through complete body consumption and decode. Status,
  read, decode and timeout failures all release capacity;
- civic responses must use `application/json` or an application `+json`
  variant. Wrong media types are rejected before body parsing or caching;
- every offset-paginated spatial dataset uses a live-validated fixed unique
  `order_by`. Internal `assetid`, `development_key`, and `asset_id` fields are
  selected only for stable internal identity and are never normalized,
  emitted, or hashed into public IDs. True repeated source rows deduplicate by
  those keys while distinct same-site development rows survive. Public
  memorials use the single bounded cached export/index path described above.
  The privacy and cadence contracts are stated once in Runtime boundaries
  above.

### Fresh live smoke — 2026-09-05

The same Melbourne bbox returned 245 fountains (current), 44 barbecues
(current), 1,000 development points (partial/capped with zero duplicate source
keys), 319 culture points (current), and 1,000 parking points (partial/capped;
997 stale and 3 current observations). The earlier 991 development count was
caused by the now-removed public-spatial-identity collapse and is superseded.
The memorial export returned both same-title/same-description `Painted Poles`
records at distinct coordinates and with distinct generated IDs.

### Fresh verification after fix round 1

- Focused Task 3 plus shared proxy/GA/PTV concurrency suites: 110 passed, 0
  failed.
- Full `npm test`: 2,832 passed, 0 failed, 1 expected skip. The skipped
  allocation microbenchmarks remain calibrated for Node 24; verification ran
  on Node 26.8.1.
- `npm run build`: passed; Vite transformed 162 modules.
- `git diff --check`: passed.

No pack membership, push, deployment, account, credential or provider mutation
was performed. Independent re-review remains the next gate.

### Fresh verification after fix round 2

- RED-first regressions reproduced distinct development-row collapse, unstable
  memorial pagination and eight concurrent mixed PTV/GA/civic requests.
- Focused Task 3 plus shared proxy/GA/PTV concurrency suites: 114 passed, 0
  failed.
- Full `npm test`: 2,836 passed, 0 failed, 1 expected skip. The skipped
  allocation microbenchmarks remain calibrated for Node 24; verification ran
  on Node 26.8.1.
- `npm run build`: passed; Vite transformed 162 modules.
- `git diff --check`: passed.
- Live safe smoke: 1,000 development features (`partial`/capped, zero duplicate
  source keys), 319 culture features (`current`), and two distinct `Painted
  Poles` records with distinct public IDs.

No pack membership, push, deployment, account, credential or provider mutation
was performed. Independent re-review remains the next gate.

### Fresh verification after fix round 3

- RED-first regressions reproduced the enumerable opaque-key public IDs and
  key-derived collision IDs before the implementation changed.
- Public feature-ID bases now derive only from normalized public properties,
  coordinates and fixed source/dataset names. Opaque keys remain internal to
  deduplication and ordering; identical public projections receive stable
  ordinal suffixes after opaque-key sorting.
- The observed culture retrieval used two bounded outdoor-artwork
  record pages plus one bounded, cached provider-wide memorial JSON export.
- Focused Task 3 plus shared proxy/GA/PTV concurrency suites: 116 passed, 0
  failed.
- Full `npm test`: 2,838 passed, 0 failed, 1 expected skip. The skipped
  allocation microbenchmarks remain calibrated for Node 24; verification ran
  on Node 26.8.1.
- `npm run build`: passed; Vite transformed 162 modules.
- `git diff --check`: passed.

No pack membership, push, deployment, account, credential or provider mutation
was performed. Independent re-review remains the next gate.

### Fresh verification after fix round 4

- RED-first regressions showed 20,000 enumerable `kerbsideid` candidates each
  produced a distinct public parking ID under the old implementation.
- Parking public-ID bases now digest only normalized returned properties,
  coordinates and fixed source metadata. `kerbsideid` remains internal to the
  sensor/bay join, true-source deduplication and collision-group ordering; it
  is never emitted or hashed into a public ID.
- Distinct parking rows with identical public projections receive stable
  ordinal suffixes after internal key ordering, while a repeated source row is
  emitted once.
- The observed 319-feature culture smoke made exactly two bounded artwork
  record requests plus one bounded, cached provider-wide memorial JSON export.
- Restoring the projection-based implementation passed the focused Melbourne
  civic suite 29/29. The final six-suite Task 3/shared proxy/GA/PTV command
  passed 118/118.
- Full `npm test` passed 2,840 tests with 0 failures and 1 expected skip. The
  skipped allocation microbenchmarks remain calibrated for Node 24;
  verification ran on Node 26.8.1.
- `npm run build` passed; Vite transformed 162 modules.
- `git diff --check` passed.

No pack membership, push, deployment, account, credential or provider mutation
was performed. Independent re-review remains the next gate.

### Fresh verification after fix round 5

- RED-first regressions reproduced both remaining order dependencies. Reversing
  1,005 realistic sensor/bay rows changed the capped 1,000-feature membership
  and ordering, while reversing conflicting duplicate sensors changed emitted
  statuses and public IDs.
- Duplicate sensor rows for one internal kerbside identity now select one
  deterministic winner before bay matching: latest finite `status_timestamp`,
  then latest finite `lastupdated`, then ascending canonical row serialization.
- Parking projection groups are globally sorted by public base ID, then by
  internal identity within an identical-projection group. `maxFeatures` is
  applied only after that ordering. Internal kerbside identities remain absent
  from public properties and public-ID digests.
- Existing nearest-bay, stable ordinal-ID and 20,000-candidate parking privacy
  regressions remained green.
- Focused Melbourne civic suite: 31 passed, 0 failed. Final six-suite Task
  3/shared proxy/GA/PTV command: 120 passed, 0 failed.
- Full `npm test`: 2,842 passed, 0 failed, 1 expected skip. The skipped
  allocation microbenchmarks remain calibrated for Node 24; verification ran
  on Node 26.8.1.
- `npm run build`: passed; Vite transformed 162 modules. The existing
  large-chunk advisory was emitted.
- `git diff --check`: passed.

No pack membership, push, deployment, account, credential or provider mutation
was performed. Independent re-review remains the next gate.
