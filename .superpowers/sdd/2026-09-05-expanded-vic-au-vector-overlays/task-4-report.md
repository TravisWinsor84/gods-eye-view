# Task 4 report — DEA hotspots and Victorian reference WFS

## Result

Task 4 adds fixed, credential-free OGC WFS adapters and regional proxy routes
for:

- `au-dea-hotspots` (`public:hotspots_three_days`);
- `vic-parks` (`open-data-platform:parkres`);
- `vic-recreation-tracks` (`open-data-platform:recweb_tracks`); and
- `vic-heritage` (`open-data-platform:heritage_register`).

No category-pack membership was added; that remains Task 6. Nothing was pushed
or deployed.

## TDD evidence

The initial RED run passed 58 tests and failed 5 because the OGC adapter module,
four registry entries and proxy routes did not exist. The first GREEN run passed
70/71; its one failure was an invalid test arrangement that exceeded the
existing four-logical-refresh admission guard before exercising the provider
semaphore. The corrected test runs one six-layer GA fan-out plus three OGC
requests and verifies the shared four-request ceiling through full response-body
consumption.

Live smoke then exposed two geometry-shape assumptions: a park ring contained a
consecutive duplicate vertex, and one heritage feature contained 65 polygons
while remaining bounded to 3,491 coordinates. RED regressions reproduced both.
The adapter now removes only consecutive duplicate positions before topology
validation and allows up to 256 polygons while retaining stricter coordinate,
ring and response caps.

A final RED regression reproduced false-current exact-cap results. The live DEA
response reported 2,174 matches/1,000 returned, while heritage reported 645
matches/250 returned. WFS `numberMatched`/`numberReturned` metadata now drives
explicit `partial`/`capped` status.

## Runtime and safety boundaries

- Browser input remains one allow-listed source ID plus a validated bbox.
- Requests use fixed official HTTPS endpoints, type names, public property
  allow-lists, WFS 2.0 `count`, compatible `maxFeatures`, EPSG:4326 bbox/output
  CRS and GeoJSON output.
- Fetch uses `redirect: error`; only JSON/GeoJSON application media types are
  accepted. The shared provider-wide four-request semaphore remains held while
  the response stream is consumed.
- Each response is capped at 2 MB, 1,000 requested features maximum, 50,000
  input coordinates per feature and 100,000 per response. Geometry has fixed
  type/nesting, finite longitude/latitude, polygon closure/cardinality/winding
  and bounded simple-ring topology checks.
- Heritage polygons are validated before deterministic simplification to no
  more than 4,000 coordinates per feature, then closure, winding and
  self-intersection checks run again. Invalid, excessive or topology-changing
  geometry rejects the refresh rather than entering cache.
- Sanitized features are deduplicated and ordered deterministically. Public IDs
  derive only from public geometry/properties, never provider IDs. Dropped
  wrong-geometry/duplicate rows and provider count truncation return partial
  status.
- DEA keeps observation time and provider-supplied positional uncertainty and
  confidence. Its copy identifies satellite observation context, nominal 375 m
  type uncertainty, and explicitly rejects warning/evacuation use. Internal IDs,
  file names and free text are omitted.
- Parks retain reserve name/type/manager only. Tracks retain name/classification
  only and explicitly are not live closure or condition state. Heritage retains
  site name/object type only and states unknown publisher cadence. Closure,
  maintenance, comments, register IDs and other internal/sensitive/free-text
  fields are neither requested nor emitted.
- Source-local last-good ceilings are 15 minutes for DEA and seven days for the
  three DataVic reference sources. Outside those ceilings, errors are sanitized
  and fail closed.

## Live official smoke — 2026-09-05

Each request ran through `createRegionalProxy()` with live `fetch`, redirect
rejection, stream metering and production normalization. Evidence records only
status/count/geometry/public-key metadata; no sensitive or free-text source
values were copied.

| Source | Bbox | Upstream | Bytes | Normalized | Status | WFS matches |
| --- | --- | --- | ---: | ---: | --- | ---: |
| DEA hotspots | `140,-40,150,-30` | 200 `application/json` | 318,652 | 839 points | `partial`, capped; 161 deterministic duplicates removed | 2,174 |
| Victorian parks | `144.9,-37.9,145,-37.8` | 200 `application/json` | 85,876 | 21 multipolygons | `current` | 21 |
| Recreation tracks | `144.16,-37.52,144.49,-37.42` | 200 `application/json` | 193,932 | 7 multilines | `current` | 7 |
| Victorian heritage | `144.9,-37.9,145,-37.8` | 200 `application/json` | 474,190 | 250 multipolygons | `partial`, capped | 645 |

All four proxy responses were HTTP 200. Public property-key inspection matched
the fixed output contracts: DEA observation metadata/caveat only; parks
name/type/manager; tracks name/classification; heritage site/object type.

## Verification

- Focused Task 4/source/proxy command: 74 passed, 0 failed.
- Full `npm test`: 2,857 passed, 0 failed, 1 expected skip. The skipped
  allocation microbenchmarks are calibrated for Node 24; this shell ran Node
  26.8.1.
- `npm run build`: passed; Vite transformed 163 modules. The existing
  large-chunk advisory was emitted.
- `git diff --check`: passed.

Independent review and Task 6 browser-visible category integration remain
separate gates.
