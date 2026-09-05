import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';

import {
  REGIONAL_ENTITY_LIMIT,
  REGIONAL_LABEL_LIMIT,
  createRegionalLayer,
} from './regionalLayer.js';

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

function response(features, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return featureCollection(features); },
  };
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
    sourceIds: ['vic-epa-air'],
    name: 'Victoria',
    icon: 'V',
    color: '#22cc88',
  });

  await layer.init(viewer);
  await layer.enable(viewer);
  await withFetch(async (url) => {
    urls.push(String(url));
    return response([pointFeature('epa-1', 144.96, -37.81)]);
  }, () => layer.update(viewer));

  assert.equal(added.length, 1);
  assert.ok(added[0] instanceof Cesium.CustomDataSource);
  assert.equal(added[0].clustering.enabled, true);
  assert.equal(added[0].entities.values.length, 1);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/api\/regional\/vic-epa-air\?/);
  assert.doesNotMatch(urls[0], /^https?:/);
});

test('retains each source last-good cohort and names a failed source honestly', async () => {
  const { viewer, added } = viewerStub();
  const layer = createRegionalLayer({
    id: 'regional-victoria',
    sourceIds: ['vic-epa-air', 'vic-fire-context'],
    name: 'Victoria',
    icon: 'V',
    color: '#22cc88',
  });
  await layer.init(viewer);
  await layer.enable(viewer);

  let refresh = 0;
  await withFetch(async (url) => {
    const sourceId = new URL(String(url), 'http://test').pathname.split('/').at(-1);
    if (refresh === 1 && sourceId === 'vic-epa-air') throw new Error('offline');
    if (sourceId === 'vic-epa-air') return response([pointFeature('epa-old', 144.96, -37.81)]);
    return response([pointFeature(refresh === 0 ? 'fire-old' : 'fire-new', 144.95, -37.82)]);
  }, async () => {
    assert.equal(await layer.update(viewer), true);
    refresh = 1;
    assert.equal(await layer.update(viewer), true);
  });

  assert.deepEqual(
    added[0].entities.values.map((entity) => entity.id).sort(),
    ['vic-epa-air:epa-old', 'vic-fire-context:fire-new'],
  );
  assert.equal(layer.getStats().count, 2);
  assert.match(layer.getStats().error, /EPA Victoria/);
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

test('culls off-viewport records and re-culls the last-good cohort on camera movement', async () => {
  let rectangle = Cesium.Rectangle.fromDegrees(144.8, -37.9, 145.0, -37.7);
  const fixture = viewerStub();
  fixture.viewer.camera.computeViewRectangle = () => rectangle;
  const layer = createRegionalLayer({
    id: 'regional-melbourne',
    sourceIds: ['melbourne-places'],
    name: 'Melbourne',
    icon: 'M',
    color: '#66ddff',
  });
  await layer.init(fixture.viewer);
  await layer.enable(fixture.viewer);
  await withFetch(async () => response([
    pointFeature('inside', 144.96, -37.81),
    pointFeature('outside', 146.0, -38.5),
  ]), () => layer.update(fixture.viewer));

  assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), ['melbourne-places:inside']);
  rectangle = Cesium.Rectangle.fromDegrees(145.9, -38.6, 146.1, -38.4);
  fixture.moveEnd.raise();
  assert.deepEqual(fixture.added[0].entities.values.map((entity) => entity.id), ['melbourne-places:outside']);
});

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
  assert.deepEqual(layer.getStats(), { count: 0, lastUpdate: null, error: null, status: 'idle', sourceErrors: {} });
});
