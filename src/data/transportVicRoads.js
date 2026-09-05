const BASE = 'https://api.opendata.transport.vic.gov.au';
const PAGE_SIZE = 500;
const UNPLANNED_PAGE_SIZE = 100;
const MAX_PROVIDER_FEATURES = 2_000;
const DEFAULT_PAGE_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export const TRANSPORT_VIC_ROAD_URLS = Object.freeze({
  'vic-road-unplanned': `${BASE}/api/opendata/roads/disruptions/unplanned/v3`,
  'vic-lane-signals': `${BASE}/opendata/roads/lums/v1/sites`,
});

const SOURCE_CONFIG = Object.freeze({
  'vic-road-unplanned': Object.freeze({ refreshMs: 60_000, maxStaleMs: 5 * 60_000 }),
  'vic-lane-signals': Object.freeze({ refreshMs: 30_000, maxStaleMs: 2 * 60_000 }),
});

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isoDate(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    return host === 'gov.au' || host.endsWith('.gov.au') ? url.href : null;
  } catch {
    return null;
  }
}

function validPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && value[0] >= 140 && value[0] <= 150 && value[1] >= -40 && value[1] <= -33;
}

function normalizeGeometry(geometry, allowedTypes) {
  if (!geometry || !allowedTypes.includes(geometry.type)) return null;
  if (geometry.type === 'Point') return validPosition(geometry.coordinates)
    ? { type: 'Point', coordinates: [geometry.coordinates[0], geometry.coordinates[1]] }
    : null;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || geometry.coordinates.length > 5_000) return null;
  const coordinates = geometry.coordinates.map((position) => validPosition(position) ? [position[0], position[1]] : null);
  return coordinates.every(Boolean) ? { type: 'LineString', coordinates } : null;
}

/** Normalize one public unplanned-disruption feature into a strict allow-list. */
export function normalizeRoadDisruption(input) {
  const geometry = normalizeGeometry(input?.geometry, ['Point', 'LineString']);
  const raw = input?.properties || {};
  const id = cleanText(raw.id ?? input?.id, 120);
  if (!geometry || !id) return null;
  const properties = {
    label: cleanText(raw.closedRoadName || raw.declaredRoadName || raw.eventType || 'Road disruption'),
    roadName: cleanText(raw.closedRoadName || raw.declaredRoadName) || null,
    status: cleanText(raw.status || raw.eventLocationStatus, 40) || null,
    eventType: cleanText(raw.eventType, 80) || null,
    eventSubtype: cleanText(raw.eventSubType ?? raw.eventSubtype, 80) || null,
    direction: cleanText(raw.impact?.direction, 80) || null,
    impact: cleanText(raw.impact?.impactType, 100) || null,
    createdAt: isoDate(raw.created),
    updatedAt: isoDate(raw.lastUpdated),
    endsAt: isoDate(raw.endTime),
    officialUrl: safeOfficialUrl(raw.weblinkURL),
    caveat: 'Road disruption context only. Follow official traffic controls and emergency advice.',
  };
  return { type: 'Feature', id, geometry, properties: Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== null)) };
}

/** Normalize one Lane Use Management site without presenting its display as legal advice. */
export function normalizeLaneSignal(input) {
  const geometry = normalizeGeometry(input?.geometry, ['Point']);
  const raw = input?.properties || {};
  const id = cleanText(input?.id ?? raw.id, 120);
  if (!geometry || !id) return null;
  const lanes = Array.isArray(raw.lanes) ? raw.lanes.slice(0, 16).map((lane) => ({
    lane: Number.isFinite(Number(lane?.num)) ? Number(lane.num) : null,
    display: cleanText(lane?.value, 24),
  })).filter((lane) => lane.lane !== null && lane.display) : [];
  const reported = Number(raw.reportedSpeed);
  return {
    type: 'Feature', id, geometry,
    properties: {
      label: cleanText(raw.name || 'Lane-use signal'),
      state: cleanText(raw.state, 40) || 'Unknown',
      deviceType: cleanText(raw.deviceType, 80) || null,
      ...(Number.isFinite(reported) && reported >= 0 && reported <= 200 ? { reportedSpeedKph: reported } : {}),
      lanes,
      caveat: 'Display context only. Obey the road signs and conditions physically shown at the site.',
    },
  };
}

function intersectsBbox(feature, bbox) {
  let intersects = false;
  const visit = (value) => {
    if (intersects || !Array.isArray(value)) return;
    if (validPosition(value)) {
      intersects = value[0] >= bbox.west && value[0] <= bbox.east && value[1] >= bbox.south && value[1] <= bbox.north;
      return;
    }
    for (const nested of value) visit(nested);
  };
  visit(feature?.geometry?.coordinates);
  return intersects;
}

async function readJsonCapped(response, maxBytes) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    throw codedError('invalid provider response', 'INVALID_PROVIDER_DATA');
  }
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw codedError('provider response too large', 'RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader?.();
  if (!reader) throw codedError('unbounded provider response', 'INVALID_PROVIDER_DATA');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw codedError('provider response too large', 'RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw codedError('invalid provider response', 'INVALID_PROVIDER_DATA');
  }
}

