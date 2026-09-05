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
