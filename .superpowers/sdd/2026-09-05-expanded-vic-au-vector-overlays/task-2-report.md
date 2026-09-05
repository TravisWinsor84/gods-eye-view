# Task 2 implementation report

## Outcome

Implemented the three accepted Geoscience Australia reference-source families
from base `3b718a1` in commit `fa88838`:

- `au-emergency-facilities`: ambulance, other emergency management, policing,
  metropolitan fire, rural/country fire and SES sublayers;
- `au-health-facilities`: general practice, hospital and pharmacy sublayers;
- `au-place-names`: Composite Gazetteer of Australia.

The registry, fixed ArcGIS request builder, sanitizer, paginated proxy path,
source status, cache semantics, source credits and catalogue are implemented.
No source was added to a visible layer or pack; that remains Task 6. Nothing was
pushed or deployed.

## Safety and data contract

- Browser input remains an allow-listed source ID plus validated bbox only.
- Requests fix the official service and layer, `f=geojson`, envelope geometry,
  `inSR=4326`, `outSR=4326`, `returnGeometry=true` and source-specific
  `outFields`.
- Each sublayer is bounded to two 500-feature pages, each response to 1 MiB,
  and each normalized source response to 1,000 features.
- Output omits ArcGIS object IDs, G-NAF IDs, Healthdirect service IDs,
  authority IDs, comments, contacts, postcodes and full street addresses.
- Facility output is explicitly `referenceOnly` with freshness class
  `reference`; no capacity, wait, staffing, readiness, dispatch, opening,
  routing, medicine-stock or medical-advice claim is derived.
- Partial sublayer failures retain successful cohorts, expose only sanitized
  degraded status and retain that status on cache hits. All-layer timeouts,
  oversized responses and malformed pages fail closed.
- Exact live layer-level GA, CC BY 4.0 and incorporated G-NAF credit strings
  are registered in the Cesium attribution surface and documented.

## TDD evidence

RED was observed before each production slice:

1. the adapter suite failed with `ERR_MODULE_NOT_FOUND` before
   `gaRegionalSources.js` existed;
2. registry/delegation/attribution tests failed on unknown GA source IDs;
3. four proxy tests failed because the GA transport did not exist;
4. cache/degraded, truncated-pagination, all-layer timeout and stop-at-cap
   regressions each failed for their expected missing behavior before the
   corresponding implementation change;
5. attribution tests failed after expectations were corrected to the literal
   live layer metadata, then passed after the production credit strings were
   corrected.

Final focused command:

```text
node --test src/data/gaRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/dataCredits.test.mjs
57 passed, 0 failed
```

## Live provider evidence

Read-only metadata and query smoke tests against the official GA ArcGIS 11.1
services confirmed decimal-degree service units, advertised output CRS handling
and 2,000-record provider maxima. For bbox `144.90,-37.90,145.05,-37.75`:

- emergency facilities normalized 53 features across all six sublayers;
- health facilities normalized 529 features across all three sublayers;
- the gazetteer returned 500 rows with `exceededTransferLimit=true` on page 1;
- the final full proxy smoke returned HTTP 200 with 1,000 sanitized gazetteer
  features in 33.766 seconds and honest `degraded`/`partial`/`capped` status
  because the provider advertised additional rows beyond the application cap.

Only counts, timings, status and sanitized property-key names were printed.
The first full gazetteer smoke exposed that the shared 12-second timeout was too
short for this service; the final contract uses a bounded 30-second per-page
gazetteer timeout and a 20-second per-page facility timeout.

## Verification

```text
npm test
2,793 passed, 0 failed, 1 expected Node-version allocation-benchmark skip

npm run build
passed; Vite transformed 161 modules

git diff --check
passed
```

The build retained the repository's existing large-chunk advisory; it did not
fail. Browser-visible category-layer verification and deployed host verification
remain intentionally pending Task 6 and the explicit push/deploy gate.

## Independent-review fix round 1

The first independent review found five paging, status, concurrency and error
classification defects. Fix round 1 addresses all five without changing source
admission, privacy allow-lists, PTV/EPA behavior, cache coalescing or pack
membership:

- a later-page failure now retains already-normalized page data and reports a
  sanitized `partial` layer error instead of converting the whole source to an
  empty 502;
- the 1,000-feature source cap now makes the aggregate source `partial`, emits a
  degraded response header, and marks later data-bearing layers as explicitly
  `capped` and `unprocessed`;
- an empty ArcGIS page with `exceededTransferLimit=true` advances by the bounded
  requested window and consumes the second and final page allowance;
- a FIFO provider-request gate caps actual GA fetch/read operations at four
  across sublayer fan-out and concurrent source/bbox refreshes, releasing its
  slot on success, failure and timeout abort;
- HTTP 504 is now reserved for all-layer timeouts with no retained feature
  data; mixed timeout/non-timeout failures return the generic sanitized 502.

TDD RED evidence was observed before implementation: the first focused run had
six expected failures covering all five review findings (the concurrency repair
has both ceiling and release regressions). A subsequent mutation check added an
empty-page-then-timeout regression, which failed as 200 instead of 504 before
the retained-feature predicate was corrected.

Fresh fix-round verification:

```text
node --test src/data/gaRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/dataCredits.test.mjs src/data/regionalLayer.test.mjs
80 passed, 0 failed

npm test
2,801 passed, 0 failed, 1 expected Node-version allocation-benchmark skip

npm run build
passed; Vite transformed 161 modules

git diff --check
passed
```

Independent re-review remains pending. Browser-visible category-layer proof is
still Task 6, and nothing has been pushed or deployed.
