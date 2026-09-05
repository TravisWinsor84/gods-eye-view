# Victorian and Australian Data Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver official Victorian, Melbourne, and Australian spatial data overlays with independent lifecycle, attribution, cache, and credential behaviour.

**Architecture:** A source registry describes every regional feed. Pure normalizers turn source responses into constrained GeoJSON features; Vite owns remote fetches through allowlisted, cached proxies; generic Cesium layers render viewport-bounded point, line, and polygon cohorts through the existing `DataLayerManager`.

**Tech Stack:** Vanilla ES modules, CesiumJS, Vite server plugins, Node 24, `node:test`, GeoJSON, official Opendatasoft/DataVic/EPA/PTV/RSS endpoints.

**Spec:** `docs/superpowers/specs/2026-09-05-vic-au-data-catalogue-design.md`

## Global Constraints

- Use only official or attributable public-government sources with display-compatible terms.
- Never expose API keys; free registered credentials are server-side `.env` values only.
- Every upstream request has an allowlisted route, payload cap, timeout, cache, and source-local failure state.
- Dense data is viewport-bounded, clustered/decimated, and label-limited.
- Update `DATA_SOURCES.md`, `docs/CURRENT-STATE.md`, and `CHANGELOG.md` with every activated source.

---

### Task 1: Regional source catalogue and parser contracts

**Files:**

- Create: `src/data/regionalSources.js`
- Create: `src/data/regionalSources.test.mjs`
- Modify: `DATA_SOURCES.md`

**Interfaces:** Produces `REGIONAL_SOURCES`, `normalizeRegionalFeatureCollection(sourceId, payload)`, and `regionalSourceAttribution(sourceId)`. Source IDs are `melbourne-trees`, `melbourne-places`, `melbourne-cycling`, `melbourne-water-history`, `vic-epa-air`, `vic-cfa-alerts`, `vic-fire-context`, `vic-freight-network`, `au-hydrology`, and `ptv-transit`.

- [ ] **Step 1: Write failing parser tests**

    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { normalizeRegionalFeatureCollection } from './regionalSources.js';

    test('normalizes City of Melbourne tree records', () => {
      const result = normalizeRegionalFeatureCollection('melbourne-trees', {
        results: [{ record: { id: 'tree-1', fields: { common_name: 'River red gum', latitude: -37.81, longitude: 144.96 } } }],
      });
      assert.deepEqual(result.features[0].geometry.coordinates, [144.96, -37.81]);
      assert.equal(result.features[0].properties.title, 'River red gum');
    });

- [ ] **Step 2: Confirm parser tests fail**

    Run: `node --test src/data/regionalSources.test.mjs`
    Expected: FAIL because the regional source module is absent.

- [ ] **Step 3: Implement explicit source contracts**

    export const REGIONAL_SOURCES = Object.freeze({
      'melbourne-trees': Object.freeze({ name: 'Melbourne Urban Forest', source: 'City of Melbourne Open Data', geometry: 'point', refreshMs: 86400000, credit: 'City of Melbourne Open Data' }),
      'vic-epa-air': Object.freeze({ name: 'Victoria Air Quality', source: 'EPA Victoria', geometry: 'point', refreshMs: 300000, credit: 'EPA Victoria' }),
    });

- [ ] **Step 4: Cover malformed coordinates, unknown IDs, oversized properties, GeoJSON, RSS, and EPA payloads**

    Run: `node --test src/data/regionalSources.test.mjs`
    Expected: PASS.

- [ ] **Step 5: Record publisher, licence, exact attribution, geometry, and refresh model in `DATA_SOURCES.md`**

- [ ] **Step 6: Commit**

    git add src/data/regionalSources.js src/data/regionalSources.test.mjs DATA_SOURCES.md
    git commit -m 'feat: add regional data source registry'

### Task 2: Secure regional source proxy

**Files:**

- Create: `src/data/regionalProxy.js`
- Create: `src/data/regionalProxy.test.mjs`
- Modify: `vite.config.js`
- Modify: `.env.example`

**Interfaces:** Produces `createRegionalProxy()` at `/api/regional/<sourceId>`. It accepts a validated bounding box only; it consumes the server-only `TRANSPORT_VIC_OPEN_DATA_API_KEY` for Transport Victoria feeds. The browser never supplies an arbitrary upstream URL or credential.

- [ ] **Step 1: Write failing proxy tests**

    test('rejects unknown source IDs before fetch', async () => {
      const response = await request('/api/regional/not-a-source');
      assert.equal(response.status, 404);
      assert.equal(fetchCalls, 0);
    });

    test('does not return a PTV key in a response', async () => {
      const response = await request('/api/regional/ptv-transit');
      assert.doesNotMatch(await response.text(), /secret-value/);
    });

