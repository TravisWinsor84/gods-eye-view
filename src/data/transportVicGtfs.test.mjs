import test from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

import {
  TRANSPORT_VIC_FEED_URLS,
  TRANSPORT_VIC_MAX_FEED_BYTES,
  createTransportVicGtfs,
} from './transportVicGtfs.js';

const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;
const BBOX_WEST = { west: 144, south: -38.5, east: 145, north: -37 };
const BBOX_EAST = { west: 145, south: -38.5, east: 146, north: -37 };
const NOW_MS = 1_800_000_000_000;

function feed({ timestamp = NOW_MS / 1_000 - 10, entities = [] } = {}) {
  return transitRealtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp },
    entity: entities,
  }).finish();
}

function vehicle(id, longitude, latitude, overrides = {}) {
  return {
    id,
    vehicle: {
      trip: { tripId: `trip-${id}`, routeId: `route-${id}` },
      vehicle: {
        id: `vehicle-${id}`,
        label: `private label ${id}`,
        licensePlate: `plate-${id}`,
      },
      position: { longitude, latitude, bearing: 123.5 },
      timestamp: NOW_MS / 1_000 - 8,
      occupancyStatus: 2,
      ...overrides,
    },
  };
}

function protobufResponse(bytes, status = 200, headers = {}) {
  return new Response(bytes, {
    status,
    headers: { 'Content-Type': 'application/x-protobuf', ...headers },
  });
}

function client(fetchImpl, options = {}) {
  return createTransportVicGtfs({
    fetchImpl,
    now: () => NOW_MS,
    cache: new Map(),
    ...options,
  });
}

test('uses exactly four current vehicle-position endpoints and sends the key only in KeyID', async () => {
  const calls = [];
  const apiKey = 'secret-value';
  const transport = client(async (url, options) => {
    calls.push({ url: String(url), options });
    return protobufResponse(feed({ entities: [vehicle(String(calls.length), 144.9, -37.8)] }));
  });

  await transport.load({ bbox: BBOX_WEST, apiKey, maxFeatures: 100 });

  assert.deepEqual(calls.map(({ url }) => url), Object.values(TRANSPORT_VIC_FEED_URLS));
  for (const { url, options } of calls) {
    assert.deepEqual(options.headers, { KeyID: apiKey, Accept: 'application/x-protobuf' });
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal('body' in options, false);
    assert.doesNotMatch(url, /secret-value|KeyID|bbox|west|south|east|north/);
  }
});

test('decodes GTFS-RT v2 and keeps only safe vehicle fields', async () => {
  const malicious = vehicle('entity-<script>', 144.96, -37.81, {
    trip: { tripId: 'trip\u0000unsafe', routeId: 'route<script>' },
  });
  const transport = client(async () => protobufResponse(feed({ entities: [malicious] })));

  const result = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });
  const record = result.vehicles[0];

  assert.ok(Math.abs(record.position.longitude - 144.96) < 0.000_01);
  assert.ok(Math.abs(record.position.latitude - -37.81) < 0.000_01);
  assert.equal(record.mode, 'metro');
  assert.equal(record.vehicleId, 'vehicle-entity-script');
  assert.equal(record.tripId, 'tripunsafe');
  assert.equal(record.routeId, 'routescript');
  assert.equal(record.bearing, 123.5);
  assert.equal(record.occupancyStatus, 'FEW_SEATS_AVAILABLE');
  assert.equal(record.timestamp, NOW_MS / 1_000 - 8);
  assert.equal(record.feedTimestamp, NOW_MS / 1_000 - 10);
  assert.equal(record.feedAgeSeconds, 10);
  assert.equal(record.stale, false);
  assert.equal('label' in record, false);
  assert.equal('licensePlate' in record, false);
  assert.doesNotMatch(JSON.stringify(result), /private label|plate-|<script>|\u0000/);
});

test('rejects oversized binary bodies and malformed protobuf per mode', async () => {
  const calls = new Map();
  const transport = client(async (url) => {
    const mode = new URL(url).pathname.split('/').at(-2);
    calls.set(mode, (calls.get(mode) || 0) + 1);
    if (mode === 'metro') {
      return protobufResponse(new Uint8Array(), 200, {
        'Content-Length': String(TRANSPORT_VIC_MAX_FEED_BYTES.metro + 1),
      });
    }
    if (mode === 'tram') return protobufResponse(Uint8Array.of(0xff, 0xff, 0xff));
    return protobufResponse(feed({ entities: [vehicle(mode, 144.9, -37.8)] }));
  });

  const result = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });

  assert.equal(result.modeStatus.metro.status, 'unavailable');
  assert.equal(result.modeStatus.tram.status, 'unavailable');
  assert.equal(result.modeStatus.bus.status, 'current');
  assert.equal(result.modeStatus.vline.status, 'current');
  assert.equal(result.vehicles.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /protobuf|byte|decoder|ff/);
});

test('times out every hanging mode with a sanitized all-mode failure', async () => {
  let aborted = 0;
  const transport = client((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted += 1;
      reject(signal.reason);
    }, { once: true });
  }), { timeoutMs: 5 });

  await assert.rejects(
    transport.load({ bbox: BBOX_WEST, apiKey: 'secret-value', maxFeatures: 100 }),
    (error) => error?.code === 'ALL_MODES_FAILED' && !/secret-value|timeout|KeyID/.test(error.message),
  );
  assert.equal(aborted, 4);
});

