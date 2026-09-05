import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import {
  REGIONAL_REQUEST_CONCURRENCY,
  REGIONAL_ENTITY_LIMIT,
  REGIONAL_LABEL_LIMIT,
  createRegionalLayer,
  estimateViewportZoom,
} from './regionalLayer.js';

test('capped results remain healthy and expose coverage, counts and source observation time', async () => {
  const { viewer } = viewerStub();
  const layer = createRegionalLayer({ id: 'cap-test', sourceIds: ['melbourne-trees'] });
  await layer.init(viewer);
  await layer.enable(viewer);
  const feature = pointFeature('one', 144.96, -37.81);
  feature.properties.observedAt = '2025-01-02T03:04:05Z';
  await withFetch(async () => response([], 200, {
    headers: { 'x-regional-status': 'partial' },
    body: { ...featureCollection([feature]), sourceStatus: { status: 'partial', capped: true, numberMatched: 100 } },
  }), () => layer.update(viewer));
  const stats = layer.getStats();
  assert.equal(stats.status, 'active');
  assert.equal(stats.error, null);
  assert.equal(stats.capped, true);
  assert.match(stats.loadingLabel, /result limit.*zoom in/);
  assert.equal(stats.sources[0].featureCount, 1);
  assert.equal(stats.sources[0].observedAt, '2025-01-02T03:04:05.000Z');
  assert.equal(stats.sources[0].coverage.numberMatched, 100);
  assert.deepEqual(stats.sourceCounts, { total: 1, loaded: 1, failed: 0, stale: 0, partial: 1 });
  await layer.destroy(viewer);
});

test('stale proxy data stays stale while successful empty coverage is not an outage', async () => {
  const { viewer } = viewerStub();
  const layer = createRegionalLayer({ id: 'stale-test', sourceIds: ['melbourne-trees'] });
  await layer.init(viewer);
  await layer.enable(viewer);
  await withFetch(async () => response([], 200, { headers: { 'x-regional-status': 'stale' } }), () => layer.update(viewer));
  assert.equal(layer.getStats().status, 'stale');
  assert.equal(layer.getStats().stale, true);
  assert.equal(layer.getStats().sources[0].observedAt, null, 'retrieval does not invent an observation time');
  await withFetch(async () => response([], 200, {
    headers: { 'x-regional-status': 'outside-coverage' },
    body: { ...featureCollection([]), sourceStatus: { status: 'outside-coverage', reason: 'Viewport is outside Victoria.' } },
  }), () => layer.update(viewer));
  assert.equal(layer.getStats().status, 'empty');
  assert.equal(layer.getStats().error, null);
  assert.match(layer.getStats().loadingLabel, /outside Victoria/);
  await layer.destroy(viewer);
});

test('camera refresh notifies fresh stats, descriptions escape markup, and destroy detaches the listener', async () => {
  const { viewer, moveEnd, added } = viewerStub();
  const layer = createRegionalLayer({ id: 'listener-test', sourceIds: ['melbourne-trees'] });
  const snapshots = [];
  layer.setStatsListener(() => snapshots.push(layer.getStats()));
  await layer.init(viewer);
  await layer.enable(viewer);
  const feature = pointFeature('one', 144.96, -37.81);
  feature.properties.description = '<img src=x onerror="alert(1)">';
  await withFetch(async () => response([feature]), async () => {
    moveEnd.raise();
    await waitFor(() => snapshots.some((stats) => stats.lastUpdate && stats.count === 1));
  });
  const entity = added[0].entities.values[0];
  const description = entity.description.getValue(Cesium.JulianDate.now());
  assert.match(description, /Publisher:/);
  assert.match(description, /&lt;img/);
  assert.doesNotMatch(description, /<img/);
  assert.equal(entity.properties.regionalSourceId.getValue(), 'melbourne-trees');
  const calls = snapshots.length;
  await layer.destroy(viewer);
  moveEnd.raise();
  assert.equal(snapshots.length, calls);
});

