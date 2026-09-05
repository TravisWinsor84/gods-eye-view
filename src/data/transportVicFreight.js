const METADATA_URL = 'https://opendata.transport.vic.gov.au/api/3/action/package_show?id=088b0dcd-935d-42f8-9b60-8d24eaabe92c';
const PACKAGE_ID = '088b0dcd-935d-42f8-9b60-8d24eaabe92c';
const CACHE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const METADATA_MAX_BYTES = 2 * 1024 * 1024;
const RESOURCE_MAX_BYTES = 6 * 1024 * 1024;
const RESOURCES = Object.freeze([
  Object.freeze({ name: 'Principal Freight Network - Road Network', kind: 'Road' }),
  Object.freeze({ name: 'Principal Freight Network - Rail Network', kind: 'Rail' }),
]);

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function readJsonCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
  const reader = response.body?.getReader?.();
  if (!reader) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw codedError('invalid source data', 'INVALID_SOURCE_DATA'); }
}

function resourceUrl(resource) {
  let url;
  try { url = new URL(resource?.url); } catch { throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA'); }
  const prefix = `/dataset/${PACKAGE_ID}/resource/${resource.id}/download/`;
  if (url.protocol !== 'https:' || url.hostname !== 'opendata.transport.vic.gov.au'
    || !url.pathname.startsWith(prefix) || url.pathname.slice(prefix.length).includes('/') || url.search || url.hash
    || resource.format !== 'GeoJSON' || resource.mimetype !== 'application/geo+json') {
    throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
  }
  const size = Number(resource.size);
  if (!Number.isFinite(size) || size < 0 || size > RESOURCE_MAX_BYTES) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
  return url;
}

function geometryBounds(geometry) {
  if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) return null;
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  const stack = [geometry.coordinates];
  let count = 0;
  while (stack.length) {
    const value = stack.pop();
    if (!Array.isArray(value)) return null;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [longitude, latitude] = value;
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
        || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return null;
      bounds.west = Math.min(bounds.west, longitude);
      bounds.east = Math.max(bounds.east, longitude);
      bounds.south = Math.min(bounds.south, latitude);
      bounds.north = Math.max(bounds.north, latitude);
      count += 1;
      if (count > 100_000) return null;
    } else stack.push(...value);
  }
  return count ? bounds : null;
}

function intersects(left, right) {
  return left.west <= right.east && left.east >= right.west && left.south <= right.north && left.north >= right.south;
}

/** Cache and query the official Principal Freight Network line releases. */
export function createTransportVicFreight({
  fetchImpl = fetch,
  now = () => Date.now(),
  withRequestSlot = async (operation) => operation(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let dataset = null;
  let loadedAt = Number.NEGATIVE_INFINITY;
  let pending = null;

  async function requestJson(url, maxBytes) {
    return withRequestSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json, application/geo+json' }, signal: controller.signal, redirect: 'error' });
        } catch (error) {
          if (controller.signal.aborted || error?.name === 'AbortError') throw codedError('source timed out', 'TIMEOUT');
          throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
        }
        if (!response?.ok) throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
        const type = String(response.headers?.get?.('content-type') || '').split(';', 1)[0].trim();
        if (!['application/json', 'application/geo+json'].includes(type)) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
        return readJsonCapped(response, maxBytes);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async function refresh() {
    if (dataset && now() - loadedAt < CACHE_MS) return dataset;
    const metadata = await requestJson(METADATA_URL, METADATA_MAX_BYTES);
    if (metadata?.success !== true || metadata?.result?.id !== PACKAGE_ID || !Array.isArray(metadata.result.resources)) {
      throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
    }
    const selected = RESOURCES.map((wanted) => {
      const matches = metadata.result.resources.filter((resource) => resource?.name === wanted.name);
      if (matches.length !== 1) throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
      return { ...wanted, url: resourceUrl(matches[0]) };
    });
    const payloads = await Promise.all(selected.map(async (resource) => ({
      resource,
      payload: await requestJson(resource.url, RESOURCE_MAX_BYTES),
    })));
    const features = [];
    for (const { resource, payload } of payloads) {
      if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features) || payload.features.length > 2_000) {
        throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
      }
      for (const row of payload.features) {
        const bounds = geometryBounds(row?.geometry);
        if (!bounds) continue;
        const properties = row?.properties || {};
        const title = resource.kind === 'Road'
          ? properties.NAME_LABEL || properties.NAME_FULL
          : properties.LINE_NAME || properties.SECTION_NAME;
        features.push({
          type: 'Feature', geometry: row.geometry, bounds,
          properties: { title: String(title || `${resource.kind} freight corridor`), type: resource.kind, status: String(properties.STATUS || '') },
        });
      }
    }
    dataset = features;
    loadedAt = now();
    return dataset;
  }

  async function load({ bbox, maxFeatures = 1_000 } = {}) {
    if (!bbox || ![bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
      || bbox.west >= bbox.east || bbox.south >= bbox.north
      || !Number.isSafeInteger(maxFeatures) || maxFeatures <= 0 || maxFeatures > 1_000) {
      throw codedError('invalid source query', 'INVALID_SOURCE_QUERY');
    }
    if (!pending) pending = refresh().finally(() => { pending = null; });
    const features = (await pending).filter((row) => intersects(row.bounds, bbox)).slice(0, maxFeatures)
      .map(({ type, geometry, properties }) => ({ type, geometry, properties }));
    return { type: 'FeatureCollection', features };
  }

  return Object.freeze({ load });
}
