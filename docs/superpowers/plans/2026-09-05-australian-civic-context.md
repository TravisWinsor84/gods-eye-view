# Australian Civic Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain the current map state at a glance and add only validated official civic-status overlays.

**Architecture:** A pure context model translates map/location/selection/source state into safe display strings. A small always-visible DOM card renders that model; it never fetches. Civic data remains independent regional sources behind the proxy and is activated only after source-specific legal and technical validation.

**Tech Stack:** Vanilla ES modules, existing DOM/Cesium app, Vite proxy, node:test.

**Spec:** `docs/superpowers/specs/2026-09-05-australian-civic-context-design.md`

## Global Constraints

- No patient, staff, ambulance, security, or critical-infrastructure operational data.
- Use official, display-compatible sources only; no scraping or camera-frame retention beyond stated terms.
- No browser credentials or arbitrary upstream URLs.
- Show source, timestamp, stale/error state and official link for every civic datum.
- Keep the orientation card functional when every external source is unavailable.

---

### Task 1: Pure map-context model

**Files:** Create `src/mapContext.js`; create `src/mapContext.test.mjs`.

**Interfaces:** Export `buildMapContext({ location, selection, camera, enabledLayers, sources, now })` returning `{ title, hierarchy, coordinates, explanation, sourceSummary, isStale, officialUrl }`; export `clampContextLabel(value, maxLines = 2)`.

- [ ] **Step 1: Write failing tests**

```js
test('falls back to coordinates when location is unresolved', () => {
  assert.match(buildMapContext({ location: { longitude: 144.9631, latitude: -37.8136 } }).title, /37\.8136/);
});
test('marks stale source data without hiding last-good provenance', () => {
  const result = buildMapContext({ sources: [{ name: 'EPA Victoria', observedAt: 1, stale: true, officialUrl: 'https://epa.vic.gov.au/' }], now: 2 });
  assert.equal(result.isStale, true);
  assert.equal(result.officialUrl, 'https://epa.vic.gov.au/');
});
```

- [ ] **Step 2: Run** `node --test src/mapContext.test.mjs` **and confirm failure.**
- [ ] **Step 3: Implement pure normalization.** Reject unsafe URLs, collapse whitespace, use coordinate fallback, and return no HTML strings.
- [ ] **Step 4: Run** `node --test src/mapContext.test.mjs` **and confirm pass.**
- [ ] **Step 5: Commit** `git add src/mapContext.js src/mapContext.test.mjs && git commit -m 'feat: model map orientation context'`.

### Task 2: Accessible always-visible Context card

**Files:** Modify `index.html`; modify the existing stylesheet that owns `#location-mini-city`; modify `src/main.js`; create `src/mapContextDom.js`; create `src/mapContextDom.test.mjs`.

**Interfaces:** `renderMapContext(root, context)` receives Task 1 output and uses `textContent`, `hidden`, `aria-expanded`, and a normal anchor with `rel="noopener noreferrer"`; `main.js` calls it after resolved location, camera selection, source status, and layer changes.

- [ ] **Step 1: Write failing DOM tests** for compact two-line label, expanded source/timestamp, safe official link, and unavailable/stale copy.
- [ ] **Step 2: Run** `node --test src/mapContextDom.test.mjs` **and confirm failure.**
- [ ] **Step 3: Add the lower-left `<aside id="map-context-card" aria-label="Map context">`** with a compact summary, Details toggle, and source link. Preserve existing location bar and cockpit context behavior.
- [ ] **Step 4: Implement DOM rendering and lifecycle wiring.** Do not add fetches, inline handlers, or unsafe `innerHTML`.
- [ ] **Step 5: Add responsive CSS**: fixed lower-left placement outside the Cesium controls, fixed readable width, two-line clamp, keyboard-visible focus, and a narrow-screen stack that avoids the location bar.
- [ ] **Step 6: Run** focused tests and `npm run build`; manually test a resolved Melbourne location, unresolved coordinates, selected camera, selection with official source, and a 320px viewport.
- [ ] **Step 7: Commit** `git add index.html src/main.js src/mapContextDom.js src/mapContextDom.test.mjs <verified-style-file> && git commit -m 'feat: explain current map context'`.

