import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMelbourneParkingIndex,
  CITY_OF_MELBOURNE_CREDIT,
  createMelbourneCivicClient,
  melbourneCivicSpatialRequests,
  normalizeMelbourneCivicPayload,
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
    ['melbourne-drinking-fountains', [['drinking-fountains', 'geo_point_2d', 'assetid', 'assetid']]],
    ['melbourne-barbecues', [['public-barbecues', 'geo_point_2d', 'assetid', 'assetid']]],
    ['melbourne-development', [['development-activity-monitor', 'geopoint', 'development_key', 'development_key']]],
    ['melbourne-culture', [['outdoor-artworks', 'geo_point_2d', 'asset_id', 'asset_id'], ['public-memorials-and-sculptures', 'co_ordinates', '', undefined]]],
  ]);

  for (const [sourceId, datasets] of expected) {
    const requests = melbourneCivicSpatialRequests(sourceId, BBOX, 500);
    assert.deepEqual(requests.map(({ dataset, geometryField, orderBy, rowKey }) => [dataset, geometryField, orderBy, rowKey]), datasets);
    for (const request of requests) {
      assert.equal(request.url.origin, 'https://data.melbourne.vic.gov.au');
      const isExport = request.dataset === 'public-memorials-and-sculptures';
      assert.equal(request.url.pathname, `/api/explore/v2.1/catalog/datasets/${request.dataset}/${isExport ? 'exports/json' : 'records'}`);
      assert.equal(request.url.searchParams.get('limit'), isExport ? null : '100');
      assert.equal(request.url.searchParams.get('offset'), isExport ? null : '0');
      if (isExport) assert.equal(request.url.searchParams.get('where'), null);
      else assert.match(request.url.searchParams.get('where'), new RegExp(`^in_bbox\\(${request.geometryField}, -37\\.9, 144\\.9, -37\\.8, 145\\)$`));
      assert.ok(request.url.searchParams.get('select'));
      if (isExport) assert.equal(request.url.searchParams.get('order_by'), null);
      else assert.ok(request.url.searchParams.get('order_by'), `${request.dataset} must have deterministic pagination`);
      assert.doesNotMatch(request.url.searchParams.get('select'), /company|contract|manager|property_id|street_address|planning_application|history|inscription/i);
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

test('duplicate parking bays select the spatially nearest sensor match then deterministic recency', () => {
  const liveSensor = sensor({
    kerbsideid: 17212,
    location: { lon: 144.9594132, lat: -37.8038190 },
  });
  const index = buildMelbourneParkingIndex([liveSensor], [
    bay({ kerbsideid: 17212, roadsegmentdescription: 'Wellington Parade South', lastupdated: '2025-06-03', location: { lon: 144.9753201, lat: -37.8160071 } }),
    bay({ kerbsideid: 17212, roadsegmentdescription: 'Berkeley Street', lastupdated: '2025-09-03', location: { lon: 144.9594192, lat: -37.8038058 } }),
  ]);
  const result = queryMelbourneParkingIndex(index, BBOX, { nowMs: NOW, maxFeatures: 10 });
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates, [144.9594192, -37.8038058]);
  assert.equal(result.features[0].properties.title, 'On-street parking sensor');
  assert.doesNotMatch(JSON.stringify(result), /17212/);
});

test('duplicate parking bays fall back to latest finite update when sensor coordinates are invalid', () => {
  const index = buildMelbourneParkingIndex([sensor({ kerbsideid: 7, location: null })], [
    bay({ kerbsideid: 7, lastupdated: '2024-01-01', location: { lon: 144.951, lat: -37.851 } }),
    bay({ kerbsideid: 7, lastupdated: '2026-01-01', location: { lon: 144.952, lat: -37.852 } }),
  ]);
  const result = queryMelbourneParkingIndex(index, BBOX, { nowMs: NOW, maxFeatures: 10 });
  assert.deepEqual(result.features[0].geometry.coordinates, [144.952, -37.852]);
});

test('civic asset adapters expose only minimal address-safe public inventory fields', () => {
  const feature = normalizeMelbourneCivicRecord('melbourne-drinking-fountains', {
    assetid: 'private-asset-id',
    type: 'Drinking Fountain',
    description: 'Barbeque - Urban Design Single Hotplate - 160-206 Lorimer Street Nature Strip',
    company: 'City of Melbourne',
    contract: 'Civil Infrastructure Services',
    assetmanager: 'City Infrastructure',
    primaryservicemanager: 'City Infrastructure',
    modelno: 'secret-model',
    propertyname: '150 Collins Street',
    roadsegmentdescription: 'Rathdowne Street between Victoria Street and Carlton Street',
    evaluationdate: '2026-02-28',
    geo_point_2d: { lon: 144.971, lat: -37.805 },
  }, { dataset: 'drinking-fountains' });
  assert.deepEqual(feature.properties, {
    title: 'Drinking Fountain',
    type: 'Drinking Fountain',
    inventoryAsOf: '2026-02-28',
    freshnessClass: 'inventory',
    caveat: 'Asset inventory only; presence does not guarantee current condition or operability.',
  });
  assert.doesNotMatch(JSON.stringify(feature), /private-asset-id|contract|manager|secret-model|Rathdowne|Lorimer|Collins/i);
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
  assert.match(feature.id, /^melbourne-development-[a-f0-9]{24}$/);
});

test('development public IDs cannot identify an opaque provider key by enumeration', () => {
  const publicRecord = {
    status: 'COMPLETED', year_completed: '2024', clue_small_area: 'West Melbourne (Residential)',
    floors_above: 5, resi_dwellings: 31, hotel_rooms: 0,
    geopoint: { lon: 144.9415, lat: -37.8047 },
  };
  const observedId = normalizeMelbourneCivicRecord('melbourne-development', {
    ...publicRecord, development_key: 'X000557',
  }, { dataset: 'development-activity-monitor' }).id;
  const enumeratedIds = new Set(Array.from({ length: 10_000 }, (_, candidate) => (
    normalizeMelbourneCivicRecord('melbourne-development', {
      ...publicRecord, development_key: `X${String(candidate).padStart(6, '0')}`,
    }, { dataset: 'development-activity-monitor' }).id
  )));

  assert.deepEqual([...enumeratedIds], [observedId], 'opaque-key candidates cannot select or recover a public ID');
  assert.doesNotMatch(observedId, /X000557/);
});

test('identical public development records use stable ordinal IDs while true source duplicates deduplicate', () => {
  const shared = {
    status: 'COMPLETED', year_completed: '2024', clue_small_area: 'Melbourne',
    floors_above: 5, resi_dwellings: 31, hotel_rooms: 0,
    geopoint: { lon: 144.95, lat: -37.85 },
  };
  const lowerKey = { ...shared, development_key: 'X000010' };
  const higherKey = { ...shared, development_key: 'X000020' };
  const normalize = (results) => normalizeMelbourneCivicPayload('melbourne-development', [{
    dataset: 'development-activity-monitor', results,
  }], { maxFeatures: 10 });

  const forward = normalize([higherKey, lowerKey, higherKey]);
  const reverse = normalize([higherKey, lowerKey, higherKey].reverse());
  assert.equal(forward.features.length, 2);
  assert.deepEqual(forward.features.map(({ id }) => id), reverse.features.map(({ id }) => id));
  assert.match(forward.features[0].id, /^melbourne-development-[a-f0-9]{24}$/);
  assert.equal(forward.features[1].id, `${forward.features[0].id}-2`);
  assert.doesNotMatch(JSON.stringify(forward), /X000010|X000020|development_key/);
});

test('development deduplicates repeated opaque source rows but preserves distinct same-site records', async () => {
  const shared = {
    status: 'COMPLETED', clue_small_area: 'Melbourne', geopoint: { lon: 144.95, lat: -37.85 },
  };
  const first = { ...shared, development_key: 'X000005', year_completed: '2002', floors_above: 4, resi_dwellings: 0 };
  const second = { ...shared, development_key: 'X0004207', year_completed: '2020', floors_above: 1, resi_dwellings: 9 };
  const client = createMelbourneCivicClient({
    limits: { pageRows: 2 },
    fetchImpl: async (input) => jsonResponse(Number(new URL(input).searchParams.get('offset')) === 0
      ? { total_count: 4, results: [first, second] }
      : { total_count: 4, results: [first, second] }),
  });

  const result = await client.load('melbourne-development', { bbox: BBOX, maxFeatures: 10 });
  assert.equal(result.features.length, 2);
  assert.equal(new Set(result.features.map(({ id }) => id)).size, 2);
  assert.deepEqual(result.features.map(({ properties }) => properties.yearCompleted), ['2002', '2020']);
  assert.equal(result.sourceStatus.datasets[0].duplicates, 2);
  assert.doesNotMatch(JSON.stringify(result), /X000005|X0004207|development_key/);
});

test('culture keeps minimal address-safe metadata and uses declared geometry', () => {
  const feature = normalizeMelbourneCivicRecord('melbourne-culture', {
    asset_id: 1559911,
    title: 'Anchor', object_type: 'Sculpture', classification: 'Sculpture', art_date: '2005',
    property: '150 Collins Street', location: '758 Bourke Street, Docklands, 3008',
    description: 'Artwork beside 160-206 Lorimer Street',
    history: 'long private history', inscription: 'long inscription', company: 'VicUrban', service_manager: 'Manager',
    latitude: 144.9474, longitude: -37.8182,
    geo_point_2d: { lon: 144.9474, lat: -37.8182 },
  }, { dataset: 'outdoor-artworks' });
  assert.deepEqual(feature.geometry.coordinates, [144.9474, -37.8182]);
  assert.equal(feature.properties.title, 'Anchor');
  assert.equal(feature.properties.type, 'Sculpture');
  assert.equal(feature.properties.date, '2005');
  assert.equal('locality' in feature.properties, false);
  assert.equal('description' in feature.properties, false);
  assert.doesNotMatch(JSON.stringify(feature), /1559911|long private history|long inscription|VicUrban|Manager|Bourke|Lorimer|Collins/i);
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
  assert.equal(result.sourceStatus.status, 'stale');
  assert.equal(result.sourceStatus.tables.sensors.status, 'stale');
  assert.equal(result.sourceStatus.tables.bays.status, 'current');
  assert.doesNotMatch(JSON.stringify(result), /503|upstream|on-street-parking-bay/i);
});

for (const failedTable of ['sensors', 'bays']) {
  test(`parking expires inherited ${failedTable} table even while its sibling refreshes`, async () => {
    let clock = NOW;
    let warm = true;
    const client = createMelbourneCivicClient({
      now: () => clock,
      fetchImpl: async (input) => {
        const dataset = new URL(input).pathname.split('/').at(-3);
        const isSensors = dataset === 'on-street-parking-bay-sensors';
        if (!warm && ((failedTable === 'sensors' && isSensors) || (failedTable === 'bays' && !isSensors))) {
          return jsonResponse({}, 503);
        }
        return jsonResponse([isSensors ? sensor({ kerbsideid: 1 }) : bay({ kerbsideid: 1 })]);
      },
    });
    assert.equal((await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 100 })).features.length, 1);
    warm = false;
    for (let elapsed = 120_001; elapsed <= 720_006; elapsed += 120_001) {
      clock = NOW + elapsed;
      const result = await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 100 });
      if (elapsed <= 600_000) assert.equal(result.features.length, 1);
      else assert.equal(result.features.length, 0);
    }
  });
}

