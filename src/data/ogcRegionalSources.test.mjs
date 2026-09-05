import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OGC_SOURCE_CREDITS,
  normalizeOgcFeature,
  normalizeOgcPayload,
  ogcFeatureRequest,
} from './ogcRegionalSources.js';

const BBOX = Object.freeze({ west: 144, south: -38, east: 146, north: -37 });

function feature(geometry, properties = {}, id = undefined) {
  return { type: 'Feature', ...(id === undefined ? {} : { id }), geometry, properties };
}

const POLYGON = {
  type: 'Polygon',
  coordinates: [[[144, -38], [146, -38], [146, -37], [144, -37], [144, -38]]],
};

test('builds only fixed WFS requests with bbox, EPSG:4326, GeoJSON and count caps', () => {
  const expected = {
    'au-dea-hotspots': ['https://hotspots.dea.ga.gov.au/geoserver/wfs', 'public:hotspots_three_days'],
    'vic-parks': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:parkres'],
    'vic-recreation-tracks': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:recweb_tracks'],
    'vic-heritage': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:heritage_register'],
  };

  for (const [sourceId, [base, typeName]] of Object.entries(expected)) {
    const url = ogcFeatureRequest(sourceId, BBOX, 1_000);
    assert.equal(`${url.origin}${url.pathname}`, base);
    assert.equal(url.searchParams.get('service'), 'WFS');
    assert.equal(url.searchParams.get('request'), 'GetFeature');
    assert.equal(url.searchParams.get('version'), '2.0.0');
    assert.equal(url.searchParams.get('typeName'), typeName);
    assert.equal(url.searchParams.get('bbox'), '144,-38,146,-37,EPSG:4326');
    assert.equal(url.searchParams.get('srsName'), 'EPSG:4326');
    assert.equal(url.searchParams.get('outputFormat'), 'application/json');
    assert.equal(url.searchParams.get('count'), '1000');
    assert.equal(url.searchParams.get('maxFeatures'), '1000');
    assert.ok(url.searchParams.get('propertyName'));
    assert.doesNotMatch(url.searchParams.get('propertyName'), /(?:^|,)(?:id|ufi|vhr_num|hermes_num|comments|clos_[^,]*|maintained_by)(?:,|$)/i);
  }
  assert.throws(() => ogcFeatureRequest('unknown', BBOX, 10), /Unknown OGC regional source/);
  assert.throws(() => ogcFeatureRequest('vic-parks', { ...BBOX, west: Number.NaN }, 10), /invalid OGC bounding box/);
  assert.throws(() => ogcFeatureRequest('vic-parks', BBOX, 1_001), /invalid OGC feature limit/);
});

test('hotspots retain observation uncertainty and confidence without IDs or safety-of-life claims', () => {
  const normalized = normalizeOgcFeature('au-dea-hotspots', feature(
    { type: 'Point', coordinates: [144.96, -37.81] },
    {
      datetime: '2026-09-03T05:48:28Z', accuracy: '± 2km', confidence: 80,
      satellite: 'HIMAWARI-9', sensor: 'AHI', id: 1234, filename: 'private-path',
      evacuate: true, comments: 'operator free text',
    },
    'hotspots.1234',
  ));

  assert.equal(normalized.properties.observedAt, '2026-09-03T05:48:28.000Z');
  assert.equal(normalized.properties.positionalUncertainty, '± 2km');
  assert.equal(normalized.properties.confidence, 80);
  assert.match(normalized.properties.caveat, /375 m/i);
  assert.match(normalized.properties.caveat, /not.*warning|not.*evacuation/i);
  assert.doesNotMatch(JSON.stringify(normalized), /1234|private-path|operator free text|evacuate/);
});

test('parks expose only safe reserve name, type and manager fields', () => {
  const normalized = normalizeOgcFeature('vic-parks', feature(POLYGON, {
    name: 'Example Reserve', area_type: 'National Park', manager: 'Parks Victoria',
    prims_id: 'internal-park-id', veac_rec: 'free text', search_name: 'alternate text',
  }));
  assert.equal(normalized.properties.title, 'Example Reserve');
  assert.equal(normalized.properties.reserveType, 'National Park');
  assert.equal(normalized.properties.manager, 'Parks Victoria');
  assert.equal(normalized.properties.referenceOnly, true);
  assert.doesNotMatch(JSON.stringify(normalized), /internal-park-id|free text|alternate text/);
});

