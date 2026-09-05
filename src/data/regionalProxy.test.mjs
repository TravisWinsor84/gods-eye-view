import { test } from 'node:test';
import assert from 'node:assert/strict';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
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

function ckanIndexedFixture(sourceId) {
  const toilet = sourceId === 'au-public-toilets';
  const packageId = toilet ? '553b3049-2b8b-46a2-95e6-640d7986a8c1' : '6d36dfd9-8693-4552-8a03-05eb29a391fd';
  const resourceId = toilet ? '34076296-6692-4e30-b627-67b7c4eb1027' : 'a2cba0b0-bddc-4b87-b495-2b6b7013af6e';
  const host = toilet ? 'data.gov.au' : 'opendata.transport.vic.gov.au';
  return {
    success: true,
    result: {
      id: packageId,
      metadata_modified: '2026-09-05T00:00:00',
      license_title: toilet ? 'Creative Commons Attribution 3.0 Australia' : 'Creative Commons Attribution 4.0',
      resources: [{
        id: resourceId,
        name: toilet ? 'Toiletmap.csv' : 'Public Transport Stops',
        format: toilet ? 'CSV' : 'GeoJSON',
        mimetype: toilet ? 'text/csv' : 'application/geo+json',
        url: `https://${host}/${toilet ? 'data/' : ''}dataset/${packageId}/resource/${resourceId}/download/${toilet ? 'toilet.csv' : 'public_transport_stops.geojson'}`,
        size: 1_000,
        last_modified: '2026-09-05T00:00:00',
        ...(toilet ? {} : { dataset_last_updated_date: '2025-07-28T00:00:00' }),
      }],
    },
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
const MELBOURNE_BLOCK_BOUNDS = '?west=144.96&south=-37.815&east=144.965&north=-37.811';
const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;

function regionalTransitFeed() {
  return transitRealtime.FeedMessage.encode({
    header: { gtfsRealtimeVersion: '2.0', timestamp: 1_800_000_000 },
    entity: [],
  }).finish();
}

test('regional proxy rejects unknown IDs before fetch', async () => {
  let fetchCalls = 0;
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
  }), `/api/regional/not-a-source${MELBOURNE_BOUNDS}`);
  assert.equal(response.status, 404);
  assert.equal(fetchCalls, 0);
});

test('regional proxy delegates indexed downloads globally across bboxes and surfaces cache/status metadata', async () => {
  const calls = [];
  const middleware = createRegionalProxy({
    indexedRegionalDownloads: {
      async load(sourceId, options) {
        calls.push({ sourceId, ...options });
        return {
          type: 'FeatureCollection', features: [],
          sourceStatus: { status: 'current', cache: calls.length === 1 ? 'miss' : 'hit', downloadStatus: 'downloaded' },
        };
      },
    },
  });

  const first = await invokeRegional(middleware, `/api/regional/au-public-toilets${MELBOURNE_BOUNDS}`);
  const second = await invokeRegional(middleware, '/api/regional/au-public-toilets?west=138.4&south=-35.1&east=138.8&north=-34.7');
  assert.deepEqual(calls, [
    { sourceId: 'au-public-toilets', bbox: { west: 144.9, south: -37.9, east: 145, north: -37.8 }, maxFeatures: 1_000 },
    { sourceId: 'au-public-toilets', bbox: { west: 138.4, south: -35.1, east: 138.8, north: -34.7 }, maxFeatures: 1_000 },
  ]);
  assert.equal(first.status, 200);
  assert.equal(first.headers['x-regional-cache'], 'MISS');
  assert.equal(first.headers['x-regional-status'], 'fresh');
  assert.equal(second.headers['x-regional-cache'], 'HIT');
});

