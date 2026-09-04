import { REGIONAL_SOURCES, normalizeRegionalFeatureCollection } from './regionalSources.js';

const MAX_CACHE_ENTRIES = 64;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_BOUNDS_WIDTH = 10;
// A process-local cap limits all distinct source/bbox refreshes. Same-key
// callers still coalesce, and an expired last-good entry can still be served.
const MAX_CONCURRENT_UPSTREAM_REFRESHES = 4;
const ALLOWED_QUERY_KEYS = new Set(['west', 'south', 'east', 'north']);

// These are server-owned query templates. They are deliberately separate from
// the catalogue: the browser supplies only an approved source ID and a bbox.
const SOURCE_TRANSPORT = Object.freeze({
  'melbourne-trees': Object.freeze({
    timeoutMs: 8_000,
    url: (bbox, source) => cityRecordsUrl('trees-with-species-and-dimensions-urban-forest', bbox, source.maxFeatures),
  }),
  'melbourne-places': Object.freeze({
    timeoutMs: 8_000,
    url: (bbox, source) => cityRecordsUrl('public-toilets', bbox, source.maxFeatures),
  }),
  'melbourne-cycling': Object.freeze({
    timeoutMs: 10_000,
    url: (bbox, source) => cityGeoJsonUrl('bicycle-routes-including-informal-on-road-and-off-road-routes', bbox, source.maxFeatures),
  }),
  'melbourne-water-history': Object.freeze({
    timeoutMs: 10_000,
    url: (bbox, source) => cityGeoJsonUrl('water-flow-routes-over-land-urban-forest', bbox, source.maxFeatures),
  }),
  'vic-epa-air': Object.freeze({
    timeoutMs: 6_000,
    url: (bbox) => endpointUrl('https://gateway.api.epa.vic.gov.au/environmentMonitoring/v1/sites', bbox),
  }),
  'vic-fire-context': Object.freeze({
    timeoutMs: 12_000,
    url: (bbox, source) => arcGisGeoJsonUrl('https://mapshare.vic.gov.au/arcgis/rest/services/Planning_Schemes/MapServer/0/query', bbox, source.maxFeatures),
  }),
  'vic-freight-network': Object.freeze({
    timeoutMs: 12_000,
    url: (bbox, source) => arcGisGeoJsonUrl('https://mapshare.vic.gov.au/arcgis/rest/services/Transport/MapServer/0/query', bbox, source.maxFeatures),
  }),
  'au-hydrology': Object.freeze({
    timeoutMs: 15_000,
    url: (bbox, source) => arcGisGeoJsonUrl('https://awds.bom.gov.au/arcgis/rest/services/Geofabric/MapServer/0/query', bbox, source.maxFeatures),
  }),
});

function cityRecordsUrl(dataset, bbox, limit) {
  const url = new URL(`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/${dataset}/records`);
  url.searchParams.set('where', `within_box(geo_point_2d, ${bbox.south}, ${bbox.west}, ${bbox.north}, ${bbox.east})`);
  url.searchParams.set('limit', String(limit));
  return url;
}

function cityGeoJsonUrl(dataset, bbox, limit) {
  const url = new URL(`https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/${dataset}/exports/geojson`);
  url.searchParams.set('where', `intersects(geo_shape, geom'POLYGON((${bbox.west} ${bbox.south},${bbox.east} ${bbox.south},${bbox.east} ${bbox.north},${bbox.west} ${bbox.north},${bbox.west} ${bbox.south}))')`);
  url.searchParams.set('limit', String(limit));
  return url;
}

function endpointUrl(endpoint, bbox) {
  const url = new URL(endpoint);
  url.searchParams.set('west', String(bbox.west));
  url.searchParams.set('south', String(bbox.south));
  url.searchParams.set('east', String(bbox.east));
  url.searchParams.set('north', String(bbox.north));
  return url;
}

function arcGisGeoJsonUrl(endpoint, bbox, limit) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    f: 'geojson', where: '1=1', geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: '*', returnGeometry: 'true', resultRecordCount: String(limit),
  }).toString();
  return url;
}