function validateBbox(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

/** Provider-wide cached client for the Transport Victoria road products authorized by the portal key. */
export function createTransportVicRoads({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxPageBytes = DEFAULT_PAGE_BYTES,
  requestRunner = (operation) => operation(),
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function request(url, apiKey) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await requestRunner(async () => {
        const response = await fetchImpl(url, {
          method: 'GET', headers: { KeyId: apiKey, Accept: 'application/json' }, signal: controller.signal, redirect: 'error',
        });
        if (response?.status === 401 || response?.status === 403) throw codedError('credentials required', 'CREDENTIALS_REQUIRED');
        if (response?.status === 429) throw codedError('provider rate limited', 'RATE_LIMITED');
        if (!response?.ok) throw codedError('provider unavailable', 'UPSTREAM_UNAVAILABLE');
        return readJsonCapped(response, maxPageBytes);
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw codedError('provider timed out', 'TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchAll(sourceId, apiKey) {
    const rows = [];
    let totalFound = 0;
    if (sourceId === 'vic-road-unplanned') {
      for (let page = 1; page <= 20 && rows.length < MAX_PROVIDER_FEATURES; page += 1) {
        const url = new URL(TRANSPORT_VIC_ROAD_URLS[sourceId]);
        url.searchParams.set('page', String(page));
        url.searchParams.set('limit', String(UNPLANNED_PAGE_SIZE));
        const payload = await request(url, apiKey);
        const features = payload?.data?.features;
        if (!Array.isArray(features) || !Number.isInteger(payload?.meta?.total_pages) || payload.meta.total_pages < 0) {
          throw codedError('invalid provider response', 'INVALID_PROVIDER_DATA');
        }
        totalFound = Number(payload.meta.total_records) || features.length;
        rows.push(...features);
        if (page >= payload.meta.total_pages) break;
      }
    } else {
      for (let from = 0; from < MAX_PROVIDER_FEATURES; from += PAGE_SIZE) {
        const url = new URL(TRANSPORT_VIC_ROAD_URLS[sourceId]);
        url.searchParams.set('from', String(from));
        url.searchParams.set('size', String(PAGE_SIZE));
        const payload = await request(url, apiKey);
        const features = payload?.featureCollection?.features;
        if (!Array.isArray(features) || !Number.isInteger(payload?.totalFound) || payload.totalFound < features.length) {
          throw codedError('invalid provider response', 'INVALID_PROVIDER_DATA');
        }
        totalFound = payload.totalFound;
        rows.push(...features);
        if (from + PAGE_SIZE >= totalFound || features.length === 0) break;
      }
    }
    if (rows.length > MAX_PROVIDER_FEATURES) throw codedError('provider feature limit exceeded', 'INVALID_PROVIDER_DATA');
    const normalize = sourceId === 'vic-road-unplanned' ? normalizeRoadDisruption : normalizeLaneSignal;
    const features = rows.map(normalize).filter(Boolean);
    if (rows.length && !features.length) throw codedError('invalid provider response', 'INVALID_PROVIDER_DATA');
    return { features, totalFound, fetchedAt: now() };
  }

  async function load(sourceId, { bbox, apiKey, maxFeatures = 500 } = {}) {
    const config = SOURCE_CONFIG[sourceId];
    if (!config) throw codedError('unknown road source', 'INVALID_SOURCE');
    if (!validateBbox(bbox)) throw codedError('invalid bounds', 'INVALID_SOURCE_QUERY');
    const key = cleanText(apiKey, 512);
    if (!key) throw codedError('credentials required', 'CREDENTIALS_REQUIRED');
    let entry = cache.get(sourceId);
    let cacheState = 'hit';
    if (!entry || now() - entry.fetchedAt >= config.refreshMs) {
      cacheState = 'miss';
      let pending = inFlight.get(sourceId);
      if (!pending) {
        pending = fetchAll(sourceId, key).then((next) => {
          cache.set(sourceId, next);
          return next;
        }).finally(() => inFlight.delete(sourceId));
        inFlight.set(sourceId, pending);
      }
      try {
        entry = await pending;
      } catch (error) {
        if (error?.code === 'CREDENTIALS_REQUIRED' || !entry || now() - entry.fetchedAt > config.maxStaleMs) throw error;
        cacheState = 'stale';
      }
    }
    const limit = Math.max(1, Math.min(1_000, Math.floor(Number(maxFeatures) || 500)));
    const features = entry.features.filter((feature) => intersectsBbox(feature, bbox)).slice(0, limit);
    const observedAt = sourceId === 'vic-road-unplanned'
      ? features.map((feature) => feature.properties.updatedAt).filter(Boolean).sort().at(-1) || null
      : null;
    return {
      type: 'FeatureCollection', features,
      sourceStatus: {
        status: cacheState === 'stale' ? 'stale' : 'current', cache: cacheState,
        totalFound: entry.totalFound, indexedFeatures: entry.features.length,
        capped: entry.totalFound > entry.features.length || features.length === limit,
        fetchedAt: new Date(entry.fetchedAt).toISOString(), observedAt,
      },
    };
  }

  return Object.freeze({ load });
}