test('drops non-finite and out-of-range positions, unsafe bearings and occupancy values', async () => {
  const transport = client(async () => protobufResponse(feed({ entities: [
    vehicle('valid', 144.9, -37.8),
    vehicle('nan', Number.NaN, -37.8),
    vehicle('longitude', 181, -37.8),
    vehicle('latitude', 144.9, -91),
    vehicle('optional', 144.91, -37.81, { position: { longitude: 144.91, latitude: -37.81, bearing: 999 }, occupancyStatus: 99 }),
  ] })));

  const result = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });

  assert.equal(result.vehicles.length, 8, 'two valid vehicles from each of four modes');
  for (const mode of ['metro', 'tram', 'bus', 'vline']) {
    const optional = result.vehicles.find((entry) => entry.mode === mode && entry.vehicleId === 'vehicle-optional');
    assert.equal('bearing' in optional, false);
    assert.equal('occupancyStatus' in optional, false);
  }
});

test('reuses all four globally cached mode snapshots across browser bboxes and filters after decode', async () => {
  let calls = 0;
  const transport = client(async () => {
    calls += 1;
    return protobufResponse(feed({ entities: [
      vehicle('west', 144.9, -37.8),
      vehicle('east', 145.1, -37.8),
    ] }));
  });

  const west = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });
  const east = await transport.load({ bbox: BBOX_EAST, apiKey: 'key', maxFeatures: 100 });

  assert.equal(calls, 4);
  assert.equal(west.vehicles.length, 4);
  assert.ok(west.vehicles.every(({ vehicleId }) => vehicleId === 'vehicle-west'));
  assert.equal(east.vehicles.length, 4);
  assert.ok(east.vehicles.every(({ vehicleId }) => vehicleId === 'vehicle-east'));
});

test('retains successful modes with explicit sanitized partial-failure status', async () => {
  const secret = 'provider-secret-body';
  const transport = client(async (url) => {
    const mode = new URL(url).pathname.split('/').at(-2);
    if (mode === 'tram') return new Response(secret, { status: 500 });
    return protobufResponse(feed({ entities: [vehicle(mode, 144.9, -37.8)] }));
  });

  const result = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });

  assert.equal(result.vehicles.length, 3);
  assert.deepEqual(result.modeStatus.tram, { status: 'unavailable' });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test('marks old feeds and bounded last-good fallback stale, then refuses over-age positions', async () => {
  let clock = NOW_MS;
  let fail = false;
  const transport = createTransportVicGtfs({
    now: () => clock,
    cache: new Map(),
    fetchImpl: async () => {
      if (fail) throw new Error('offline secret');
      return protobufResponse(feed({ timestamp: NOW_MS / 1_000 - 150, entities: [vehicle('old', 144.9, -37.8)] }));
    },
  });

  const old = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });
  assert.equal(old.modeStatus.metro.status, 'stale');
  assert.equal(old.modeStatus.metro.feedAgeSeconds, 150);
  assert.ok(old.vehicles.every(({ stale }) => stale));

  clock += 31_000;
  fail = true;
  const fallback = await transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 });
  assert.equal(fallback.modeStatus.metro.status, 'stale');
  assert.equal(fallback.modeStatus.metro.feedAgeSeconds, 181);

  clock += 120_000;
  await assert.rejects(
    transport.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 }),
    (error) => error?.code === 'ALL_MODES_FAILED' && !/offline|secret/.test(error.message),
  );
});

test('maps any upstream 401 or 403 to credentials required and never serves stale success', async () => {
  for (const status of [401, 403]) {
    const cache = new Map();
    let clock = NOW_MS;
    let denied = false;
    const fetchImpl = async () => denied
      ? new Response('key secret-value denied', { status })
      : protobufResponse(feed({ entities: [vehicle('cached', 144.9, -37.8)] }));
    const transport = createTransportVicGtfs({ fetchImpl, now: () => clock, cache });
    await transport.load({ bbox: BBOX_WEST, apiKey: 'secret-value', maxFeatures: 100 });
    denied = true;
    clock += 31_000;
    await assert.rejects(
      transport.load({ bbox: BBOX_WEST, apiKey: 'secret-value', maxFeatures: 100 }),
      (error) => error?.code === 'CREDENTIALS_REQUIRED' && !/secret-value|KeyID/.test(error.message),
    );
  }
});

test('returns a sanitized error when every mode fails and caps aggregate records', async () => {
  const failed = client(async () => new Response('upstream internals and secret-key', { status: 500 }));
  await assert.rejects(
    failed.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 100 }),
    (error) => error?.code === 'ALL_MODES_FAILED' && !/internals|secret-key/.test(error.message),
  );

  const capped = client(async () => protobufResponse(feed({ entities: [
    vehicle('one', 144.9, -37.8),
    vehicle('two', 144.91, -37.81),
  ] })));
  assert.equal((await capped.load({ bbox: BBOX_WEST, apiKey: 'key', maxFeatures: 3 })).vehicles.length, 3);
});
