import { REGIONAL_SOURCES, normalizeRegionalFeatureCollection, regionalSourceAvailability } from './regionalSources.js';
import { gaArcGisRequests } from './gaRegionalSources.js';
import { createTransportVicGtfs } from './transportVicGtfs.js';
import { createMelbourneCivicClient } from './melbourneCivicSources.js';
import { OGC_MAX_RESPONSE_BYTES, normalizeOgcPayload, ogcFeatureRequest } from './ogcRegionalSources.js';
import { createIndexedRegionalDownloads, INDEXED_REGIONAL_DOWNLOAD_SOURCE_IDS } from './indexedRegionalDownloads.js';
import { createDataVicWasteFacilities } from './dataVicWasteFacilities.js';
import { normalizeVicmapParcelPayload, vicmapParcelRequest } from './vicmapPropertyBoundaries.js';

const MAX_CACHE_ENTRIES = 64;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_BOUNDS_WIDTH = 10;
// A process-local cap limits all distinct source/bbox refreshes. Same-key
// callers still coalesce, and an expired last-good entry can still be served.
const MAX_CONCURRENT_UPSTREAM_REFRESHES = 4;
const ALLOWED_QUERY_KEYS = new Set(['west', 'south', 'east', 'north']);
const GA_SOURCE_IDS = new Set(['au-emergency-facilities', 'au-health-facilities', 'au-place-names']);
const MELBOURNE_CIVIC_SOURCE_IDS = new Set([
  'melbourne-drinking-fountains',
  'melbourne-barbecues',
  'melbourne-parking-live',
  'melbourne-development',
  'melbourne-culture',
]);
const OGC_SOURCE_IDS = new Set([
  'au-dea-hotspots', 'vic-parks', 'vic-recreation-tracks', 'vic-heritage',
  'vic-ev-chargers', 'vic-renewable-facilities', 'vic-flood-history-2022',
  'vic-epa-priority-sites', 'vic-landfill-register', 'vic-recreation-assets',
]);
const INDEXED_SOURCE_IDS = new Set(INDEXED_REGIONAL_DOWNLOAD_SOURCE_IDS);
const OGC_TIMEOUT_MS = 20_000;
const VICMAP_TIMEOUT_MS = 12_000;
const MAX_GA_PAGES_PER_LAYER = 2;
const GA_TIMEOUT_MS = 20_000;
const GA_GAZETTEER_TIMEOUT_MS = 30_000;

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
export function createRegionalProxy({ fetchImpl = fetch, now = () => Date.now(), timeoutMs, transportVicGtfs, melbourneCivicClient, indexedRegionalDownloads, dataVicWasteFacilities, env = process.env } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let activeRefreshes = 0;
  let activeProviderRequests = 0;
  const providerRequestWaiters = [];

  async function withProviderRequestSlot(operation) {
    if (activeProviderRequests >= MAX_CONCURRENT_UPSTREAM_REFRESHES) {
      await new Promise((resolve) => providerRequestWaiters.push(resolve));
    } else {
      activeProviderRequests += 1;
    }
    try {
      return await operation();
    } finally {
      const next = providerRequestWaiters.shift();
      if (next) next();
      else activeProviderRequests -= 1;
    }
  }
  const transportClient = transportVicGtfs || createTransportVicGtfs({
    fetchImpl,
    now,
    requestRunner: withProviderRequestSlot,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const civicClient = melbourneCivicClient || createMelbourneCivicClient({
    fetchImpl,
    now,
    withRequestSlot: withProviderRequestSlot,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const indexedClient = indexedRegionalDownloads || createIndexedRegionalDownloads({
    fetchImpl,
    now,
    withRequestSlot: withProviderRequestSlot,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const wasteClient = dataVicWasteFacilities || createDataVicWasteFacilities({
    fetchImpl,
    now,
    withRequestSlot: withProviderRequestSlot,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });

  async function refresh(sourceId, source, bbox) {
    if (sourceId === 'vic-property-boundaries') {
      return withProviderRequestSlot(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          const error = new Error('timeout');
          error.code = 'TIMEOUT';
          controller.abort(error);
        }, timeoutMs ?? VICMAP_TIMEOUT_MS);
        try {
          const response = await fetchImpl(vicmapParcelRequest(bbox), {
            method: 'GET', headers: { Accept: 'application/geo+json, application/json' }, signal: controller.signal, redirect: 'error',
          });
          if (!response?.ok) throw new Error('upstream failed');
          const contentType = response.headers?.get?.('content-type') || '';
          if (!/^application\/(?:geo\+json|(?:[a-z0-9!#$&^_.+-]+\+)?json)(?:\s*;|$)/i.test(contentType)) {
            const error = new Error('invalid provider media type');
            error.code = 'INVALID_MEDIA_TYPE';
            throw error;
          }
          return normalizeVicmapParcelPayload(await readJsonCapped(response, 2_000_000));
        } finally {
          clearTimeout(timer);
        }
      });
    }
    if (MELBOURNE_CIVIC_SOURCE_IDS.has(sourceId)) {
      return civicClient.load(sourceId, { bbox, maxFeatures: source.maxFeatures });
    }
    if (GA_SOURCE_IDS.has(sourceId)) {
      const initialRequests = gaArcGisRequests(sourceId, bbox, source.maxFeatures);
      const layerResults = await Promise.all(initialRequests.map(async (initialRequest) => {
        let request = initialRequest;
        let featureCount = 0;
        const payloads = [];
        try {
          for (let page = 0; page < MAX_GA_PAGES_PER_LAYER; page += 1) {
            const payload = await withProviderRequestSlot(async () => {
              const controller = new AbortController();
              const timer = setTimeout(() => {
                const error = new Error('timeout');
                error.code = 'TIMEOUT';
                controller.abort(error);
              }, timeoutMs ?? (sourceId === 'au-place-names' ? GA_GAZETTEER_TIMEOUT_MS : GA_TIMEOUT_MS));
              try {
                const response = await fetchImpl(request.url, {
                  method: 'GET', headers: { Accept: 'application/geo+json, application/json' }, signal: controller.signal, redirect: 'error',
                });
                if (!response?.ok) throw new Error('upstream failed');
                return await readJsonCapped(response, MAX_RESPONSE_BYTES);
              } finally {
                clearTimeout(timer);
              }
            });
            if (!Array.isArray(payload?.features) || payload.features.length > request.requestedCount) {
              const error = new Error('invalid GA response');
              error.code = 'INVALID_GA_RESPONSE';
              throw error;
            }
            payloads.push(payload);
            featureCount += payload.features.length;
            if (payload.exceededTransferLimit !== true) {
              return { layer: request.layer, payloads };
            }
            if (featureCount >= source.maxFeatures) {
              return { layer: request.layer, payloads, truncated: true };
            }
            if (page === MAX_GA_PAGES_PER_LAYER - 1) {
              return { layer: request.layer, payloads, truncated: true };
            }
            const nextOffset = request.offset + request.requestedCount;
            request = request.nextPage(nextOffset, source.maxFeatures - featureCount);
          }
          return { layer: request.layer, payloads, truncated: true };
        } catch (error) {
          return { layer: initialRequest.layer, payloads, error };
        }
      }));
      const hasRetainedFeatures = (result) => result.payloads.some((payload) => payload.features.length > 0);
      if (layerResults.every((result) => result.error && !hasRetainedFeatures(result))) {
        const timedOut = (result) => result.error?.code === 'TIMEOUT' || result.error?.name === 'AbortError';
        if (layerResults.every(timedOut)) {
          const error = new Error('all GA layers timed out');
          error.code = 'TIMEOUT';
          throw error;
        }
        if (layerResults.every((result) => result.error?.code === 'INVALID_GA_RESPONSE')) throw layerResults[0].error;
        if (layerResults.every((result) => result.error?.code === 'RESPONSE_TOO_LARGE')) throw layerResults[0].error;
        const error = new Error('all GA layers failed');
        error.code = 'ALL_GA_LAYERS_FAILED';
        throw error;
      }
      return normalizeRegionalFeatureCollection(sourceId, layerResults);
    }
    if (OGC_SOURCE_IDS.has(sourceId)) {
      return withProviderRequestSlot(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          const error = new Error('timeout');
          error.code = 'TIMEOUT';
          controller.abort(error);
        }, timeoutMs ?? OGC_TIMEOUT_MS);
        try {
          const response = await fetchImpl(ogcFeatureRequest(sourceId, bbox, source.maxFeatures), {
            method: 'GET', headers: { Accept: 'application/geo+json, application/json' }, signal: controller.signal, redirect: 'error',
          });
          if (!response?.ok) throw new Error('upstream failed');
          const contentType = response.headers?.get?.('content-type') || '';
          if (!/^application\/(?:geo\+json|(?:[a-z0-9!#$&^_.+-]+\+)?json)(?:\s*;|$)/i.test(contentType)) {
            const error = new Error('invalid provider media type');
            error.code = 'INVALID_MEDIA_TYPE';
            throw error;
          }
          if (!response.body?.getReader) {
            const error = new Error('unbounded provider body');
            error.code = 'INVALID_OGC_RESPONSE';
            throw error;
          }
          const payload = await readJsonCapped(response, source.maxResponseBytes ?? OGC_MAX_RESPONSE_BYTES);
          return normalizeOgcPayload(sourceId, payload, { maxFeatures: source.maxFeatures });
        } finally {
          clearTimeout(timer);
        }
      });
    }
    const transport = SOURCE_TRANSPORT[sourceId];
    if (!transport) throw new Error('source unavailable');
    return withProviderRequestSlot(async () => {
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
    });
  }

  return async function regionalProxy(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET' });
    const url = new URL(req.url || '/', 'http://localhost');
    const sourceId = requestSourceId(url.pathname);
    if (!sourceId || !Object.hasOwn(REGIONAL_SOURCES, sourceId)) return sendJson(res, 404, { error: 'unknown regional source' });
    const source = REGIONAL_SOURCES[sourceId];
    const admissionEnv = source.credentialEnv ? { [source.credentialEnv]: env?.[source.credentialEnv] } : env;
    const availability = regionalSourceAvailability(sourceId, admissionEnv);
    if (!availability.available) {
      const credentialsRequired = availability.status === 'credentials-required';
      return sendJson(res, credentialsRequired ? 424 : 403, {
        error: credentialsRequired ? 'regional source credentials required' : 'regional source is unavailable',
        ...(source.availabilityReason ? { reason: availability.reason } : {}),
      }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': availability.status });
    }
    const bbox = parseBounds(url);
    if (!bbox) return sendJson(res, 400, { error: 'invalid regional bounds' });
    const serverApiKey = source.credentialEnv
      ? String(env?.[source.credentialEnv] || '').trim()
      : '';
    if (sourceId === 'ptv-transit') {
      try {
        const payload = await transportClient.load({ bbox, apiKey: serverApiKey, maxFeatures: source.maxFeatures });
        const body = normalizeRegionalFeatureCollection(sourceId, payload);
        const statuses = Object.values(body.modeStatus || {}).map(({ status }) => status);
        const status = statuses.every((value) => value === 'current') ? 'fresh' : 'degraded';
        return sendJson(res, 200, body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': status });
      } catch (error) {
        if (error?.code === 'CREDENTIALS_REQUIRED') {
          return sendJson(res, 424, { error: 'regional source credentials required' }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'credentials-required' });
        }
        return sendJson(res, error?.code === 'TIMEOUT' ? 504 : 502, {
          error: error?.code === 'TIMEOUT' ? 'regional source timed out' : 'regional source is temporarily unavailable',
        }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'unavailable' });
      }
    }
    if (sourceId === 'vic-waste-facilities') {
      try {
        const body = await wasteClient.load({ bbox, maxFeatures: source.maxFeatures });
        const sourceStatus = body?.sourceStatus || {};
        const status = sourceStatus.status === 'stale'
          ? 'stale'
          : sourceStatus.status === 'current' ? 'fresh' : 'degraded';
        const cache = cleanIndexedCacheHeader(sourceStatus.cache);
        return sendJson(res, 200, body, {
          'X-Regional-Source': sourceId,
          'X-Regional-Status': status,
          ...(cache ? { 'X-Regional-Cache': cache } : {}),
        });
      } catch (error) {
        const timedOut = error?.name === 'AbortError' || error?.code === 'TIMEOUT';
        return sendJson(res, timedOut ? 504 : 502, {
          error: timedOut ? 'regional source timed out' : 'regional source returned invalid data',
        }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'unavailable' });
      }
    }
    if (INDEXED_SOURCE_IDS.has(sourceId)) {
      try {
        const body = await indexedClient.load(sourceId, { bbox, maxFeatures: source.maxFeatures });
        const sourceStatus = body?.sourceStatus || {};
        const status = sourceStatus.status === 'stale'
          ? 'stale'
          : sourceStatus.status === 'current' ? 'fresh' : 'degraded';
        const cache = cleanIndexedCacheHeader(sourceStatus.cache);
        return sendJson(res, 200, body, {
          'X-Regional-Source': sourceId,
          'X-Regional-Status': status,
          ...(cache ? { 'X-Regional-Cache': cache } : {}),
        });
      } catch (error) {
        const timedOut = error?.code === 'TIMEOUT';
        const invalid = ['SOURCE_LIMIT', 'INVALID_SOURCE_METADATA', 'INVALID_SOURCE_DATA', 'INVALID_SOURCE_QUERY'].includes(error?.code);
        return sendJson(res, timedOut ? 504 : 502, {
          error: timedOut
            ? 'regional source timed out'
            : invalid ? 'regional source returned invalid data' : 'regional source is temporarily unavailable',
        }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'unavailable' });
      }
    }

    const key = cacheKey(sourceId, bbox);
    const existing = cache.get(key);
    const canServeLastGood = () => existing && (!Number.isFinite(source.maxStaleMs)
      || now() - existing.cachedAt <= source.maxStaleMs);
    if (existing && now() - existing.cachedAt < source.refreshMs) {
      const sourceStatus = existing.body?.sourceStatus?.status;
      return sendJson(res, 200, existing.body, {
        'X-Regional-Source': sourceId,
        'X-Regional-Status': sourceStatus && sourceStatus !== 'current' ? 'degraded' : 'fresh',
        'X-Regional-Cache': 'HIT',
      });
    }
    let pending = inFlight.get(key);
    if (!pending) {
      if (activeRefreshes >= MAX_CONCURRENT_UPSTREAM_REFRESHES) {
        if (canServeLastGood()) return sendJson(res, 200, existing.body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'stale', 'X-Regional-Cache': 'STALE' });
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
      const sourceStatus = body?.sourceStatus?.status;
      return sendJson(res, 200, body, {
        'X-Regional-Source': sourceId,
        'X-Regional-Status': sourceStatus && sourceStatus !== 'current' ? 'degraded' : 'fresh',
        'X-Regional-Cache': 'MISS',
      });
    } catch (error) {
      if (sourceId === 'vic-property-boundaries' && error?.code === 'VICMAP_ZOOM_REQUIRED') {
        return sendJson(res, 200, {
          type: 'FeatureCollection', features: [],
          sourceStatus: { status: 'zoom-required', capped: false, reason: 'Zoom in to level 18 or closer to view parcel boundaries.' },
        }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'zoom-required' });
      }
      if (sourceId === 'vic-property-boundaries' && error?.code === 'OUTSIDE_VICMAP_COVERAGE') {
        return sendJson(res, 200, {
          type: 'FeatureCollection', features: [],
          sourceStatus: { status: 'outside-coverage', capped: false, reason: 'Viewport is outside Victoria.' },
        }, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'outside-coverage' });
      }
      if (canServeLastGood()) return sendJson(res, 200, existing.body, { 'X-Regional-Source': sourceId, 'X-Regional-Status': 'stale', 'X-Regional-Cache': 'STALE' });
      if (error?.code === 'RESPONSE_TOO_LARGE') return sendJson(res, 502, { error: 'regional source response was too large' });
      if (['INVALID_JSON', 'INVALID_GA_RESPONSE', 'INVALID_MEDIA_TYPE', 'INVALID_OGC_RESPONSE', 'INVALID_OGC_GEOMETRY', 'OGC_FEATURE_LIMIT', 'OGC_COORDINATE_LIMIT', 'OGC_NESTING_LIMIT', 'OGC_TOPOLOGY_LIMIT'].includes(error?.code)
        || error?.message === 'source unavailable') return sendJson(res, 502, { error: 'regional source returned invalid data' });
      // Normalizer errors are intentionally collapsed with malformed payloads.
      if (error?.message?.includes('payload must contain') || error?.message?.includes('Unknown regional source')) {
        return sendJson(res, 502, { error: 'regional source returned invalid data' });
      }
      return sendJson(res, unavailableError(error), { error: unavailableError(error) === 504 ? 'regional source timed out' : 'regional source is temporarily unavailable' });
    }
  };
}

function cleanIndexedCacheHeader(value) {
  const headers = { hit: 'HIT', miss: 'MISS', stale: 'STALE', revalidated: 'REVALIDATED' };
  return headers[value] || '';
}