test('an all-stale parking response is degraded while mixed freshness preserves counts', async () => {
  const responses = [
    [sensor({ kerbsideid: 1, status_timestamp: '2026-09-05T04:00:00Z' }), sensor({ kerbsideid: 2, status_timestamp: '2026-09-05T05:23:00Z' })],
    [bay({ kerbsideid: 1 }), bay({ kerbsideid: 2, location: { lon: 144.965, lat: -37.814 } })],
  ];
  let index = 0;
  const client = createMelbourneCivicClient({ now: () => NOW, fetchImpl: async () => jsonResponse(responses[index++]) });
  const mixed = await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 100 });
  assert.equal(mixed.sourceStatus.staleRecords, 1);
  assert.equal(mixed.sourceStatus.currentRecords, 1);
  assert.equal(mixed.sourceStatus.status, 'partial');
});

test('all stale parking observations report stale with zero current records', async () => {
  let call = 0;
  const client = createMelbourneCivicClient({
    now: () => NOW,
    fetchImpl: async () => jsonResponse(call++ === 0
      ? [sensor({ kerbsideid: 1, status_timestamp: '2026-09-05T04:00:00Z' })]
      : [bay({ kerbsideid: 1 })]),
  });
  const result = await client.load('melbourne-parking-live', { bbox: BBOX, maxFeatures: 100 });
  assert.equal(result.sourceStatus.status, 'stale');
  assert.equal(result.sourceStatus.staleRecords, 1);
  assert.equal(result.sourceStatus.currentRecords, 0);
});