- [ ] **Step 2: Confirm tests fail**

    Run: `node --test src/data/regionalProxy.test.mjs`
    Expected: FAIL because `createRegionalProxy` is unavailable.

- [ ] **Step 3: Implement an allowlisted proxy with bounded fetches**

    export function createRegionalProxy({ fetchImpl = fetch, now = () => Date.now() } = {}) {
      return async (req, res, next) => {
        const source = resolveRegionalSource(req.url);
        if (!source) return sendJson(res, 404, { error: 'unknown regional source' });
        const bounds = parseRegionalBounds(req.url);
        const payload = await fetchRegionalSource(source, bounds, { fetchImpl, now });
        return sendJson(res, 200, normalizeRegionalFeatureCollection(source.id, payload));
      };
    }

- [ ] **Step 4: Test bounds validation, timeout, payload cap, cache hit/stale recovery, and upstream failure isolation**

    Run: `node --test src/data/regionalProxy.test.mjs`
    Expected: PASS.

- [ ] **Step 5: Register the Vite plugin and document empty PTV environment keys**

- [ ] **Step 6: Commit**

    git add src/data/regionalProxy.js src/data/regionalProxy.test.mjs vite.config.js .env.example
    git commit -m 'feat: proxy regional public data safely'

### Task 3: Generic Cesium regional layer and no-account packs

**Files:**

- Create: `src/data/regionalLayer.js`
- Create: `src/data/regionalLayer.test.mjs`
- Create: `src/data/regionalPacks.js`
- Create: `src/data/regionalPacks.test.mjs`
- Modify: `src/data/layerState.js`
- Modify: `src/main.js`
- Modify: `src/locations.js`
- Modify: `src/locations.test.mjs`

**Interfaces:** Produces `createRegionalLayer({ id, sourceIds, name, icon, color, updateInterval })` with standard layer lifecycle and `regionalDataLayers`. Adds `CITY_POIS.melbourne` and serializable `regional-melbourne`, `regional-victoria`, and `regional-australia` layer IDs.

- [ ] **Step 1: Write failing lifecycle and pack tests**

    test('retains last-good records when an EPA refresh fails', async () => {
      const layer = createRegionalLayer({ id: 'regional-victoria', sourceIds: ['vic-epa-air'] });
      await layer.enable();
      fetchImpl.rejectNext(new Error('offline'));
      await layer.update();
      assert.equal(layer.getStats().count, 1);
      assert.match(layer.getStats().error, /EPA Victoria/);
    });

    test('Melbourne pack is made only of no-account sources', () => {
      assert.deepEqual(regionalPackIds('regional-melbourne'), ['melbourne-trees', 'melbourne-places', 'melbourne-cycling', 'melbourne-water-history']);
    });

- [ ] **Step 2: Confirm tests fail**

    Run: `node --test src/data/regionalLayer.test.mjs src/data/regionalPacks.test.mjs`
    Expected: FAIL because regional layer modules are absent.

- [ ] **Step 3: Implement bounded rendering and honest stats**

    export function createRegionalLayer({ id, sourceIds, name, icon, color, updateInterval = 300000 }) {
      // Keep one Cesium CustomDataSource, source-scoped last-good cohorts,
      // point clustering, viewport/zoom culling, and a capped label cohort.
    }

- [ ] **Step 4: Add regional layer state, register packs before `finalizeRegistrations()`, and add a five-POI Melbourne preset**

- [ ] **Step 5: Test disable/destroy, label cap, viewport/zoom culling, share-state round-trip, and Melbourne preset bounds**

    Run: `node --test src/data/regionalLayer.test.mjs src/data/regionalPacks.test.mjs src/locations.test.mjs`
    Expected: PASS.

- [ ] **Step 6: Commit**

    git add src/data/regionalLayer.js src/data/regionalLayer.test.mjs src/data/regionalPacks.js src/data/regionalPacks.test.mjs src/data/layerState.js src/main.js src/locations.js src/locations.test.mjs
    git commit -m 'feat: add Melbourne and Victorian data packs'

### Task 4: Free registered PTV transit source

**Files:**

