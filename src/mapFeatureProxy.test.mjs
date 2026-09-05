import test from 'node:test';
import assert from 'node:assert/strict';
import { mapFeatureProxy, normalizeMapFeature } from '../vite.config.js';

const point = { latitude: -37.8136123, longitude: 144.9631234 };
const fixture = { category: 'amenity', type: 'library', name: 'Public Library', osm_type: 'way', osm_id: 123,
  address: { house_number: '10', road: 'Example Street', city: 'Melbourne' },
  extratags: { 'building:levels': '3', website: 'https://library.vic.gov.au/', source: 'http://data.vic.gov.au/' } };

function route(options, preview = false) {
  let handler;
  const plugin = mapFeatureProxy(options);
  plugin[preview ? 'configurePreviewServer' : 'configureServer']({ middlewares: { use(path, fn) {
    assert.equal(path, '/api/map-feature'); handler = fn;
  } } });
  return async (url = `?latitude=${point.latitude}&longitude=${point.longitude}`, method = 'GET', ip = 'local') => {
    let status, body, headers;
    await handler({ url, method, socket: { remoteAddress: ip }, headers: {} }, {
      writeHead(code, values) { status = code; headers = values; }, end(json) { body = JSON.parse(json); },
    });
    return { status, body, headers };
  };
}

test('map feature schema preserves provenance and distinguishes nearest address', () => {
  const body = normalizeMapFeature(fixture, point);
  assert.deepEqual(Object.keys(body).sort(), ['coordinates', 'name', 'address', 'category', 'details', 'source', 'sourceUrl', 'caveat'].sort());
  assert.deepEqual(body.coordinates, point);
  assert.equal(body.name, 'Public Library');
  assert.equal(body.sourceUrl, 'https://www.openstreetmap.org/way/123');
  assert.equal(body.source, 'OpenStreetMap via Nominatim');
  assert.ok(body.details.some(({ label, value }) => label === 'Nearest mapped address' && value === body.address));
  assert.ok(body.details.some(({ value }) => value === 'http://data.vic.gov.au/'));
  assert.equal(body.caveat, 'Nearest mapped feature; this may be beside the clicked building. Building identity is not verified.');
});

test('metadata allowlist excludes resident identity, contacts and unsafe links', () => {
  const body = normalizeMapFeature({ ...fixture, category: 'building', type: 'house', name: 'Resident Secret',
    namedetails: { name: 'Resident Secret' }, display_name: 'Resident Secret',
    extratags: { owner: 'Resident Secret', operator: 'Resident Secret', phone: 'Resident Secret',
      description: 'Resident Secret', website: 'https://resident.example', source: 'https://user:password@example.org' },
    osm_type: 'way/evil', osm_id: '../evil' }, point);
  assert.doesNotMatch(JSON.stringify(body), /Resident Secret|password|resident\.example/);
  assert.equal(body.sourceUrl, 'https://nominatim.openstreetmap.org/');
  for (const source of ['javascript:alert(1)', 'data:text/plain,secret', 'file:///etc/passwd', '//example.org']) {
    assert.ok(!normalizeMapFeature({ ...fixture, extratags: { source, website: source } }, point).details.some(d => /URL|website/.test(d.label)));
  }
});

test('strict input and path validation prevents alternate proxy targets', async () => {
  let calls = 0;
  const request = route({ fetchDetail: async () => { calls++; return fixture; } }, true);
  for (const query of ['', '?latitude=&longitude=0', '?latitude=NaN&longitude=0', '?latitude=91&longitude=0',
    '?latitude=0&longitude=181', '?latitude=0x10&longitude=0', '?latitude=1e1&longitude=0',
    '?latitude=0&longitude=0&latitude=1', '?latitude=0&longitude=0&url=https://evil.example', '?latitude=%20&longitude=0']) {
    assert.equal((await request(query)).status, 400, query);
  }
  assert.equal((await request('/extra?latitude=0&longitude=0')).status, 404);
  assert.equal((await request(undefined, 'POST')).status, 405);
  assert.equal(calls, 0);
});