test('rejects JSON-shaped civic responses served as text/html without caching them', async () => {
  let calls = 0;
  const client = createMelbourneCivicClient({
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ total_count: 0, results: [] }), { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  });
  await assert.rejects(client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 100 }), (error) => error?.code === 'INVALID_MEDIA_TYPE');
  await assert.rejects(client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 100 }), (error) => error?.code === 'INVALID_MEDIA_TYPE');
  assert.equal(calls, 2);
});

test('deduplicates overlapping ordered spatial pages and reports partial', async () => {
  const offsets = [];
  const client = createMelbourneCivicClient({
    limits: { pageRows: 2 },
    fetchImpl: async (input) => {
      const url = new URL(input);
      offsets.push([url.searchParams.get('offset'), url.searchParams.get('order_by')]);
      const rows = Number(url.searchParams.get('offset')) === 0
        ? [{ type: 'Drinking Fountain', evaluationdate: '2026-01-01', geo_point_2d: { lon: 144.95, lat: -37.85 } }, { type: 'Drinking Fountain', evaluationdate: '2026-01-02', geo_point_2d: { lon: 144.951, lat: -37.851 } }]
        : [{ type: 'Drinking Fountain', evaluationdate: '2026-01-02', geo_point_2d: { lon: 144.951, lat: -37.851 } }, { type: 'Drinking Fountain', evaluationdate: '2026-01-03', geo_point_2d: { lon: 144.952, lat: -37.852 } }];
      return jsonResponse({ total_count: 4, results: rows });
    },
  });
  const result = await client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 10 });
  assert.deepEqual(offsets.map(([offset]) => offset), ['0', '2']);
  assert.ok(offsets.every(([, order]) => order));
  assert.equal(result.features.length, 3);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.datasets[0].duplicates, 1);
});