test('regional proxy delegates the fixed DataVic waste snapshot and reports its cache state', async () => {
  const calls = [];
  const middleware = createRegionalProxy({
    dataVicWasteFacilities: {
      async load(options) {
        calls.push(options);
        return {
          type: 'FeatureCollection', features: [],
          sourceStatus: { status: 'partial', cache: 'hit', snapshot: 'October 2025' },
        };
      },
    },
  });
  const response = await invokeRegional(middleware, `/api/regional/vic-waste-facilities${MELBOURNE_BOUNDS}`);
  assert.deepEqual(calls, [{
    bbox: { west: 144.9, south: -37.9, east: 145, north: -37.8 },
    maxFeatures: 1_000,
  }]);
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-cache'], 'HIT');
  assert.equal(response.headers['x-regional-status'], 'degraded');
  assert.equal(JSON.parse(response.body).sourceStatus.snapshot, 'October 2025');
});

test('regional proxy fetches only a fixed high-zoom Vicmap parcel query and strips provider IDs', async () => {
  const requests = [];
  const middleware = createRegionalProxy({
    fetchImpl: async (url) => {
      requests.push(String(url));
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 9,
          geometry: { type: 'Polygon', coordinates: [[
            [144.96, -37.811], [144.961, -37.811], [144.961, -37.812], [144.96, -37.811],
          ]] },
          properties: { OBJECTID: 9, parcel_spi: '1\\PS1', parcel_status: 'A', parcel_task_id: 'private-workflow' },
        }],
      });
    },
  });
  const response = await invokeRegional(middleware, `/api/regional/vic-property-boundaries${MELBOURNE_BLOCK_BOUNDS}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'fresh');
  assert.equal(requests.length, 1);
  const request = new URL(requests[0]);
  assert.equal(request.pathname, '/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query');
  assert.equal(request.searchParams.get('resultRecordCount'), '501');
  assert.doesNotMatch(request.searchParams.get('outFields'), /task_id|address|owner/i);
  assert.doesNotMatch(response.body, /OBJECTID|private-workflow|parcel_task_id/i);
});

test('regional proxy asks for a closer Vicmap viewport without calling the provider', async () => {
  let fetchCalls = 0;
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => { fetchCalls += 1; return regionalResponseJson({}); },
  }), `/api/regional/vic-property-boundaries${MELBOURNE_BOUNDS}`);
  assert.equal(fetchCalls, 0);
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'zoom-required');
  assert.deepEqual(JSON.parse(response.body), {
    type: 'FeatureCollection', features: [],
    sourceStatus: { status: 'zoom-required', capped: false, reason: 'Zoom in to level 18 or closer to view parcel boundaries.' },
  });
});

test('regional proxy maps indexed partial, stale, limit, invalid and unavailable states honestly', async () => {
  const states = [
    [{ sourceStatus: { status: 'partial', cache: 'miss' } }, 200, 'degraded', 'MISS'],
    [{ sourceStatus: { status: 'stale', cache: 'stale' } }, 200, 'stale', 'STALE'],
    [Object.assign(new Error('source limit exceeded'), { code: 'SOURCE_LIMIT' }), 502, 'unavailable', undefined],
    [Object.assign(new Error('invalid source data'), { code: 'INVALID_SOURCE_DATA' }), 502, 'unavailable', undefined],
    [Object.assign(new Error('private provider detail'), { code: 'UPSTREAM_UNAVAILABLE' }), 502, 'unavailable', undefined],
  ];
  for (const [outcome, status, regionalStatus, cache] of states) {
    const response = await invokeRegional(createRegionalProxy({
      indexedRegionalDownloads: { async load() {
        if (outcome instanceof Error) throw outcome;
        return { type: 'FeatureCollection', features: [], ...outcome };
      } },
    }), `/api/regional/vic-transport-stops${MELBOURNE_BOUNDS}`);
    assert.equal(response.status, status);
    assert.equal(response.headers['x-regional-status'], regionalStatus);
    assert.equal(response.headers['x-regional-cache'], cache);
    if (status !== 200) assert.doesNotMatch(response.body, /private provider detail|source limit exceeded/);
  }
});

test('indexed metadata and file bodies share the proxy four-request semaphore', async () => {
  let active = 0;
  let maxActive = 0;
  const metadata = (sourceId) => ckanIndexedFixture(sourceId);
  const middleware = createRegionalProxy({
    fetchImpl: async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const url = String(input);
      const isMetadata = url.includes('/api/3/action/package_show');
      const body = isMetadata
        ? JSON.stringify(metadata(url.includes('553b3049') ? 'au-public-toilets' : 'vic-transport-stops'))
        : url.includes('toilet')
          ? '"Name","FacilityType","Latitude","Longitude"\n"Fixture","Park","-37.81","144.96"\n'
          : JSON.stringify({ type: 'FeatureCollection', features: [] });
      const contentType = isMetadata ? 'application/json' : url.includes('toilet') ? 'text/csv' : 'application/geo+json';
      return new Response(new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
          active -= 1;
        },
      }), { status: 200, headers: { 'Content-Type': contentType } });
    },
  });
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => invokeRegional(
    middleware,
    `/api/regional/${index % 2 ? 'vic-transport-stops' : 'au-public-toilets'}${MELBOURNE_BOUNDS}`,
  )));
  assert.deepEqual(responses.map(({ status }) => status), Array(6).fill(200));
  assert.ok(maxActive <= 4, `expected at most four active provider bodies, observed ${maxActive}`);
  assert.equal(active, 0);
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

test('regional proxy delegates Melbourne civic sources with only validated source, bounds and caps', async () => {
  const calls = [];
  const response = await invokeRegional(createRegionalProxy({
    melbourneCivicClient: {
      async load(sourceId, options) {
        calls.push({ sourceId, ...options });
        return {
          type: 'FeatureCollection',
          features: [],
          sourceStatus: { status: 'partial', datasets: [{ dataset: 'drinking-fountains', status: 'partial' }] },
        };
      },
    },
  }), `/api/regional/melbourne-drinking-fountains${MELBOURNE_BOUNDS}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  assert.deepEqual(calls, [{
    sourceId: 'melbourne-drinking-fountains',
    bbox: { west: 144.9, south: -37.9, east: 145, north: -37.8 },
    maxFeatures: 500,
  }]);
});

