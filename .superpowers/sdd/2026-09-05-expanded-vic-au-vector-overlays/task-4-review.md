# Task 4 independent review

## Verdict

**FAIL - 1 P1 and 2 P2 findings.**

Focused verification passed 74/74 and all four bounded live proxy probes
completed successfully, but the implementation still accepts invalid polygon
topology as current, accepts contradictory WFS count metadata as current, and
does not use the current Geoscience Australia attribution required by its own
stated CC BY 4.0 basis. Review scope was
`8464e9e..7f41d05c0cdf74165df807ea7e361062caa4385a` plus the named Task 4
brief, report, implementation, tests, proxy and catalogue. Only this review
artifact was written; no product source, test, commit, push, deployment,
credential or provider state was changed.

## Findings

### P1 - Polygon topology validation ignores shell, hole and sibling-polygon relationships

`src/data/ogcRegionalSources.js:159-199` validates each ring only for closure,
area and self-intersection. `src/data/ogcRegionalSources.js:283-293` then maps
and optionally simplifies those rings independently before returning the
Polygon or MultiPolygon; it never verifies that holes are inside their shell,
that holes do not cross or overlap each other, that shell and hole winding are
compatible, or that MultiPolygon members do not overlap. The simplifier at
`src/data/ogcRegionalSources.js:230-264` likewise rechecks only each simplified
ring in isolation, so it cannot detect a shell/hole relationship changed by
simplification.

A read-only synthetic probe supplied a valid simple outer square plus a second
closed, simple ring located entirely outside that square. The heritage
normalizer accepted the impossible hole, returned two rings, and labelled the
collection `current`. This contradicts the fail-closed malformed-geometry and
topology-preservation claims in `DATA_SOURCES.md:103-120`. The geometry test at
`src/data/ogcRegionalSources.test.mjs:130-149` covers a single self-crossing
ring, but no shell/hole, inter-ring or inter-polygon relationship.

### P2 - Contradictory WFS collection counts are accepted as current

`src/data/ogcRegionalSources.js:382-385` validates `numberReturned` against the
feature array, but `src/data/ogcRegionalSources.js:386-393` accepts any
non-negative `numberMatched` without requiring it to be at least
`numberReturned`. It then treats only `numberMatched > features.length` as
capped. A read-only probe with one returned feature, `numberReturned: 1` and
`numberMatched: 0` was accepted with `status: "current"`, `capped: false` and
the contradictory zero match count exposed in `sourceStatus`.

The official services currently return consistent numeric counts, but malformed
or intermediary-supplied metadata does not fail closed and can produce a false
current status. The count test at
`src/data/ogcRegionalSources.test.mjs:185-198` covers a genuine cap and a
`numberReturned` mismatch, not the impossible `numberMatched < numberReturned`
case.

### P2 - DEA's registered credit is not the attribution required by the cited licence basis

`DATA_SOURCES.md:66` declares DEA Hotspots to be CC BY 4.0 but records the
credit only as `Digital Earth Australia Hotspots`. That same product-name-only
string is exported at `src/data/ogcRegionalSources.js:40-45`, installed in the
regional catalogue at `src/data/regionalSources.js:155-160`, and locked by the
test at `src/data/ogcRegionalSources.test.mjs:201-205`.

The current official data.gov.au records for `digital-earth-australia-hotspots`
and `digital-earth-australia-hotspots-wfs` both report their dataset-specific
licence as `notspecified`. Geoscience Australia's current general copyright
page supplies the fallback CC BY 4.0 basis, but requires attribution to the
Commonwealth of Australia (Geoscience Australia), with the current copyright
year and accompanying notices retained. A product title alone does not meet
that stated attribution. The catalogue therefore needs either a
dataset-specific licence/credit source or the actual GA attribution required by
the general licence; the present licence-and-credit pair is not exact.

## Verified clean

- The four source IDs resolve only to fixed HTTPS hosts, paths, feature types
  and property projections in `src/data/ogcRegionalSources.js:13-38`; browser
  input is limited to an allow-listed source ID and validated bbox. No SSRF,
  browser-controlled upstream URL, type name, property list or header path was
  found.
