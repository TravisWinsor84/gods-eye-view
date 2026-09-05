# SDD ledger — plan: /Users/travis/Projects/gods-eye-view-vic-au/.worktrees/vic-au-execution/docs/superpowers/plans/2026-09-05-expanded-vic-au-vector-overlays.md

## Baseline

- 2026-09-05: plan and specification committed at `5c06cce` on `exec/vic-au-data-catalogue`.
- 2026-09-05: Regional Task 4 completed review-clean at `cf142b3`; final full suite 2,773 passed with 1 skip and build clean. This plan may now begin.

## Pre-flight interface scan

| Tasks | Shared files/interfaces | Finding and ruling |
| --- | --- | --- |
| 1 -> 2-5 | `REGIONAL_SOURCES`, proxy source admission | Task 1 must establish `regionalSourceAvailability()` once; later adapters consume it rather than adding credential checks ad hoc. |
| 1 -> 6 | EPA and PTV pack membership | Registered sources remain absent from default packs until browser-safe configuration is true; status must remain server-authoritative. |
| 2-5 -> 6 | normalized FeatureCollections and per-source status | Category packs compose existing fixed source IDs only; they do not fetch providers directly. |
| 2/3/5 | provider-wide download/index caches | Cache once per source refresh window and bbox-filter after decode to prevent viewport amplification. |
| 2/4 | ArcGIS/WFS viewport queries | Fixed allow-listed endpoints, field lists, pagination and caps; partial sublayer failure is reported without erasing successful cohorts. |
| 1-6 -> 7 | credentials, source truth, attribution | Deployment waits for review-clean source, credential-safe smoke tests, and explicit push/deploy approval. |

## Decisions

- EPA Victoria is incorrectly advertised as credential-free against a non-API page and must be fail-closed before new source work.
- The Transport Victoria subscription key is installed only in the Docker host's mode-600 `.env`; its value must never enter source, reports, logs, URLs or browser bundles.
- The current Transport Victoria tram vehicle feed returned HTTP 500 during authenticated measurement; runtime must report that mode degraded/unavailable rather than relabel it as a client failure.

## Task state

- Task 1 brief generated; Regional Task 4 dependency is review-clean and the task is ready for dispatch.
- Task 1 dispatched to implementer `Russell` (`01a06fdf-58e5-7a81-9246-d3f90f304991`) from base `b5859ef`.
- Task 1 implementation committed as `06d6d5f`; affected layer tests 15/15, focused 43/43, full suite 2,775 passed with 1 skip, and build clean.
- Task 1 independent review found zero runtime defects and two P2 documentation-contract defects: stale whole-catalogue inactive wording and a prematurely named EPA environment variable in the registered-operations follow-on plan. Fix round 1/5 corrects only those statements.
- Task 1 re-review 1 confirmed the EPA contract fix but found one remaining P2: catalogue wording equated runtime eligibility with an implemented proxy/layer even though AIHW is eligible but not yet wired. Fix round 2/5 scopes integration status per entry.
- Task 1 final re-review passed with zero actionable findings. Task 1 complete at `cea0304`; runtime verification remains 2,775 passed, 0 failed, 1 skipped, with build clean.
- Task 2 preflight: live ArcGIS 11.1 metadata confirmed six emergency layers, three health layers, and one composite gazetteer layer in decimal degrees; exact field schemas captured for allow-list design.
- Task 2 dispatched to implementer `Peirce` (`01a06ff2-bf73-73b3-bede-878c32d93951`) from base `3b718a1`.
- Task 2 implementation committed as `fa88838`: fixed GA ArcGIS adapters and
  proxy paths for six emergency, three health and one gazetteer sublayer;
  strict field allow-lists, two-page/1 MiB/1,000-feature caps, sanitized
  reference-only output, partial-layer status and exact GA/G-NAF attribution.
- Task 2 focused verification passed 57/57; full suite passed 2,793 with 0
  failures and 1 expected Node-version benchmark skip; production build passed
  at 161 modules and `git diff --check` passed.
- Task 2 live read-only smoke normalized 53 emergency and 529 health features
  in the Melbourne bbox. The full gazetteer proxy returned 1,000 features with
  honest partial/capped status in 33.766 seconds. Visible category-layer and
  deployed-host proof remain Task 6/deployment gates. Independent review is
  pending; no push or deployment occurred.
- Task 1 TDD implementation is complete. The controller approved a bounded
  correction to the two stale `src/data/regionalLayer.test.mjs` fixtures; they
  now use `melbourne-trees` while preserving route, clustering, source-local
  last-good and DataVic error assertions.
- Final verification: affected regional-layer suite 15/15; focused Task 1 suite
  43/43; full suite 2,775 passed, 0 failed, 1 expected Node-version benchmark
  skip; production build clean at 160 modules; `git diff --check` clean.
- EPA registration, product subscription and authenticated endpoint/schema/key
  contract validation remain the only EPA activation gate. No push or deploy
  occurred.
- Task 2 independent review failed with two P1 and three P2 findings: retained
  pages were dropped after a later failure, source-wide cap status could be
  falsely fresh, empty transfer-limited pages stopped pagination, GA fan-out
  bypassed the four-request ceiling, and mixed outages were mislabeled timeout.
