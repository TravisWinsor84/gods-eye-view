# Victorian and Australian Raster Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rights-clear Australian earth-observation, terrain and hazard-model imagery as fixed, attributable Cesium context layers.

**Architecture:** A server-only imagery registry maps safe local IDs to exact WMS/ArcGIS services and layer names. The proxy validates extent, dimensions, CRS and format before fetching capped image bytes; the browser cannot choose upstream URLs or arbitrary layers. Cesium imagery adapters expose modelled/historical meaning and attribution separately from vector data.

**Tech Stack:** Vite middleware, Node test runner, Cesium imagery layers, OGC WMS 1.3.0, ArcGIS MapServer export.

**Spec:** `docs/superpowers/specs/2026-09-05-expanded-vic-au-overlays-design.md`

## Global Constraints

- Only exact allow-listed service hosts, layer names, formats and CRS values are accepted.
- Browser dimensions are integers from 64 to 1024 and bbox uses the existing finite/max-span validation.
- Image responses have content-type and byte caps, timeout, redirect rejection, cache bounds and sanitized errors.
- Every layer states whether it is annual, historical, modelled or observation-derived; none is a live warning.
- BOM imagery is excluded until a redistribution licence exists.
- Credentials and arbitrary WMS parameters never pass through the browser.

---

### Task 1: Fixed regional imagery registry and proxy

**Files:**

- Create: `src/data/regionalImagery.js`
- Create: `src/data/regionalImagery.test.mjs`
- Create: `src/data/regionalImageryProxy.js`
- Create: `src/data/regionalImageryProxy.test.mjs`
- Modify: `vite.config.js`
- Modify: `DATA_SOURCES.md`

**Interfaces:**

- Produces `REGIONAL_IMAGERY_SOURCES`, `buildRegionalImageryUrl(id, request)` and `createRegionalImageryProxy()` at `/api/regional-imagery/<id>`.
- Initial IDs: `au-dea-land-cover`, `au-dea-water-history`, `au-ga-relief`, `au-seismic-hazard`.

- [ ] **Step 1: Write failing registry/security tests**

```js
test('rejects arbitrary imagery IDs and WMS parameters before fetch', async () => {
  assert.equal((await request('/api/regional-imagery/unknown?west=144&south=-38&east=145&north=-37&width=512&height=512')).status, 404);
  assert.equal((await request('/api/regional-imagery/au-dea-land-cover?layers=evil&west=144&south=-38&east=145&north=-37&width=512&height=512')).status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('pins DEA land cover to the verified layer name', () => {
  const url = buildRegionalImageryUrl('au-dea-land-cover', REQUEST);
  assert.equal(url.searchParams.get('layers'), 'ga_ls_landcover');
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/regionalImagery.test.mjs src/data/regionalImageryProxy.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the exact allow-list**

```js
export const REGIONAL_IMAGERY_SOURCES = Object.freeze({
  'au-dea-land-cover': { kind: 'wms', base: 'https://ows.dea.ga.gov.au/', layer: 'ga_ls_landcover', freshnessClass: 'annual' },
  'au-dea-water-history': { kind: 'wms', base: 'https://ows.dea.ga.gov.au/', layer: 'water_observations', freshnessClass: 'historical' },
  'au-ga-relief': { kind: 'wms', base: 'https://services.ga.gov.au/gis/services/DEM_SRTM_1Second/MapServer/WMSServer', layer: '0', freshnessClass: 'reference' },
  'au-seismic-hazard': { kind: 'arcgis-export', base: 'https://services.ga.gov.au/gis/rest/services/National_Seismic_Hazard_Assessment_2018/MapServer/export', layer: 'show:0', freshnessClass: 'modelled' },
});
```

Generate only PNG requests with fixed transparency/style, output CRS EPSG:3857 or CRS84 as verified per service, and server-controlled layer/time defaults. Validate upstream content type begins `image/png`, reject XML/service-exception bodies, cap at 8 MiB and cache by full safe tile request.

- [ ] **Step 4: Test timeout, size/type failures, cache and source attribution**

Run: `node --test src/data/regionalImagery.test.mjs src/data/regionalImageryProxy.test.mjs src/devFreshDotenv.test.mjs`

Expected: PASS with no arbitrary URL/layer/format path.

- [ ] **Step 5: Run full verification and commit**

```bash
npm test
npm run build
git diff --check
git add src/data/regionalImagery.js src/data/regionalImagery.test.mjs src/data/regionalImageryProxy.js src/data/regionalImageryProxy.test.mjs vite.config.js DATA_SOURCES.md
git commit -m 'feat: proxy Australian raster context safely'
```

### Task 2: Cesium regional imagery lifecycle

**Files:**

- Create: `src/data/regionalImageryLayer.js`
- Create: `src/data/regionalImageryLayer.test.mjs`
- Modify: `src/data/layerState.js`
- Modify: `src/data/layerState.test.mjs`
- Modify: `src/main.js`

**Interfaces:** Produces `createRegionalImageryLayer({ id, sourceId, name, icon, alpha })` and off-by-default serializable imagery layers using Cesium `WebMapServiceImageryProvider` or `UrlTemplateImageryProvider` against the local proxy only.

- [ ] **Step 1: Write failing lifecycle/state tests**

```js
test('imagery provider points only at the local fixed route', async () => {
  const layer = createRegionalImageryLayer({ id: 'imagery-dea-land-cover', sourceId: 'au-dea-land-cover', name: 'DEA Land Cover' });
  await layer.enable();
  assert.match(createdProvider.url, /^\/api\/regional-imagery\/au-dea-land-cover/);
});