test('tracks are reference alignments and strip closure, maintenance and free-text fields', () => {
  const normalized = normalizeOgcFeature('vic-recreation-tracks', feature({
    type: 'MultiLineString', coordinates: [[[144.9, -37.8], [145, -37.7]]],
  }, {
    name: 'Example Track', trk_class: 'BASIC', asset_cls: 'TRACK',
    clos_stat: 'Closed', clos_desc: 'incident details', maintained_by: 'private contact',
    comments: 'free text', serial_no: 'internal-track-id',
  }));
  assert.equal(normalized.properties.title, 'Example Track');
  assert.equal(normalized.properties.trackClass, 'BASIC');
  assert.equal(normalized.properties.referenceOnly, true);
  assert.match(normalized.properties.caveat, /not.*live closure|not.*condition/i);
  assert.doesNotMatch(JSON.stringify(normalized), /Closed|incident details|private contact|free text|internal-track-id/);
});

test('heritage exposes only site name and object type with unknown cadence', () => {
  const normalized = normalizeOgcFeature('vic-heritage', feature(POLYGON, {
    site_name: 'Example Heritage Site', heritage_object: 'Building', id: 42,
    hermes_num: 'internal-hermes', ufi: 'internal-ufi', notes: 'sensitive free text',
  }));
  assert.equal(normalized.properties.title, 'Example Heritage Site');
  assert.equal(normalized.properties.objectType, 'Building');
  assert.equal(normalized.properties.freshnessClass, 'unknown');
  assert.match(normalized.properties.caveat, /unknown cadence/i);
  assert.doesNotMatch(JSON.stringify(normalized), /42|internal-hermes|internal-ufi|sensitive free text/);
});

test('normalization rejects excessive or invalid geometry and never reads beyond feature cap', () => {
  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection',
    features: [feature({ type: 'Polygon', coordinates: [[[[144, -38]]]] }, { name: 'Bad nesting' })],
  }, { maxFeatures: 10 }), /invalid OGC geometry/);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection',
    features: [feature({ type: 'Polygon', coordinates: [[[[[[144, -38]]]]]] }, { site_name: 'Too deep' })],
  }, { maxFeatures: 10 }), /invalid OGC geometry nesting/);
  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection',
    features: [feature({ type: 'Polygon', coordinates: [[[144, -38], [Infinity, -38], [146, -37], [144, -38]]] }, { name: 'Bad coordinate' })],
  }, { maxFeatures: 10 }), /invalid OGC geometry/);

  const rows = [feature(POLYGON, { name: 'One' })];
  Object.defineProperty(rows, 1, { enumerable: true, get() { throw new Error('feature beyond cap was read'); } });
  rows.length = 2;
  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection', features: rows,
  }, { maxFeatures: 1 }), /feature limit/);
});

test('heritage simplification stays bounded, closed and deterministic while invalid rings fail closed', () => {
  const ring = [];
  for (let index = 0; index < 12_000; index += 1) {
    const angle = (Math.PI * 2 * index) / 12_000;
    ring.push([145 + Math.cos(angle) * 0.1, -37.8 + Math.sin(angle) * 0.1]);
  }
  ring.push(ring[0]);
  const input = feature({ type: 'Polygon', coordinates: [ring] }, { site_name: 'Large Site', heritage_object: 'Precinct' });
  const first = normalizeOgcPayload('vic-heritage', { type: 'FeatureCollection', features: [input] }, { maxFeatures: 10 });
  const second = normalizeOgcPayload('vic-heritage', { type: 'FeatureCollection', features: [input] }, { maxFeatures: 10 });
  const outputRing = first.features[0].geometry.coordinates[0];
  assert.ok(outputRing.length <= 4_001);
  assert.deepEqual(outputRing[0], outputRing.at(-1));
  assert.deepEqual(first, second);

  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', features: [feature({
      type: 'Polygon', coordinates: [[[144, -38], [145, -37], [144, -37], [145, -38], [144, -38]]],
    }, { site_name: 'Self crossing' })],
  }, { maxFeatures: 10 }), /invalid OGC geometry/);
});

