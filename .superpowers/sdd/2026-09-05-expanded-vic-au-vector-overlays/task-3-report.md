# Task 3 report — Melbourne parking and civic amenities

## Result

Implementation commit: `47de6284b1a78bbb3d0272756a145f45b1f6e2e5`

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
- Rows without joined bay geometry are omitted. Provider IDs are used only for
  the server-side join and never returned; public feature IDs are generated
  digests.
- Fountains/barbecues omit asset, contract, manager, maintenance, model and
  full location-description fields. Development omits development/property/
  application IDs and full addresses. Culture keeps only bounded public
  title/type/date/locality/description metadata.
- Partial datasets and retained pages stay source-local. Last-good ceilings are
  ten minutes for parking, seven days for weekly civic assets, and thirty days
  for monthly/unknown-cadence reference sources.
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
