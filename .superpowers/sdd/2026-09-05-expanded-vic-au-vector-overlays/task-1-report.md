# Task 1 report - correct source admission and EPA gating

## State

Implementation and verification are complete. The controller approved a
bounded integration-test correction for two stale regional-layer fixtures that
explicitly instantiated `vic-epa-air`; both now use the runtime-eligible
`melbourne-trees` point source without weakening their lifecycle assertions.

## RED evidence

- `node --test src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs`
  - 43 tests: 38 passed, 5 failed.
  - Failures proved the old EPA registry, pack, proxy-fetch, payload-normalizer,
    and missing availability-helper behavior.
- Follow-up runtime-ineligible availability test:
  `node --test src/data/regionalSources.test.mjs`
  - 18 tests: 17 passed, 1 failed because the old lookup threw for a
    non-runtime civic source instead of returning sanitized availability.

## GREEN evidence

- Focused Task 1 suite: 43 passed, 0 failed.
- Source-only follow-up: 18 passed, 0 failed.
- Bounded affected suite: 15 passed, 0 failed.
- Final focused Task 1 suite: 43 passed, 0 failed.
- Full suite: 2,776 tests; 2,775 passed, 0 failed, 1 skipped. The skip is the
  existing allocation benchmark gate calibrated for Node 24 while this host is
  running Node 26.8.1.
- Production build: passed; Vite transformed 160 modules.
- `git diff --check`: passed.

## Implemented behavior

- `vic-epa-air` has no endpoint, request template, normalizer path, environment
  variable contract, or pack membership.
- EPA admission returns sanitized `credentials-required` / `EPA Victoria
  registration required` without reading environment values or fetching.
- `regionalSourceAvailability(sourceId, env)` handles public, runtime-ineligible,
  server-credential and browser-safe configured-marker cases.
- The regional proxy consults the same contract but deliberately supplies only
  the actual server credential view, so a browser-safe marker cannot authorize
  an upstream provider request.
- Review-clean Transport Victoria configured-only behavior remains intact in
  the focused suite.

## Remaining gate

EPA developer-portal signup, product subscription, exact endpoint/schema,
key-header, quota, licence and authenticated smoke validation remain required
before a real EPA environment variable or adapter may be introduced.
