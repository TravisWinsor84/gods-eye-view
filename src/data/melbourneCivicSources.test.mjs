import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMelbourneParkingIndex,
  CITY_OF_MELBOURNE_CREDIT,
  createMelbourneCivicClient,
  melbourneCivicSpatialRequests,
  normalizeMelbourneCivicRecord,
  normalizeMelbourneParking,
  queryMelbourneParkingIndex,
} from './melbourneCivicSources.js';

const BBOX = Object.freeze({ west: 144.9, south: -37.9, east: 145, north: -37.8 });
const NOW = Date.parse('2026-09-05T05:24:00Z');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sensor(overrides = {}) {
  return {
    lastupdated: '2026-09-05T05:22:49+00:00',
    status_timestamp: '2026-09-05T05:19:54+00:00',
    zone_number: 7394,
    status_description: 'Unoccupied',
    kerbsideid: 9344,
    location: { lon: 1, lat: 1 },
    ...overrides,
  };
}

function bay(overrides = {}) {
  return {
    roadsegmentid: 23259,
    kerbsideid: 9344,
    roadsegmentdescription: 'Bourke Street between Swanston Street and Elizabeth Street',
    latitude: -37.8138,
    longitude: 144.9647,
    lastupdated: '2025-09-03',
    location: { lon: 144.9647, lat: -37.8138 },
    ...overrides,
  };
}

test('builds only fixed Opendatasoft v2.1 spatial requests for civic datasets', () => {
  const expected = new Map([
    ['melbourne-drinking-fountains', [['drinking-fountains', 'geo_point_2d']]],
    ['melbourne-barbecues', [['public-barbecues', 'geo_point_2d']]],
    ['melbourne-development', [['development-activity-monitor', 'geopoint']]],
    ['melbourne-culture', [['outdoor-artworks', 'geo_point_2d'], ['public-memorials-and-sculptures', 'co_ordinates']]],
  ]);

  for (const [sourceId, datasets] of expected) {
    const requests = melbourneCivicSpatialRequests(sourceId, BBOX, 500);
    assert.deepEqual(requests.map(({ dataset, geometryField }) => [dataset, geometryField]), datasets);
    for (const request of requests) {
      assert.equal(request.url.origin, 'https://data.melbourne.vic.gov.au');
      assert.equal(request.url.pathname, `/api/explore/v2.1/catalog/datasets/${request.dataset}/records`);
      assert.equal(request.url.searchParams.get('limit'), '100');
      assert.equal(request.url.searchParams.get('offset'), '0');
      assert.match(request.url.searchParams.get('where'), new RegExp(`^in_bbox\\(${request.geometryField}, -37\\.9, 144\\.9, -37\\.8, 145\\)$`));
      assert.ok(request.url.searchParams.get('select'));
      assert.doesNotMatch(request.url.searchParams.get('select'), /assetid|asset_id|company|contract|manager|property_id|development_key|street_address|planning_application|history|inscription/i);
    }
  }
  assert.throws(() => melbourneCivicSpatialRequests('melbourne-parking-live', BBOX, 500), /provider-wide/i);
  assert.throws(() => melbourneCivicSpatialRequests('unknown', BBOX, 500), /Unknown Melbourne civic source/);
});

test('parking retains exact timestamps and caveats without promising availability', () => {
  const feature = normalizeMelbourneParking(sensor(), bay(), { nowMs: NOW });
  assert.equal(feature.properties.status, 'vacant');
  assert.equal(feature.properties.observedAt, '2026-09-05T05:19:54+00:00');
  assert.equal(feature.properties.sensorUpdatedAt, '2026-09-05T05:22:49+00:00');
  assert.equal(feature.properties.bayUpdatedAt, '2025-09-03');
  assert.equal(feature.properties.stale, false);
  assert.match(feature.properties.caveat, /sensor observation/i);
  assert.match(feature.properties.caveat, /not a guarantee/i);
  assert.match(feature.properties.caveat, /street signs/i);
  assert.equal('available' in feature.properties, false);
  assert.equal('kerbsideid' in feature.properties, false);
  assert.equal('zone_number' in feature.properties, false);
  assert.equal('roadsegmentid' in feature.properties, false);
  assert.match(feature.id, /^melbourne-parking-[a-f0-9]{8}$/);
  assert.deepEqual(feature.geometry.coordinates, [144.9647, -37.8138]);
});