test('one shared request pool bounds packs and individual layers and drops disabled queued work', async () => {
  const { viewer } = viewerStub();
  const layers = [
    createRegionalLayer({ id: 'pool-pack', sourceIds: ['melbourne-trees', 'melbourne-places', 'melbourne-cycling', 'melbourne-water-history'] }),
    ...Array.from({ length: 3 }, (_, index) => createRegionalLayer({ id: `pool-${index}`, sourceIds: ['melbourne-trees'] })),
  ];
  for (const layer of layers) { await layer.init(viewer); await layer.enable(viewer); }
  const gates = [];
  let active = 0;
  let peak = 0;
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    active -= 1;
    return response([]);
  }, async () => {
    const updates = layers.map((layer) => layer.update(viewer));
    await waitFor(() => calls === REGIONAL_REQUEST_CONCURRENCY);
    await layers[3].disable(viewer);
    for (let completed = 0; completed < 6; completed += 1) {
      await waitFor(() => gates.length > 0);
      gates.shift().resolve();
    }
    await Promise.all(updates);
  });
  assert.equal(calls, 6);
  assert.equal(peak, REGIONAL_REQUEST_CONCURRENCY);
  assert.equal(layers[3].getStats().lastUpdate, null);
  for (const layer of layers) await layer.destroy(viewer);
});

function pointFeature(id, longitude, latitude, title = id) {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { title },
  };
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features };
}

function response(features, status = 200, { headers = {}, body = null, modeStatus = undefined } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return headers[String(name).toLowerCase()] ?? null; } },
    async json() { return body || { ...featureCollection(features), ...(modeStatus ? { modeStatus } : {}) }; },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message = 'condition was not met') {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function eventSlot() {
  const listeners = new Set();
  return {
    addEventListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    raise() { for (const listener of [...listeners]) listener(); },
    get size() { return listeners.size; },
  };
}

function viewerStub({
  rectangle = Cesium.Rectangle.fromDegrees(144.8, -37.9, 145.0, -37.7),
  height = 50_000,
} = {}) {
  const moveEnd = eventSlot();
  const added = [];
  const removed = [];
  const viewer = {
    scene: { globe: { ellipsoid: Cesium.Ellipsoid.WGS84 }, requestRender() {} },
    camera: {
      positionCartographic: { height },
      computeViewRectangle: () => rectangle,
      moveEnd,
    },
    dataSources: {
      async add(dataSource) { added.push(dataSource); return dataSource; },
      remove(dataSource, destroy) { removed.push({ dataSource, destroy }); return true; },
    },
  };
  return { viewer, added, removed, moveEnd };
}

test('Vicmap browser requests carry an independently estimated zoom level', async () => {
  const rectangle = Cesium.Rectangle.fromDegrees(144.96, -37.82, 144.962, -37.818);
  const { viewer } = viewerStub({ rectangle, height: 100 });
  viewer.scene.canvas = { clientWidth: 1024 };
  assert.ok(estimateViewportZoom(viewer, { west: 144.96, east: 144.962 }) >= 18);
  const layer = createRegionalLayer({ id: 'regional-planning', sourceIds: ['vic-property-boundaries'] });
  await layer.init(viewer);
  await layer.enable(viewer);
  let requested;
  await withFetch(async (url) => {
    requested = new URL(url, 'http://test');
    return response([]);
  }, () => layer.update(viewer));
  assert.match(requested.pathname, /vic-property-boundaries$/);
  assert.ok(Number(requested.searchParams.get('zoom')) >= 18);
});

async function withFetch(fetchImpl, operation) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await operation();
  } finally {
    globalThis.fetch = previous;
  }
}

