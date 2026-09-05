import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapFeatureInspector, featureInspectorModel } from './mapFeatureInspector.js';
import { readMapContextClick, readRegionalContextSelection } from './mapContextLocation.js';
import { registerPickOwner, unregisterPickOwner } from './data/pickRegistry.js';

function harness() {
  const changes = [], calls = [], markers = new Set(), timers = new Map(), listeners = new Map();
  let action, selection, destroyed = false;
  const point = { latitude: -37.8, longitude: 145, height: 180 };
  const worldPoint = { ...point, x: 6378000, y: 0, z: 0 };
  const Cesium = {
    ScreenSpaceEventHandler: class { setInputAction(fn) { action = fn; } destroy() { destroyed = true; } },
    ScreenSpaceEventType: { LEFT_CLICK: 1 }, Color: { TRANSPARENT: 'clear', WHITE: 'white' },
    Cartesian3: { fromDegrees: (longitude, latitude, height) => ({ longitude, latitude, height }) },
    Cartographic: { fromCartesian: ({ latitude, longitude, height }) => ({ latitude, longitude, height }) }, Math: { toDegrees: (v) => v },
  };
  const viewer = { scene: { canvas: {}, pick: () => ({}), drillPick: () => [viewer.scene.pick()],
    pickPositionSupported: true, pickPosition: () => worldPoint, globe: { pick: () => null } },
  camera: { getPickRay: () => ({}), pickEllipsoid: () => null }, clock: {},
  entities: { add: (e) => { markers.add(e); return e; }, remove: (e) => markers.delete(e) },
  selectedEntityChanged: { addEventListener: (fn) => { selection = fn; return () => { selection = null; }; } } };
  const inspector = createMapFeatureInspector({ viewer, Cesium, onChange: (v) => changes.push(v),
    fetchFeature: (lat, lon, { signal }) => new Promise((resolve, reject) => calls.push({ lat, lon, signal, resolve, reject })),
    schedule: (fn) => { timers.set(fn, fn); return fn; }, cancel: (id) => timers.delete(id),
    documentRef: { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key) => listeners.delete(key) } });
  return { viewer, Cesium, inspector, changes, calls, markers, timers, listeners, point, worldPoint,
    click: () => action({ position: { x: 123, y: 456 } }), select: (e) => selection(e), destroyed: () => destroyed };
}

test('roof pick preserves actual coordinates and height, invalid depth falls back and sky stays empty', () => {
  const h = harness();
  let pixel;
  h.viewer.scene.pickPosition = (p) => { pixel = p; return h.worldPoint; };
  assert.deepEqual(readMapContextClick(h.viewer, h.Cesium, { x: 12, y: 45 }, {}), h.point);
  assert.deepEqual(pixel, { x: 12, y: 45 });
  h.viewer.scene.pickPosition = () => ({ x: NaN, y: 1, z: 2 });
  h.viewer.scene.globe.pick = () => h.worldPoint;
  assert.deepEqual(readMapContextClick(h.viewer, h.Cesium, pixel, {}), h.point);
  h.viewer.scene.pickPosition = () => ({ x: 500, y: 0, z: 0 });
  assert.deepEqual(readMapContextClick(h.viewer, h.Cesium, pixel, {}), h.point);
  h.viewer.scene.globe.pick = () => null;
  assert.equal(readMapContextClick(h.viewer, h.Cesium, pixel, {}), null);
  h.inspector.dispose();
});

test('late response cannot overwrite newer click, null native selection does not cancel building', async () => {
  const h = harness();
  const first = h.click();
  assert.equal(h.changes.at(-1).status, 'loading');
  assert.equal([...h.markers][0].position.height, 180);
  h.select(undefined);
  assert.equal(h.calls[0].signal.aborted, false);
  const second = h.click();
  assert.equal(h.calls[0].signal.aborted, true);
  h.calls[1].resolve({ name: 'New', coordinates: { latitude: 1, longitude: 2 }, address: 'Nearby' });
  await second;
  h.calls[0].resolve({ name: 'Old' }); await first;
  assert.equal(h.changes.at(-1).label, 'New');
  assert.deepEqual(h.changes.at(-1).point, h.point);
  h.select({ id: 'flight' });
  assert.equal(h.changes.at(-1), null);
  assert.equal(h.markers.size, 0);
  h.inspector.dispose();
});

test('escape, timeout and dispose cancel pending work and release owned resources', async () => {
  for (const mode of ['escape', 'timeout', 'dispose']) {
    const h = harness(); const pending = h.click();
    if (mode === 'escape') h.listeners.get('keydown')({ key: 'Escape' });
    if (mode === 'timeout') [...h.timers.values()][0]();
    if (mode === 'dispose') h.inspector.dispose();
    assert.equal(h.calls[0].signal.aborted, true);
    const count = h.changes.length;
    h.calls[0].resolve({ name: 'Late' }); await pending;
    assert.equal(h.changes.length, count);
    if (mode === 'timeout') assert.equal(h.changes.at(-1).status, 'error');
    h.inspector.dispose();
    assert.equal(h.timers.size, 0); assert.equal(h.markers.size, 0);
    assert.equal(h.listeners.size, 0); assert.equal(h.destroyed(), true);
  }
});

test('regional priority preserves entity identity, source fields bounded, and layer hiding clears ring', async () => {
  const h = harness();
  const entity = { id: 'trees:42', name: '<b>Tree</b>', properties: {
    regionalSourceId: 'melbourne-trees', regionalPublisher: 'internal', description: 'Useful tree description',
    scientific_name: 'Elm', nested: {}, bad: Infinity, flag: false,
  } };
  h.viewer.scene.drillPick = () => [{ id: entity }];
  await h.click();
  assert.equal(h.viewer.selectedEntity, entity);
  assert.equal(h.calls.length, 0);
  assert.equal(h.changes.at(-1).identity, entity.id);
  assert.deepEqual(h.changes.at(-1).fields.map((f) => f.label), ['Description', 'Scientific Name', 'Flag']);
  assert.equal(readRegionalContextSelection({ ...entity, id: 'trees:43' }).identity, 'trees:43');
  entity.isShowing = false; h.inspector.sync();
  assert.equal(h.changes.at(-1), null); assert.equal(h.markers.size, 0);
  h.inspector.dispose();
});

test('top flight pick keeps existing ownership even above a regional point; terrain has no request', async () => {
  const h = harness();
  registerPickOwner('test-flight', (id) => id === 'flight');
  try {
    h.viewer.scene.pick = () => ({ id: 'flight' });
    h.viewer.scene.drillPick = () => [{ id: { properties: { regionalSourceId: 'melbourne-trees' } } }];
    await h.click(); assert.equal(h.calls.length, 0); assert.equal(h.changes.at(-1), null);
    h.viewer.scene.pick = () => undefined; h.viewer.scene.drillPick = () => [];
    h.viewer.scene.globe.pick = () => h.worldPoint;
    await h.click(); assert.equal(h.calls.length, 0); assert.equal(h.changes.at(-1).status, 'coordinates');
  } finally { unregisterPickOwner('test-flight'); h.inspector.dispose(); }
});

test('API fields use confirmed flat schema with bounded scalars', () => {
  const model = featureInspectorModel({ latitude: 1, longitude: 2 }, { name: 'Place', source: 'OSM',
    address: 'Nearby address', category: 'building', details: Array.from({ length: 100 }, () => ({ label: 'X', value: 'y'.repeat(400) })) });
  assert.equal(model.fields.length, 26); assert.equal(model.fields.at(-1).value.length, 300);
  assert.equal(model.source, 'OSM');
});
