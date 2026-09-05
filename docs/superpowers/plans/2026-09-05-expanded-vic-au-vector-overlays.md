# Expanded Victorian and Australian Vector Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the accepted free and registered Victorian/Australian point and vector sources as honest, bounded, category-based map overlays.

**Architecture:** Extend the fixed regional source registry and proxy with format-specific adapters rather than arbitrary URLs. Provider-wide downloads/feeds are cached independently of browser bbox, while WFS/ArcGIS/Opendatasoft requests remain bbox-bound. Existing `createRegionalLayer` renders sanitized GeoJSON and new category packs make source meaning visible.

**Tech Stack:** Vite 6, vanilla JavaScript, Node test runner, Cesium, ArcGIS REST/WFS, Opendatasoft v2.1, CSV parsing, server-side process caches.

**Spec:** `docs/superpowers/specs/2026-09-05-expanded-vic-au-overlays-design.md`

## Global Constraints

- Use only official supported endpoints and exact source-level reuse terms recorded in the 2026-09-05 research provenance.
- Never scrape viewers or infer permission from anonymous reachability.
- Never label reference, periodic, historical or modelled data as live.
- Never expose provider credentials, internal IDs, licence plates, personal/free-text fields or maintenance contacts.
- Browser requests contain only an allow-listed source ID and validated bbox.
- Provider-wide feeds/downloads cache once per source window and filter after decode/indexing; bbox changes cannot amplify upstream requests.
- Authentication failures fail closed and never return stale success.
- Keep source-local last-good data only within an explicit maximum stale age.
- Preserve exact publisher attribution and per-feature observation/publication dates.
- Keep every new category layer off by default and serializable through layer-state v2.

---

### Task 1: Correct source admission and EPA gating

**Files:**

- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `src/data/regionalPacks.js`
- Modify: `src/data/regionalPacks.test.mjs`
- Modify: `DATA_SOURCES.md`
- Modify: `.env.example`

**Interfaces:**

- Consumes: `REGIONAL_SOURCES`, `CIVIC_SOURCE_VALIDATION`, `normalizeRegionalFeatureCollection()` and `createRegionalProxy()`.
- Produces: a fail-closed source admission contract in which `vic-epa-air` is `runtimeEligible: false` until an EPA developer-portal endpoint/key has been validated, and a reusable `regionalSourceAvailability(sourceId, env)` result with `available`, `status` and sanitized `reason`.

- [ ] **Step 1: Write failing correctness tests**

```js
test('does not advertise EPA air as credential-free runtime data', () => {
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].runtimeEligible, false);
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].credential, 'registration-required');
  assert.equal(regionalPackIds('regional-victoria').includes('vic-epa-air'), false);
});

test('reports a registered source unavailable without exposing env values', () => {
  assert.deepEqual(regionalSourceAvailability('vic-epa-air', {}), {
    available: false,
    status: 'credentials-required',
    reason: 'EPA Victoria registration required',
  });
});
```

- [ ] **Step 2: Run the focused tests and record the expected failure**

Run: `node --test src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs`

Expected: FAIL because EPA is currently marked runtime-eligible/no-credential and included in the Victoria pack.

- [ ] **Step 3: Implement the fail-closed admission metadata**

```js
export function regionalSourceAvailability(sourceId, env = process.env) {
  const source = sourceFor(sourceId);
  if (!source.runtimeEligible) return { available: false, status: source.decision || 'unavailable', reason: source.availabilityReason };
  if (source.credentialEnv && !String(env[source.credentialEnv] || '').trim()) {
    return { available: false, status: 'credentials-required', reason: source.credentialsReason };
  }
  return { available: true, status: 'available', reason: '' };
}
```

Remove the incorrect public endpoint claim and document the EPA registration/product-subscription gate. Preserve PTV's current portal-key contract.

- [ ] **Step 4: Run focused tests, full tests and build**