test('memorial export is bbox-filtered, order-independent and keeps equal-title rows at distinct coordinates', async () => {
  const paintedPoles = [
    { title: 'Painted Poles', description: 'Same provider description', co_ordinates: { lon: 144.951, lat: -37.851 } },
    { title: 'Painted Poles', description: 'Same provider description', co_ordinates: { lon: 144.952, lat: -37.852 } },
  ];
  const run = async (rows) => {
    const calls = [];
    const client = createMelbourneCivicClient({
      fetchImpl: async (input) => {
        const url = new URL(input);
        calls.push(url);
        if (url.pathname.includes('public-memorials-and-sculptures')) return jsonResponse(rows);
        return jsonResponse({ total_count: 0, results: [] });
      },
    });
    const result = await client.load('melbourne-culture', { bbox: BBOX, maxFeatures: 500 });
    const cached = await client.load('melbourne-culture', {
      bbox: { west: 144.9515, south: -37.853, east: 144.953, north: -37.8515 }, maxFeatures: 500,
    });
    return { result, cached, calls };
  };
  const forward = await run([...paintedPoles, { title: 'Outside', co_ordinates: { lon: 150, lat: -30 } }]);
  const reverse = await run([{ title: 'Outside', co_ordinates: { lon: 150, lat: -30 } }, ...paintedPoles].reverse());

  assert.equal(forward.result.features.length, 2);
  assert.equal(reverse.result.features.length, 2);
  assert.deepEqual(
    forward.result.features.map(({ id }) => id).sort(),
    reverse.result.features.map(({ id }) => id).sort(),
  );
  assert.equal(new Set(forward.result.features.map(({ id }) => id)).size, 2);
  assert.equal(forward.cached.features.filter(({ properties }) => properties.title === 'Painted Poles').length, 1);
  assert.equal(forward.calls.filter((url) => url.pathname.endsWith('/public-memorials-and-sculptures/exports/json')).length, 1);
  assert.doesNotMatch(JSON.stringify(forward.result), /Same provider description/);
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
    fetchImpl: async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
  });
  await assert.rejects(
    client.load('melbourne-drinking-fountains', { bbox: BBOX, maxFeatures: 500 }),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
  assert.equal(cancelled, true);
  assert.ok(pulls <= 2);
});

test('concurrent civic datasets share one hard aggregate byte budget', async () => {
  const client = createMelbourneCivicClient({
    limits: { pageBytes: 40, totalBytes: 50 },
    fetchImpl: async (input) => {
      const exportRequest = new URL(input).pathname.endsWith('/exports/json');
      const payload = exportRequest
        ? JSON.stringify([{ title: 'xxxxxxxxxxxx' }])
        : JSON.stringify({ total_count: 0, results: [] });
      return new Response(payload, { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
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
