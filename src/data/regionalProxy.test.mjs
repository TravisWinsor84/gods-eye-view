import { test } from 'node:test';
import assert from 'node:assert/strict';
import createViteConfig, {
  adsbLolFallbackAnchor,
  coalesceProxyRequest,
  launchLibraryRequestHeaders,
  keylessGooglePlacesResponse,
  LL2_CACHE_TTL_MS,
  readResponseJsonCapped,
  regionalBriefHasAnySource,
  validMilitaryInstallationBox,
  validRegionalPoint,
} from '../../vite.config.js';
import { createRegionalProxy } from './regionalProxy.js';

function regionalResponseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function regionalTreePayload() {
  return {
    results: [{ record: { id: 'tree-1', fields: {
      common_name: 'River red gum', latitude: -37.81, longitude: 144.96,
    } } }],
  };
}

function invokeRegional(middleware, url, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const result = { status: 0, headers: {}, body: '' };
    const res = {
      setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
      writeHead(status, headers = {}) {
        result.status = status;
        for (const [name, value] of Object.entries(headers)) result.headers[name.toLowerCase()] = value;
      },
      end(body = '') { result.body = String(body); resolve(result); },
    };
    Promise.resolve(middleware({ url, method }, res)).catch(reject);
  });
}

const MELBOURNE_BOUNDS = '?west=144.9&south=-37.9&east=145.0&north=-37.8';

test('regional proxy rejects unknown IDs before fetch', async () => {
  let fetchCalls = 0;
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
  }), `/api/regional/not-a-source${MELBOURNE_BOUNDS}`);
  assert.equal(response.status, 404);
  assert.equal(fetchCalls, 0);
});

test('regional proxy rejects restricted CFA and malformed bounds before fetch', async () => {
  let fetchCalls = 0;
  const middleware = createRegionalProxy({
    fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
  });
  assert.equal((await invokeRegional(middleware, `/api/regional/vic-cfa-alerts${MELBOURNE_BOUNDS}`)).status, 403);
  assert.equal((await invokeRegional(middleware, '/api/regional/melbourne-trees?west=144.9&south=nope&east=145&north=-37.8')).status, 400);
  assert.equal(fetchCalls, 0);
});

test('regional proxy builds a fixed official route from only the approved source and bbox', async () => {
  let requestedUrl = '';
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (url) => { requestedUrl = String(url); return regionalResponseJson(regionalTreePayload()); },
  }), `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}&url=https://attacker.invalid/&headers=secret`);
  assert.equal(response.status, 400, 'unexpected browser parameters are rejected');
  assert.equal(requestedUrl, '');

  const safe = await invokeRegional(createRegionalProxy({
    fetchImpl: async (url) => { requestedUrl = String(url); return regionalResponseJson(regionalTreePayload()); },
  }), `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  assert.equal(safe.status, 200);
  assert.match(requestedUrl, /^https:\/\/data\.melbourne\.vic\.gov\.au\/api\/explore\/v2\.1\/catalog\/datasets\/trees-with-species-and-dimensions-urban-forest\/records\?/);
  assert.match(requestedUrl, /limit=1000/);
  assert.doesNotMatch(requestedUrl, /attacker|secret/);
});

test('regional proxy enforces byte cap and isolates parser failures', async () => {
  const oversized = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({ value: 'x'.repeat(1_100_000) }),
  }), `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  assert.equal(oversized.status, 502);
  assert.deepEqual(JSON.parse(oversized.body), { error: 'regional source response was too large' });

  const malformed = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({ results: 'not-an-array', secret: 'upstream-secret' }),
  }), `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  assert.equal(malformed.status, 502);
  assert.deepEqual(JSON.parse(malformed.body), { error: 'regional source returned invalid data' });
  assert.doesNotMatch(malformed.body, /upstream-secret/);
});

test('regional proxy times out, caches a fresh result, and serves source-local stale last-good data', async () => {
  let clock = 1_000_000;
  let mode = 'success';
  let calls = 0;
  const middleware = createRegionalProxy({
    now: () => clock,
    fetchImpl: async (_url, { signal }) => {
      calls += 1;
      if (mode === 'timeout') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      if (mode === 'failure') throw new Error('offline with server-secret');
      return regionalResponseJson(regionalTreePayload());
    },
  });
  const first = await invokeRegional(middleware, `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  const hit = await invokeRegional(middleware, `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  assert.equal(first.status, 200);
  assert.equal(hit.headers['x-regional-cache'], 'HIT');
  assert.equal(calls, 1);

  clock += 86_400_001;
  mode = 'failure';
  const stale = await invokeRegional(middleware, `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['x-regional-cache'], 'STALE');
  assert.equal(JSON.parse(stale.body).features[0].id, 'tree-1');
  assert.doesNotMatch(stale.body, /server-secret/);

  const timeout = await invokeRegional(createRegionalProxy({
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  }), `/api/regional/melbourne-trees${MELBOURNE_BOUNDS}`);
  assert.equal(timeout.status, 504);
});