test('uses one clustered CustomDataSource and only the regional proxy route', async () => {
  const { viewer, added } = viewerStub();
  const urls = [];
  const layer = createRegionalLayer({
    id: 'regional-victoria',
    sourceIds: ['melbourne-trees'],
    name: 'Victoria',
    icon: 'V',
    color: '#22cc88',
  });

  await layer.init(viewer);
  await layer.enable(viewer);
  await withFetch(async (url) => {
    urls.push(String(url));
    return response([pointFeature('tree-1', 144.96, -37.81)]);
  }, () => layer.update(viewer));

  assert.equal(added.length, 1);
  assert.ok(added[0] instanceof Cesium.CustomDataSource);
  assert.equal(added[0].clustering.enabled, false);
  assert.equal(added[0].entities.values.length, 1);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/api\/regional\/melbourne-trees\?/);
  assert.doesNotMatch(urls[0], /^https?:/);
});

test('retains each source last-good cohort and uniquely names a failed DataVic source', async () => {
  const { viewer, added } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-victoria',
    sourceIds: ['melbourne-trees', 'vic-fire-context'],
    name: 'Victoria',
    icon: 'V',
    color: '#22cc88',
  });
  await layer.init(viewer);
  await layer.enable(viewer);

  let refresh = 0;
  await withFetch(async (url) => {
    const sourceId = new URL(String(url), 'http://test').pathname.split('/').at(-1);
    if (refresh === 1 && sourceId === 'vic-fire-context') throw new Error('offline');
    if (sourceId === 'melbourne-trees') {
      return response([pointFeature(refresh === 0 ? 'tree-old' : 'tree-new', 144.96, -37.81)]);
    }
    return response([pointFeature('fire-old', 144.95, -37.82)]);
  }, async () => {
    assert.equal(await layer.update(viewer), true);
    refresh = 1;
    assert.equal(await layer.update(viewer), true);
  });

  assert.deepEqual(
    added[0].entities.values.map((entity) => entity.id).sort(),
    ['melbourne-trees:tree-new', 'vic-fire-context:fire-old'],
  );
  assert.equal(layer.getStats().count, 2);
  assert.match(layer.getStats().error, /Victoria Fire Context/);
  assert.match(layer.getStats().error, /vic-fire-context/);
  assert.match(layer.getStats().error, /offline/);
});

test('caps labels while retaining the bounded point cohort', async () => {
  const { viewer, added } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-melbourne',
    sourceIds: ['melbourne-trees'],
    name: 'Melbourne',
    icon: 'M',
    color: '#66ddff',
  });
  await layer.init(viewer);
  await layer.enable(viewer);
  const features = Array.from({ length: REGIONAL_LABEL_LIMIT + 25 }, (_, index) => (
    pointFeature(`tree-${index}`, 144.9 + index * 0.0001, -37.82, `Tree ${index}`)
  ));

  await withFetch(async () => response(features), () => layer.update(viewer));

  const entities = added[0].entities.values;
  assert.equal(entities.length, features.length);
  assert.equal(entities.filter((entity) => entity.label).length, REGIONAL_LABEL_LIMIT);
});

test('caps expanded MultiPoint rendering at the global entity budget', async () => {
  const { viewer, added } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-australia',
    sourceIds: ['au-hydrology'],
    name: 'Australia',
    icon: 'A',
    color: '#4488ff',
  });
  await layer.init(viewer);
  await layer.enable(viewer);
  const coordinates = Array.from({ length: REGIONAL_ENTITY_LIMIT + 25 }, (_, index) => [
    144.81 + (index % 100) * 0.001,
    -37.89 + (index % 100) * 0.001,
  ]);

  await withFetch(async () => response([{
    type: 'Feature',
    id: 'many-points',
    geometry: { type: 'MultiPoint', coordinates },
    properties: { title: 'Many points' },
  }]), () => layer.update(viewer));

  assert.equal(added[0].entities.values.length, REGIONAL_ENTITY_LIMIT);
  assert.equal(layer.getStats().count, REGIONAL_ENTITY_LIMIT);
});