- Task 2 fix round 1/5 added RED-first regressions and corrected all five
  findings. Prior-page features now survive later upstream failure with a
  sanitized partial-layer error; cap-omitted layers are explicitly
  capped/unprocessed; empty transfer-limited pages advance within the two-page
  bound; a FIFO gate limits actual GA provider fetches to four and releases on
  errors/aborts; only unanimous no-data timeouts return 504.
- Fresh fix-round verification: focused GA/source/proxy/credit/layer suites
  passed 80/80; the full suite passed 2,801 with 0 failures and 1 expected
  Node-version allocation-benchmark skip; production build passed at 161
  modules; `git diff --check` passed. Independent re-review remains pending;
  no push or deployment occurred.
- Task 2 re-review 1 confirmed four findings resolved but found one remaining
  P2: a non-empty short transfer-limited ArcGIS page advanced by returned rows
  rather than the server-owned requested record window, allowing overlap,
  duplicate IDs and omitted second-window rows under a falsely current result.
- Task 2 fix round 2/5 added a RED-first short-page regression. A 500-row
  request initially observed offsets `[0, 2]`; after the one-line correction,
  empty, short and full transfer-limited pages all advance by the prior
  `resultRecordCount`, preserving the two-page cap and review-clean behavior.
- Fresh round-two verification: focused GA/source/proxy/credit/layer suites
  passed 81/81; the full suite passed 2,802 with 0 failures and 1 expected
  Node-version allocation-benchmark skip; production build passed at 161
  modules. Independent re-review remains pending; no push or deployment
  occurred.
- Task 2 re-review 2 confirmed the requested-window correction and all four
  earlier findings remain resolved, but found one P2 at the final local page
  boundary: a transfer-limited second page attempted to construct offset 1,000
  and converted the application cap into a false upstream failure.
- Task 2 fix round 3/5 added RED-first short and empty final-page regressions.
  The short sequence initially retained rows without capped status, while the
  empty sequence returned a false 502. The proxy now stops after consuming the
  second permitted page, before constructing a third request; both sequences
  use exactly offsets `[0, 500]`, retain available rows, and return honest HTTP
  200 degraded `partial`/`capped` status without an upstream error.
- Fresh round-three verification: focused GA/source/proxy/credit/layer suites
  passed 83/83; the full suite passed 2,804 with 0 failures and 1 expected
  Node-version allocation-benchmark skip; production build passed at 161
  modules; `git diff --check` passed. Independent re-review remains pending;
  no push or deployment occurred.
- Task 2 final independent re-review passed with zero actionable findings and
  reran the focused suite 83/83. Task 2 complete at `eff5aea`.
- Task 3 preflight: all seven official Opendatasoft dataset IDs resolve. Live
  counts include 6,324 parking sensors and 29,053 bays; arbitrary rows may be
  old while the maximum observation timestamp is current, so freshness is
  per-record and provider tables must be globally cached/indexed.
- Task 3 dispatched to implementer `Pasteur` (`01a07026-07d9-7172-902f-a2910005b912`) from base `40065ea`.
- Task 3 implementation committed as `47de628`: five fixed City of Melbourne
  source adapters, two provider-wide parking exports cached for two minutes,
  cached kerbside join/spatial index, strict public-field allow-lists, generated
  IDs, per-record five-minute stale state, explicit last-good ceilings and the
  actual City of Melbourne CC BY 4.0 data credit. No Task 6 pack membership was
  added.
- Live Melbourne-bbox smoke returned 245 fountains, 44 barbecues, 1,000 capped
  parking points, 1,000 capped development points and 319 culture points. The
  parking refresh used exactly two exports, read 6,324 sensors and 5,072 bays
  with join keys, preserved maximum observation `2026-09-05T06:07:49+00:00`,
  and marked 994/1,000 sampled points stale independently.
- Fresh Task 3 verification: focused suites 74/74; full suite 2,822 passed, 0
  failed, 1 expected Node-version allocation-benchmark skip; production build
  passed at 162 modules; `git diff --check` passed. Independent review remains
  pending; no push or deployment occurred.
- Task 3 independent review failed with three P1, four P2 and one P3 finding:
  indefinitely renewable inherited parking tables, first-match duplicate-bay
  joins, false fresh all-stale parking status, civic request fan-out bypassing
  the provider-request ceiling, address-bearing fields, absent JSON media-type
  enforcement, unordered offset pagination and stale weekly cadence text.
- Task 3 fix round 1/5 added RED-first regressions and resolved all eight
  findings. Parking table success ages are immutable and expire at ten minutes;
  duplicate joins select nearest sensor geometry then recency/stable tie;
  current/stale counts drive honest aggregate status; one FIFO gate limits
  actual GA, civic and existing regional fetch/read operations to four without
  changing PTV; address-bearing fields are removed; JSON media types are
  enforced; fixed live-validated ordering plus defensive deduplication makes
  pagination honest; and fountains/barbecues now use Daily cadence with a
  three-missed-cycle 72-hour last-good ceiling.
- Fresh fix-round live smoke returned 245 fountains, 44 barbecues, 991 unique
  development points, 319 culture points and 1,000 capped parking points (997
  stale, 3 current). Focused Task 3/shared GA/PTV concurrency suites passed
  110/110; full suite passed 2,832 with 0 failures and 1 expected Node-version
  allocation-benchmark skip; production build passed at 162 modules;
  `git diff --check` passed. Independent re-review remains pending; no push or
  deployment occurred.
