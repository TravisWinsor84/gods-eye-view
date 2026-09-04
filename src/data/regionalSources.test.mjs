import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIONAL_SOURCES,
  normalizeRegionalFeatureCollection,
  regionalSourceAttribution,
} from './regionalSources.js';

test('registry declares the approved regional source IDs with immutable source contracts', () => {
  assert.deepEqual(Object.keys(REGIONAL_SOURCES), [
    'melbourne-trees',
    'melbourne-places',
    'melbourne-cycling',
    'melbourne-water-history',
    'vic-epa-air',
    'vic-cfa-alerts',
    'vic-fire-context',
    'vic-freight-network',
    'au-hydrology',
    'ptv-transit',
  ]);
  assert.equal(Object.isFrozen(REGIONAL_SOURCES), true);
  assert.equal(Object.isFrozen(REGIONAL_SOURCES['melbourne-trees']), true);
  assert.equal(REGIONAL_SOURCES['melbourne-trees'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].refreshMs, 300_000);
  assert.equal(REGIONAL_SOURCES['ptv-transit'].credential, 'server-required');
  assert.equal(REGIONAL_SOURCES['vic-cfa-alerts'].runtimeEligible, false);
  assert.ok(Number.isInteger(REGIONAL_SOURCES['melbourne-trees'].maxFeatures));
});

test('normalizes City of Melbourne tree records', () => {
  const result = normalizeRegionalFeatureCollection('melbourne-trees', {
    results: [{ record: { id: 'tree-1', fields: {
      common_name: 'River red gum', latitude: -37.81, longitude: 144.96,
    } } }],
  });
  assert.deepEqual(result.features[0].geometry.coordinates, [144.96, -37.81]);
  assert.equal(result.features[0].properties.title, 'River red gum');
  assert.equal(result.features[0].id, 'tree-1');
});

