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

function gaPoint(properties, longitude = 144.96, latitude = -37.81) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties };
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

test('regional proxy reports EPA registration required without constructing or fetching an endpoint', async () => {
  let fetchCalls = 0;
  const secret = 'unverified-epa-secret';
  const response = await invokeRegional(createRegionalProxy({
    env: { UNRELATED_SECRET: secret },
    fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
  }), `/api/regional/vic-epa-air${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 424);
  assert.equal(response.headers['x-regional-status'], 'credentials-required');
  assert.deepEqual(JSON.parse(response.body), {
    error: 'regional source credentials required',
    reason: 'EPA Victoria registration required',
  });
  assert.equal(fetchCalls, 0);
  assert.doesNotMatch(response.body, new RegExp(secret));
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

test('regional proxy queries every fixed GA emergency sublayer and returns sanitized reference features', async () => {
  const requested = [];
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const url = new URL(input);
      requested.push(url);
      const layer = Number(url.pathname.match(/MapServer\/(\d+)\/query$/)?.[1]);
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: [gaPoint({
          facility_name: `Facility ${layer}`, facility_operationalstatus: 'Operational', abs_suburb: 'Melbourne',
          facility_address: 'private address', objectid: layer + 1, comment_: 'private note',
        }, 144.95 + layer / 1_000)],
      });
    },
  }), `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'fresh');
  assert.deepEqual(requested.map((url) => Number(url.pathname.match(/MapServer\/(\d+)\/query$/)?.[1])), [0, 1, 2, 3, 4, 5]);
  assert.ok(requested.every((url) => url.searchParams.get('outSR') === '4326'));
  assert.ok(requested.every((url) => !/address|objectid|comment/i.test(url.searchParams.get('outFields'))));
  const body = JSON.parse(response.body);
  assert.equal(body.features.length, 6);
  assert.equal(body.sourceStatus.status, 'current');
  assert.doesNotMatch(response.body, /private address|private note|objectid/);
});

test('regional proxy follows bounded ArcGIS pagination without allowing viewport-controlled fields', async () => {
  const requested = [];
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const url = new URL(input);
      requested.push(url);
      const offset = Number(url.searchParams.get('resultOffset'));
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => gaPoint({
          name: `Place ${offset + index}`, feature: 'LOCALITY', authority: 'VIC', auth_id: 'private-id',
        }, 144.9 + (offset + index) / 100_000)),
        exceededTransferLimit: offset === 0,
      });
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.deepEqual(requested.map((url) => url.searchParams.get('resultOffset')), ['0', '500']);
  assert.deepEqual(requested.map((url) => url.searchParams.get('resultRecordCount')), ['500', '500']);
  assert.ok(requested.every((url) => url.searchParams.get('outFields') === 'name,feature,category,theme,authority,supply_date'));
  assert.equal(JSON.parse(response.body).features.length, 501);
  assert.doesNotMatch(response.body, /private-id/);
});

