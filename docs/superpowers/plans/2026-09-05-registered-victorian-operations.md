# Registered Victorian Operational Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the user's approved provider accounts to add current Victorian transport and environmental operational feeds without exposing keys or overstating safety/currentness.

**Architecture:** Reuse the server-only Transport Victoria portal key and provider-wide cache introduced for GTFS-Realtime. Each operational product has a fixed endpoint, schema-specific normalizer and maximum stale age; the browser retains only source ID plus bbox. EPA remains disabled until its separate developer subscription is authenticated and smoke-tested.

**Tech Stack:** Vite server middleware, Node test runner, JSON/GeoJSON adapters, Transport Victoria Open Data Portal, EPA Victoria developer portal.

**Spec:** `docs/superpowers/specs/2026-09-05-expanded-vic-au-overlays-design.md`

## Global Constraints

- Credentials are server-only, mode 600 on the host, never logged or returned.
- Missing keys and upstream 401/403 return sanitized HTTP 424 and never stale success.
- Provider-wide responses cache independently of bbox and are post-filtered/capped.
- Road feeds are context, not navigation or emergency instructions; preserve issue/update/expiry fields and official links.
- EPA observations/forecasts retain measurement time, quality flags and caveats; they are not personal health advice.
- Do not subscribe to paid products in this plan.

---

### Task 1: Transport Victoria road disruptions

**Files:**

- Create: `src/data/transportVicRoads.js`
- Create: `src/data/transportVicRoads.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `src/data/regionalPacks.js`
- Modify: `src/data/regionalPacks.test.mjs`
- Modify: `DATA_SOURCES.md`

**Interfaces:** Produces `fetchTransportVicRoadSource(sourceId, { key, fetchImpl, now })` for `vic-road-unplanned` and `vic-road-planned`, using `TRANSPORT_VIC_OPEN_DATA_API_KEY` as `KeyID`.

- [ ] **Step 1: Write failing exact-contract tests**

```js
test('unplanned v3 is paged once per provider cache rather than bbox', async () => {
  await query(BBOX_A);
  await query(BBOX_B);
  assert.equal(fetchCalls[0].url.pathname, '/api/opendata/roads/disruptions/unplanned/v3');
  assert.equal(fetchCalls.filter((call) => call.url.hostname === 'api.opendata.transport.vic.gov.au').length, EXPECTED_PAGES);
});