test('parking freshness is evaluated per sensor observation after five minutes', () => {
  const stale = normalizeMelbourneParking(sensor({ status_timestamp: '2026-09-05T05:18:59Z' }), bay(), { nowMs: NOW });
  const current = normalizeMelbourneParking(sensor({ status_timestamp: '2026-09-05T05:19:00Z' }), bay(), { nowMs: NOW });
  const occupied = normalizeMelbourneParking(sensor({ status_description: 'Present' }), bay(), { nowMs: NOW });
  assert.equal(stale.properties.stale, true);
  assert.equal(current.properties.stale, false);
  assert.equal(occupied.properties.status, 'occupied');
  assert.equal(normalizeMelbourneParking(sensor(), bay({ location: null, latitude: null }), { nowMs: NOW }), null);
});

test('parking joins once into a spatial index before viewport filtering', () => {
  const index = buildMelbourneParkingIndex(
    [sensor({ kerbsideid: 1 }), sensor({ kerbsideid: 2 }), sensor({ kerbsideid: 3 })],
    [
      bay({ kerbsideid: 1, location: { lon: 144.95, lat: -37.85 } }),
      bay({ kerbsideid: 2, location: { lon: 145.5, lat: -37.85 } }),
      bay({ kerbsideid: 3, location: null, latitude: null, longitude: null }),
    ],
  );
  assert.equal(index.joinedRows, 2);
  assert.equal(index.omittedWithoutGeometry, 1);
  assert.equal(queryMelbourneParkingIndex(index, BBOX, { nowMs: NOW, maxFeatures: 10 }).features.length, 1);
  assert.equal(queryMelbourneParkingIndex(index, {
    west: 145.4, south: -37.9, east: 145.6, north: -37.8,
  }, { nowMs: NOW, maxFeatures: 10 }).features.length, 1);
});

test('civic asset adapters expose only bounded public inventory fields', () => {
  const feature = normalizeMelbourneCivicRecord('melbourne-drinking-fountains', {
    assetid: 'private-asset-id',
    type: 'Drinking Fountain',
    description: 'Stainless steel drinking fountain',
    company: 'City of Melbourne',
    contract: 'Civil Infrastructure Services',
    assetmanager: 'City Infrastructure',
    primaryservicemanager: 'City Infrastructure',
    modelno: 'secret-model',
    propertyname: 'Carlton Gardens',
    roadsegmentdescription: 'Rathdowne Street between Victoria Street and Carlton Street',
    evaluationdate: '2026-02-28',
    geo_point_2d: { lon: 144.971, lat: -37.805 },
  }, { dataset: 'drinking-fountains' });
  assert.deepEqual(feature.properties, {
    title: 'Drinking Fountain',
    type: 'Drinking Fountain',
    locality: 'Carlton Gardens',
    description: 'Stainless steel drinking fountain',
    inventoryAsOf: '2026-02-28',
    freshnessClass: 'inventory',
    caveat: 'Asset inventory only; presence does not guarantee current condition or operability.',
  });
  assert.doesNotMatch(JSON.stringify(feature), /private-asset-id|contract|manager|secret-model|Rathdowne/i);
});