Run: `node --test src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalPacks.test.mjs && npm test && npm run build && git diff --check`

Expected: all commands pass; no registered source is fetched without its key.

- [ ] **Step 5: Commit**

```bash
git add src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs src/data/regionalPacks.js src/data/regionalPacks.test.mjs DATA_SOURCES.md .env.example
git commit -m 'fix: gate unverified registered regional sources'
```

### Task 2: National emergency, health and place-name services

**Files:**

- Create: `src/data/gaRegionalSources.js`
- Create: `src/data/gaRegionalSources.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `DATA_SOURCES.md`

**Interfaces:**

- Consumes: validated bbox and regional proxy byte/feature caps.
- Produces: `gaArcGisRequests(sourceId, bbox, limit)` and `normalizeGaRegionalPayload(sourceId, payloads)` for `au-emergency-facilities`, `au-health-facilities`, and `au-place-names`.

- [ ] **Step 1: Write failing request and sanitizer tests**

```js
test('queries every accepted emergency facility layer within the bbox', () => {
  const requests = gaArcGisRequests('au-emergency-facilities', BBOX, 1000);
  assert.deepEqual(requests.map((request) => request.layer), [0, 1, 2, 3, 4, 5]);
  assert.ok(requests.every((request) => request.url.searchParams.get('geometry') === '144,-38,146,-37'));
});