test('immediately re-culls then coalesces camera moves into one refresh for the new bbox', async () => {
  let rectangle = Cesium.Rectangle.fromDegrees(144.8, -37.9, 145.0, -37.7);
  const fixture = viewerStub();
  fixture.viewer.camera.computeViewRectangle = () => rectangle;
  const urls = [];
  const layer = createRegionalLayer({
    id: 'regional-melbourne',
    sourceIds: ['melbourne-places'],
    name: 'Melbourne',
    icon: 'M',
    color: '#66ddff',
  });
  await layer.init(fixture.viewer);
  await layer.enable(fixture.viewer);
  await withFetch(async (url) => {
    urls.push(String(url));
    return response(urls.length === 1
      ? [pointFeature('inside', 144.96, -37.81)]
      : [pointFeature('outside', 146.0, -38.5)]);
  }, async () => {
    await layer.update(fixture.viewer);
    assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), ['melbourne-places:inside']);

    rectangle = Cesium.Rectangle.fromDegrees(145.9, -38.6, 146.1, -38.4);
    fixture.moveEnd.raise();
    fixture.moveEnd.raise();
    fixture.moveEnd.raise();
    assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), []);

    await waitFor(() => urls.length === 2, 'camera move did not issue a second request');
    await waitFor(
      () => fixture.added[0].entities.values.some((entity) => entity.id === 'melbourne-places:outside'),
      'new-bounds response was not rendered',
    );
  });

  const movedUrl = new URL(urls[1], 'http://test');
  assert.equal(movedUrl.pathname, '/api/regional/melbourne-places');
  assert.deepEqual(Object.fromEntries(movedUrl.searchParams), {
    west: '145.9',
    south: '-38.6',
    east: '146.1',
    north: '-38.4',
  });
  assert.equal(urls.length, 2);
});

test('disable cancels scheduled and in-flight camera refresh work', async () => {
  let rectangle = Cesium.Rectangle.fromDegrees(144.8, -37.9, 145.0, -37.7);
  const fixture = viewerStub();
  fixture.viewer.camera.computeViewRectangle = () => rectangle;
  const layer = createRegionalLayer({
    id: 'regional-melbourne',
    sourceIds: ['melbourne-places'],
  });
  const cameraResponse = deferred();
  let fetches = 0;
  await layer.init(fixture.viewer);
  await layer.enable(fixture.viewer);

  await withFetch(async () => {
    fetches += 1;
    if (fetches === 1) return response([pointFeature('initial', 144.96, -37.81)]);
    return cameraResponse.promise;
  }, async () => {
    await layer.update(fixture.viewer);
    const initialLastUpdate = layer.getStats().lastUpdate;
    rectangle = Cesium.Rectangle.fromDegrees(145.9, -38.6, 146.1, -38.4);
    fixture.moveEnd.raise();
    await waitFor(() => fetches === 2, 'camera refresh did not start');
    await layer.disable(fixture.viewer);
    cameraResponse.resolve(response([pointFeature('late', 146.0, -38.5)]));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(layer.getStats().lastUpdate, initialLastUpdate);
    assert.equal(layer.getStats().status, 'idle');
    assert.equal(fixture.moveEnd.size, 0);
    assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), []);
  });

  await layer.enable(fixture.viewer);
  fixture.moveEnd.raise();
  await layer.disable(fixture.viewer);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(fetches, 2);
});

