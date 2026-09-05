import test from 'node:test';
import assert from 'node:assert/strict';
import createViteConfig from '../../vite.config.js';
import { createRegionalImageryProxy } from './regionalImageryProxy.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const QUERY = 'west=144&south=-39&east=146&north=-37&width=512&height=256';

function pngResponse(body = PNG, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'image/png', ...(init.headers || {}) },
  });
}

function invoke(middleware, url, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const result = { status: 0, headers: {}, body: Buffer.alloc(0) };
    const res = {
      writeHead(status, headers = {}) {
        result.status = status;
        for (const [name, value] of Object.entries(headers)) {
          result.headers[name.toLowerCase()] = String(value);
        }
      },
      end(body = '') {
        result.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
        resolve(result);
      },
    };
    Promise.resolve(middleware({ url, method }, res)).catch(reject);
  });
}

test('rejects arbitrary imagery IDs and WMS parameters before fetch', async () => {
  const fetchCalls = [];
  const request = createRegionalImageryProxy({
    fetchImpl: async (...args) => { fetchCalls.push(args); return pngResponse(); },
  });

  assert.equal((await invoke(request, `/unknown?${QUERY}`)).status, 404);
  assert.equal((await invoke(request, `/au-dea-water-history?${QUERY}`)).status, 404);
  assert.equal((await invoke(request, `/au-dea-land-cover?layers=evil&${QUERY}`)).status, 400);
  assert.equal((await invoke(request, `/au-dea-land-cover?format=image/jpeg&${QUERY}`)).status, 400);
  assert.equal(fetchCalls.length, 0);
});

test('rejects malformed dimensions and bbox values before fetch', async () => {
  let fetchCalls = 0;
  const request = createRegionalImageryProxy({
    fetchImpl: async () => { fetchCalls += 1; return pngResponse(); },
  });
  const invalidQueries = [
    'west=144&south=-39&east=146&north=-37&width=63&height=256',
    'west=144&south=-39&east=146&north=-37&width=1025&height=256',
    'west=144&south=-39&east=146&north=-37&width=512.5&height=256',
    'west=144&south=-39&east=146&north=-37&width=512&height=',
    'west=144&south=-39&east=144&north=-37&width=512&height=256',
    'west=144&south=-39&east=155&north=-37&width=512&height=256',
    'west=nan&south=-39&east=146&north=-37&width=512&height=256',
  ];
  for (const query of invalidQueries) {
    assert.equal((await invoke(request, `/au-dea-land-cover?${query}`)).status, 400, query);
  }
  assert.equal(fetchCalls, 0);
});

test('fetches only the pinned PNG request and returns attribution and cache metadata', async () => {
  const calls = [];
  const request = createRegionalImageryProxy({
    fetchImpl: async (input, options) => { calls.push({ input, options }); return pngResponse(); },
  });

  const first = await invoke(request, `/au-dea-land-cover?${QUERY}`);
  const second = await invoke(request, `/au-dea-land-cover?${QUERY}`);

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, PNG);
  assert.equal(first.headers['content-type'], 'image/png');
  assert.equal(first.headers['cache-control'], 'public, max-age=300');
  assert.equal(first.headers['x-content-type-options'], 'nosniff');
  assert.equal(first.headers['x-regional-imagery-source'], 'au-dea-land-cover');
  assert.equal(first.headers['x-regional-imagery-cache'], 'MISS');
  assert.match(first.headers['x-regional-imagery-attribution'], /Digital Earth Australia/i);
  assert.equal(second.headers['x-regional-imagery-cache'], 'HIT');
  assert.equal(calls.length, 1);

  const upstream = new URL(calls[0].input);
  assert.equal(upstream.origin, 'https://ows.dea.ga.gov.au');
  assert.equal(upstream.searchParams.get('layers'), 'ga_ls_landcover');
  assert.equal(upstream.searchParams.get('format'), 'image/png');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Accept, 'image/png');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('rejects redirects, non-PNG MIME and service-exception bodies with sanitized errors', async () => {
  const upstreams = [
    new Response('', { status: 302, headers: { Location: 'https://attacker.invalid/image.png' } }),
    new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    new Response('<ServiceException>secret layer details</ServiceException>', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }),
  ];

  for (const upstream of upstreams) {
    const response = await invoke(createRegionalImageryProxy({
      fetchImpl: async () => upstream,
    }), `/au-dea-land-cover?${QUERY}`);
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { error: 'regional imagery is temporarily unavailable' });
    assert.doesNotMatch(String(response.body), /attacker|secret|layer details/i);
  }
});

test('enforces the 8 MiB cap from both content length and streamed bytes', async () => {
  const declared = await invoke(createRegionalImageryProxy({
    fetchImpl: async () => pngResponse(PNG, { headers: { 'Content-Length': String(8 * 1024 * 1024 + 1) } }),
  }), `/au-dea-land-cover?${QUERY}`);
  assert.equal(declared.status, 502);

  let cancelled = false;
  const streamedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(PNG);
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
    },
    cancel() { cancelled = true; },
  });
  const streamed = await invoke(createRegionalImageryProxy({
    fetchImpl: async () => pngResponse(streamedBody),
  }), `/au-dea-land-cover?${QUERY}`);
  assert.equal(streamed.status, 502);
  assert.equal(cancelled, true);
  assert.deepEqual(JSON.parse(streamed.body), { error: 'regional imagery is temporarily unavailable' });
});

test('times out with a sanitized 504 response', async () => {
  const response = await invoke(createRegionalImageryProxy({
    timeoutMs: 10,
    fetchImpl: async (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }),
  }), `/au-dea-land-cover?${QUERY}`);

  assert.equal(response.status, 504);
  assert.deepEqual(JSON.parse(response.body), { error: 'regional imagery timed out' });
});

test('bounds the full-request cache and expires entries', async () => {
  let calls = 0;
  let clock = 1_000_000;
  const request = createRegionalImageryProxy({
    now: () => clock,
    cacheMaxEntries: 2,
    cacheTtlMs: 100,
    fetchImpl: async () => { calls += 1; return pngResponse(); },
  });
  const route = (west) => `/au-dea-land-cover?west=${west}&south=-39&east=${west + 1}&north=-38&width=256&height=256`;

  await invoke(request, route(144));
  await invoke(request, route(145));
  await invoke(request, route(146));
  await invoke(request, route(144));
  assert.equal(calls, 4, 'oldest full-request entry should be evicted');

  clock += 101;
  await invoke(request, route(146));
  assert.equal(calls, 5, 'cache entry should expire after its TTL');
});

test('allows GET only', async () => {
  let fetchCalls = 0;
  const response = await invoke(createRegionalImageryProxy({
    fetchImpl: async () => { fetchCalls += 1; return pngResponse(); },
  }), `/au-dea-land-cover?${QUERY}`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(fetchCalls, 0);
});

test('Vite mounts the regional imagery middleware on the exact local route', () => {
  const config = createViteConfig({ mode: 'test' });
  const plugin = config.plugins.find(({ name }) => name === 'regional-imagery-proxy');
  assert.ok(plugin);

  const registrations = [];
  plugin.configureServer({ middlewares: { use: (...args) => registrations.push(args) } });
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], '/api/regional-imagery');
  assert.equal(typeof registrations[0][1], 'function');
});