- Modify: `src/data/regionalSources.js`
- Modify: `src/data/regionalProxy.js`
- Modify: `src/data/regionalPacks.js`
- Create: `src/data/transportVicGtfs.js`
- Create: `src/data/transportVicGtfs.test.mjs`
- Modify: `.env.example`
- Modify: `DATA_SOURCES.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:** `ptv-transit` uses Transport Victoria's current Open Data Portal GTFS-Realtime feeds and is available only if `TRANSPORT_VIC_OPEN_DATA_API_KEY` exists. The server sends the key only as `KeyID`, decodes full-feed Protocol Buffers for Metro Train, Yarra Trams, Metro/Regional Bus and V/Line vehicle positions, caches by provider feed rather than bbox, filters after decode, sanitizes all responses, and adds PTV to the Victoria pack only after configuration. Legacy PTV v3 developer-ID/HMAC credentials are explicitly out of scope because portal keys are not interchangeable with them.

- [ ] **Step 1: Register with the Transport Victoria Open Data Portal through Chrome and place the resulting key in the host `.env` with mode 600**

    Verify presence, whitespace, length, and server-only availability. Never print the value.

- [ ] **Step 2: Write failing credential, binary-decode and cache-boundary tests**

    test('reports credentials required when PTV keys are absent', async () => {
      const response = await request('/api/regional/ptv-transit');
      assert.equal(response.status, 424);
    });

    test('sends the portal key only in the KeyID header', async () => {
      await request('/api/regional/ptv-transit?west=144&south=-38&east=146&north=-37');
      assert.equal(fetchCalls[0].options.headers.KeyID, 'secret-value');
      assert.doesNotMatch(fetchCalls[0].url, /secret-value/);
    });

    test('reuses a decoded provider feed across different browser bboxes', async () => {
      await request('/api/regional/ptv-transit?west=144&south=-38&east=145&north=-37');
      await request('/api/regional/ptv-transit?west=145&south=-38&east=146&north=-37');
      assert.equal(upstreamVehicleFeedCalls, 4);
    });

- [ ] **Step 3: Implement bounded binary decoding, provider-feed cache, bbox filtering and source normalization; run focused tests**

    Use the current base `https://api.opendata.transport.vic.gov.au/opendata/public-transport/gtfs/realtime/v1` and the four `/{metro|tram|bus|vline}/vehicle-positions` paths. Send `Accept: application/x-protobuf`. Do not amplify provider requests by bbox. Apply source-specific binary byte caps only after measuring authenticated feeds.

    Test missing/blank key 424 without fetch, exact header placement, no query/body leakage, upstream 401/403-to-424 mapping, protobuf decode failure isolation, feed cache reuse across bboxes, post-decode bbox filtering, per-mode partial failure, stale-age labeling, byte caps and sanitized errors.

    Run: `node --test src/data/transportVicGtfs.test.mjs src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalLayer.test.mjs`
    Expected: PASS.

- [ ] **Step 4: Execute authenticated server-side smoke tests without printing credentials or bodies**

    Record only status, response MIME type, byte count, decoded entity count, provider feed timestamp/age and whether `KeyID` succeeded for each mode. Observe rate-limit headers and confirm the same key works across all four feeds.

    Expected: HTTP 200 and valid normalized vehicle features from at least one mode; partial mode outages remain explicit and sanitized.

- [ ] **Step 5: Commit**

    git add src/data/regionalSources.js src/data/regionalProxy.js src/data/regionalPacks.js src/data/transportVicGtfs.js src/data/transportVicGtfs.test.mjs .env.example DATA_SOURCES.md package.json package-lock.json
    git commit -m 'feat: add secure Transport Victoria realtime transit'

### Task 5: Exhaustive research, paid-feed matrix, and production verification

**Files:**

- Create: `docs/vic-au-paid-and-restricted-sources.md`
- Modify: `DATA_SOURCES.md`
- Modify: `docs/CURRENT-STATE.md`
- Modify: `CHANGELOG.md`

**Interfaces:** Documents every source as activated, free-registration, paid, restricted, or rejected. Paid sources are never subscribed to or wired.

- [ ] **Step 1: Repeat official-source searches by jurisdiction and theme**

    Search Victoria, Melbourne, and Australia separately for transport, emergency, fire, flood/water, environment/air, weather, infrastructure, city assets, heritage, biodiversity, maritime, and local-government feeds. Record publisher, endpoint, licence, geometry, refresh, authentication, and decision.

- [ ] **Step 2: Write a paid/restricted feature-cost matrix**

    Include premium imagery, satellite AIS/SAR, commercial traffic/camera feeds, and Port of Melbourne operational feeds. Record published price/tier where available and explicitly state that no paid subscription was created.

- [ ] **Step 3: Update runtime/source docs**

- [ ] **Step 4: Run verification**

    node --test src/data/regionalSources.test.mjs src/data/regionalProxy.test.mjs src/data/regionalLayer.test.mjs src/data/regionalPacks.test.mjs
    npm test
    npm run build

- [ ] **Step 5: Deploy through the guarded updater and verify production**

    Verify container health, Cloudflare host-header HTTP 200, every no-account `/api/regional` source, and PTV through an authenticated server-side smoke test.

- [ ] **Step 6: Commit and push the review branch**

    git add DATA_SOURCES.md docs/CURRENT-STATE.md CHANGELOG.md docs/vic-au-paid-and-restricted-sources.md
    git commit -m 'docs: catalogue Victorian and Australian sources'
    git push -u origin feat/vic-au-data-catalogue
