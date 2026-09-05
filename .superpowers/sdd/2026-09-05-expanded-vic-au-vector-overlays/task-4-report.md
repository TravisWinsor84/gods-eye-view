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

## Independent review fix round

The three review findings were reproduced RED before implementation. New tests
cover outside and shell-crossing holes; overlapping, touching and nested holes;
overlapping, touching and contained sibling multipolygon members; preservation
of valid same-direction rings; topology made invalid only by heritage
simplification; shared validation-budget exhaustion; `numberMatched` below the
returned/actual count; conflicting numeric total metadata; and the exact DEA
fallback licence and attribution contract. A proxy-level RED also proved that
topology-budget exhaustion was being mislabeled as a transient outage.

Polygon admission now validates shell/hole and sibling-polygon relationships
before heritage simplification and validates them again afterwards. It does not
require a particular GeoJSON winding direction, while simplification still
must preserve each ring's original orientation. Ring scans, inter-ring checks,
point containment and pair bounds checks share a 100,000-comparison budget per
normalization and retain only linear ring/bounds storage. Budget exhaustion is
sanitized by the proxy as invalid provider data. WFS numeric totals must be
non-negative, at least the actual/returned feature count, and consistent with
one another; contradictory metadata cannot produce `current` output.

The current Data.gov.au catalogue records for both DEA Hotspots and its WFS
state `notspecified` for the dataset-specific licence. The registered fallback
now uses Geoscience Australia's general copyright terms and exact current
attribution: `© Commonwealth of Australia (Geoscience Australia) 2026`, with
CC BY 4.0 and the requirement to observe and retain accompanying copyright or
related notices. Product-name-only credit was removed from code, catalogue and
documentation.

### Fresh bounded live smoke — review fix

All four calls used `createRegionalProxy()` with the existing fixed requests,
timeouts, redirect/media checks, 2 MB stream cap and production normalizers.
Evidence retained only counts, geometry types and sanitized status.

| Source | HTTP | Normalized result | Status |
| --- | ---: | --- | --- |
| DEA hotspots | 200 | 839 points from 1,000 rows; 161 deterministic duplicates removed; 2,173 matches | `partial`, capped |
| Victorian parks | 200 | 21 multipolygons | `current` |
| Recreation tracks | 200 | 7 multilines | `current` |
| Victorian heritage | 502 | No geometry admitted | Sanitized invalid data: current row 6 has two sibling polygon members that violate the required no-overlap/touch/contain topology contract |

The heritage failure is intentional fail-closed behavior under the requested
contract, not a successful live data result or a transient provider outage. No
provider IDs or free-text fields were copied into evidence.

### Review-fix verification

- Focused command: 82 passed, 0 failed, 0 skipped.
- Full `npm test`: 2,865 passed, 0 failed, 1 expected skip. The runner also
  reported two skipped allocation microbenchmarks because this shell uses Node
  26.8.1 while their budgets are calibrated for Node 24.
- `npm run build`: passed with Vite 6.4.3; 163 modules transformed. The existing
  large-chunk advisory was emitted.
- `git diff --check`: passed before staging.
- No push or deployment was performed.

## Operational follow-up — per-feature fail-closed recovery

The review-fix smoke above exposed a real operational gap: one invalid heritage
row caused the complete 250-row response to fail even though the other reference
features were valid. RED tests first reproduced mixed valid/invalid topology,
zero valid survivors, cumulative coordinate/nesting limits and proxy behavior.
The initial focused RED run passed 64/68 and failed the four new recovery
assertions for the expected old whole-response behavior.

`normalizeOgcPayload()` now omits only feature-local `INVALID_OGC_GEOMETRY`
failures and counts them in `sourceStatus.invalidFeatures`. Any omission forces
`sourceStatus.status: partial`; it can never report `current`. A nonempty or
positively matched response with no valid survivor raises
`INVALID_OGC_RESPONSE`, so the layer still fails closed rather than presenting
an empty current result.

The response byte cap, collection shape/count checks, total-coordinate meter,
nesting limit and topology-comparison meter remain whole-request hard failures.
The response coordinate and topology meters are shared across feature-local
exceptions and are never reset by omission. Regression fixtures exhaust both
meters through multiple invalid rows. Excessive nesting has its own hard
`OGC_NESTING_LIMIT` classification, and the proxy sanitizes it as invalid source
data.

Live diagnosis measured 110,230 topology comparisons for the current heritage
response after row 6 was omitted. The bounded response budget is now 150,000.
Unchanged heritage geometry is not redundantly topology-validated a second time;
geometry that is actually simplified is still validated both before and after
simplification. A live-scale valid workload above the old 100,000 cap and a
70-invalid-feature cumulative exhaustion attack are both covered.

### Fresh live heritage smoke

The production proxy path returned HTTP 200 with `X-Regional-Status: degraded`.
It emitted 249 `MultiPolygon` reference features as `partial`/capped against 645
matches, reported `invalidFeatures: 1`, `duplicateFeatures: 0` and 16,964 input
coordinates, and emitted zero geometries rejected by an independent second pass
through the production geometry normalizer. The invalid sibling-polygon row was
omitted and no invalid geometry was returned.

The final four-source smoke returned HTTP 200 for all sources: DEA 839 points
(`partial`, capped, 161 duplicates removed, 2,172 matches), parks 21
multipolygons (`current`), recreation tracks 7 multilines (`current`), and
heritage 249 multipolygons (`partial`, capped, one invalid omitted, 645 matches).

### Follow-up verification

- Focused Task 4 command: 88 passed, 0 failed, 0 skipped.
- Full `npm test`: 2,871 passed, 0 failed, 1 expected platform skip. The runner
  also reported two skipped allocation microbenchmarks because Node 26.8.1 was
  used while those budgets are calibrated for Node 24.
- `npm run build`: passed with Vite 6.4.3; 163 modules transformed. The existing
  large-chunk advisory was emitted.
- `git diff --check`: passed before staging.
- No push or deployment was performed.
