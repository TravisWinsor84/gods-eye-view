import test from 'node:test';
import assert from 'node:assert/strict';
import { regionalPlaceProxy } from '../vite.config.js';

function route(options) {
  let handler;
  regionalPlaceProxy(options).configureServer({ middlewares: { use(path, fn) {
    assert.equal(path, '/api/regional-place'); handler = fn;
  } } });
  return async (lat = '-37.8136', lon = '144.9631', method = 'GET') => {
    let status;
    let body;
    await handler({ method, url: `?latitude=${lat}&longitude=${lon}`, socket: { remoteAddress: 'local' }, headers: {} }, {
      writeHead(code) { status = code; }, end(json) { body = JSON.parse(json); },
    });
    return { status, body };
  };
}

test('default place route requests only Nominatim suburb detail, never weather or news', async (t) => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ address: {
      city: 'Melbourne', suburb: 'Carlton', state: 'Victoria', country: 'Australia',
    } }), { status: 200 });
  });
  const response = await route()();
  assert.equal(response.status, 200);
  assert.equal(response.body.place.locality, 'Carlton');
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.hostname, 'nominatim.openstreetmap.org');
  assert.equal(url.searchParams.get('zoom'), '14');
  assert.equal(url.searchParams.get('lat'), '-37.81360');
});

test('place route coalesces precise points and does not reuse adjacent locality cache', async () => {
  const calls = [];
  let now = 0;
  const request = route({ now: () => now, fetchPlace: async (point) => {
    calls.push(point); return { label: `Place ${point.latitude}` };
  } });
  const [one, two] = await Promise.all([request(), request()]);
  assert.equal(calls.length, 1);
  assert.deepEqual(one, two);
  assert.equal(one.status, 200);
  assert.deepEqual(Object.keys(one.body).sort(), ['coordinates', 'place']);
  await request();
  assert.equal(calls.length, 1);
  const nearby = await request('-37.8137');
  assert.equal(calls.length, 2);
  assert.notEqual(nearby.body.place.label, one.body.place.label);
  now = 300_001;
  await request();
  assert.equal(calls.length, 3);
});

test('place route rejects invalid inputs and backs off sanitized provider failures', async () => {
  let calls = 0;
  const request = route({ fetchPlace: async () => { calls++; throw new Error('secret upstream failure'); } });
  assert.equal((await request('', '0')).status, 400);
  assert.equal((await request('91', '0')).status, 400);
  assert.equal((await request('0', '181')).status, 400);
  assert.equal((await request('0', '0', 'POST')).status, 405);
  assert.equal(calls, 0);
  assert.deepEqual(await request(), { status: 503, body: { error: 'Place temporarily unavailable' } });
  await request();
  assert.equal(calls, 1);
});

test('place route bounds distinct outstanding lookups', async () => {
  const releases = [];
  const request = route({ fetchPlace: () => new Promise((resolve) => releases.push(resolve)) });
  const pending = Array.from({ length: 8 }, (_, i) => request(String(i), '0'));
  await Promise.resolve();
  assert.equal((await request('20', '0')).status, 503);
  assert.equal(releases.length, 8);
  releases.forEach((resolve) => resolve({ label: 'Place' }));
  await Promise.all(pending);
});
