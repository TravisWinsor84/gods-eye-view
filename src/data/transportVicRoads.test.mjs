import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSPORT_VIC_ROAD_URLS,
  createTransportVicRoads,
  normalizeLaneSignal,
  normalizeRoadDisruption,
} from './transportVicRoads.js';

const BBOX_A = { west: 144.8, south: -38, east: 145.1, north: -37.7 };
const BBOX_B = { west: 145.1, south: -38, east: 145.4, north: -37.7 };

function jsonResponse(body, status = 200, headers = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return new Response(bytes, { status, headers: { 'content-type': 'application/json', ...headers } });
}

function unplannedFeature(id, longitude = 144.95) {
  return {
    type: 'Feature', geometry: { type: 'LineString', coordinates: [[longitude, -37.82], [longitude + 0.01, -37.81]] },
    properties: {
      id, eventId: `event-${id}`, status: 'Active', eventType: 'Incident', eventSubType: 'Collision',
      closedRoadName: 'Example Road', created: '2026-09-05T01:00:00Z', lastUpdated: '2026-09-05T02:00:00Z',
      endTime: '2026-09-05T03:00:00Z', impact: { direction: 'Both directions', impactType: 'Road closed' },
      weblinkURL: 'https://transport.vic.gov.au/road-incident', description: 'free text', socialMedia: '@private',
      towAllocation: 'internal', source: { sourceId: 'internal-id', sourceName: 'operator' },
    },
  };
}

test('normalizers preserve public road meaning while stripping internal/free-text fields', () => {
  const feature = normalizeRoadDisruption(unplannedFeature('one'));
  assert.equal(feature.properties.updatedAt, '2026-09-05T02:00:00.000Z');
  assert.equal(feature.properties.roadName, 'Example Road');
  assert.equal(feature.properties.impact, 'Road closed');
  for (const key of ['towAllocation', 'description', 'socialMedia', 'source', 'eventId']) {
    assert.equal(key in feature.properties, false, key);
  }

  const signal = normalizeLaneSignal({
    type: 'Feature', id: 'signal-1', geometry: { type: 'Point', coordinates: [144.96, -37.81] },
    properties: { name: 'M1 gantry', state: 'OK', deviceType: 'VSLS', reportedSpeed: 80, lanes: [{ num: 1, value: '80' }], faults: [{ description: 'internal fault' }], tags: ['internal'] },
  });
  assert.equal(signal.properties.reportedSpeedKph, 80);
  assert.deepEqual(signal.properties.lanes, [{ lane: 1, display: '80' }]);
  assert.match(signal.properties.caveat, /road signs/i);
  assert.equal(signal.properties.advice, undefined);
  assert.equal(signal.properties.faults, undefined);
  assert.equal(signal.properties.tags, undefined);
});

test('unplanned feed pages once per provider cache and bbox-filters afterwards', async () => {
  const calls = [];
  let now = 1_000;
  const client = createTransportVicRoads({ now: () => now, fetchImpl: async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    const page = Number(url.searchParams.get('page'));
    return jsonResponse({
      meta: { page, limit: 100, count: page === 1 ? 2 : 0, total_pages: 1, total_records: 2 },
      data: { type: 'FeatureCollection', features: [unplannedFeature('a', 144.9), unplannedFeature('b', 145.2)] },
    });
  } });

  const first = await client.load('vic-road-unplanned', { bbox: BBOX_A, apiKey: 'secret', maxFeatures: 50 });
  const second = await client.load('vic-road-unplanned', { bbox: BBOX_B, apiKey: 'secret', maxFeatures: 50 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin + calls[0].url.pathname, TRANSPORT_VIC_ROAD_URLS['vic-road-unplanned']);
  assert.deepEqual(calls[0].options.headers, { KeyId: 'secret', Accept: 'application/json' });
  assert.doesNotMatch(calls[0].url.href, /secret|west|south|east|north/);
  assert.deepEqual(first.features.map(({ id }) => id), ['a']);
  assert.deepEqual(second.features.map(({ id }) => id), ['b']);
  assert.equal(first.sourceStatus.cache, 'miss');
  assert.equal(second.sourceStatus.cache, 'hit');
});

test('bbox filtering retains a disruption line that crosses the viewport between outside vertices', async () => {
  const crossing = unplannedFeature('crossing');
  crossing.geometry.coordinates = [[144.7, -37.85], [145.2, -37.85]];
  const client = createTransportVicRoads({ fetchImpl: async () => jsonResponse({
    meta: { page: 1, limit: 100, count: 1, total_pages: 1, total_records: 1 },
    data: { type: 'FeatureCollection', features: [crossing] },
  }) });
  const result = await client.load('vic-road-unplanned', { bbox: BBOX_A, apiKey: 'secret', maxFeatures: 50 });
  assert.deepEqual(result.features.map(({ id }) => id), ['crossing']);
});

test('lane sites page provider-wide and never turn display values into driving advice', async () => {
  const calls = [];
  const row = (id, longitude) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [longitude, -37.81] }, properties: { name: id, state: 'OK', lanes: [{ num: 1, value: '80' }] } });
  const client = createTransportVicRoads({ fetchImpl: async (input) => {
    const url = new URL(input); calls.push(url);
    const from = Number(url.searchParams.get('from'));
    return jsonResponse({ from, size: 500, totalFound: 501, featureCollection: { type: 'FeatureCollection', features: from === 0 ? [row('one', 144.9)] : [row('two', 145.2)] } });
  } });
  const result = await client.load('vic-lane-signals', { bbox: BBOX_A, apiKey: 'secret', maxFeatures: 50 });
  assert.deepEqual(calls.map((url) => url.search), ['?from=0&size=500', '?from=500&size=500']);
  assert.deepEqual(result.features.map(({ id }) => id), ['one']);
  assert.match(result.features[0].properties.caveat, /road signs/i);
});

test('missing or rejected credentials fail closed without stale success', async () => {
  let calls = 0;
  const client = createTransportVicRoads({ fetchImpl: async () => { calls += 1; return jsonResponse({}, 401); } });
  await assert.rejects(client.load('vic-road-unplanned', { bbox: BBOX_A, apiKey: '' }), (error) => error.code === 'CREDENTIALS_REQUIRED');
  assert.equal(calls, 0);
  await assert.rejects(client.load('vic-road-unplanned', { bbox: BBOX_A, apiKey: 'secret' }), (error) => error.code === 'CREDENTIALS_REQUIRED');
});

test('rate limits, media drift and oversized pages are sanitized coded failures', async () => {
  for (const [response, code] of [
    [jsonResponse({}, 429, { 'retry-after': '60' }), 'RATE_LIMITED'],
    [new Response('<xml/>', { status: 200, headers: { 'content-type': 'text/xml' } }), 'INVALID_PROVIDER_DATA'],
    [new Response(new Uint8Array(2_000_001), { status: 200, headers: { 'content-type': 'application/json' } }), 'RESPONSE_TOO_LARGE'],
  ]) {
    const client = createTransportVicRoads({ maxPageBytes: 2_000_000, fetchImpl: async () => response });
    await assert.rejects(client.load('vic-road-unplanned', { bbox: BBOX_A, apiKey: 'secret' }), (error) => error.code === code);
  }
});