test('development omits identifiers and full address and remains monthly context', () => {
  const feature = normalizeMelbourneCivicRecord('melbourne-development', {
    development_key: 'X000557', property_id: '100435', property_id_2: '100436',
    street_address: '7-21 Anderson Street WEST MELBOURNE VIC 3003',
    town_planning_application: 'TP-123',
    status: 'COMPLETED', year_completed: '2024', clue_small_area: 'West Melbourne (Residential)',
    floors_above: 5, resi_dwellings: 31, hotel_rooms: 0,
    geopoint: { lon: 144.9415, lat: -37.8047 },
  }, { dataset: 'development-activity-monitor' });
  assert.equal(feature.properties.title, 'Development activity — West Melbourne (Residential)');
  assert.equal(feature.properties.freshnessClass, 'monthly-context');
  assert.match(feature.properties.caveat, /not live works/i);
  assert.doesNotMatch(JSON.stringify(feature), /X000557|100435|100436|Anderson|TP-123/);
});

test('culture keeps minimal metadata, uses declared geometry and bounds free text', () => {
  const feature = normalizeMelbourneCivicRecord('melbourne-culture', {
    asset_id: 1559911,
    title: 'Anchor', object_type: 'Sculpture', classification: 'Sculpture', art_date: '2005',
    property: 'Victoria Point', location: '758 Bourke Street, Docklands, 3008',
    description: `Public description ${'x'.repeat(400)}`,
    history: 'long private history', inscription: 'long inscription', company: 'VicUrban', service_manager: 'Manager',
    latitude: 144.9474, longitude: -37.8182,
    geo_point_2d: { lon: 144.9474, lat: -37.8182 },
  }, { dataset: 'outdoor-artworks' });
  assert.deepEqual(feature.geometry.coordinates, [144.9474, -37.8182]);
  assert.equal(feature.properties.title, 'Anchor');
  assert.equal(feature.properties.type, 'Sculpture');
  assert.equal(feature.properties.date, '2005');
  assert.equal(feature.properties.locality, 'Victoria Point');
  assert.ok(feature.properties.description.length <= 240);
  assert.doesNotMatch(JSON.stringify(feature), /1559911|long private history|long inscription|VicUrban|Manager|758 Bourke/i);
});

test('provider-wide parking tables download once, coalesce bbox calls and filter after joining', async () => {
  const calls = [];
  let releaseDownloads;
  const downloadGate = new Promise((resolve) => { releaseDownloads = resolve; });
  const fetchImpl = async (input) => {
    const url = new URL(input);
    const dataset = url.pathname.split('/').at(-3);
    calls.push({ dataset, pathname: url.pathname, where: url.searchParams.get('where') });
    await downloadGate;
    if (dataset === 'on-street-parking-bay-sensors') {
      return jsonResponse([sensor({ kerbsideid: 1 }), sensor({ kerbsideid: 2 }), sensor({ kerbsideid: 3 })]);
    }
    return jsonResponse([
      bay({ kerbsideid: 1, location: { lon: 144.95, lat: -37.85 } }),
      bay({ kerbsideid: 2, location: { lon: 145.5, lat: -37.85 } }),
      bay({ kerbsideid: 3, location: null, latitude: null, longitude: null }),
    ]);
  };
  const client = createMelbourneCivicClient({ fetchImpl, now: () => NOW });
  const first = client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 1_000 });
  const second = client.load('melbourne-parking-live', {
    bbox: { west: 145.4, south: -37.9, east: 145.6, north: -37.8 }, maxFeatures: 1_000,
  });
  await Promise.resolve();
  assert.equal(calls.length, 2, 'different bboxes share one provider-wide table refresh');
  releaseDownloads();
  const [inside, outside] = await Promise.all([first, second]);
  assert.equal(inside.features.length, 1);
  assert.equal(outside.features.length, 1);
  assert.deepEqual(calls.map(({ dataset }) => dataset), [
    'on-street-parking-bay-sensors', 'on-street-parking-bays',
  ]);
  assert.ok(calls.every(({ pathname }) => pathname.endsWith('/exports/json')));
  assert.ok(calls.every(({ where }) => !where?.includes('within_box')), 'provider-wide parking requests never contain viewport predicates');

  await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 1_000 });
  assert.equal(calls.length, 2, 'two-minute provider cache prevents a second table download');
});

