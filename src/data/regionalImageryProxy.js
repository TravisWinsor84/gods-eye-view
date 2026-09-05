import { REGIONAL_IMAGERY_SOURCES, buildRegionalImageryUrl } from './regionalImagery.js';

const ALLOWED_QUERY_KEYS = new Set(['west', 'south', 'east', 'north', 'width', 'height']);
const MAX_BOUNDS_SPAN = 10;
const MIN_IMAGE_DIMENSION = 64;
const MAX_IMAGE_DIMENSION = 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 300_000;
const DEFAULT_CACHE_MAX_ENTRIES = 64;
const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

function finiteCoordinate(value, min, max) {
  if (typeof value !== 'string' || !value.trim() || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function imageDimension(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= MIN_IMAGE_DIMENSION && number <= MAX_IMAGE_DIMENSION
    ? number
    : null;
}

function parseRequest(searchParams) {
  for (const key of searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) return null;
  }
  if ([...ALLOWED_QUERY_KEYS].some((key) => searchParams.getAll(key).length !== 1)) return null;

  const west = finiteCoordinate(searchParams.get('west'), -180, 180);
  const south = finiteCoordinate(searchParams.get('south'), -90, 90);
  const east = finiteCoordinate(searchParams.get('east'), -180, 180);
  const north = finiteCoordinate(searchParams.get('north'), -90, 90);
  const width = imageDimension(searchParams.get('width'));
  const height = imageDimension(searchParams.get('height'));
  if ([west, south, east, north, width, height].some((value) => value === null)) return null;
  if (west >= east || south >= north || east - west > MAX_BOUNDS_SPAN || north - south > MAX_BOUNDS_SPAN) return null;
  return { west, south, east, north, width, height };
}

function requestSourceId(pathname) {
  return pathname.match(/^\/(?:api\/regional-imagery\/)?([a-z0-9-]+)$/)?.[1] || null;
}

function sendJson(res, status, error, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify({ error }));
}

function isPng(bytes) {
  return bytes.byteLength >= PNG_SIGNATURE.byteLength
    && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

async function readPngCapped(response) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch { /* best effort */ }
    throw new Error('oversized imagery response');
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('unstreamable imagery response');

  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('oversized imagery response');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  for (const chunk of chunks) {
    Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).copy(bytes, offset);
    offset += chunk.byteLength;
  }
  if (!isPng(bytes)) throw new Error('invalid PNG response');
  return bytes;
}

/** Create the fixed-ID, fixed-provider regional imagery middleware. */
export function createRegionalImageryProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  cacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES,
} = {}) {
  const cache = new Map();

  function sendImage(res, sourceId, body, cacheStatus) {
    const source = REGIONAL_IMAGERY_SOURCES[sourceId];
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(body.byteLength),
      'Cache-Control': `public, max-age=${Math.floor(cacheTtlMs / 1000)}`,
      'X-Content-Type-Options': 'nosniff',
      'X-Regional-Imagery-Source': sourceId,
      'X-Regional-Imagery-Attribution': source.attribution,
      'X-Regional-Imagery-Cache': cacheStatus,
    });
    res.end(body);
  }

  return async function regionalImageryProxy(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, 'method not allowed', { Allow: 'GET' });
      return;
    }

    const url = new URL(req.url || '', 'http://localhost');
    const sourceId = requestSourceId(url.pathname);
    if (!sourceId || !REGIONAL_IMAGERY_SOURCES[sourceId]) {
      sendJson(res, 404, 'regional imagery source not found');
      return;
    }
    const request = parseRequest(url.searchParams);
    if (!request) {
      sendJson(res, 400, 'invalid regional imagery request');
      return;
    }

    const upstreamUrl = buildRegionalImageryUrl(sourceId, request);
    const key = upstreamUrl.toString();
    const cached = cache.get(key);
    if (cached && now() - cached.cachedAt <= cacheTtlMs) {
      cache.delete(key);
      cache.set(key, cached);
      sendImage(res, sourceId, cached.body, 'HIT');
      return;
    }
    if (cached) cache.delete(key);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('regional imagery timeout', 'TimeoutError'));
    }, timeoutMs);
    try {
      const upstream = await fetchImpl(upstreamUrl, {
        method: 'GET',
        headers: { Accept: 'image/png' },
        redirect: 'error',
        signal: controller.signal,
      });
      const contentType = upstream?.headers?.get?.('content-type') || '';
      if (!upstream?.ok || upstream.redirected || !/^image\/png(?:\s*;|$)/i.test(contentType)) {
        throw new Error('invalid imagery response');
      }
      const body = await readPngCapped(upstream);
      cache.set(key, { body, cachedAt: now() });
      while (cache.size > Math.max(1, cacheMaxEntries)) {
        cache.delete(cache.keys().next().value);
      }
      sendImage(res, sourceId, body, 'MISS');
    } catch {
      if (timedOut) sendJson(res, 504, 'regional imagery timed out');
      else sendJson(res, 502, 'regional imagery is temporarily unavailable');
    } finally {
      clearTimeout(timer);
    }
  };
}
