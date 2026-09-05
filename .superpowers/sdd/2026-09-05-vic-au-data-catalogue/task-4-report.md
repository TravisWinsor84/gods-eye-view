# Task 4 report: Transport Victoria GTFS-Realtime

## Outcome

Implemented the amended Regional Task 4 using the Transport Victoria Open Data
Portal GTFS-Realtime vehicle-position feeds for metro, tram, bus and V/Line.
The browser route remains `/api/regional/ptv-transit`; the server uses only
`TRANSPORT_VIC_OPEN_DATA_API_KEY` and sends it upstream only as the `KeyID`
header with `Accept: application/x-protobuf`.

## RED evidence

The first updated focused run failed against the legacy implementation:

- `regional-victoria` did not contain `ptv-transit`.
- the proxy still required `PTV_DEVELOPER_ID` plus `PTV_API_KEY` and returned
  the legacy signing-required response.
- the source registry had no Open Data Portal server credential metadata.
- the source normalizer still required the old stop payload.
- the new transport test initially failed because
  `gtfs-realtime-bindings` and `src/data/transportVicGtfs.js` were absent.

After installing the pinned decoder, the transport test was rerun and failed
specifically because `src/data/transportVicGtfs.js` did not exist. This records
the required pre-implementation RED boundary.

## GREEN evidence

Focused command:

```text
node --test src/data/transportVicGtfs.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs src/data/regionalLayer.test.mjs
```

Initial implementation result: 61 tests passed, 0 failed.

Coverage includes missing/blank key handling before fetch, exact endpoints and
headers, credential non-leakage, upstream 401/403 mapping, binary byte caps,
real GTFS-RT v2 protobuf decode, malformed feed isolation, timeout handling,
finite/range-safe coordinates, post-decode bbox filtering, global per-mode
cache reuse across bboxes, partial mode failure, bounded stale-age semantics,
all-mode failure, aggregate feature caps, pack inclusion, and preservation of
the prior regional source/proxy/layer behavior.

## Independent review fix round 1/5

The review found six defects. Test-first fixes now enforce these boundaries:

- GTFS-Realtime `entity.id`, `vehicle.vehicle.id`, `vehicle.vehicle.label` and
  `vehicle.vehicle.licensePlate` never enter client output. Feature identity is
  a deterministic 96-bit digest over mode and non-sensitive trip, route, time,
  coordinate, bearing and occupancy fields, rendered as 24 hexadecimal
  characters and collision-suffixed within a snapshot. It has no Node-core
  dependency and is an identity function, not a cryptographic claim.
- The Victoria pack omits PTV unless the browser-safe configuration-presence
  marker is true. A marker/key mismatch remains honest: sanitized 424
  `credentials-required` and `X-Regional-Status` survive the browser layer,
  while per-mode stale/unavailable states surface as degraded.
- The exact Public Transport Victoria CC BY 4.0 credit is registered in
  `DATA_CREDITS`, the application's actual attribution popover source.
- Four-mode timeout fan-out preserves `TIMEOUT` when all modes time out, so the
  public proxy returns sanitized HTTP 504. Mixed timeout/failure with a usable
  mode remains a degraded 200 with per-mode status.
- Binary bodies are read incrementally from WHATWG readers or Node async
  iterables. Streaming overruns cancel/close the reader. Array-buffer-only
  responses are rejected before allocation.
- All modes use one provisional 32 MiB hard safety ceiling. It is not described
  as a measured provider maximum or a source-specific limit.

The fix-round focused RED run failed on all new behavior boundaries. The GREEN
command adds the direct attribution test:

```text
node --test src/data/transportVicGtfs.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs src/data/regionalLayer.test.mjs src/data/dataCredits.test.mjs
```

Result: 69 tests passed, 0 failed.

Fix-round integration verification also ran the browser-module boundary test:
70 tests passed, 0 failed. This caught and removed an initial `node:crypto`
dependency before commit.

## Authenticated provider measurement

At 2026-09-05 local time, the user's automatically assigned subscription key was
copied from the authenticated portal and used in memory in the `KeyID` header for
the following credential-safe measurements. The value was never printed, logged
or committed. It was installed as `TRANSPORT_VIC_OPEN_DATA_API_KEY` in the
Docker host's existing mode-600 deployment environment file.

| Mode | HTTP | Bytes | MIME type | Interpretation |
| --- | ---: | ---: | --- | --- |
| metro | 200 | 15,354 | `application/octet-stream` | authenticated binary feed response |
| tram | 500 | 99 | `text/plain` | honest per-mode provider failure |
| bus | 200 | 119,651 | `application/octet-stream` | authenticated binary feed response |
| V/Line | 200 | 3,290 | `application/octet-stream` | authenticated binary feed response |