test('health facilities remain reference data, not live capacity', () => {
  const result = normalizeGaRegionalPayload('au-health-facilities', HEALTH_FIXTURE);
  assert.equal(result.features[0].properties.freshnessClass, 'reference');
  assert.equal('capacity' in result.features[0].properties, false);
  assert.equal('waitTime' in result.features[0].properties, false);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/gaRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: FAIL because the GA adapter and source IDs do not exist.

- [ ] **Step 3: Implement fixed ArcGIS queries and field allow-lists**

Use these bases and layers:

```js
const GA_SERVICES = {
  'au-emergency-facilities': {
    base: 'https://services.ga.gov.au/gis/rest/services/Emergency_Management_Facilities/MapServer',
    layers: [0, 1, 2, 3, 4, 5],
  },
  'au-health-facilities': {
    base: 'https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer',
    layers: [0, 1, 2],
  },
  'au-place-names': {
    base: 'https://services.ga.gov.au/gis/rest/services/Composite_Gazetteer_of_Australia/MapServer',
    layers: [0],
  },
};
```

Request `f=geojson`, envelope geometry, `inSR=4326`, `outSR=4326`, fixed `outFields`, `returnGeometry=true`, and capped pagination. Transform GDA94/GDA2020 service output only through the advertised output CRS; do not hand-adjust coordinates. Preserve source date/status but omit internal database IDs, operational inference and unnecessary address/contact fields.

- [ ] **Step 4: Test partial-layer failures, pagination, caps and attribution**

Run: `node --test src/data/gaRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: PASS with source-local partial failure status and exact GA/G-NAF attribution.

- [ ] **Step 5: Run full verification and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/gaRegionalSources.js src/data/gaRegionalSources.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs DATA_SOURCES.md
git commit -m 'feat: add Australian facilities and place names'
```

### Task 3: Melbourne live parking and civic amenities

**Files:**

- Create: `src/data/melbourneCivicSources.js`
- Create: `src/data/melbourneCivicSources.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `DATA_SOURCES.md`

**Interfaces:**

- Produces Opendatasoft adapters for `melbourne-drinking-fountains`, `melbourne-barbecues`, `melbourne-parking-live`, `melbourne-development`, and `melbourne-culture`.
- `melbourne-parking-live` joins `on-street-parking-bay-sensors` to `on-street-parking-bays` by `kerbsideid` inside a provider-wide two-minute cache and returns bbox-filtered point features.

- [ ] **Step 1: Write failing source-specific tests**

```js
test('parking retains timestamp and provider caveats without promising availability', () => {
  const feature = normalizeMelbourneParking(SENSOR, BAY);
  assert.equal(feature.properties.status, 'vacant');
  assert.equal(feature.properties.observedAt, SENSOR.status_timestamp);
  assert.match(feature.properties.caveat, /not a guarantee/i);
  assert.equal('available' in feature.properties, false);
});

test('civic asset adapters omit internal maintenance fields', () => {
  const feature = normalizeMelbourneCivicRecord('melbourne-drinking-fountains', FOUNTAIN);
  assert.equal('contractor' in feature.properties, false);
  assert.equal('asset_manager' in feature.properties, false);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/melbourneCivicSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: FAIL because source-specific adapters are absent.

- [ ] **Step 3: Implement exact fixed datasets**

Use Opendatasoft v2.1 records for:

```js
const DATASETS = {
  'melbourne-drinking-fountains': ['drinking-fountains'],
  'melbourne-barbecues': ['public-barbecues'],
  'melbourne-parking-live': ['on-street-parking-bay-sensors', 'on-street-parking-bays'],
  'melbourne-development': ['development-activity-monitor'],
  'melbourne-culture': ['outdoor-artworks', 'public-memorials-and-sculptures'],
};
```

Use provider spatial predicates where geometry exists. Cache parking source tables globally for two minutes, retain `lastupdated`/`status_timestamp`, and mark records stale after five minutes. Select the latest census year for building/reference records; do not add non-spatial permits or stale garbage/planned-works datasets.

- [ ] **Step 4: Test joins, stale transitions, field allow-lists and source failures**

Run: `node --test src/data/melbourneCivicSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: PASS; separate amenity failures do not erase parking or other cohorts.

- [ ] **Step 5: Run full verification and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/melbourneCivicSources.js src/data/melbourneCivicSources.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs DATA_SOURCES.md
git commit -m 'feat: add Melbourne parking and civic amenities'
```

### Task 4: DEA hotspots and Victorian open-space/reference WFS

**Files:**

- Create: `src/data/ogcRegionalSources.js`
- Create: `src/data/ogcRegionalSources.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `DATA_SOURCES.md`

**Interfaces:**

- Produces `ogcFeatureRequest(sourceId, bbox, limit)` and source-specific normalizers for `au-dea-hotspots`, `vic-parks`, `vic-recreation-tracks`, and `vic-heritage`.

- [ ] **Step 1: Write failing OGC request/safety tests**

```js
test('DEA hotspots uses the bounded three-day WFS layer', () => {
  const url = ogcFeatureRequest('au-dea-hotspots', BBOX, 1000);
  assert.equal(url.searchParams.get('typeName'), 'public:hotspots_three_days');
  assert.equal(url.searchParams.get('bbox'), '144,-38,146,-37,EPSG:4326');
});

test('hotspot copy retains uncertainty and rejects safety-of-life claims', () => {
  const feature = normalizeOgcFeature('au-dea-hotspots', HOTSPOT);
  assert.match(feature.properties.caveat, /375 m|not.*warning/i);
  assert.equal('evacuate' in feature.properties, false);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/ogcRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: FAIL because the OGC adapter is absent.

- [ ] **Step 3: Implement a fixed service/type allow-list**

```js
const OGC_FEATURE_SOURCES = {
  'au-dea-hotspots': ['https://hotspots.dea.ga.gov.au/geoserver/wfs', 'public:hotspots_three_days'],
  'vic-parks': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:parkres'],
  'vic-recreation-tracks': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:recweb_tracks'],
  'vic-heritage': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:heritage_register'],
};
```

Use WFS 2.0/1.1 parameters supported by each capabilities document, request GeoJSON, set output CRS EPSG:4326, bbox and count/maxFeatures, and reject redirects/content-type mismatches. Simplify only after preserving valid topology; cap coordinates and feature counts.

- [ ] **Step 4: Test exact type names, bbox, geometry caps, dates and attribution**

Run: `node --test src/data/ogcRegionalSources.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: PASS; tracks say reference/not closure state, heritage says unknown cadence, hotspots show observation time/uncertainty.

- [ ] **Step 5: Run full verification and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/ogcRegionalSources.js src/data/ogcRegionalSources.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs DATA_SOURCES.md
git commit -m 'feat: add Australian hotspots parks and heritage'
```

### Task 5: Indexed national toilets and Victorian transit stops

**Files:**

- Create: `src/data/indexedRegionalDownloads.js`
- Create: `src/data/indexedRegionalDownloads.test.mjs`
- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalSources.test.mjs`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalProxy.test.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `DATA_SOURCES.md`

**Interfaces:**

- Produces `createIndexedRegionalDownload({ sourceId, resolveResource, parse, maxBytes, maxRows, maxAgeMs })` with one versioned provider download, conditional requests, bounded parsing and bbox lookup.
- Adds `au-public-toilets` and `vic-transport-stops`.

- [ ] **Step 1: Write failing whole-file/cache tests**

```js
test('different bboxes reuse one versioned toilet export', async () => {
  await index.query(BBOX_A);
  await index.query(BBOX_B);
  assert.equal(downloadCalls, 1);
});

test('rejects decompression or row-count expansion beyond the source cap', async () => {
  await assert.rejects(() => index.load(OVERSIZED_FIXTURE), /source limit/);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/indexedRegionalDownloads.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: FAIL because the indexed-download adapter does not exist.

- [ ] **Step 3: Implement bounded provider-wide indexes**

Resolve the current toilet CSV through the official `data.gov.au` CKAN package `553b3049-2b8b-46a2-95e6-640d7986a8c1`; resolve the current public-transport-stops GeoJSON through Transport Victoria package `public-transport-lines-and-stops`. Do not pin rotating filenames without checking package metadata. Use conditional requests, strict content length/stream byte caps, CSV/GeoJSON row caps, finite coordinate validation and a simple longitude/latitude bucket index. Retain provider/resource modified date and record-level update where present.

- [ ] **Step 4: Test resource rotation, malformed rows, currency flags and bbox lookup**

Run: `node --test src/data/indexedRegionalDownloads.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs`

Expected: PASS; old catalogue prose does not override file-level currency, and transit stops never claim realtime service.

- [ ] **Step 5: Run full verification and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/indexedRegionalDownloads.js src/data/indexedRegionalDownloads.test.mjs src/data/regionalSources.js src/data/regionalSources.test.mjs src/data/regionalProxy.js src/data/regionalProxy.test.mjs package.json package-lock.json DATA_SOURCES.md
git commit -m 'feat: index national amenities and transit stops'
```

### Task 6: Category packs, layer state and source-status UI

**Files:**

- Modify: `src/data/regionalPacks.js`
- Modify: `src/data/regionalPacks.test.mjs`
- Modify: `src/data/layerState.js`
- Modify: `src/data/layerState.test.mjs`
- Modify: `src/data/regionalLayer.js`
- Modify: `src/data/regionalLayer.test.mjs`
- Modify: `src/mapContext.js`
- Modify: `src/mapContext.test.mjs`
- Modify: `src/mapContextDom.js`
- Modify: `src/mapContextDom.test.mjs`
- Modify: `src/main.js`
- Modify: `src/style.css`

**Interfaces:**

- Produces off-by-default serializable layers `regional-civic`, `regional-mobility`, `regional-environment`, and `regional-planning`.
- Extends `getStats()` and map context source entries with `{ sourceId, name, status, freshnessClass, observedAt, ageMs, error }`.

- [ ] **Step 1: Write failing pack/state/context tests**

```js
test('new category packs contain each newly admitted source once', () => {
  const ids = CATEGORY_REGIONAL_PACK_IDS.flatMap((packId) => REGIONAL_PACKS[packId].sourceIds);
  assert.equal(new Set(ids).size, ids.length);
});

test('context distinguishes live recent reference historical and modelled sources', () => {
  const context = buildMapContext({ sources: SOURCE_STATUSES });
  assert.deepEqual(context.sources.map((source) => source.freshnessClass), ['live', 'recent', 'reference', 'historical', 'modelled']);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/regionalPacks.test.mjs src/data/layerState.test.mjs src/data/regionalLayer.test.mjs src/mapContext.test.mjs src/mapContextDom.test.mjs`

Expected: FAIL because category layers and per-source status display are absent.

- [ ] **Step 3: Implement category packs without duplication**

Assign facilities/toilets/fountains/barbecues to civic; PTV/parking/stops to mobility; hotspots/parks/tracks to environment; place names/heritage/development/culture to planning. Export a literal `CATEGORY_REGIONAL_PACK_IDS` list for tests and UI ordering. Preserve the three existing packs and their source membership for saved-link compatibility; provider caches coalesce any legacy/category overlap. Registered unavailable sources appear as explicit credentials-required status only when part of a requested category; they do not silently disappear.

- [ ] **Step 4: Render compact accessible source status**

Use semantic list rows, source name, freshness badge, relative age plus exact timestamp in accessible text, official-source link and sanitized error. At 320 px width, wrap source names and keep all content inside the rail. Do not display a freshness label without provider timestamp/cadence evidence.

- [ ] **Step 5: Test serialization, disable/destroy, stale/error and responsive layout contracts**

Run: `node --test src/data/regionalPacks.test.mjs src/data/layerState.test.mjs src/data/regionalLayer.test.mjs src/mapContext.test.mjs src/mapContextDom.test.mjs`

Expected: PASS with all new layers off by default and share-state round trip exact.

- [ ] **Step 6: Run React/CSS-independent full verification and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/regionalPacks.js src/data/regionalPacks.test.mjs src/data/layerState.js src/data/layerState.test.mjs src/data/regionalLayer.js src/data/regionalLayer.test.mjs src/mapContext.js src/mapContext.test.mjs src/mapContextDom.js src/mapContextDom.test.mjs src/main.js src/style.css
git commit -m 'feat: organize regional overlays by source meaning'
```

### Task 7: Live endpoint and browser verification

**Files:**

- Create: `docs/vic-au-overlay-verification.md`
- Modify: `DATA_SOURCES.md`
- Modify: `docs/CURRENT-STATE.md`
- Modify: `CHANGELOG.md`

**Interfaces:** Produces a source-by-source proof ledger separating code, mocked tests, provider response, deployed server response and browser-visible behavior.

- [ ] **Step 1: Add a credential-safe provider smoke command**

Record only source ID, HTTP status, content type, byte/feature count, source timestamp/age and sanitized failure class. Never print headers, bodies or environment values for registered sources.

- [ ] **Step 2: Verify every free source from the server route**

Run one Melbourne/Victoria bbox and one second bbox for each source. Confirm the second request uses expected cache behavior, feature coordinates remain in bounds, source attribution is present and errors do not expose upstream details.

- [ ] **Step 3: Run full tests and build from a clean tracked worktree**

Run: `npm test && npm run build && git diff --check`

Expected: PASS with only the documented Node-version benchmark skip, if still applicable.

- [ ] **Step 4: After explicit deployment approval, deploy and verify through Cloudflare Access**

Confirm container health, updater timer state, authenticated public route, each category toggle, Context source meanings, stale/error display and 320 px layout. Record screenshots or browser observations without exposing private credentials.

- [ ] **Step 5: Commit verification documentation**

```bash
git add docs/vic-au-overlay-verification.md DATA_SOURCES.md docs/CURRENT-STATE.md CHANGELOG.md
git commit -m 'docs: verify expanded Victorian overlays'
```