test('regional proxy reports GA partial sublayer failure while retaining successful cohorts', async () => {
  const middleware = createRegionalProxy({
    fetchImpl: async (input) => {
      const layer = Number(new URL(input).pathname.match(/MapServer\/(\d+)\/query$/)?.[1]);
      if (layer === 1) return regionalResponseJson({ provider: 'secret error' }, 503);
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: [gaPoint({ organisation_name: layer === 0 ? 'Example GP' : 'Example Pharmacy', suburb: 'Melbourne', state: 'VIC' })],
      });
    },
  });
  const response = await invokeRegional(middleware, `/api/regional/au-health-facilities${MELBOURNE_BOUNDS}`);
  const cached = await invokeRegional(middleware, `/api/regional/au-health-facilities${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  assert.equal(cached.headers['x-regional-status'], 'degraded');
  assert.equal(cached.headers['x-regional-cache'], 'HIT');
  const body = JSON.parse(response.body);
  assert.equal(body.features.length, 2);
  assert.equal(body.sourceStatus.status, 'partial');
  assert.deepEqual(body.sourceStatus.layers.map(({ layer, status }) => [layer, status]), [
    [0, 'current'], [1, 'unavailable'], [2, 'current'],
  ]);
  assert.doesNotMatch(response.body, /secret error/);
});

test('regional proxy fails closed when every GA sublayer fails or a page exceeds its requested feature cap', async () => {
  const allFailed = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({ provider: 'secret error' }, 503),
  }), `/api/regional/au-health-facilities${MELBOURNE_BOUNDS}`);
  assert.equal(allFailed.status, 502);
  assert.deepEqual(JSON.parse(allFailed.body), { error: 'regional source is temporarily unavailable' });
  assert.doesNotMatch(allFailed.body, /secret error/);

  const oversizedPage = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({
      type: 'FeatureCollection',
      features: Array.from({ length: 501 }, (_, index) => gaPoint({ name: `Place ${index}` })),
    }),
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);
  assert.equal(oversizedPage.status, 502);
  assert.deepEqual(JSON.parse(oversizedPage.body), { error: 'regional source returned invalid data' });
});

test('regional proxy preserves an all-layer GA timeout as a sanitized 504', async () => {
  const response = await invokeRegional(createRegionalProxy({
    timeoutMs: 10,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }),
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);
  assert.equal(response.status, 504);
  assert.deepEqual(JSON.parse(response.body), { error: 'regional source timed out' });
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

test('regional proxy bounds distinct-bbox upstream refreshes and releases capacity after settlement', async () => {
  const releases = [];
  let fetchCalls = 0;
  const middleware = createRegionalProxy({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Promise((resolve) => releases.push(() => resolve(regionalResponseJson(regionalTreePayload()))));
    },
  });
  const urls = Array.from({ length: 5 }, (_, index) => (
    `/api/regional/melbourne-trees?west=${144.9 + index / 100}&south=-37.9&east=${144.905 + index / 100}&north=-37.895`
  ));
  const active = urls.slice(0, 4).map((url) => invokeRegional(middleware, url));
  let saturated;
  let retry;
  try {
    saturated = invokeRegional(middleware, urls[4]);
    assert.equal(fetchCalls, 4, 'the fifth distinct bbox must not start another upstream request');
    const response = await saturated;
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(response.body), { error: 'regional source is temporarily unavailable' });
    assert.equal(response.headers['x-regional-status'], 'saturated');

    releases.shift()();
    await active[0];
    retry = invokeRegional(middleware, urls[4]);
    assert.equal(fetchCalls, 5, 'settling a refresh releases one global slot');
    releases.at(-1)();
    releases.pop();
    assert.equal((await retry).status, 200);
  } finally {
    for (const release of releases.splice(0)) release();
    await Promise.allSettled([...active, saturated, retry].filter(Boolean));
  }
});

test('regional proxy reports missing and blank Transport Victoria credentials before fetch', async () => {
  const apiKey = process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
  delete process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
  try {
    let fetchCalls = 0;
    const middleware = createRegionalProxy({
      fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
    });
    const missing = await invokeRegional(middleware, `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
    process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = '   ';
    const blank = await invokeRegional(middleware, `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
    assert.equal(missing.status, 424);
    assert.equal(blank.status, 424);
    assert.equal(fetchCalls, 0);
    assert.deepEqual(JSON.parse(missing.body), { error: 'regional source credentials required' });
    assert.equal(missing.headers['x-regional-status'], 'credentials-required');
    assert.doesNotMatch(missing.body, /secret-value|TRANSPORT_VIC|KeyID/);
  } finally {
    if (apiKey === undefined) delete process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
    else process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = apiKey;
  }
});

test('regional proxy passes only server key and validated bbox to the Transport Victoria client', async () => {
  const apiKey = process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
  process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = ' secret-value ';
  try {
    const calls = [];
    const response = await invokeRegional(createRegionalProxy({
      transportVicGtfs: {
        async load(options) {
          calls.push(options);
          return {
            vehicles: [{ entityId: 'e1', mode: 'metro', vehicleId: 'v1', position: { longitude: 144.96, latitude: -37.81 }, feedTimestamp: 1_800_000_000, feedAgeSeconds: 10, stale: false }],
            modeStatus: { metro: { status: 'current', feedTimestamp: 1_800_000_000, feedAgeSeconds: 10 } },
          };
        },
      },
    }), `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{
      apiKey: 'secret-value',
      bbox: { west: 144.9, south: -37.9, east: 145, north: -37.8 },
      maxFeatures: 1_000,
    }]);
    assert.doesNotMatch(response.body, /secret-value|KeyID|TRANSPORT_VIC/);
  } finally {
    if (apiKey === undefined) delete process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
    else process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = apiKey;
  }
});

test('regional proxy maps Transport Victoria 401/403 and all-mode failure to sanitized responses', async () => {
  const apiKey = process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
  process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = 'secret-value';
  try {
    for (const [code, expectedStatus] of [['CREDENTIALS_REQUIRED', 424], ['ALL_MODES_FAILED', 502]]) {
      const response = await invokeRegional(createRegionalProxy({
        transportVicGtfs: { async load() { const error = new Error('upstream secret-value internals'); error.code = code; throw error; } },
      }), `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
      assert.equal(response.status, expectedStatus);
      assert.doesNotMatch(response.body, /upstream|secret-value|internals|KeyID/);
      if (expectedStatus === 424) assert.equal(response.headers['x-regional-status'], 'credentials-required');
    }
  } finally {
    if (apiKey === undefined) delete process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
    else process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = apiKey;
  }
});

test('regional proxy preserves an all-mode Transport Victoria timeout as sanitized 504', async () => {
  const apiKey = process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
  process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = 'secret-value';
  try {
    const response = await invokeRegional(createRegionalProxy({
      transportVicGtfs: {
        async load() {
          const error = new Error('provider timeout with secret-value');
          error.code = 'TIMEOUT';
          throw error;
        },
      },
    }), `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`);
    assert.equal(response.status, 504);
    assert.deepEqual(JSON.parse(response.body), { error: 'regional source timed out' });
    assert.equal(response.headers['x-regional-status'], 'unavailable');
    assert.doesNotMatch(response.body, /provider|secret-value|KeyID/);
  } finally {
    if (apiKey === undefined) delete process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
    else process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = apiKey;
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
    'regional-source-proxy',
    'military-installations-proxy',
    'regional-brief-proxy',
    'weather-effects-proxy',
  ]) {
    assert.equal(typeof byName.get(name)?.configureServer, 'function', `${name} dev hook`);
    assert.equal(typeof byName.get(name)?.configurePreviewServer, 'function', `${name} preview hook`);
  }
});

test('regional source configureServer installs middleware without returning a Vite post hook', () => {
  const config = createViteConfig({ mode: 'test' });
  const plugin = config.plugins.find(({ name }) => name === 'regional-source-proxy');
  const installed = [];
  const middlewares = {
    use(...args) {
      installed.push(args);
      return this;
    },
  };

  const result = plugin.configureServer({ middlewares });

  assert.equal(result, undefined);
  assert.equal(installed.length, 1);
  assert.equal(installed[0][0], '/api/regional');
  assert.equal(typeof installed[0][1], 'function');
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