The largest successful one-time snapshot was 119,651 bytes. This evidence shows
the 32 MiB provisional ceiling is not close to the observed successful payloads,
but it does not establish a production maximum: tram supplied no successful feed
and there is no longitudinal sample. The implementation therefore retains one
high provisional streaming ceiling instead of inventing four measured limits.

## Initial implementation verification

- `npm test`: passed; 2,763 passed, 0 failed, 1 skipped. The runner also
  skipped two allocation microbenchmarks because the host used Node 26.8.1
  while those budgets are calibrated for Node 24.
- `npm run build`: passed with Vite 6.4.3; 160 modules transformed. The existing
  large-chunk advisory was emitted.
- `git diff --check`: passed before commit.
- Decoder: `gtfs-realtime-bindings` 2.2.0, whose declared engine is Node >=22.

## Fix-round full verification

- `npm test`: passed; 2,771 passed, 0 failed, 1 skipped. The runner separately
  reported two skipped allocation microbenchmarks because the host used Node
  26.8.1 while those budgets are calibrated for Node 24.
- `npm run build`: passed with Vite 6.4.3; 160 modules transformed. The existing
  large-chunk advisory was emitted.
- `git diff --check` and the staged diff check both passed.
- Implementation commit: `3ffd43a` (`fix: harden Transport Victoria realtime transit`).

## Independent review fix round 2/5

The first re-review reproduced one remaining P1: a successful PTV refresh
followed by sanitized HTTP 424 credential denial retained the prior browser
layer cohort, kept stale vehicle positions rendered and returned success from
`update()`.

The new regression first proved that behavior RED (`true !== false`). The
source-local fix now normalizes every HTTP 424 to `credentials-required` and
deletes only the denied source from `lastGoodBySource` before rendering.
Repeated denial cannot retain or resurrect the prior PTV cohort. Transient
upstream failures and timeouts retain their existing bounded last-good
fallback. A second regression mutation-check proved that replacing the
source-local deletion with a global clear incorrectly removes an unrelated
Victoria source cohort.

Verification after the fix:

- `node --test src/data/regionalLayer.test.mjs`: 15 passed, 0 failed.
- focused Task 4 suite: 71 passed, 0 failed.
- `npm test`: 2,773 passed, 0 failed, 1 skipped. The runner separately skipped
  two allocation microbenchmarks because Node 26.8.1 was used instead of their
  calibrated Node 24 runtime.
- `npm run build`: passed with Vite 6.4.3; 160 modules transformed. The existing
  large-chunk advisory was emitted.
- `git diff --check`: passed.
- Source/test commit: `8b4d73a` (`fix: clear stale transit after credential denial`).

Fix-round committed files:

- `.env.example`
- `DATA_SOURCES.md`
- `src/data/dataCredits.js`
- `src/data/dataCredits.test.mjs`
- `src/data/regionalLayer.js`
- `src/data/regionalLayer.test.mjs`
- `src/data/regionalPacks.js`
- `src/data/regionalPacks.test.mjs`
- `src/data/regionalProxy.test.mjs`
- `src/data/regionalSources.js`
- `src/data/regionalSources.test.mjs`
- `src/data/transportVicGtfs.js`
- `src/data/transportVicGtfs.test.mjs`

## Commit and files

Commit: `55fb1cc116a93eadf075f3f6186b60be84aa2db7`

Message: `feat: add secure Transport Victoria realtime transit`

Committed owned files:

- `.env.example`
- `DATA_SOURCES.md`
- `package.json`
- `package-lock.json`
- `src/data/regionalSources.js`
- `src/data/regionalSources.test.mjs`
- `src/data/regionalProxy.js`
- `src/data/regionalProxy.test.mjs`
- `src/data/regionalPacks.js`
- `src/data/regionalPacks.test.mjs`
- `src/data/transportVicGtfs.js`
- `src/data/transportVicGtfs.test.mjs`

## Remaining live proof

Authentication and response-size/MIME checks are now proven for metro, bus and
V/Line. Tram returned HTTP 500 and must remain unavailable/degraded rather than
being relabelled as a client or credential failure. Production proof still needs
a successful tram response plus credential-safe decoded entity counts, feed
timestamps/ages, rate-limit headers, and a full normalized `/api/regional/ptv-transit`
smoke through the deployed server. The browser-safe configured marker and the
server-only key must both be present in deployment configuration; no deployment
or push is part of this fix round.