test('normalizes Melbourne place records and drops malformed coordinates', () => {
  const result = normalizeRegionalFeatureCollection('melbourne-places', {
    results: [
      { record: { id: 'tap-1', fields: {
        name: 'Birrarung Marr drinking fountain', latitude: '-37.818', longitude: '144.973', category: 'drinking fountain',
      } } },
      { record: { id: 'bad-range', fields: { name: 'No location', latitude: '-91', longitude: '144.9' } } },
      { record: { id: 'bad-blank', fields: { name: 'Blank location', latitude: '', longitude: '144.9' } } },
      { record: { id: 'bad-boolean', fields: { name: 'Boolean location', latitude: false, longitude: '144.9' } } },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.category, 'drinking fountain');
});

test('constrains GeoJSON features to registered geometry and bounded public properties', () => {
  const result = normalizeRegionalFeatureCollection('melbourne-cycling', {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'cycle-1', geometry: { type: 'LineString', coordinates: [[144.96, -37.81], [144.97, -37.82]] }, properties: {
        name: 'Capital City Trail', unsafe: '<script>alert(1)</script>', description: 'x'.repeat(2_000),
      } },
      { type: 'Feature', id: 'invalid-coordinate', geometry: { type: 'Point', coordinates: [999, -37.8] }, properties: { name: 'Invalid' } },
      { type: 'Feature', id: 'wrong-geometry', geometry: { type: 'Point', coordinates: [144.96, -37.8] }, properties: { name: 'Not a cycleway' } },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates[0], [144.96, -37.81]);
  assert.equal(result.features[0].properties.title, 'Capital City Trail');
  assert.equal(result.features[0].properties.description.length, 512);
  assert.equal('unsafe' in result.features[0].properties, false);
});

test('normalizes EPA station payloads with an AQI title and rejects missing or non-numeric positions', () => {
  const result = normalizeRegionalFeatureCollection('vic-epa-air', {
    data: [
      { stationId: 'melbourne', stationName: 'Melbourne CBD', latitude: -37.8136, longitude: 144.9631, aqi: 42, category: 'Good' },
      { stationId: 'missing', stationName: 'Missing position', aqi: 12 },
      { stationId: 'blank', stationName: 'Blank position', latitude: '', longitude: 144.9 },
      { stationId: 'boolean', stationName: 'Boolean position', latitude: -37.8, longitude: false },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.title, 'Melbourne CBD - AQI 42');
  assert.equal(result.features[0].properties.aqi, 42);
});

test('rejects the restricted CFA/VicEmergency RSS source before parsing its payload', () => {
  assert.throws(
    () => normalizeRegionalFeatureCollection('vic-cfa-alerts', '<rss><channel><item/></channel></rss>'),
    /vic-cfa-alerts is not runtime eligible: restricted source terms/,
  );
});

test('normalizes fire context, freight, hydrology, and PTV payload shapes independently', () => {
  const fire = normalizeRegionalFeatureCollection('vic-fire-context', {
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Bushfire Prone Area' }, geometry: {
      type: 'Polygon', coordinates: [[[144.9, -37.9], [145, -37.9], [145, -37.8], [144.9, -37.9]]],
    } }],
  });
  const freight = normalizeRegionalFeatureCollection('vic-freight-network', {
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { road_name: 'Western Freeway' }, geometry: {
      type: 'LineString', coordinates: [[144.8, -37.9], [144.9, -37.8]],
    } }],
  });
  const hydrology = normalizeRegionalFeatureCollection('au-hydrology', {
    features: [{ type: 'Feature', properties: { name: 'Merri Creek' }, geometry: {
      type: 'LineString', coordinates: [[144.98, -37.7], [144.99, -37.8]],
    } }],
  });
  const transit = normalizeRegionalFeatureCollection('ptv-transit', {
    stops: [
      { stop_id: 123, stop_name: 'Flinders Street Station', stop_latitude: -37.8183, stop_longitude: 144.9671, route_type: 0 },
      { stop_id: 124, stop_name: 'Blank coordinate', stop_latitude: '', stop_longitude: 144.9 },
      { stop_id: 125, stop_name: 'Boolean coordinate', stop_latitude: -37.8, stop_longitude: true },
    ],
  });
  assert.equal(fire.features[0].properties.title, 'Bushfire Prone Area');
  assert.equal(freight.features[0].properties.title, 'Western Freeway');
  assert.equal(hydrology.features[0].properties.title, 'Merri Creek');
  assert.deepEqual(transit.features[0].geometry.coordinates, [144.9671, -37.8183]);
  assert.equal(transit.features[0].properties.title, 'Flinders Street Station');
});

test('unknown and inherited source IDs fail closed everywhere', () => {
  for (const sourceId of ['unknown-source', 'toString', 'constructor', '__proto__']) {
    assert.throws(() => normalizeRegionalFeatureCollection(sourceId, {}), new RegExp(`Unknown regional source: ${sourceId}`));
    assert.throws(() => regionalSourceAttribution(sourceId), new RegExp(`Unknown regional source: ${sourceId}`));
  }
});

test('malformed source payloads fail closed with descriptive errors', () => {
  assert.throws(
    () => normalizeRegionalFeatureCollection('melbourne-trees', { results: 'not-an-array' }),
    /melbourne-trees payload must contain a results array/,
  );
});

test('source-aware maxima cap valid normalized features at each source contract limit', () => {
  const source = REGIONAL_SOURCES['melbourne-places'];
  const result = normalizeRegionalFeatureCollection('melbourne-places', {
    results: Array.from({ length: source.maxFeatures + 2 }, (_, index) => ({ record: { id: `place-${index}`, fields: {
      name: `Place ${index}`, latitude: -37.8, longitude: 144.9,
    } } })),
  });
  assert.equal(result.features.length, source.maxFeatures);
  assert.equal(result.features.at(-1).id, `place-${source.maxFeatures - 1}`);
});

test('attribution is exact, source-scoped, and rejects unknown IDs', () => {
  assert.equal(regionalSourceAttribution('melbourne-trees'), 'City of Melbourne Open Data');
  assert.equal(regionalSourceAttribution('vic-epa-air'), 'EPA Victoria');
  assert.throws(() => regionalSourceAttribution('nope'), /Unknown regional source: nope/);
});