### Task 3: Civic source acceptance and adapter contracts

**Files:** Modify `src/data/regionalSources.js`; modify `src/data/regionalSources.test.mjs`; modify `DATA_SOURCES.md`; create `docs/australian-civic-source-validation.md`.

**Interfaces:** Add a source only after the validation record contains `publisher`, `officialUrl`, `endpoint`, `licence`, `cacheMs`, `geometry`, `sensitivityReview`, and `runtimeEligible`. A rejected source has `runtimeEligible: false` and no proxy request template.

- [ ] **Step 1: Create the validation record format** and write a test that rejected hospital/camera candidates throw before normalization/fetch.
- [ ] **Step 2: Validate current official hospital and local-camera candidates live**: confirm endpoint, current terms, attribution, field semantics, response size, and CORS/proxy behavior. Record non-machine-readable or restricted products as rejected; do not scrape them.
- [ ] **Step 3: Add only candidates that pass every contract field.** Hospital values must be aggregate period-based pressure/performance, never individual wait/capacity. Camera entries must be metadata/link-only unless terms explicitly permit still-image display.
- [ ] **Step 4: Run** source tests and document exact attribution, freshness and decision.
- [ ] **Step 5: Commit** `git add src/data/regionalSources.js src/data/regionalSources.test.mjs DATA_SOURCES.md docs/australian-civic-source-validation.md && git commit -m 'docs: validate Australian civic source candidates'`.

### Task 4: Civic pack and source-status integration

**Files:** Modify `src/data/regionalProxy.js`; modify `src/data/regionalProxy.test.mjs`; modify `src/data/regionalPacks.js`; modify `src/data/regionalPacks.test.mjs`; modify `src/data/layerState.js`; modify `src/main.js`.

**Interfaces:** A `regional-civic-status` layer contains only Task 3-eligible source IDs. Proxy responses expose sanitized `{ source, observedAt, stale, officialUrl }` metadata. `mapContext` consumes that status without depending on Cesium entities.

- [ ] **Step 1: Write failing tests** that unsupported sources are not present in the pack and stale last-good metadata reaches the context model.
- [ ] **Step 2: Register the pack only when it has one or more eligible sources.** Keep it off by default and serializable through existing layer state.
- [ ] **Step 3: Reuse proxy bounds, payload cap, timeout, cache and error-isolation rules.** Add source-specific caps/TTLs based on the Task 3 record.
- [ ] **Step 4: Test** enable/disable/destroy, unavailable-source messaging, stale recovery, source provenance, and share-state round-trip.
- [ ] **Step 5: Run** focused suites, `npm test`, and `npm run build`.
- [ ] **Step 6: Commit** `git add src/data/regionalProxy.js src/data/regionalProxy.test.mjs src/data/regionalPacks.js src/data/regionalPacks.test.mjs src/data/layerState.js src/main.js && git commit -m 'feat: add validated civic status overlays'`.

### Task 5: Documentation and live verification

**Files:** Modify `docs/CURRENT-STATE.md`; modify `CHANGELOG.md`; modify `DATA_SOURCES.md`.

- [ ] **Step 1: Document the Context card, all enabled sources, and every unavailable/rejected candidate with its reason.**
- [ ] **Step 2: Run** `npm test` and `npm run build`.
- [ ] **Step 3: Deploy through the guarded updater only after the existing source branch/deployment decision is approved; verify Cloudflare Access, desktop/narrow context card, and each enabled no-account endpoint.**
- [ ] **Step 4: Commit** `git add docs/CURRENT-STATE.md CHANGELOG.md DATA_SOURCES.md && git commit -m 'docs: describe civic map context'`.