test('regional proxy fetches fixed OGC GeoJSON and strips provider IDs and unsafe fields', async () => {
  let requestedUrl;
  let requestedOptions;
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input, options) => {
      requestedUrl = new URL(input);
      requestedOptions = options;
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature', id: 'internal.99',
          geometry: { type: 'Point', coordinates: [144.96, -37.81] },
          properties: { datetime: '2026-09-03T05:48:28Z', accuracy: '± 375 m', confidence: 90, id: 99, comments: 'secret note' },
        }],
      });
    },
  }), `/api/regional/au-dea-hotspots${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(requestedUrl.origin, 'https://hotspots.dea.ga.gov.au');
  assert.equal(requestedUrl.searchParams.get('typeName'), 'public:hotspots_three_days');
  assert.equal(requestedUrl.searchParams.get('bbox'), '144.9,-37.9,145,-37.8,EPSG:4326');
  assert.equal(requestedOptions.redirect, 'error');
  assert.match(requestedOptions.headers.Accept, /json/i);
  assert.equal(response.headers['x-regional-status'], 'fresh');
  assert.doesNotMatch(response.body, /internal\.99|secret note|"id":99/);
});

test('regional proxy admits all six final-gap WFS sources through the shared OGC path', async () => {
  const requested = [];
  const middleware = createRegionalProxy({
    fetchImpl: async (input) => {
      requested.push(new URL(input).searchParams.get('typeName'));
      return regionalResponseJson({ type: 'FeatureCollection', numberMatched: 0, numberReturned: 0, features: [] });
    },
  });
  const sourceIds = ['vic-ev-chargers', 'vic-renewable-facilities', 'vic-flood-history-2022', 'vic-epa-priority-sites', 'vic-landfill-register', 'vic-recreation-assets'];
  const responses = [];
  for (const [index, sourceId] of sourceIds.entries()) {
    responses.push(await invokeRegional(
      middleware,
      `/api/regional/${sourceId}?west=${144.9 + index / 100}&south=-37.9&east=${144.905 + index / 100}&north=-37.895`,
    ));
  }
  assert.deepEqual(responses.map(({ status }) => status), Array(6).fill(200));
  assert.deepEqual(requested.sort(), [
    'open-data-platform:dcav_site',
    'open-data-platform:psr_polygon',
    'open-data-platform:recweb_asset',
    'open-data-platform:renewables',
    'open-data-platform:vic_flood_history_public',
    'open-data-platform:vlr_polygon',
  ]);
});

test('regional proxy applies the flood-only response byte ceiling without lowering the global OGC cap', async () => {
  const payload = JSON.stringify({ type: 'FeatureCollection', numberMatched: 0, numberReturned: 0, features: [] });
  const responseWithPadding = (bytes) => new Response(`${payload}${' '.repeat(bytes - payload.length)}`, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const floodAtOnePointFourMb = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => responseWithPadding(1_400_000),
  }), `/api/regional/vic-flood-history-2022${MELBOURNE_BOUNDS}`);
  const floodAtOnePointSixMb = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => responseWithPadding(1_600_000),
  }), `/api/regional/vic-flood-history-2022${MELBOURNE_BOUNDS}`);
  const parkAtOnePointSixMb = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => responseWithPadding(1_600_000),
  }), `/api/regional/vic-parks${MELBOURNE_BOUNDS}`);
  assert.equal(floodAtOnePointFourMb.status, 200);
  assert.equal(floodAtOnePointSixMb.status, 502);
  assert.deepEqual(JSON.parse(floodAtOnePointSixMb.body), { error: 'regional source response was too large' });
  assert.equal(parkAtOnePointSixMb.status, 200);
});

test('regional proxy sanitizes exhausted OGC topology validation as invalid provider data', async () => {
  const features = Array.from({ length: 70 }, (_, rowIndex) => {
    const polygons = Array.from({ length: 65 }, (_, polygonIndex) => {
      const west = rowIndex * 0.1 + polygonIndex / 10_000;
      return [[[west, 0], [west + 0.00005, 0], [west + 0.00005, 0.00005], [west, 0]]];
    });
    polygons.push(structuredClone(polygons[0]));
    return {
      type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polygons },
      properties: { name: `Expensive invalid reserve ${rowIndex}` },
    };
  });
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({
      type: 'FeatureCollection',
      features,
    }),
  }), '/api/regional/vic-parks?west=0&south=0&east=10&north=10');

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'regional source returned invalid data' });
});

test('regional proxy serves valid OGC rows as degraded when invalid topology rows are omitted', async () => {
  const valid = { type: 'Feature', geometry: {
    type: 'Polygon', coordinates: [[[144, -38], [146, -38], [146, -37], [144, -37], [144, -38]]],
  }, properties: { site_name: 'Valid heritage place', heritage_object: 'Building' } };
  const invalid = { type: 'Feature', geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[[144, -38], [145, -38], [145, -37], [144, -37], [144, -38]]],
      [[[144.5, -37.5], [145.5, -37.5], [145.5, -36.5], [144.5, -36.5], [144.5, -37.5]]],
    ],
  }, properties: { site_name: 'Invalid sibling polygons' } };
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({
      type: 'FeatureCollection', numberMatched: 2, numberReturned: 2, features: [invalid, valid],
    }),
  }), `/api/regional/vic-heritage${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  const body = JSON.parse(response.body);
  assert.deepEqual(body.features.map(({ properties }) => properties.title), ['Valid heritage place']);
  assert.equal(body.sourceStatus.status, 'partial');
  assert.equal(body.sourceStatus.invalidFeatures, 1);
});

