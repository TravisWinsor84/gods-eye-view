# SDD ledger — plan: /Users/travis/Projects/gods-eye-view-vic-au/.worktrees/vic-au-execution/docs/superpowers/plans/2026-09-05-vic-au-data-catalogue.md

## Baseline

- 2026-09-05: isolated worktree `exec/vic-au-data-catalogue` created from `48e2a4b`.
- 2026-09-05: `npm ci` completed; `npm test` passed: 2685 passed, 0 failed, 1 skipped. The allocation microbenchmarks were skipped because local Node is 26.8.1; that is baseline behavior.

## Pre-flight interface scan

| Tasks | Shared files/interfaces | Finding and ruling |
| --- | --- | --- |
| 1 → 2 | `REGIONAL_SOURCES`, `normalizeRegionalFeatureCollection` | Task 1 defines the registry/normalization contract; Task 2 must import it rather than duplicate source metadata. No conflict. |
| 2 → 3 | `/api/regional/<sourceId>` normalized FeatureCollections | Task 2 owns server boundary/cache; Task 3 is browser-only and must not fetch upstream. No conflict. |
| 3 → 4 | `createRegionalLayer`, `regionalDataLayers`, `LAYER_STATE_REGISTRY` | Task 3 produces the generic layer; Task 4 composes packs and registers them. No conflict. |
| 1/2/3 → 4 | source IDs and optional PTV state | Melbourne pack contains only no-account sources; Victoria pack adds PTV only when proxy reports configuration. No conflict. |
| 1/2/4 → 5 | `ptv-transit` ID and server credentials | Task 5 adds the optional credential flow after no-account sources. Ruling: browser UI must surface `credentials required`, never silently omit a user-enabled transit request. |
| 1-5 | `DATA_SOURCES.md`, runtime docs | Source information accumulates across tasks and final documentation consolidates it. No conflict. |

## Decisions

- Ruling: build adapters around official public endpoints only; reject personal/sensitive data and do not subscribe to paid sources. This preserves the project public-data boundary.
- Ruling: retain source data at runtime where possible rather than bundling statewide datasets. This preserves freshness and avoids a large Docker image.

## Task state

- 2026-09-05: Task 1 dispatched to implementer `Popper` (`01a06d38-5ff7-77e1-89be-cb32332afbd1`) from base `48e2a4b2ba66ad7f13f8bdfd5c4db920e2f1246f`.
- 2026-09-05: independent official-source research completed in `national-official-source-research.md`; it confirms a national validation queue and excludes restricted/sensitive incident feeds from runtime scope.
- 2026-09-05: Task 1 implementation returned at `a8fd3be`; independent review dispatched to `Kuhn` (`01a06d3e-492a-7f41-821a-fc3ca7378583`).
- 2026-09-05: Task 1 remediated at `28964db` and `966d7be`; final independent re-review is clean. Focused source-contract suite: 12 passed, 0 failed.
- 2026-09-05: Australian civic-context design and plan approved for the same subagent-driven execution cycle (`79ada1a`); its source adapters remain licence/endpoint gated.
- Task 1: complete (commits `48e2a4b..966d7be`, review clean).
- Task 2: complete (commits `966d7be..1289140`, review clean; focused proxy/source suites 28 passed). Independent review confirmed the four-request global refresh cap and sanitized saturation behavior.
- Task 2: reopened after Civic Task 2 review reproduced a branch-introduced Vite startup crash at `vite.config.js:7409-7413`: the expression-bodied `configureServer` hook returns the Connect app from `middlewares.use`, which Vite treats as a post hook and invokes without `req`.
- Task 2: fix round 1/5 (1 addressed, 0 open — Vite `configureServer` no longer returns Connect middleware; commit `62c865f`). Scoped re-review clean; real dev-server smoke reached HTTP 200.
- Task 2: complete (commits `966d7be..62c865f`, review clean after reopened fix).
- Ruling: civic-context work is tracked in its own plan workspace from `79ada1a` onward; the earlier combined-ledger note is retained as history, not used for civic task recovery.
- Ruling: Regional Task 3 must preserve Civic Tasks 1-3 changes, especially successful-search latitude/longitude and the Context card integration; its pack contract is the prerequisite for Civic Task 4.
- Task 3: dispatched from base `3230ce5` after Civic Task 3 completed review-clean.
- Task 3: implementation committed as `d5de488` (`feat: add Melbourne and Victorian data packs`); focused 47/47 and build passed. Full suite has one unresolved failure because `src/data/layerState.test.mjs` expects the former registry size (16 vs 19); independent review must classify and bound the fix.
- Task 3: independent review failed with four findings: P1 viewport moves do not fetch new bounds; P1 registry-count integration test remains red; P2 in-flight refresh can repopulate destroyed state; P2 aggregate DataVic errors do not identify the unique source. Fix round 1/5 required.
- Task 3 ruling: widen owned scope to `src/data/layerState.test.mjs` for the exact 16-to-19 registry contract update because the production registry change made that existing test fail; retain a literal expected count so the test is not tautological.
- Task 3: fix round 1/5 committed as `3e7e38f`; original four findings resolved and full suite green (2,751 passed, 0 failed, 1 skipped), but re-review found a new P1 rapid disable/re-enable race where the new generation can inherit the stale cancelled `activeUpdate`. Fix round 2/5 required.
- Task 3: fix round 2/5 committed as `3dfb7d7`; independent re-review passed with zero findings. Required suite 101/101, full suite 2,752 passed with 1 skipped, build clean. Task 3 complete.
- Task 4 provider revalidation: official current portal and OpenAPI evidence supersede the stale PTV v3 HMAC plan. Use one server-only `TRANSPORT_VIC_OPEN_DATA_API_KEY`, `KeyID` header, four GTFS-Realtime protobuf vehicle feeds, provider-feed caching and post-decode bbox filtering. Plan amendment committed as `af12788`.
- Task 4 account state: Transport Victoria signup is open in Chrome and awaits user-entered email/password/name/2FA plus final account creation. Code implementation may proceed against mocked official contracts while authenticated smoke remains gated.
- Task 4 implementation committed as `55fb1cc`; focused 61/61, full suite 2,763 passed with 1 skipped, and build clean before review.
- Task 4 independent review failed with six findings: internal GTFS vehicle ID exposure; missing configured/credential/degraded UI state; missing runtime attribution; timeout mapped to 502 instead of 504; unbounded non-streaming binary read; and an unvalidated fixed 8 MB mode cap. Fix round 1/5 required.
- Task 4 ruling: until authenticated feed sizes are measured, use a documented conservative hard safety ceiling and report it as provisional, not a source-specific production measurement. Configuration remains explicit through sanitized server status; the browser never receives the key.
- Task 4 authenticated measurement: the assigned `KeyID` subscription returned metro 200/15,354 bytes/application-octet-stream, bus 200/119,651 bytes/application-octet-stream, V/Line 200/3,290 bytes/application-octet-stream, and tram 500/99 bytes/text-plain on 2026-09-05 local time. No key material was handled. Tram remains an honest per-mode provider failure.
- Task 4 fix round 1/5 committed as `3ffd43a`: all six review findings addressed in source and regression tests. One 32 MiB provisional streaming ceiling remains because the sample is point-in-time and tram has no successful measurement; source-specific limits require repeated successful evidence across all modes. Focused Task 4 suite: 69 passed, 0 failed; focused plus browser-module boundary: 70 passed, 0 failed; full suite: 2,771 passed, 0 failed, 1 skipped; build clean. Independent re-review remains pending.