- Current WFS 2.0 capabilities expose all four fixed feature types. Live
  `DescribeFeatureType` and `count=1` probes confirmed the projected fields and
  returned Point, MultiPolygon, MultiLineString and MultiPolygon respectively.
  Each response was HTTP 200 `application/json` without a redirect.
- The proxy uses `redirect: "error"`, rejects non-JSON application media types,
  requires a readable stream, limits decoded response bodies to 2,000,000
  bytes, and sanitizes outward errors (`src/data/regionalProxy.js:277-306`,
  `src/data/regionalProxy.js:405-414`).
- Feature count is checked before feature access. Geometry nesting is traversed
  iteratively, coordinate values are finite and range-checked, per-feature and
  per-response coordinate caps precede ring topology work, and topology
  comparisons are bounded (`src/data/ogcRegionalSources.js:107-228`,
  `src/data/ogcRegionalSources.js:375-404`), subject to the missing polygon
  relationship checks in Finding 1.
- Sanitized identity-based dedupe, hash-collision suffixing, final title/ID
  order, duplicate and wrong-geometry partial status, and genuine provider-cap
  status are deterministic (`src/data/ogcRegionalSources.js:343-424`), subject
  to the inconsistent-count case in Finding 2.
- The same four-request provider semaphore wraps OGC fetch and full body
  consumption and is shared with GA, civic and Transport Victoria work
  (`src/data/regionalProxy.js:174-205`, `src/data/regionalProxy.js:277-306`). The
  focused concurrency test exercises one six-layer GA fan-out plus three OGC
  routes and observed no more than four active provider bodies.
- OGC timeouts abort the request, no-last-good timeout/unavailable/invalid
  responses are sanitized, cache hits preserve degraded status, and source-local
  last-good data expires after fifteen minutes for DEA or seven days for the
  three Victorian reference sources (`src/data/regionalProxy.js:277-306`,
  `src/data/regionalProxy.js:367-415`, `src/data/regionalSources.js:155-181`).
- Public output omits provider feature IDs and the excluded ID, file, comment,
  closure, maintenance and sensitive/free-text fields. Selected public text is
  control-stripped, whitespace-normalized and length-bounded. Output IDs derive
  only from sanitized public geometry and properties.
- Safety language is correctly bounded in the normalized output: DEA is a
  satellite hotspot observation, not warning or evacuation advice
  (`src/data/ogcRegionalSources.js:297-315`); tracks are reference alignments,
  not live closure or condition state (`src/data/ogcRegionalSources.js:326-333`);
  parks and heritage are reference boundaries, with heritage cadence explicitly
  unknown (`src/data/ogcRegionalSources.js:317-340`).
- The four sources remain absent from visible category packs until Task 6.

## Verification

- Focused command:
  `node --test src/data/ogcRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`
  - **PASS:** 74 passed, 0 failed, 0 skipped.
- Read-only invalid-topology probe:
  - **FAIL:** an outside-hole Polygon was accepted as `current`.
- Read-only contradictory-count probe:
  - **FAIL:** `numberMatched: 0`, `numberReturned: 1` and one feature were
    accepted as `current` and not capped.
- Live production proxy probes on 2026-09-05:
  - **PASS:** DEA returned 839 normalized points, `partial/capped`, from 2,174
    matches with 161 deterministic duplicates removed.
  - **PASS:** parks returned 21 normalized multipolygons, `current`.
  - **PASS:** recreation tracks returned 7 normalized multilines, `current`.
  - **PASS:** heritage returned 250 normalized multipolygons,
    `partial/capped`, from 645 matches.

## Official references checked

- DEA Hotspots WFS capabilities and type schema:
  `https://hotspots.dea.ga.gov.au/geoserver/wfs`
- DataVic WFS capabilities and type schemas:
  `https://opendata.maps.vic.gov.au/geoserver/wfs`
- Data.gov.au DEA Hotspots and WFS catalogue records:
  `https://data.gov.au/data/api/3/action/package_show?id=digital-earth-australia-hotspots`
  and
  `https://data.gov.au/data/api/3/action/package_show?id=digital-earth-australia-hotspots-wfs`
- Geoscience Australia copyright and attribution terms:
  `https://www.ga.gov.au/copyright`
- DataVic catalogue records for Parks and Conservation Reserves, Recreation
  Tracks and the Victorian Heritage Register:
  `https://discover.data.vic.gov.au/api/3/action/package_search`