test('regional proxy fails closed when a nonempty OGC response has no valid features', async () => {
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async () => regionalResponseJson({
      type: 'FeatureCollection', numberMatched: 1, numberReturned: 1,
      features: [{ type: 'Feature', geometry: {
        type: 'Polygon', coordinates: [[[144, -38], [146, -37], [144, -37], [146, -38], [144, -38]]],
      }, properties: { site_name: 'Invalid self-crossing place' } }],
    }),
  }), `/api/regional/vic-heritage${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'regional source returned invalid data' });
});

test('regional proxy rejects OGC redirects, non-JSON media and oversized streams with sanitized errors', async () => {
  const route = `/api/regional/vic-parks${MELBOURNE_BOUNDS}`;
  const cases = [
    [new Response('', { status: 302, headers: { location: 'https://attacker.invalid/' } }), 502, 'temporarily unavailable'],
    [new Response('<html>not json</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 502, 'invalid data'],
    [new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2_100_000));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }), 502, 'too large'],
  ];
  for (const [upstream, status, message] of cases) {
    const response = await invokeRegional(createRegionalProxy({ fetchImpl: async () => upstream }), route);
    assert.equal(response.status, status);
    assert.match(JSON.parse(response.body).error, new RegExp(message));
    assert.doesNotMatch(response.body, /attacker|not json/);
  }
});

test('regional proxy holds the shared four-request semaphore through OGC body consumption', async () => {
  let active = 0;
  let maxActive = 0;
  const middleware = createRegionalProxy({
    fetchImpl: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Response(new ReadableStream({
        async start(controller) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.enqueue(new TextEncoder().encode('{"type":"FeatureCollection","features":[]}'));
          controller.close();
          active -= 1;
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const responses = await Promise.all([
    invokeRegional(middleware, `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`),
    invokeRegional(middleware, `/api/regional/au-dea-hotspots${MELBOURNE_BOUNDS}`),
    invokeRegional(middleware, `/api/regional/vic-parks${MELBOURNE_BOUNDS}`),
    invokeRegional(middleware, `/api/regional/vic-heritage${MELBOURNE_BOUNDS}`),
  ]);
  assert.deepEqual(responses.map(({ status }) => status), Array(4).fill(200));
  assert.ok(maxActive <= 4, `expected at most four active provider bodies, observed ${maxActive}`);
  assert.equal(active, 0);
});

test('regional proxy serves OGC last-good only inside the source-specific stale ceiling', async () => {
  let clock = 1_000_000;
  let fail = false;
  const middleware = createRegionalProxy({
    now: () => clock,
    fetchImpl: async () => {
      if (fail) throw new Error('private provider failure');
      return regionalResponseJson({ type: 'FeatureCollection', features: [] });
    },
  });
  const route = `/api/regional/au-dea-hotspots${MELBOURNE_BOUNDS}`;
  assert.equal((await invokeRegional(middleware, route)).status, 200);
  fail = true;
  clock += 300_001;
  const stale = await invokeRegional(middleware, route);
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['x-regional-status'], 'stale');
  assert.equal(stale.headers['x-regional-cache'], 'STALE');

  clock = 1_900_001;
  const expired = await invokeRegional(middleware, route);
  assert.equal(expired.status, 502);
  assert.deepEqual(JSON.parse(expired.body), { error: 'regional source is temporarily unavailable' });
  assert.doesNotMatch(expired.body, /private provider failure/);
});

test('regional proxy maps all-stale civic observations to a degraded header', async () => {
  const response = await invokeRegional(createRegionalProxy({
    melbourneCivicClient: {
      async load() {
        return { type: 'FeatureCollection', features: [], sourceStatus: { status: 'stale', staleRecords: 2, currentRecords: 0 } };
      },
    },
  }), `/api/regional/melbourne-parking-live${MELBOURNE_BOUNDS}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
});