test('rapid disable and re-enable isolates active updates by generation', async () => {
  let rectangle = Cesium.Rectangle.fromDegrees(144.8, -37.9, 145.0, -37.7);
  const fixture = viewerStub();
  fixture.viewer.camera.computeViewRectangle = () => rectangle;
  const layer = createRegionalLayer({
    id: 'regional-melbourne',
    sourceIds: ['melbourne-places'],
  });
  const staleResponse = deferred();
  const currentResponse = deferred();
  const urls = [];
  await layer.init(fixture.viewer);
  await layer.enable(fixture.viewer);

  await withFetch(async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return staleResponse.promise;
    if (urls.length === 2) return response([pointFeature('fresh', 146.0, -38.5)]);
    return currentResponse.promise;
  }, async () => {
    const staleUpdate = layer.update(fixture.viewer);
    await waitFor(() => urls.length === 1, 'stale generation did not start');

    await layer.disable(fixture.viewer);
    rectangle = Cesium.Rectangle.fromDegrees(145.9, -38.6, 146.1, -38.4);
    await layer.enable(fixture.viewer);
    const freshUpdate = layer.update(fixture.viewer);
    await waitFor(() => urls.length === 2, 're-enabled generation did not start a fresh request');
    assert.equal(await freshUpdate, true);
    assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), [
      'melbourne-places:fresh',
    ]);
    const freshLastUpdate = layer.getStats().lastUpdate;

    const currentUpdate = layer.update(fixture.viewer);
    await waitFor(() => urls.length === 3, 'current generation follow-up did not start');
    staleResponse.resolve(response([pointFeature('stale', 146.0, -38.5)]));
    assert.equal(await staleUpdate, false);
    assert.equal(layer.getStats().lastUpdate, freshLastUpdate);
    assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), [
      'melbourne-places:fresh',
    ]);

    const coalescedUpdate = layer.update(fixture.viewer);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(urls.length, 3);
    currentResponse.resolve(response([pointFeature('current', 146.0, -38.5)]));
    assert.equal(await currentUpdate, true);
    assert.equal(await coalescedUpdate, true);
    assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), [
      'melbourne-places:current',
    ]);
  });

  assert.deepEqual(
    urls.slice(0, 2).map((url) => Object.fromEntries(new URL(url, 'http://test').searchParams)),
    [
      { west: '144.8', south: '-37.9', east: '145', north: '-37.7' },
      { west: '145.9', south: '-38.6', east: '146.1', north: '-38.4' },
    ],
  );
});

for (const outcome of ['resolution', 'rejection']) {
  test(`destroy prevents deferred fetch ${outcome} from repopulating layer state`, async () => {
    const fixture = viewerStub();
    const layer = createRegionalLayer({
      id: 'regional-melbourne',
      sourceIds: ['melbourne-places'],
    });
    const pending = deferred();
    await layer.init(fixture.viewer);
    await layer.enable(fixture.viewer);

    await withFetch(async () => pending.promise, async () => {
      const updatePromise = layer.update(fixture.viewer);
      await layer.destroy(fixture.viewer);
      if (outcome === 'resolution') {
        pending.resolve(response([pointFeature('late', 144.96, -37.81)]));
      } else {
        pending.reject(new Error('late failure'));
      }
      assert.equal(await updatePromise, false);
    });

    assert.equal(fixture.moveEnd.size, 0);
    assert.deepEqual(fixture.added[0].entities.values, []);
    assert.deepEqual(layer.getStats(), {
      count: 0,
      lastUpdate: null,
      error: null,
      status: 'idle',
      sourceErrors: {},
      sourceStatus: {},
      sources: [],
    });
  });
}

test('zoom culling avoids browser fetches and reports guidance instead of a feed error', async () => {
  const { viewer, added } = viewerStub({
    rectangle: Cesium.Rectangle.fromDegrees(130, -45, 155, -20),
    height: 4_000_000,
  });
  const layer = createRegionalLayer({
    id: 'regional-australia',
    sourceIds: ['au-hydrology'],
    name: 'Australia',
    icon: 'A',
    color: '#4488ff',
  });
  await layer.init(viewer);
  await layer.enable(viewer);
  let fetches = 0;
  const updated = await withFetch(async () => { fetches += 1; return response([]); }, () => layer.update(viewer));

  assert.equal(updated, true);
  assert.equal(fetches, 0);
  assert.equal(added[0].entities.values.length, 0);
  assert.equal(layer.getStats().status, 'zoom-in');
  assert.equal(layer.getStats().error, null);
});

