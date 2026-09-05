import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapContextLocation, mapContextDestinationMatches, readMapContextCentre, readRegionalContextSelection } from './mapContextLocation.js';
import { buildMapContextFromUiState, renderMapContext } from './mapContextDom.js';

const melbourne = { latitude: -37.8136, longitude: 144.9631 };
const sydney = { latitude: -33.8688, longitude: 151.2093 };
const place = { label: 'Melbourne, Victoria', region: 'Victoria', country: 'Australia' };
test('a new regional selection opens details but refreshes respect manual collapse', () => {
  let click;
  const details = { hidden: true };
  const toggle = { setAttribute() {}, addEventListener(type, callback) { click = callback; } };
  const root = { querySelector(selector) {
    if (selector === '[data-map-context-toggle]') return toggle;
    if (selector === '[data-map-context-details]') return details;
    return null;
  } };
  renderMapContext(root, { selectionKey: 'trees:one' });
  assert.equal(details.hidden, false);
  click();
  renderMapContext(root, { selectionKey: 'trees:one' });
  assert.equal(details.hidden, true);
  renderMapContext(root, { selectionKey: 'trees:two' });
  assert.equal(details.hidden, false);
});
test('regional selection reads Cesium properties safely and ignores unrelated or unknown sources', () => {
  const selection = readRegionalContextSelection({
    name: '<img src=x>',
    properties: { regionalSourceId: { getValue: () => 'melbourne-trees' }, type: { getValue: () => 'Tree' } },
    get description() { throw new Error('HTML must not be read'); },
  });
  assert.equal(selection.label, '<img src=x>');
  assert.equal(selection.type, 'Tree');
  assert.equal(selection.source, 'Melbourne Urban Forest');
  const context = buildMapContextFromUiState({ regionalSelection: selection, useDestination: false });
  assert.equal(context.explanation, 'Selected Tree: <img src=x> · Melbourne Urban Forest');
  assert.equal(context.sources.length, 0, 'selection must not invent a current source status');
  assert.equal(readRegionalContextSelection({ properties: { regionalSourceId: '__proto__' } }), null);
  assert.equal(readRegionalContextSelection({ properties: { regionalSourceId: { getValue() { throw new Error(); } } } }), null);
  assert.equal(readRegionalContextSelection(null), null);
});
function harness() {
  let tick = 0;
  let nextId = 0;
  const timers = new Map();
  const calls = [];
  const changes = [];
  const lookup = createMapContextLocation({
    onChange: (value) => changes.push(value),
    now: () => tick,
    schedule: (fn) => { const id = ++nextId; timers.set(id, fn); return id; },
    cancel: (id) => timers.delete(id),
    fetchBrief: (lat, lon, { signal }) => new Promise((resolve, reject) => calls.push({ lat, lon, signal, resolve, reject })),
  });
  return { lookup, calls, changes, timers,
    advance: (ms) => { tick += ms; },
    fire: () => { const fns = [...timers.values()]; timers.clear(); return fns.map((fn) => fn()); },
  };
}

test('settled views debounce requests and show coordinates until place resolves', async () => {
  const h = harness();
  h.lookup.settle(sydney);
  h.lookup.settle(melbourne);
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 1);
  assert.equal(h.changes.at(-1).name, null);
  const pending = h.fire();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].lat, melbourne.latitude);
  h.calls[0].resolve({ place });
  await Promise.all(pending);
  assert.equal(h.changes.at(-1).name, place.label);
  h.lookup.settle(melbourne);
  assert.equal(h.timers.size, 0);
  assert.equal(h.changes.at(-1).name, place.label);
  h.advance(300_001);
  h.lookup.settle(melbourne);
  assert.equal(h.changes.at(-1).name, null);
  assert.equal(h.timers.size, 1);
});