test('Melbourne civic last-good data expires at the source-specific stale ceiling', async () => {
  let clock = 1_000_000;
  let fail = false;
  const middleware = createRegionalProxy({
    now: () => clock,
    melbourneCivicClient: {
      async load() {
        if (fail) throw new Error('provider details must not escape');
        return { type: 'FeatureCollection', features: [], sourceStatus: { status: 'current' } };
      },
    },
  });
  const url = `/api/regional/melbourne-parking-live${MELBOURNE_BOUNDS}`;
  assert.equal((await invokeRegional(middleware, url)).status, 200);
  fail = true;
  clock += 120_001;
  const briefStale = await invokeRegional(middleware, url);
  assert.equal(briefStale.status, 200);
  assert.equal(briefStale.headers['x-regional-cache'], 'STALE');

  clock = 1_600_001;
  const expired = await invokeRegional(middleware, url);
  assert.equal(expired.status, 502);
  assert.deepEqual(JSON.parse(expired.body), { error: 'regional source is temporarily unavailable' });
  assert.doesNotMatch(expired.body, /provider details/);
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

test('regional proxy advances a short transfer-limited ArcGIS page by the requested window', async () => {
  const offsets = [];
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const offset = Number(new URL(input).searchParams.get('resultOffset'));
      offsets.push(offset);
      const featuresByOffset = {
        0: [
          gaPoint({ name: 'First Window A', authority: 'VIC' }, 144.91),
          gaPoint({ name: 'First Window B', authority: 'VIC' }, 144.92),
        ],
        2: [
          gaPoint({ name: 'First Window B', authority: 'VIC' }, 144.92),
          gaPoint({ name: 'Overlapping Wrong Window', authority: 'VIC' }, 144.93),
        ],
        500: [
          gaPoint({ name: 'Second Window A', authority: 'VIC' }, 144.94),
          gaPoint({ name: 'Second Window B', authority: 'VIC' }, 144.95),
        ],
      };
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: featuresByOffset[offset] || [],
        exceededTransferLimit: offset === 0,
      });
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'fresh');
  assert.deepEqual(offsets, [0, 500]);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.features.map((feature) => feature.properties.title), [
    'First Window A', 'First Window B', 'Second Window A', 'Second Window B',
  ]);
  assert.equal(new Set(body.features.map((feature) => feature.id)).size, body.features.length);
  assert.equal(body.sourceStatus.status, 'current');
});