test('parking retains source-local last-good tables when one later download fails', async () => {
  let clock = NOW;
  let phase = 'warm';
  const client = createMelbourneCivicClient({
    now: () => clock,
    fetchImpl: async (input) => {
      const url = new URL(input);
      const dataset = url.pathname.split('/').at(-3);
      if (phase === 'refresh' && dataset === 'on-street-parking-bay-sensors') return jsonResponse({}, 503);
      const row = dataset === 'on-street-parking-bay-sensors' ? sensor({ kerbsideid: 1 }) : bay({ kerbsideid: 1 });
      return jsonResponse([row]);
    },
  });
  await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 1_000 });
  clock += 120_001;
  phase = 'refresh';
  const result = await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 1_000 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.tables.sensors.status, 'stale');
  assert.equal(result.sourceStatus.tables.bays.status, 'current');
  assert.doesNotMatch(JSON.stringify(result), /503|upstream|on-street-parking-bay/i);
});

test('culture retains one dataset when its sibling fails and marks the source partial', async () => {
  const client = createMelbourneCivicClient({
    now: () => NOW,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('public-memorials-and-sculptures')) return jsonResponse({}, 500);
      return jsonResponse({ total_count: 1, results: [{
        title: 'Anchor', object_type: 'Sculpture', art_date: '2005', property: 'Victoria Point',
        geo_point_2d: { lon: 144.9474, lat: -37.8182 },
      }] });
    },
  });
  const result = await client.load('melbourne-culture', { bbox: BBOX, maxFeatures: 500 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.deepEqual(result.sourceStatus.datasets.map(({ dataset, status }) => [dataset, status]), [
    ['outdoor-artworks', 'current'], ['public-memorials-and-sculptures', 'unavailable'],
  ]);
});

test('an exact source maximum remains current when no provider rows were omitted', async () => {
  const client = createMelbourneCivicClient({
    now: () => NOW,
    fetchImpl: async () => jsonResponse({ total_count: 1, results: [{
      type: 'Drinking Fountain', geo_point_2d: { lon: 144.95, lat: -37.85 },
    }] }),
  });
  const result = await client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 1 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'current');
  assert.equal(result.sourceStatus.capped, false);
});

test('a later spatial page failure retains rows as partial rather than unavailable', async () => {
  const client = createMelbourneCivicClient({
    now: () => NOW,
    limits: { pageRows: 1 },
    fetchImpl: async (input) => {
      const offset = Number(new URL(input).searchParams.get('offset'));
      return offset === 0
        ? jsonResponse({ total_count: 2, results: [{ type: 'Drinking Fountain', geo_point_2d: { lon: 144.95, lat: -37.85 } }] })
        : jsonResponse({}, 503);
    },
  });
  const result = await client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 500 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.datasets[0].status, 'partial');
});

test('the page byte ceiling stops reading an oversized streaming response early', async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new TextEncoder().encode(pulls === 1 ? '{"results":[' : '"x"'.repeat(10_000)));
      if (pulls === 2) controller.close();
    },
    cancel() { cancelled = true; },
  });
  const client = createMelbourneCivicClient({
    limits: { pageBytes: 8 },
    fetchImpl: async () => new Response(body, { status: 200 }),
  });
  await assert.rejects(
    client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 500 }),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
  assert.equal(cancelled, true);
  assert.ok(pulls <= 2);
});

test('concurrent civic datasets share one hard aggregate byte budget', async () => {
  const payload = JSON.stringify({ total_count: 0, results: [] });
  const client = createMelbourneCivicClient({
    limits: { pageBytes: 40, totalBytes: 50 },
    fetchImpl: async () => new Response(payload, { status: 200 }),
  });
  const result = await client.load('melbourne-culture', { bbox: BBOX, maxFeatures: 500 });
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.datasets.filter(({ status }) => status === 'unavailable').length, 1);
});

test('declares the exact City of Melbourne attribution used by all civic adapters', () => {
  assert.equal(
    CITY_OF_MELBOURNE_CREDIT,
    'City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.',
  );
});