test('removes tow/internal fields and preserves public issue/expiry semantics', () => {
  const feature = normalizeRoadDisruption(UPSTREAM_RECORD);
  assert.equal('towAllocation' in feature.properties, false);
  assert.equal(feature.properties.updatedAt, UPSTREAM_RECORD.lastUpdated);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/transportVicRoads.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: FAIL because road sources are absent.

- [ ] **Step 3: Implement current OpenAPI v3/planned contracts**

Use `https://api.opendata.transport.vic.gov.au/api/opendata/roads/disruptions/unplanned/v3` and the exact planned route from its current portal OpenAPI. Page with fixed `limit`, cap total records/bytes, cache unplanned for 60 seconds and planned for 30 minutes, then bbox-filter point/line geometry. Preserve public cause, impact, start/end, update and official advice fields only.

- [ ] **Step 4: Test pagination, partial/malformed records, 429/Retry-After and auth failures**

Run: `node --test src/data/transportVicRoads.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs`

Expected: PASS; 401/403 is 424, 429 is sanitized/backed off, stale data expires explicitly.

- [ ] **Step 5: Verify and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/transportVicRoads.js src/data/transportVicRoads.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs src/data/regionalPacks.js src/data/regionalPacks.test.mjs DATA_SOURCES.md
git commit -m 'feat: add Victorian road disruptions'
```

### Task 2: Freeway travel time and lane-use signals

**Files:**

- Modify: `src/data/transportVicRoads.js`
- Modify: `src/data/transportVicRoads.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `src/data/regionalPacks.js`
- Modify: `src/data/regionalPacks.test.mjs`
- Modify: `DATA_SOURCES.md`

**Interfaces:** Adds `vic-freeway-travel-time` and `vic-lane-signals`, joining provider traffic/status records to provider geometry/site records inside source-wide caches.

- [ ] **Step 1: Write failing join/freshness tests**

```js
test('freeway traffic joins only matching official segment geometry', () => {
  const feature = joinFreewayTraffic(TRAFFIC, GIS_SEGMENTS)[0];
  assert.equal(feature.id, TRAFFIC.segmentId);
  assert.equal(feature.properties.observedAt, TRAFFIC.timestamp);
  assert.equal(feature.geometry.type, 'LineString');
});

test('lane signals do not turn display values into legal driving advice', () => {
  const feature = normalizeLaneSignal(LANE_FIXTURE);
  assert.equal(feature.properties.advice, undefined);
  assert.match(feature.properties.caveat, /road signs/i);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/transportVicRoads.test.mjs`

Expected: FAIL because the sources/joins do not exist.

- [ ] **Step 3: Implement exact portal OpenAPI routes and caches**

Use the current `Freeway Travel Time - Traffic`, `Freeway Travel Time - GIS`, and `Lane Use Management Sites` OpenAPI resources from their official portal packages. Cache traffic around 30 seconds, GIS around 12 hours and lane signals at the provider-advertised cadence. Use one `KeyID`; reject route/header drift in contract tests.

- [ ] **Step 4: Test joins, timestamps, stale limits and sanitized errors**

Run: `node --test src/data/transportVicRoads.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs`

Expected: PASS with no browser key/query leakage and no unbounded provider calls.

- [ ] **Step 5: Verify and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/transportVicRoads.js src/data/transportVicRoads.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs src/data/regionalPacks.js src/data/regionalPacks.test.mjs DATA_SOURCES.md
git commit -m 'feat: add Victorian freeway operations'
```

### Task 3: EPA Victoria registered air monitoring

**Files:**

- Create: `src/data/epaVictoria.js`
- Create: `src/data/epaVictoria.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `src/data/regionalPacks.js`
- Modify: `src/data/regionalPacks.test.mjs`
- Modify: `.env.example`
- Modify: `DATA_SOURCES.md`

**Interfaces:** Activates `vic-epa-air` only after the provider-documented key variable and header contract, exact subscribed endpoint, schema, quota and terms are verified. The environment-variable name is chosen only after that authenticated inspection. Missing credentials remain 424 and the source remains absent from default category membership until then.

- [ ] **Step 1: Complete EPA developer signup/subscription in Chrome**

Review account-specific terms, subscribe only to the free Environment Monitoring/Air product, and store the resulting key in the host `.env` with mode 600. Record key presence/length only; never print the value.

- [ ] **Step 2: Capture a credential-safe contract fixture**

Record exact base/path, required header name, status, MIME type, byte count, quota headers, top-level keys, station count and observation timestamps. Create a hand-written minimal fixture containing no key or provider-only sensitive fields.

- [ ] **Step 3: Write failing auth/normalizer tests**

```js
test('EPA is unavailable before its server key is configured', async () => {
  const response = await request('/api/regional/vic-epa-air?west=144&south=-38&east=146&north=-37', {});
  assert.equal(response.status, 424);
  assert.equal(fetchCalls.length, 0);
});

test('air observations preserve quality and measurement time', () => {
  const feature = normalizeEpaAir(EPA_FIXTURE).features[0];
  assert.equal(feature.properties.observedAt, EPA_FIXTURE.observedAt);
  assert.ok(feature.properties.quality);
});
```

- [ ] **Step 4: Implement the fixed subscribed endpoint**

Send the key in the provider-documented server header, cache within the observed quota/cadence, bbox-filter station points, retain station/parameter/value/unit/quality/observation time and remove all unneeded provider fields. Do not activate water/noise products not covered by the subscription.

- [ ] **Step 5: Verify, smoke test and commit**

Run: `node --test src/data/epaVictoria.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs && npm test && npm run build && git diff --check`

Expected: PASS plus authenticated server smoke HTTP 200 with bounded features and no secret output.

```bash
git add src/data/epaVictoria.js src/data/epaVictoria.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs src/data/regionalPacks.js src/data/regionalPacks.test.mjs .env.example DATA_SOURCES.md
git commit -m 'feat: add registered EPA air monitoring'
```

### Task 4: Credential-safe live verification

**Files:**

- Create: `docs/victorian-registered-feed-verification.md`
- Modify: `DATA_SOURCES.md`
- Modify: `docs/CURRENT-STATE.md`
- Modify: `CHANGELOG.md`

**Interfaces:** Produces current provider/deployed evidence for every registered feed without secret material.

- [ ] **Step 1: Smoke each provider endpoint directly from the server**

Record source ID, status, MIME, bytes, decoded features, provider timestamp/age, cache/rate headers and sanitized error class only.

- [ ] **Step 2: Exercise each `/api/regional/<sourceId>` route across two bboxes**

Confirm provider-wide cache reuse, bbox output filtering, stale transitions and no key/header/body leakage.

- [ ] **Step 3: Run full tests/build and independent security review**

Run: `npm test && npm run build && git diff --check`

Expected: PASS; review verifies credentials remain server-only.

- [ ] **Step 4: After explicit deployment approval, verify through Cloudflare Access**

Check container health, public authentication redirect, category toggles, exact source names, freshness/error states and mobile rail layout.

- [ ] **Step 5: Commit verification evidence**

```bash
git add docs/victorian-registered-feed-verification.md DATA_SOURCES.md docs/CURRENT-STATE.md CHANGELOG.md
git commit -m 'docs: verify registered Victorian feeds'
```