test('regional proxy continues after an empty ArcGIS transfer-limited page', async () => {
  const offsets = [];
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const offset = Number(new URL(input).searchParams.get('resultOffset'));
      offsets.push(offset);
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: offset === 0 ? [] : [gaPoint({ name: 'Recovered Place', authority: 'VIC' })],
        exceededTransferLimit: offset === 0,
      });
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.deepEqual(offsets, [0, 500]);
  assert.equal(JSON.parse(response.body).features[0].properties.title, 'Recovered Place');
});

test('regional proxy stops after a short transfer-limited final ArcGIS page as locally capped', async () => {
  const offsets = [];
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const offset = Number(new URL(input).searchParams.get('resultOffset'));
      offsets.push(offset);
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: offset === 0
          ? [gaPoint({ name: 'First Window Place', authority: 'VIC' }, 144.91)]
          : [gaPoint({ name: 'Final Window Place', authority: 'VIC' }, 144.92)],
        exceededTransferLimit: true,
      });
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  assert.deepEqual(offsets, [0, 500]);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.features.map((feature) => feature.properties.title), [
    'First Window Place', 'Final Window Place',
  ]);
  assert.equal(body.sourceStatus.status, 'partial');
  assert.equal(body.sourceStatus.capped, true);
  assert.equal(body.sourceStatus.layers[0].status, 'partial');
  assert.equal(body.sourceStatus.layers[0].error, undefined);
});

test('regional proxy returns an empty partial result at the final ArcGIS page cap', async () => {
  const offsets = [];
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      offsets.push(Number(new URL(input).searchParams.get('resultOffset')));
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: [],
        exceededTransferLimit: true,
      });
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  assert.deepEqual(offsets, [0, 500]);
  const body = JSON.parse(response.body);
  assert.deepEqual(body.features, []);
  assert.equal(body.sourceStatus.status, 'partial');
  assert.equal(body.sourceStatus.capped, true);
  assert.equal(body.sourceStatus.layers[0].status, 'partial');
  assert.equal(body.sourceStatus.layers[0].error, undefined);
});