function finiteCoordinate(value, min, max) {
  if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function parseBounds(url) {
  for (const key of url.searchParams.keys()) if (!ALLOWED_QUERY_KEYS.has(key)) return null;
  const west = finiteCoordinate(url.searchParams.get('west'), -180, 180);
  const south = finiteCoordinate(url.searchParams.get('south'), -90, 90);
  const east = finiteCoordinate(url.searchParams.get('east'), -180, 180);
  const north = finiteCoordinate(url.searchParams.get('north'), -90, 90);
  if ([west, south, east, north].some((value) => value === null)
    || west >= east || south >= north || east - west > MAX_BOUNDS_WIDTH || north - south > MAX_BOUNDS_WIDTH) return null;
  return { west, south, east, north };
}

function requestSourceId(pathname) {
  const match = pathname.match(/^\/(?:api\/regional\/)?([a-z0-9-]+)$/);
  return match?.[1] || null;
}

function cacheKey(sourceId, bbox) {
  return `${sourceId}:${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

async function readJsonCapped(response, maxBytes) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error('response too large');
    error.code = 'RESPONSE_TOO_LARGE';
    throw error;
  }
  const reader = response.body?.getReader?.();
  let bytes;
  if (reader) {
    const chunks = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          const error = new Error('response too large');
          error.code = 'RESPONSE_TOO_LARGE';
          throw error;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      const error = new Error('response too large');
      error.code = 'RESPONSE_TOO_LARGE';
      throw error;
    }
    bytes = buffer;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    const error = new Error('invalid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

function unavailableError(error) {
  return error?.name === 'AbortError' || error?.code === 'TIMEOUT' ? 504 : 502;
}

/** Create Vite middleware for the fixed, public regional-source allow-list. */
export function createRegionalProxy({ fetchImpl = fetch, now = () => Date.now(), timeoutMs } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let activeRefreshes = 0;

  async function refresh(sourceId, source, bbox) {
    const transport = SOURCE_TRANSPORT[sourceId];
    if (!transport) throw new Error('source unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const error = new Error('timeout');
      error.code = 'TIMEOUT';
      controller.abort(error);
    }, timeoutMs ?? transport.timeoutMs);
    try {
      const response = await fetchImpl(transport.url(bbox, source), {
        method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error',
      });
      if (!response?.ok) throw new Error('upstream failed');
      const payload = await readJsonCapped(response, MAX_RESPONSE_BYTES);
      return normalizeRegionalFeatureCollection(sourceId, payload);
    } finally {
      clearTimeout(timer);
    }
  }

  return async function regionalProxy(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET' });
    const url = new URL(req.url || '/', 'http://localhost');
    const sourceId = requestSourceId(url.pathname);
    if (!sourceId || !Object.hasOwn(REGIONAL_SOURCES, sourceId)) return sendJson(res, 404, { error: 'unknown regional source' });
    const source = REGIONAL_SOURCES[sourceId];
    if (!source.runtimeEligible) return sendJson(res, 403, { error: 'regional source is unavailable' });
    const bbox = parseBounds(url);
    if (!bbox) return sendJson(res, 400, { error: 'invalid regional bounds' });
    if (source.credential === 'server-required' && (!String(process.env.PTV_DEVELOPER_ID || '').trim() || !String(process.env.PTV_API_KEY || '').trim())) {
      return sendJson(res, 424, { error: 'regional source credentials required' }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'credentials-required' });
    }
    // Task 2 intentionally does not implement PTV's required HMAC signing.
    // Refuse even configured credentials rather than send an unsigned request.
    if (sourceId === 'ptv-transit') {
      return sendJson(res, 501, { error: 'regional source signing is not configured' }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'signing-required' });
    }

    const key = cacheKey(sourceId, bbox);
    const existing = cache.get(key);
    if (existing && now() - existing.cachedAt < source.refreshMs) {
      return sendJson(res, 200, existing.body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'fresh', 'X-Regional-Cache': 'HIT' });
    }
    let pending = inFlight.get(key);
    if (!pending) {
      if (activeRefreshes >= MAX_CONCURRENT_UPSTREAM_REFRESHES) {
        if (existing) return sendJson(res, 200, existing.body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'stale', 'X-Regional-Cache': 'STALE' });
        return sendJson(res, 503, { error: 'regional source is temporarily unavailable' }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'saturated' });
      }
      activeRefreshes += 1;
      pending = refresh(sourceId, source, bbox).then((body) => {
        cache.delete(key);
        cache.set(key, { body, cachedAt: now() });
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        return body;
      }).finally(() => {
        activeRefreshes -= 1;
        inFlight.delete(key);
      });
      inFlight.set(key, pending);
    }
    try {
      const body = await pending;
      return sendJson(res, 200, body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'fresh', 'X-Regional-Cache': 'MISS' });
    } catch (error) {
      if (existing) return sendJson(res, 200, existing.body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'stale', 'X-Regional-Cache': 'STALE' });
      if (error?.code === 'RESPONSE_TOO_LARGE') return sendJson(res, 502, { error: 'regional source response was too large' });
      if (error?.code === 'INVALID_JSON' || error?.message === 'source unavailable') return sendJson(res, 502, { error: 'regional source returned invalid data' });
      // Normalizer errors are intentionally collapsed with malformed payloads.
      if (error?.message?.includes('payload must contain') || error?.message?.includes('Unknown regional source')) {
        return sendJson(res, 502, { error: 'regional source returned invalid data' });
      }
      return sendJson(res, unavailableError(error), { error: unavailableError(error) === 504 ? 'regional source timed out' : 'regional source is temporarily unavailable' });
    }
  };
}