test('rejects polygon holes outside or crossing the shell', () => {
  const shell = [[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]];
  const outsideHole = [[147, -37.8], [147.2, -37.8], [147.2, -37.6], [147, -37.6], [147, -37.8]];
  const crossingHole = [[145.8, -37.8], [146.2, -37.8], [146.2, -37.4], [145.8, -37.4], [145.8, -37.8]];

  for (const hole of [outsideHole, crossingHole]) {
    assert.throws(() => normalizeOgcFeature('vic-parks', feature({
      type: 'Polygon', coordinates: [shell, hole],
    }, { name: 'Invalid reserve' })), /invalid OGC polygon topology/);
  }
});

test('rejects polygon holes that overlap, touch or nest', () => {
  const shell = [[144, -38], [148, -38], [148, -34], [144, -34], [144, -38]];
  const left = [[145, -37], [146, -37], [146, -36], [145, -36], [145, -37]];
  const invalidPairs = [
    [[145.5, -36.5], [146.5, -36.5], [146.5, -35.5], [145.5, -35.5], [145.5, -36.5]],
    [[146, -37], [147, -37], [147, -36], [146, -36], [146, -37]],
    [[145.2, -36.8], [145.8, -36.8], [145.8, -36.2], [145.2, -36.2], [145.2, -36.8]],
  ];

  for (const right of invalidPairs) {
    assert.throws(() => normalizeOgcFeature('vic-parks', feature({
      type: 'Polygon', coordinates: [shell, left, right],
    }, { name: 'Invalid reserve holes' })), /invalid OGC polygon topology/);
  }
});

test('rejects overlapping, touching or contained sibling multipolygon members', () => {
  const left = [[[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]]];
  const invalidSiblings = [
    [[[145, -37], [147, -37], [147, -35], [145, -35], [145, -37]]],
    [[[146, -38], [148, -38], [148, -36], [146, -36], [146, -38]]],
    [[[144.5, -37.5], [145.5, -37.5], [145.5, -36.5], [144.5, -36.5], [144.5, -37.5]]],
  ];

  for (const right of invalidSiblings) {
    assert.throws(() => normalizeOgcFeature('vic-parks', feature({
      type: 'MultiPolygon', coordinates: [left, right],
    }, { name: 'Invalid reserve members' })), /invalid OGC multipolygon topology/);
  }
});

test('accepts valid holes without imposing GeoJSON winding direction', () => {
  const shell = [[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]];
  const sameWindingHole = [[144.5, -37.5], [145, -37.5], [145, -37], [144.5, -37], [144.5, -37.5]];
  const normalized = normalizeOgcFeature('vic-parks', feature({
    type: 'Polygon', coordinates: [shell, sameWindingHole],
  }, { name: 'Valid reserve' }));

  assert.deepEqual(normalized.geometry.coordinates, [shell, sameWindingHole]);
});

test('rejects heritage topology that becomes invalid only after simplification', () => {
  const shell = [];
  for (let index = 0; index <= 2_401; index += 1) shell.push([index * 10 / 2_401, 0]);
  shell.push([10, 4], [12, 5], [10, 6], [10, 10]);
  for (let index = 1; index <= 2_599; index += 1) shell.push([10 - index * 10 / 2_599, 10]);
  shell.push([0, 0]);
  const holeInSpike = [[10.6, 4.8], [11, 5], [10.6, 5.2], [10.5, 5], [10.6, 4.8]];

  assert.throws(() => normalizeOgcFeature('vic-heritage', feature({
    type: 'Polygon', coordinates: [shell, holeInSpike],
  }, { site_name: 'Topology-changing simplification' })), /invalid OGC polygon topology/);
});