test('regional proxy retains page one when a later page of the same GA layer fails', async () => {
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const offset = Number(new URL(input).searchParams.get('resultOffset'));
      if (offset === 500) return regionalResponseJson({ provider: 'secret page two failure' }, 503);
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: Array.from({ length: 500 }, (_, index) => gaPoint({
          name: `Retained Place ${index}`,
          authority: 'VIC',
        }, 144.9 + index / 100_000)),
        exceededTransferLimit: true,
      });
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  const body = JSON.parse(response.body);
  assert.equal(body.features.length, 500);
  assert.equal(body.features[0].properties.title, 'Retained Place 0');
  assert.equal(body.sourceStatus.status, 'partial');
  assert.equal(body.sourceStatus.layers[0].status, 'partial');
  assert.equal(body.sourceStatus.layers[0].error, 'upstream-unavailable');
  assert.doesNotMatch(response.body, /secret page two failure/);
});

test('regional proxy reports a source-wide multi-layer cap as degraded', async () => {
  const response = await invokeRegional(createRegionalProxy({
    fetchImpl: async (input) => {
      const layer = Number(new URL(input).pathname.match(/MapServer\/(\d+)\/query$/)?.[1]);
      const count = layer < 2 ? 500 : 1;
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: Array.from({ length: count }, (_, index) => gaPoint({
          facility_name: `Facility ${layer}-${index}`,
        }, 144.9 + index / 100_000, -37.8 - layer / 10_000)),
      });
    },
  }), `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers['x-regional-status'], 'degraded');
  const body = JSON.parse(response.body);
  assert.equal(body.sourceStatus.status, 'partial');
  assert.equal(body.sourceStatus.capped, true);
  assert.deepEqual(body.sourceStatus.layers.slice(2).map(({ status, unprocessed }) => [status, unprocessed]), [
    ['capped', true], ['capped', true], ['capped', true], ['capped', true],
  ]);
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

test('regional proxy treats an empty page followed by timeout as no retained GA data', async () => {
  const response = await invokeRegional(createRegionalProxy({
    timeoutMs: 10,
    fetchImpl: async (input, { signal }) => {
      const offset = Number(new URL(input).searchParams.get('resultOffset'));
      if (offset === 0) {
        return regionalResponseJson({ type: 'FeatureCollection', features: [], exceededTransferLimit: true });
      }
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    },
  }), `/api/regional/au-place-names${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 504);
  assert.deepEqual(JSON.parse(response.body), { error: 'regional source timed out' });
});

test('regional proxy reports mixed GA timeout and non-timeout failures as unavailable', async () => {
  const response = await invokeRegional(createRegionalProxy({
    timeoutMs: 10,
    fetchImpl: async (input, { signal }) => {
      const layer = Number(new URL(input).pathname.match(/MapServer\/(\d+)\/query$/)?.[1]);
      if (layer === 0) {
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
      }
      return regionalResponseJson({ provider: 'secret failure' }, 503);
    },
  }), `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`);

  assert.equal(response.status, 502);
  assert.deepEqual(JSON.parse(response.body), { error: 'regional source is temporarily unavailable' });
  assert.doesNotMatch(response.body, /secret failure|timeout/);
});

test('regional proxy caps concurrent GA provider fetches at four across fan-out and refreshes', async () => {
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const middleware = createRegionalProxy({
    fetchImpl: async (input) => {
      active += 1;
      calls += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const layer = Number(new URL(input).pathname.match(/MapServer\/(\d+)\/query$/)?.[1]);
      return regionalResponseJson({
        type: 'FeatureCollection',
        features: [gaPoint({ facility_name: `Facility ${layer}` })],
      });
    },
  });

  const responses = await Promise.all([
    invokeRegional(middleware, `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`),
    invokeRegional(middleware, '/api/regional/au-emergency-facilities?west=145&south=-37.9&east=145.1&north=-37.8'),
  ]);

  assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
  assert.equal(calls, 12);
  assert.ok(maxActive <= 4, `expected at most four active GA fetches, observed ${maxActive}`);
});

