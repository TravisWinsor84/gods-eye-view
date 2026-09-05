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
  for server-side joins, stable paging and true-row deduplication. They are never
  returned or copied reversibly; public feature IDs contain bounded one-way
  digests, with deterministic collision handling.
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
| Culture | 319 | current | 4 bounded record pages across 2 datasets |

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

The two fix rounds resolve the findings from `task-3-review.md` and
`task-3-rereview-1.md`:

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
  selected only for stable internal identity and are never normalized or
  emitted. True repeated source rows deduplicate by those keys while distinct
  same-site development rows survive. Public memorials use the bounded cached
  export/index path described above. The privacy and cadence contracts are
  stated once in Runtime boundaries above.

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