test('preserves sanitized credentials-required status from a 424 response', async () => {
  const { viewer } = viewerStub();
  const layer = createRegionalLayer({ id: 'regional-victoria', sourceIds: ['ptv-transit'] });
  await layer.init(viewer);
  await layer.enable(viewer);

  const updated = await withFetch(async () => response([], 424, {
    headers: { 'x-regional-status': 'credentials-required' },
    body: { error: 'regional source credentials required' },
  }), () => layer.update(viewer));

  assert.equal(updated, false);
  assert.deepEqual(layer.getStats().sourceStatus, {
    'ptv-transit': { status: 'credentials-required', modes: {} },
  });
  assert.equal(layer.getStats().status, 'unavailable');
  assert.match(layer.getStats().error, /credentials required/);
  assert.doesNotMatch(layer.getStats().error, /HTTP 424/);
});

test('reports a known registration-gated category source without fetching it', async () => {
  const { viewer } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-environment',
    sourceIds: ['vic-epa-air'],
  });
  let fetchCalls = 0;
  await layer.init(viewer);
  await layer.enable(viewer);
  const updated = await withFetch(async () => {
    fetchCalls += 1;
    return response([]);
  }, () => layer.update(viewer));
  assert.equal(updated, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(layer.getStats().sourceStatus, {
    'vic-epa-air': { status: 'credentials-required', modes: {} },
  });
  assert.equal(layer.getStats().status, 'unavailable');
  assert.match(layer.getStats().error, /EPA Victoria registration required/);
  assert.deepEqual(layer.getStats().sources, [{
    sourceId: 'vic-epa-air',
    name: 'Victoria Air Quality',
    status: 'credentials-required',
    freshnessClass: null,
    observedAt: null,
    ageMs: null,
    error: 'EPA Victoria registration required',
    officialUrl: null,
    featureCount: 0,
    refresh: 'not fetched; provider contract unverified',
    caveat: null,
    coverage: null,
  }]);
});

test('getStats exposes per-source evidence without losing exact observation time', async () => {
  const { viewer } = viewerStub();
  const layer = createRegionalLayer({ id: 'regional-environment', sourceIds: ['vic-flood-history-2022'] });
  await layer.init(viewer);
  await layer.enable(viewer);
  await withFetch(async () => response([{
    ...pointFeature('flood-1', 144.96, -37.81),
    properties: { observedAt: '2022-11-01T00:00:00Z' },
  }]), () => layer.update(viewer));

  const [source] = layer.getStats().sources;
  assert.equal(source.sourceId, 'vic-flood-history-2022');
  assert.equal(source.name, 'Victorian Flood History - October 2022 Event Public');
  assert.equal(source.status, 'fresh');
  assert.equal(source.freshnessClass, 'historical');
  assert.equal(source.observedAt, '2022-11-01T00:00:00.000Z');
  assert.ok(source.ageMs > 0);
  assert.match(source.officialUrl, /^https:\/\//);
  assert.equal(source.error, null);
});

test('credential denial clears prior PTV vehicles and repeated denial cannot resurrect them', async () => {
  const { viewer, added } = viewerStub();
  const layer = createRegionalLayer({ id: 'regional-victoria', sourceIds: ['ptv-transit'] });
  await layer.init(viewer);
  await layer.enable(viewer);

  let request = 0;
  await withFetch(async () => {
    request += 1;
    if (request === 1) return response([pointFeature('ptv-safe', 144.96, -37.81)]);
    return response([], 424, {
      headers: { 'x-regional-status': 'credentials-required' },
      body: { error: 'regional source credentials required' },
    });
  }, async () => {
    assert.equal(await layer.update(viewer), true);
    assert.deepEqual(added[0].entities.values.map((entity) => entity.id), [
      'ptv-transit:ptv-safe',
    ]);

    assert.equal(await layer.update(viewer), false);
    assert.deepEqual(added[0].entities.values, []);
    assert.equal(layer.getStats().count, 0);
    assert.equal(layer.getStats().status, 'unavailable');
    assert.deepEqual(layer.getStats().sourceStatus, {
      'ptv-transit': { status: 'credentials-required', modes: {} },
    });

    assert.equal(await layer.update(viewer), false);
    assert.deepEqual(added[0].entities.values, []);
    assert.equal(layer.getStats().count, 0);
    assert.equal(layer.getStats().status, 'unavailable');
    assert.deepEqual(layer.getStats().sourceStatus, {
      'ptv-transit': { status: 'credentials-required', modes: {} },
    });
  });
});

test('PTV credential denial does not clear another source transient last-good cohort', async () => {
  const { viewer, added } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-victoria',
    sourceIds: ['ptv-transit', 'vic-fire-context'],
  });
  await layer.init(viewer);
  await layer.enable(viewer);

  let refresh = 0;
  await withFetch(async (url) => {
    const sourceId = new URL(String(url), 'http://test').pathname.split('/').at(-1);
    if (refresh === 0 && sourceId === 'ptv-transit') {
      return response([pointFeature('ptv-safe', 144.96, -37.81)]);
    }
    if (refresh === 0) return response([pointFeature('fire-safe', 144.95, -37.82)]);
    if (sourceId === 'ptv-transit') {
      return response([], 424, {
        headers: { 'x-regional-status': 'credentials-required' },
        body: { error: 'regional source credentials required' },
      });
    }
    throw new Error('temporary fire feed failure');
  }, async () => {
    assert.equal(await layer.update(viewer), true);
    refresh = 1;
    assert.equal(await layer.update(viewer), true);
  });

  assert.deepEqual(added[0].entities.values.map((entity) => entity.id), [
    'vic-fire-context:fire-safe',
  ]);
  assert.equal(layer.getStats().count, 1);
  assert.equal(layer.getStats().status, 'degraded');
  assert.equal(layer.getStats().sourceStatus['ptv-transit'].status, 'credentials-required');
  assert.match(layer.getStats().error, /temporary fire feed failure/);
});