test('destroy removes the imagery layer and ignores deferred completion', async () => {
  const pending = layer.enable();
  await layer.destroy();
  resolveProvider();
  await pending;
  assert.equal(viewer.imageryLayers.length, 0);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/data/regionalImageryLayer.test.mjs src/data/layerState.test.mjs`

Expected: FAIL because the imagery lifecycle does not exist.

- [ ] **Step 3: Implement manager-compatible init/enable/disable/destroy/stats**

Use one owned imagery layer, generation-safe async creation, explicit alpha, zoom bounds, credit object and source status. Do not add vector entities or bypass the existing layer manager.

- [ ] **Step 4: Register four exact off-by-default layer IDs before finalization**

Use `imagery-dea-land-cover`, `imagery-dea-water-history`, `imagery-ga-relief`, and `imagery-seismic-hazard`; update the literal exact registry count in its test.

- [ ] **Step 5: Verify and commit**

```bash
node --test src/data/regionalImageryLayer.test.mjs src/data/layerState.test.mjs
npm test
npm run build
git diff --check
git add src/data/regionalImageryLayer.js src/data/regionalImageryLayer.test.mjs src/data/layerState.js src/data/layerState.test.mjs src/main.js
git commit -m 'feat: add Australian raster context layers'
```

### Task 3: Imagery meaning, attribution and responsive UI

**Files:**

- Modify: `src/mapContext.js`
- Modify: `src/mapContext.test.mjs`
- Modify: `src/mapContextDom.js`
- Modify: `src/mapContextDom.test.mjs`
- Modify: `src/style.css`
- Modify: `DATA_SOURCES.md`

**Interfaces:** Adds imagery source entries to the Context card with `freshnessClass`, source date/model version, credit and caveat.

- [ ] **Step 1: Write failing meaning/accessibility tests**

```js
test('water history is never described as a live flood layer', () => {
  const context = buildMapContext({ imagery: [{ sourceId: 'au-dea-water-history', enabled: true }] });
  assert.equal(context.imagery[0].freshnessClass, 'historical');
  assert.doesNotMatch(context.imagery[0].summary, /live flood/i);
});
```

- [ ] **Step 2: Confirm RED**

Run: `node --test src/mapContext.test.mjs src/mapContextDom.test.mjs`

Expected: FAIL because imagery meaning is not included.

- [ ] **Step 3: Render compact source rows with exact caveats**

Show annual year/model version when available, historical/modelled badges, official links and attribution. Source names wrap inside the 320 px rail without covering controls.

- [ ] **Step 4: Verify and commit**

```bash
node --test src/mapContext.test.mjs src/mapContextDom.test.mjs
npm test
npm run build
git diff --check
git add src/mapContext.js src/mapContext.test.mjs src/mapContextDom.js src/mapContextDom.test.mjs src/style.css DATA_SOURCES.md
git commit -m 'feat: explain Australian raster context'
```

### Task 4: Live service and visual verification

**Files:**

- Create: `docs/vic-au-imagery-verification.md`
- Modify: `docs/CURRENT-STATE.md`
- Modify: `CHANGELOG.md`

**Interfaces:** Produces source-by-source provider, proxy and browser proof for every imagery layer.

- [ ] **Step 1: Smoke exact upstream requests and local proxy requests**

Record status, MIME, bytes, cache state and image dimensions only. Confirm service-exception XML is rejected and no arbitrary query survives.

- [ ] **Step 2: Run full tests/build and independent review**

Run: `npm test && npm run build && git diff --check`

Expected: PASS.

- [ ] **Step 3: After explicit deployment approval, visually verify each layer**

Check Melbourne, regional Victoria and national extents; alpha/zoom; attribution; Context meaning; error state; dark mode; and 320 px rail layout.

- [ ] **Step 4: Commit verification evidence**

```bash
git add docs/vic-au-imagery-verification.md docs/CURRENT-STATE.md CHANGELOG.md
git commit -m 'docs: verify Australian raster context'
```