test('rejects polygon relationship validation when its bounded comparison budget is exceeded', () => {
  const shell = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const holes = Array.from({ length: 500 }, (_, index) => {
    const column = index % 25;
    const row = Math.floor(index / 25);
    const west = 0.2 + column * 0.38;
    const south = 0.2 + row * 0.45;
    return [[west, south], [west + 0.1, south], [west + 0.1, south + 0.1], [west, south + 0.1], [west, south]];
  });

  assert.throws(() => normalizeOgcFeature('vic-parks', feature({
    type: 'Polygon', coordinates: [shell, ...holes],
  }, { name: 'Excessive topology work' })), (error) => error?.code === 'OGC_TOPOLOGY_LIMIT');
});

test('accepts bounded provider geometry with duplicate consecutive vertices or 65 polygons', () => {
  const park = normalizeOgcFeature('vic-parks', feature({
    type: 'Polygon',
    coordinates: [[[144, -38], [146, -38], [146, -38], [146, -37], [144, -37], [144, -38]]],
  }, { name: 'Duplicate vertex reserve' }));
  assert.equal(park.geometry.coordinates[0].length, 5);

  const polygons = Array.from({ length: 65 }, (_, index) => {
    const west = 144 + index / 1_000;
    return [[[west, -38], [west + 0.0005, -38], [west + 0.0005, -37.9995], [west, -38]]];
  });
  const heritage = normalizeOgcFeature('vic-heritage', feature({
    type: 'MultiPolygon', coordinates: polygons,
  }, { site_name: 'Bounded multipolygon heritage place' }));
  assert.equal(heritage.geometry.coordinates.length, 65);
});

test('deduplicates and orders sanitized features deterministically with partial status for dropped rows', () => {
  const goodA = feature(POLYGON, { name: 'A', area_type: 'Park', manager: 'Manager' }, 'internal-a');
  const goodB = feature({
    type: 'Polygon', coordinates: [[[145, -38], [146, -38], [146, -37], [145, -37], [145, -38]]],
  }, { name: 'B', area_type: 'Reserve', manager: 'Manager' }, 'internal-b');
  const bad = feature({ type: 'Point', coordinates: [145, -37.5] }, { name: 'Wrong geometry' });
  const left = normalizeOgcPayload('vic-parks', { type: 'FeatureCollection', features: [goodB, bad, goodA, goodA] }, { maxFeatures: 10 });
  const right = normalizeOgcPayload('vic-parks', { type: 'FeatureCollection', features: [goodA, goodB, goodA, bad] }, { maxFeatures: 10 });
  assert.deepEqual(left, right);
  assert.deepEqual(left.features.map(({ properties }) => properties.title), ['A', 'B']);
  assert.equal(left.sourceStatus.status, 'partial');
  assert.equal(left.sourceStatus.invalidFeatures, 1);
  assert.equal(left.sourceStatus.duplicateFeatures, 1);
  assert.doesNotMatch(JSON.stringify(left), /internal-a|internal-b/);
});

test('marks an exact-count WFS response partial when collection metadata reports more matches', () => {
  const result = normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection',
    numberMatched: 645,
    numberReturned: 1,
    features: [feature(POLYGON, { site_name: 'Capped place', heritage_object: 'Building' })],
  }, { maxFeatures: 1 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.capped, true);
  assert.equal(result.sourceStatus.numberMatched, 645);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberReturned: 2, features: [feature(POLYGON, { site_name: 'Mismatch' })],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
});

test('rejects WFS numberMatched below numberReturned or the actual feature count', () => {
  const row = feature(POLYGON, { site_name: 'Contradictory counts' });
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 0, numberReturned: 1, features: [row],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 0, features: [row],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 2, totalFeatures: 3, features: [row],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
});

test('publishes fixed provider attribution contracts', () => {
  assert.equal(
    OGC_SOURCE_CREDITS['au-dea-hotspots'],
    '© Commonwealth of Australia (Geoscience Australia) 2026. This material is licensed under the Creative Commons Attribution 4.0 International Licence. Observe and retain any copyright or related notices that may accompany this material as part of the attribution.',
  );
  assert.equal(OGC_SOURCE_CREDITS['vic-parks'], 'State of Victoria (DataVic)');
  assert.equal(OGC_SOURCE_CREDITS['vic-recreation-tracks'], 'State of Victoria (DataVic)');
  assert.equal(OGC_SOURCE_CREDITS['vic-heritage'], 'State of Victoria (DataVic)');
});