test('surfaces per-mode stale and unavailable status as degraded while retaining available vehicles', async () => {
  const { viewer } = viewerStub();
  const layer = createRegionalLayer({ id: 'regional-victoria', sourceIds: ['ptv-transit'] });
  await layer.init(viewer);
  await layer.enable(viewer);
  const modeStatus = {
    metro: { status: 'current', feedTimestamp: 1_800_000_000, feedAgeSeconds: 10 },
    tram: { status: 'stale', feedTimestamp: 1_799_999_850, feedAgeSeconds: 150 },
    bus: { status: 'unavailable' },
    vline: { status: 'current', feedTimestamp: 1_800_000_000, feedAgeSeconds: 10 },
  };

  assert.equal(await withFetch(async () => response(
    [pointFeature('ptv-safe', 144.96, -37.81)],
    200,
    { headers: { 'x-regional-status': 'degraded' }, modeStatus },
  ), () => layer.update(viewer)), true);

  assert.equal(layer.getStats().status, 'degraded');
  assert.deepEqual(layer.getStats().sourceStatus['ptv-transit'], { status: 'degraded', modes: modeStatus });
  assert.match(layer.getStats().error, /tram stale/);
  assert.match(layer.getStats().error, /bus unavailable/);
});

test('disable hides and detaches camera work while destroy removes the owned source', async () => {
  const { viewer, added, removed, moveEnd } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-melbourne',
    sourceIds: ['melbourne-places'],
    name: 'Melbourne',
    icon: 'M',
    color: '#66ddff',
  });
  await layer.init(viewer);
  await layer.enable(viewer);
  assert.equal(moveEnd.size, 1);
  assert.equal(added[0].show, true);

  await layer.disable(viewer);
  assert.equal(moveEnd.size, 0);
  assert.equal(added[0].show, false);

  await layer.destroy(viewer);
  assert.deepEqual(removed, [{ dataSource: added[0], destroy: true }]);
  assert.deepEqual(layer.getStats(), { count: 0, lastUpdate: null, error: null, status: 'idle', sourceErrors: {}, sourceStatus: {}, sources: [] });
});