test('regional proxy releases GA provider capacity after failures and aborts', async () => {
  let phase = 'fail';
  let active = 0;
  let maxActive = 0;
  const middleware = createRegionalProxy({
    timeoutMs: 10,
    fetchImpl: async (input, { signal }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        const layer = Number(new URL(input).pathname.match(/MapServer\/(\d+)\/query$/)?.[1]);
        if (phase === 'fail') {
          if (layer === 0) return await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
          throw new Error('provider failure');
        }
        return regionalResponseJson({ type: 'FeatureCollection', features: [] });
      } finally {
        active -= 1;
      }
    },
  });

  const failed = await invokeRegional(middleware, `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`);
  phase = 'recover';
  const recovered = await invokeRegional(middleware, '/api/regional/au-emergency-facilities?west=145&south=-37.9&east=145.1&north=-37.8');

  assert.equal(failed.status, 502);
  assert.equal(recovered.status, 200);
  assert.ok(maxActive <= 4);
});

test('regional proxy shares four actual request slots across GA and civic fan-out and recovers after failure', async () => {
  let active = 0;
  let maxActive = 0;
  let failOneCivic = true;
  const middleware = createRegionalProxy({
    fetchImpl: async (input) => {
      const url = new URL(input);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise((resolve) => setTimeout(resolve, 4));
        if (failOneCivic && url.pathname.includes('public-memorials-and-sculptures')) return regionalResponseJson({}, 503);
        if (url.hostname === 'services.ga.gov.au') {
          return regionalResponseJson({ type: 'FeatureCollection', features: [] });
        }
        if (url.pathname.endsWith('/exports/json')) return regionalResponseJson([]);
        return regionalResponseJson({ total_count: 0, results: [] });
      } finally {
        active -= 1;
      }
    },
  });
  const first = await Promise.all([
    invokeRegional(middleware, `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`),
    invokeRegional(middleware, `/api/regional/melbourne-culture${MELBOURNE_BOUNDS}`),
    invokeRegional(middleware, '/api/regional/melbourne-culture?west=145&south=-37.9&east=145.1&north=-37.8'),
  ]);
  assert.deepEqual(first.map(({ status }) => status), [200, 200, 200]);
  assert.ok(maxActive <= 4, `expected at most four actual provider requests, observed ${maxActive}`);

  failOneCivic = false;
  const recovered = await invokeRegional(middleware, '/api/regional/melbourne-culture?west=145.2&south=-37.9&east=145.3&north=-37.8');
  assert.equal(recovered.status, 200);
  assert.ok(maxActive <= 4);
});

test('regional proxy shares four provider slots across PTV body reads and GA or civic fan-out', async () => {
  let active = 0;
  let maxActive = 0;
  const apiKey = process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
  process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = 'secret-value';
  try {
    const middleware = createRegionalProxy({
      fetchImpl: async (input) => {
        const url = new URL(input);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 3));
        if (url.hostname === 'api.opendata.transport.vic.gov.au') {
          const bytes = regionalTransitFeed();
          return new Response(new ReadableStream({
            async start(controller) {
              await new Promise((resolve) => setTimeout(resolve, 3));
              controller.enqueue(bytes);
              controller.close();
              active -= 1;
            },
          }), { status: 200, headers: { 'Content-Type': 'application/x-protobuf' } });
        }
        active -= 1;
        return url.hostname === 'services.ga.gov.au'
          ? regionalResponseJson({ type: 'FeatureCollection', features: [] })
          : url.pathname.endsWith('/exports/json')
            ? regionalResponseJson([])
          : regionalResponseJson({ total_count: 0, results: [] });
      },
    });
    const responses = await Promise.all([
      invokeRegional(middleware, `/api/regional/ptv-transit${MELBOURNE_BOUNDS}`),
      invokeRegional(middleware, `/api/regional/au-emergency-facilities${MELBOURNE_BOUNDS}`),
      invokeRegional(middleware, `/api/regional/melbourne-culture${MELBOURNE_BOUNDS}`),
    ]);
    assert.deepEqual(responses.map(({ status }) => status), [200, 200, 200]);
    assert.ok(maxActive <= 4, `expected at most four actual provider requests, observed ${maxActive}`);
    assert.equal(active, 0);
  } finally {
    if (apiKey === undefined) delete process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY;
    else process.env.TRANSPORT_VIC_OPEN_DATA_API_KEY = apiKey;
  }
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