test('motion aborts and hides old places; late responses cannot overwrite a newer view', async () => {
  const h = harness();
  h.lookup.settle(melbourne);
  const old = h.fire();
  h.lookup.moving();
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.changes.at(-1), null);
  h.lookup.settle(sydney);
  const current = h.fire();
  h.calls[1].resolve({ place: { label: 'Sydney' } });
  await Promise.all(current);
  h.calls[0].resolve({ place });
  await Promise.all(old);
  assert.equal(h.changes.at(-1).name, 'Sydney');
});

test('failure, partial payloads and sky views keep honest coordinate/unresolved fallback', async () => {
  for (const fail of [true, false]) {
    const h = harness();
    h.lookup.settle(melbourne);
    const pending = h.fire();
    if (fail) h.calls[0].reject(new Error('offline'));
    else h.calls[0].resolve({ place: null, weather: {} });
    await Promise.all(pending);
    const context = buildMapContextFromUiState({ centreLocation: h.changes.at(-1), useDestination: false });
    assert.equal(context.title, '-37.8136, 144.9631');
    h.lookup.settle(melbourne);
    assert.equal(h.timers.size, 0);
    h.lookup.settle(null);
    assert.equal(h.changes.at(-1), null);
    assert.equal(h.timers.size, 0);
  }
});

test('dispose cancels timers and ignores non-cooperative requests', async () => {
  const h = harness();
  h.lookup.settle(melbourne);
  const pending = h.fire();
  h.lookup.dispose();
  const count = h.changes.length;
  h.calls[0].resolve({ place });
  await Promise.all(pending);
  h.lookup.settle(sydney);
  assert.equal(h.changes.length, count);
  assert.equal(h.calls[0].signal.aborted, true);
  assert.equal(h.timers.size, 0);
});

test('preset/search destinations survive nearby views but cannot name a different city', () => {
  const currentPoi = { name: 'Landmark', lat: melbourne.latitude, lon: melbourne.longitude };
  const preset = { city: { name: 'Melbourne', pois: [currentPoi] }, currentPoi };
  const search = { searchedLabel: 'Melbourne search', searchedLatitude: melbourne.latitude, searchedLongitude: melbourne.longitude };
  for (const destination of [preset, search]) {
    assert.equal(mapContextDestinationMatches(melbourne, destination), true);
    assert.equal(mapContextDestinationMatches(sydney, destination), false);
    assert.equal(mapContextDestinationMatches(null, destination), false);
    const context = buildMapContextFromUiState({ ...destination, centreLocation: { ...sydney, name: 'Sydney' }, useDestination: false });
    assert.equal(context.title, 'Sydney');
    assert.doesNotMatch(context.explanation, /Landmark/);
  }
  assert.equal(buildMapContextFromUiState(preset).title, 'Melbourne');
  assert.equal(buildMapContextFromUiState(search).title, 'Melbourne search');
  const h = harness();
  h.lookup.settle(melbourne, { resolve: false });
  assert.equal(h.timers.size, 0);
});

test('centre picking uses screen centre terrain, then ellipsoid; sky never uses camera nadir', () => {
  const pixels = [];
  const Cesium = {
    Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
    Cartographic: { fromCartesian: (value) => value },
    Math: { toDegrees: (value) => value },
  };
  const surface = { latitude: -37, longitude: 145 };
  const viewer = {
    scene: { canvas: { clientWidth: 800, clientHeight: 600 }, globe: { pick: () => surface } },
    camera: { getPickRay: (pixel) => { pixels.push(pixel); return {}; }, pickEllipsoid: () => null,
      positionCartographic: { latitude: 10, longitude: 10 } },
  };
  assert.deepEqual(readMapContextCentre(viewer, Cesium), surface);
  assert.deepEqual({ ...pixels[0] }, { x: 400, y: 300 });
  viewer.scene.globe.pick = () => null;
  viewer.camera.pickEllipsoid = () => surface;
  assert.deepEqual(readMapContextCentre(viewer, Cesium), surface);
  viewer.camera.pickEllipsoid = () => null;
  assert.equal(readMapContextCentre(viewer, Cesium), null);
});