test('regional proxy reports absent PTV server credentials without exposing them', async () => {
  const developerId = process.env.PTV_DEVELOPER_ID;
  const apiKey = process.env.PTV_API_KEY;
  delete process.env.PTV_DEVELOPER_ID;
  delete process.env.PTV_API_KEY;
  try {
    let fetchCalls = 0;
    const response = await invokeRegional(createRegionalProxy({
      fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
    }), `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
    assert.equal(response.status, 424);
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(response.body, /secret-value|PTV_API_KEY|PTV_DEVELOPER_ID/);
  } finally {
    if (developerId === undefined) delete process.env.PTV_DEVELOPER_ID;
    else process.env.PTV_DEVELOPER_ID = developerId;
    if (apiKey === undefined) delete process.env.PTV_API_KEY;
    else process.env.PTV_API_KEY = apiKey;
  }
});

test('regional proxy never attempts unsigned PTV requests when credentials are present', async () => {
  const developerId = process.env.PTV_DEVELOPER_ID;
  const apiKey = process.env.PTV_API_KEY;
  process.env.PTV_DEVELOPER_ID = 'developer-id';
  process.env.PTV_API_KEY = 'secret-value';
  try {
    let fetchCalls = 0;
    const response = await invokeRegional(createRegionalProxy({
      fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
    }), `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
    assert.equal(response.status, 501);
    assert.equal(fetchCalls, 0);
    assert.doesNotMatch(response.body, /developer-id|secret-value/);
  } finally {
    if (developerId === undefined) delete process.env.PTV_DEVELOPER_ID;
    else process.env.PTV_DEVELOPER_ID = developerId;
    if (apiKey === undefined) delete process.env.PTV_API_KEY;
    else process.env.PTV_API_KEY = apiKey;
  }
});

test('missing Google place context is a quiet keyless capability, not a 503', () => {
  assert.deepEqual(keylessGooglePlacesResponse(undefined), {
    statusCode: 200,
    payload: { configured: false, error: null, places: [] },
  });
  assert.deepEqual(keylessGooglePlacesResponse('   '), {
    statusCode: 200,
    payload: { configured: false, error: null, places: [] },
  });
  assert.equal(keylessGooglePlacesResponse('configured-key'), null);
});

test('regional proxy rejects absent and blank coordinates instead of coercing them to zero', () => {
  assert.equal(validRegionalPoint(new URLSearchParams('longitude=12.5')), null);
  assert.equal(validRegionalPoint(new URLSearchParams('latitude=12.5')), null);
  assert.equal(validRegionalPoint(new URLSearchParams('latitude=&longitude=12.5')), null);
  assert.deepEqual(
    validRegionalPoint(new URLSearchParams('latitude=0&longitude=0')),
    { latitude: 0, longitude: 0 },
  );
});

test('adjacent proxy validators also require every coordinate explicitly', () => {
  assert.equal(
    validMilitaryInstallationBox(new URLSearchParams('west=-1&north=1&east=1')),
    null,
  );
  assert.equal(adsbLolFallbackAnchor({ url: '?lat=12.5' }), null);
  assert.equal(adsbLolFallbackAnchor({ url: '?lon=12.5' }), null);
});

test('new data proxies install the same routes in dev and preview servers', () => {
  const config = createViteConfig({ mode: 'test' });
  const byName = new Map(config.plugins.map((plugin) => [plugin.name, plugin]));
  for (const name of [
    'rocket-launches-proxy',
    'military-installations-proxy',
    'regional-brief-proxy',
    'weather-effects-proxy',
  ]) {
    assert.equal(typeof byName.get(name)?.configureServer, 'function', `${name} dev hook`);
    assert.equal(typeof byName.get(name)?.configurePreviewServer, 'function', `${name} preview hook`);
  }
});

test('Launch Library uses a 15-minute cache and optional server-side token header', () => {
  assert.equal(LL2_CACHE_TTL_MS, 15 * 60_000);
  assert.deepEqual(launchLibraryRequestHeaders(''), { Accept: 'application/json' });
  assert.deepEqual(launchLibraryRequestHeaders(' secret '), {
    Accept: 'application/json',
    Authorization: 'Token secret',
  });
});

test('proxy request coalescing shares one per-key refresh and clears it after settlement', async () => {
  const inFlight = new Map();
  let refreshCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = coalesceProxyRequest(inFlight, 'cell', async () => {
    refreshCount += 1;
    await gate;
    return 'fresh';
  });
  const second = coalesceProxyRequest(inFlight, 'cell', () => {
    refreshCount += 1;
    return 'duplicate';
  });
  assert.equal(first.shared, false);
  assert.equal(second.shared, true);
  assert.equal(first.promise, second.promise);
  release();
  assert.equal(await second.promise, 'fresh');
  assert.equal(refreshCount, 1);
  assert.equal(inFlight.size, 0);
});

test('bounded JSON reader rejects oversized upstream bodies', async () => {
  assert.deepEqual(await readResponseJsonCapped(new Response('{"ok":true}'), 32), { ok: true });
  await assert.rejects(
    readResponseJsonCapped(new Response(JSON.stringify({ value: 'x'.repeat(64) })), 32),
    (error) => error?.code === 'RESPONSE_TOO_LARGE',
  );
});

test('regional brief treats an all-source outage as total failure', () => {
  assert.equal(regionalBriefHasAnySource({
    place: null,
    weather: null,
    news: { status: 'unavailable' },
  }), false);
  assert.equal(regionalBriefHasAnySource({
    place: { country: 'United States' },
    weather: null,
    news: { status: 'unavailable' },
  }), true);
});