test('coalesces lookups, expires cache and echoes exact coordinates on every response', async () => {
  let calls = 0, now = 0;
  const request = route({ now: () => now, fetchDetail: async () => { calls++; return fixture; } });
  const adjacent = '?latitude=-37.8136124&longitude=144.9631235';
  const [one, two] = await Promise.all([request(), request(adjacent)]);
  assert.equal(calls, 1);
  assert.deepEqual(one.body.coordinates, point);
  assert.deepEqual(two.body.coordinates, { latitude: -37.8136124, longitude: 144.9631235 });
  assert.deepEqual((await request(adjacent)).body.coordinates, two.body.coordinates);
  now = 300001;
  await request();
  assert.equal(calls, 2);
});

test('limits pending to eight and coalesces requests while saturated', async () => {
  const releases = [];
  const request = route({ fetchDetail: () => new Promise(resolve => releases.push(resolve)) });
  const pending = Array.from({ length: 8 }, (_, i) => request(`?latitude=${i}&longitude=0`));
  await Promise.resolve();
  const duplicate = request('?latitude=0&longitude=0');
  assert.equal((await request('?latitude=20&longitude=0')).status, 503);
  assert.equal(releases.length, 8);
  releases.forEach(resolve => resolve(fixture));
  await Promise.all([...pending, duplicate]);
});

test('sanitizes failure and negative caches for thirty seconds', async () => {
  let calls = 0, now = 0;
  const request = route({ now: () => now, fetchDetail: async () => { calls++; throw Error('credential=SECRET'); } });
  const response = await request();
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Map feature temporarily unavailable' });
  assert.equal(response.headers['Retry-After'], '30');
  await request();
  assert.equal(calls, 1);
  now = 30001;
  await request();
  assert.equal(calls, 2);
});

test('enforces per-client and global rate caps, including cached hits', async () => {
  const request = route({ fetchDetail: async () => fixture });
  for (let i = 0; i < 20; i++) assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
  for (let i = 0; i < 20; i++) assert.equal((await request(undefined, 'GET', `client-${i}`)).status, 200);
  assert.equal((await request(undefined, 'GET', 'new-client')).status, 429);
});

test('cache evicts oldest entry above sixty-four', async (t) => {
  let clock = Date.now(), calls = 0;
  t.mock.method(Date, 'now', () => clock);
  const request = route({ now: () => 0, fetchDetail: async () => { calls++; return fixture; } });
  for (let i = 0; i < 65; i++) {
    clock += 60001;
    assert.equal((await request(`?latitude=${i}&longitude=0`)).status, 200);
  }
  clock += 60001;
  await request('?latitude=1&longitude=0');
  assert.equal(calls, 65);
  await request('?latitude=0&longitude=0');
  assert.equal(calls, 66);
});

test('default fetch uses fixed zoom18 endpoint, shared pacing and capped body', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options, time: Date.now() });
    return calls.length === 1 ? new Response(JSON.stringify(fixture))
      : new Response('x'.repeat(256 * 1024 + 1));
  });
  const request = route();
  assert.equal((await request()).status, 200);
  assert.equal((await request('?latitude=0&longitude=0')).status, 503);
  assert.equal(calls[0].url.origin, 'https://nominatim.openstreetmap.org');
  assert.equal(calls[0].url.pathname, '/reverse');
  for (const [key, value] of Object.entries({ zoom: '18', namedetails: '1', extratags: '1', lat: '-37.81361' })) {
    assert.equal(calls[0].url.searchParams.get(key), value);
  }
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.ok(calls[1].time - calls[0].time >= 1050);
});

test('upstream timeout remains active while reading the response body', async (t) => {
  const realSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => realSetTimeout(fn, ms === 9000 ? 20 : ms, ...args));
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new Error('private upstream timeout')), { once: true });
    },
  })));
  const response = await route()();
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'Map feature temporarily unavailable' });
});
