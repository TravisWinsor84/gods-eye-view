# Task 4 targeted independent re-review

## Verdict

**FAIL - 1 P3 finding.**

The requested runtime fixes pass focused tests, bounded adversarial probes and a
fresh live heritage probe. One exact safety-boundary statement remains stale:
the catalogue documentation says the global topology budget is 100,000
comparisons, while the implementation and exported limit use 150,000.

Review scope was
`7f41d05c0cdf74165df807ea7e361062caa4385a..330aa6914634aaf9bfa75467d3cc463e4d3f1f6b`.
No product source, test, commit, provider or deployment state was changed. This
re-review artifact was the only file written.

## Finding

### P3 - The documented topology budget is stale after the live-data adjustment

`DATA_SOURCES.md:109-110` says relationship and ring checks share a
100,000-comparison budget per normalization. The implementation sets the limit
to 150,000 at `src/data/ogcRegionalSources.js:9`, enforces that value at
`src/data/ogcRegionalSources.js:162-166`, and exports it at
`src/data/ogcRegionalSources.js:574-580`. The Task 4 report itself records that
the budget was raised to 150,000 after the live heritage response consumed
110,230 comparisons (`task-4-report.md:184-187`).

The runtime remains bounded and rejected the cumulative exhaustion probe, so
this is not a limiter bypass. It is an inaccurate current safety contract: a
response may consume 50% more comparisons than `DATA_SOURCES.md` states.

## Verified fixes

- Invalid outside/crossing holes, overlapping/touching/nested holes, and
  overlapping/touching/contained sibling MultiPolygon members are rejected by
  the full relationship checks at `src/data/ogcRegionalSources.js:285-334`.
  Geometry is checked before simplification at
  `src/data/ogcRegionalSources.js:400-413`; geometry actually simplified is
  checked again at `src/data/ogcRegionalSources.js:413-415`. An independent
  simplification-only invalid topology probe was rejected.
- Ring, inter-ring, containment and sibling checks consume one shared meter via
  `src/data/ogcRegionalSources.js:162-166`; the meter is created once per
  response at `src/data/ogcRegionalSources.js:532` and is not reset when an
  invalid feature is omitted. A cumulative 70-row adversarial workload failed
  with `OGC_TOPOLOGY_LIMIT`.
- Only feature-local `INVALID_OGC_GEOMETRY` is omitted at
  `src/data/ogcRegionalSources.js:536-545`. Any omission forces `partial`, and a
  nonempty or positively matched response with no survivor fails at
  `src/data/ogcRegionalSources.js:557-560`.
- Feature-count and contradictory collection totals fail before normalization
  at `src/data/ogcRegionalSources.js:505-526`. The response coordinate meter is
  global (`src/data/ogcRegionalSources.js:118-125`), excessive nesting escapes
  with `OGC_NESTING_LIMIT` (`src/data/ogcRegionalSources.js:336-349`), and the
  proxy keeps byte, coordinate, nesting, topology and count failures at whole-
  request scope (`src/data/regionalProxy.js:277-306`,
  `src/data/regionalProxy.js:405-414`). Independent probes confirmed mixed
  valid/invalid output is partial, while all-invalid nonempty, contradictory
  counts, cumulative coordinates, excessive nesting and cumulative topology
  budget are fatal.
- The two current Data.gov.au catalogue records still report
  `license_id: notspecified`. `DATA_SOURCES.md:66` identifies the CC BY 4.0
  statement as a fallback and retains the general-term exceptions. The exact
  current Geoscience Australia 2026 attribution is registered at
  `src/data/ogcRegionalSources.js:40-45` and the catalogue does not present the
  dataset-specific licence as known (`src/data/regionalSources.js:155-161`).

## Verification evidence

- Focused command:
  `node --test src/data/ogcRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`
  - **PASS:** 88 passed, 0 failed, 0 skipped.
- Bounded independent adversarial matrix:
  - **PASS:** outside/crossing/nested-hole and overlapping/touching sibling
    cases rejected as `INVALID_OGC_GEOMETRY`;
  - **PASS:** topology made invalid only after heritage simplification rejected;
  - **PASS:** mixed valid/invalid response retained one valid feature as
    `partial` with `invalidFeatures: 1`;
  - **PASS:** all-invalid nonempty response and contradictory counts rejected as
    `INVALID_OGC_RESPONSE`;
  - **PASS:** cumulative coordinate, nesting and topology probes escaped as
    `OGC_COORDINATE_LIMIT`, `OGC_NESTING_LIMIT` and `OGC_TOPOLOGY_LIMIT`.
- Fresh live production-proxy heritage probe on 2026-09-05:
  - **PASS:** HTTP 200, `X-Regional-Status: degraded`, cache miss;
  - **PASS:** 249 `MultiPolygon` features, `partial`/capped against 645 matches;
  - **PASS:** `invalidFeatures: 1`, `duplicateFeatures: 0`, 16,964 input
    coordinates;
  - **PASS:** zero emitted geometries failed a second pass through the production
    geometry normalizer.
- Current official metadata:
  - `digital-earth-australia-hotspots`: `license_id: notspecified`, metadata
    modified 2025-10-16;
  - `digital-earth-australia-hotspots-wfs`: `license_id: notspecified`, metadata
    modified 2025-10-17;
  - Geoscience Australia's current copyright page was updated 2026-05-21 and
    specifies the 2026 Commonwealth attribution, CC BY 4.0 fallback and
    accompanying-notice requirement used by the implementation.

## Official references checked

- https://data.gov.au/data/api/3/action/package_show?id=digital-earth-australia-hotspots
- https://data.gov.au/data/api/3/action/package_show?id=digital-earth-australia-hotspots-wfs
- https://www.ga.gov.au/copyright
