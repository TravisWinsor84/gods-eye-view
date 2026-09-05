import { parse as parseCsv } from 'csv-parse/sync';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_MEDIA_TYPES = new Set(['application/json']);
const METADATA_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const BUCKET_DEGREES = 1;
const MAX_PUBLIC_TEXT = 180;

const TOILET_CAVEAT = 'Reference inventory only; accuracy, completeness and current availability are not guaranteed.';
const OPENING_HOURS_CAVEAT = 'Descriptive source text only; not proof this facility is currently open.';
const TRANSIT_CAVEAT = 'Reference stop inventory only; not realtime and not evidence that a service is currently running.';

const SOURCE_CONFIGS = Object.freeze({
  'au-public-toilets': Object.freeze({
    metadataUrl: 'https://data.gov.au/data/api/3/action/package_show?id=553b3049-2b8b-46a2-95e6-640d7986a8c1',
    packageId: '553b3049-2b8b-46a2-95e6-640d7986a8c1',
    metadataHost: 'data.gov.au',
    downloadHosts: new Set(['data.gov.au']),
    downloadPathPrefix: '/data/dataset/',
    resourceName: 'Toiletmap.csv',
    format: 'CSV',
    mediaType: 'text/csv',
    acceptedContentTypes: ['text/csv'],
    maxCompressedBytes: 16 * 1024 * 1024,
    maxBytes: 20 * 1024 * 1024,
    maxRows: 30_000,
    maxAgeMs: 6 * 60 * 60 * 1_000,
    metadataMaxAgeMs: 60 * 60 * 1_000,
    maxStaleMs: 72 * 60 * 60 * 1_000,
    accept: 'text/csv',
    parse: parseToilets,
  }),
  'vic-transport-stops': Object.freeze({
    metadataUrl: 'https://opendata.transport.vic.gov.au/api/3/action/package_show?id=public-transport-lines-and-stops',
    packageId: '6d36dfd9-8693-4552-8a03-05eb29a391fd',
    metadataHost: 'opendata.transport.vic.gov.au',
    downloadHosts: new Set(['opendata.transport.vic.gov.au']),
    downloadPathPrefix: '/dataset/',
    resourceName: 'Public Transport Stops',
    format: 'GeoJSON',
    mediaType: 'application/geo+json',
    acceptedContentTypes: ['application/geo+json'],
    maxCompressedBytes: 12 * 1024 * 1024,
    maxBytes: 16 * 1024 * 1024,
    maxRows: 40_000,
    maxAgeMs: 24 * 60 * 60 * 1_000,
    metadataMaxAgeMs: 60 * 60 * 1_000,
    maxStaleMs: 7 * 24 * 60 * 60 * 1_000,
    accept: 'application/geo+json',
    parse: parseTransportStops,
  }),
});

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanText(value, maxLength = MAX_PUBLIC_TEXT) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function strictBoolean(value) {
  if (value === true || value === 'True') return true;
  if (value === false || value === 'False') return false;
  return null;
}

function finiteCoordinate(value, min, max) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validBounds(bbox) {
  return bbox && Number.isFinite(bbox.west) && Number.isFinite(bbox.south)
    && Number.isFinite(bbox.east) && Number.isFinite(bbox.north)
    && bbox.west >= -180 && bbox.east <= 180 && bbox.south >= -90 && bbox.north <= 90
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

function mediaType(response) {
  return String(response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

function headerValue(response, name, maxLength = 1_024) {
  const value = response.headers?.get?.(name);
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

async function readStreamCapped(response, { maxBytes, maxCompressedBytes }) {
  const declaredHeader = response.headers?.get?.('content-length');
  const parsedDeclaredLength = typeof declaredHeader === 'string' && declaredHeader.trim()
    ? Number(declaredHeader)
    : Number.NaN;
  const declaredLength = Number.isFinite(parsedDeclaredLength) && parsedDeclaredLength >= 0
    ? parsedDeclaredLength
    : null;
  if (declaredLength !== null && declaredLength > maxCompressedBytes) {
    await cancelResponseBody(response);
    throw codedError('source limit exceeded', 'SOURCE_LIMIT');
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  const chunks = [];
  let decodedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
      decodedBytes += value.byteLength;
      if (decodedBytes > maxBytes) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* already aborted or errored */ }
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(decodedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    decodedBytes,
    compressedBytes: declaredLength,
  };
}

async function cancelResponseBody(response) {
  try { await response?.body?.cancel?.(); } catch { /* best-effort connection teardown */ }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonicalFeature(feature) {
  return JSON.stringify(stableValue({ geometry: feature.geometry, properties: feature.properties }));
}

function defaultIdHash(value) {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b]
    .map((seed) => {
      let hash = seed >>> 0;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    })
    .join('');
}

function assignPublicIds(sourceId, inputFeatures, idHash) {
  const byCanonical = new Map();
  let duplicateRows = 0;
  for (const feature of inputFeatures) {
    const longitude = finiteCoordinate(feature?.geometry?.coordinates?.[0], -180, 180);
    const latitude = finiteCoordinate(feature?.geometry?.coordinates?.[1], -90, 90);
    if (feature?.type !== 'Feature' || feature?.geometry?.type !== 'Point'
      || longitude === null || latitude === null || !feature.properties || typeof feature.properties !== 'object') {
      throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
    }
    const normalized = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: stableValue(feature.properties),
    };
    const canonical = canonicalFeature(normalized);
    if (byCanonical.has(canonical)) {
      duplicateRows += 1;
      continue;
    }
    byCanonical.set(canonical, normalized);
  }

  const rows = [...byCanonical.entries()]
    .map(([canonical, feature]) => ({ canonical, feature, digest: cleanText(String(idHash(canonical)), 80).replace(/[^a-zA-Z0-9_-]/g, '') }))
    .sort((left, right) => left.canonical.localeCompare(right.canonical));
  if (rows.some(({ digest }) => !digest)) throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  const digestCounts = new Map();
  for (const { digest } of rows) digestCounts.set(digest, (digestCounts.get(digest) || 0) + 1);
  const digestOrdinals = new Map();
  const features = rows.map(({ digest, feature }) => {
    const ordinal = (digestOrdinals.get(digest) || 0) + 1;
    digestOrdinals.set(digest, ordinal);
    const suffix = digestCounts.get(digest) > 1 ? `-${ordinal}` : '';
    return { ...feature, id: `${sourceId}-${digest}${suffix}` };
  });
  return { features, duplicateRows };
}

function bucketKey(longitude, latitude, bucketDegrees) {
  return `${Math.floor((longitude + 180) / bucketDegrees)}:${Math.floor((latitude + 90) / bucketDegrees)}`;
}

function buildBucketIndex(features, bucketDegrees) {
  const buckets = new Map();
  for (const feature of features) {
    const [longitude, latitude] = feature.geometry.coordinates;
    const key = bucketKey(longitude, latitude, bucketDegrees);
    const bucket = buckets.get(key) || [];
    bucket.push(feature);
    buckets.set(key, bucket);
  }
  return buckets;
}

function queryBuckets(dataset, bbox, maxFeatures) {
  const matches = [];
  const seen = new Set();
  const minX = Math.floor((bbox.west + 180) / dataset.bucketDegrees);
  const maxX = Math.floor((bbox.east + 180) / dataset.bucketDegrees);
  const minY = Math.floor((bbox.south + 90) / dataset.bucketDegrees);
  const maxY = Math.floor((bbox.north + 90) / dataset.bucketDegrees);
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (const feature of dataset.buckets.get(`${x}:${y}`) || []) {
        if (seen.has(feature.id)) continue;
        const [longitude, latitude] = feature.geometry.coordinates;
        if (longitude < bbox.west || longitude > bbox.east || latitude < bbox.south || latitude > bbox.north) continue;
        seen.add(feature.id);
        matches.push(feature);
      }
    }
  }
  matches.sort((left, right) => left.id.localeCompare(right.id));
  return { features: matches.slice(0, maxFeatures), truncated: matches.length > maxFeatures };
}

function parseToilets(bytes, { maxRows }) {
  let totalRows = 0;
  let rows;
  try {
    rows = parseCsv(bytes, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      max_record_size: 16_384,
      on_record(record) {
        totalRows += 1;
        if (totalRows > maxRows) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
        return record;
      },
    });
  } catch (error) {
    if (error?.code === 'SOURCE_LIMIT') throw error;
    throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  }
  const features = [];
  let invalidRows = 0;
  for (const row of rows) {
    const longitude = finiteCoordinate(row.Longitude, -180, 180);
    const latitude = finiteCoordinate(row.Latitude, -90, 90);
    const title = cleanText(row.Name);
    if (longitude === null || latitude === null || !title) {
      invalidRows += 1;
      continue;
    }
    const properties = {
      title,
      ...(cleanText(row.FacilityType) ? { facilityType: cleanText(row.FacilityType) } : {}),
    };
    const accessible = strictBoolean(row.Accessible);
    const ambulant = strictBoolean(row.Ambulant);
    if (accessible !== null || ambulant !== null) {
      properties.accessibility = {
        ...(accessible !== null ? { accessible } : {}),
        ...(ambulant !== null ? { ambulant } : {}),
      };
    }
    const paymentRequired = strictBoolean(row.PaymentRequired);
    if (paymentRequired !== null) properties.paymentRequired = paymentRequired;
    const openingHours = cleanText(row.OpeningHours, 240);
    if (openingHours) {
      properties.openingHours = openingHours;
      properties.openingHoursCaveat = OPENING_HOURS_CAVEAT;
    }
    properties.freshnessClass = 'reference';
    properties.caveat = TOILET_CAVEAT;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties });
  }
  return { features, totalRows, invalidRows };
}

function parseTransportStops(bytes, { maxRows }) {
  let payload;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  }
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
  }
  if (payload.features.length > maxRows) throw codedError('source limit exceeded', 'SOURCE_LIMIT');
  const features = [];
  let invalidRows = 0;
  for (const row of payload.features) {
    const longitude = finiteCoordinate(row?.geometry?.coordinates?.[0], -180, 180);
    const latitude = finiteCoordinate(row?.geometry?.coordinates?.[1], -90, 90);
    const title = cleanText(row?.properties?.STOP_NAME);
    const mode = cleanText(row?.properties?.MODE, 40).toUpperCase();
    if (row?.type !== 'Feature' || row?.geometry?.type !== 'Point'
      || !Array.isArray(row.geometry.coordinates) || row.geometry.coordinates.length < 2
      || longitude === null || latitude === null || !title || !mode) {
      invalidRows += 1;
      continue;
    }
    features.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: { title, mode, freshnessClass: 'reference', caveat: TRANSIT_CAVEAT },
    });
  }
  return { features, totalRows: payload.features.length, invalidRows };
}

function validateResource(config, metadata) {
  if (metadata?.success !== true || !metadata.result || metadata.result.id !== config.packageId
    || !Array.isArray(metadata.result.resources)) {
    throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
  }
  const candidates = metadata.result.resources.filter((resource) => resource?.name === config.resourceName);
  if (candidates.length !== 1) throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
  const resource = candidates[0];
  if (!UUID.test(String(resource.id || '')) || resource.format !== config.format || resource.mimetype !== config.mediaType) {
    throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
  }
  let url;
  try { url = new URL(resource.url); } catch { throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA'); }
  const expectedPrefix = `${config.downloadPathPrefix}${config.packageId}/resource/${resource.id}/download/`;
  const downloadName = url.pathname.startsWith(expectedPrefix) ? url.pathname.slice(expectedPrefix.length) : '';
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !config.downloadHosts.has(url.hostname) || url.search || url.hash
    || !downloadName || downloadName.includes('/')) {
    throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
  }
  const declaredSize = Number(resource.size);
  if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > config.maxCompressedBytes) {
    throw codedError('source limit exceeded', 'SOURCE_LIMIT');
  }
  const licence = cleanText(metadata.result.license_title, 160) || null;
  const notes = typeof metadata.result.notes === 'string' ? metadata.result.notes : '';
  const hasUpdateTerm = /\bupdat(?:e|es|ed|ing)\b|update your copy/i.test(notes);
  const hasNonTransferTerm = /non-transferable/i.test(notes);
  const hasNoSublicenceTerm = /may not (?:be )?sublicen[cs](?:e|ed)|no sublicen[cs]ing/i.test(notes);
  const termsConflict = !notes.trim() ? null
    : hasUpdateTerm && hasNonTransferTerm && hasNoSublicenceTerm
      ? `Structured catalogue licence says ${licence || 'unspecified'}, while package notes require prompt updates and describe the licence as non-transferable with no sublicensing; legal review is required before relying on redistribution rights.`
      : `Structured catalogue licence says ${licence || 'unspecified'}, while current package notes contain additional terms that have not matched the reviewed clauses; legal review is required before relying on redistribution rights.`;
  return Object.freeze({
    id: resource.id,
    url: url.href,
    mediaType: resource.mimetype,
    format: resource.format,
    declaredSize,
    metadataModified: cleanText(metadata.result.metadata_modified, 80) || null,
    resourceModified: cleanText(resource.last_modified, 80) || null,
    datasetLastUpdatedDate: cleanText(resource.dataset_last_updated_date, 80) || null,
    licence,
    ...(config === SOURCE_CONFIGS['au-public-toilets'] ? {
      legalReview: 'required',
      ...(termsConflict ? { termsConflict } : {}),
    } : {}),
  });
}

function sameResource(left, right) {
  return left && right && left.id === right.id && left.url === right.url;
}

/**
 * Build one provider-wide, version-aware point index. Browser bboxes are only
 * applied after the bounded source file has been parsed and indexed.
 */
export function createIndexedRegionalDownload({
  sourceId,
  resolveResource,
  parse,
  maxBytes,
  maxCompressedBytes = maxBytes,
  maxRows,
  maxAgeMs,
  metadataMaxAgeMs = maxAgeMs,
  maxStaleMs,
  acceptedContentTypes,
  accept = acceptedContentTypes?.join(', ') || 'application/octet-stream',
  fetchImpl = fetch,
  now = () => Date.now(),
  withRequestSlot = async (operation) => operation(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  bucketDegrees = BUCKET_DEGREES,
  idHash = defaultIdHash,
} = {}) {
  if (!sourceId || typeof resolveResource !== 'function' || typeof parse !== 'function'
    || !Number.isSafeInteger(maxBytes) || maxBytes <= 0
    || !Number.isSafeInteger(maxCompressedBytes) || maxCompressedBytes <= 0
    || !Number.isSafeInteger(maxRows) || maxRows <= 0
    || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
    || !Number.isFinite(metadataMaxAgeMs) || metadataMaxAgeMs < 0
    || !Number.isFinite(maxStaleMs) || maxStaleMs < maxAgeMs
    || !Array.isArray(acceptedContentTypes) || !acceptedContentTypes.length
    || !Number.isFinite(bucketDegrees) || bucketDegrees <= 0) {
    throw new TypeError('invalid indexed regional download configuration');
  }

  let metadata = null;
  let metadataCheckedAt = Number.NEGATIVE_INFINITY;
  let dataset = null;
  let pending = null;

  async function request(input, {
    acceptedTypes,
    byteLimit,
    compressedLimit = byteLimit,
    headers = {},
    allowNotModified = false,
  }) {
    return withRequestSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response;
        try {
          response = await fetchImpl(input, { method: 'GET', headers, signal: controller.signal, redirect: 'error' });
        } catch (error) {
          if (error?.name === 'AbortError' || controller.signal.aborted) throw codedError('source timed out', 'TIMEOUT');
          throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
        }
        if (allowNotModified && response?.status === 304) return { notModified: true, response };
        if (!response?.ok) {
          await cancelResponseBody(response);
          throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
        }
        if (!acceptedTypes.has(mediaType(response))) {
          await cancelResponseBody(response);
          throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
        }
        try {
          return { response, ...await readStreamCapped(response, { maxBytes: byteLimit, maxCompressedBytes: compressedLimit }) };
        } catch (error) {
          if (error?.name === 'AbortError' || controller.signal.aborted) {
            throw codedError('source timed out', 'TIMEOUT');
          }
          throw error;
        }
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async function requestJson(input) {
    let result;
    try {
      result = await request(input, {
        acceptedTypes: JSON_MEDIA_TYPES,
        byteLimit: METADATA_MAX_BYTES,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      });
    } catch (error) {
      if (error?.code === 'SOURCE_LIMIT') throw error;
      if (error?.code === 'INVALID_SOURCE_DATA') throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
      throw error;
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)); }
    catch { throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA'); }
  }

  async function refresh() {
    const checkedAt = now();
    const isFresh = (timestamp, ttl) => Number.isFinite(timestamp)
      && checkedAt >= timestamp && checkedAt - timestamp < ttl;
    let resource = metadata?.resource || null;
    if (!resource || !isFresh(metadataCheckedAt, metadataMaxAgeMs)) {
      try {
        resource = await resolveResource({ requestJson });
      } catch (error) {
        if (['SOURCE_LIMIT', 'INVALID_SOURCE_METADATA'].includes(error?.code)) throw error;
        throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
      }
      if (!resource || typeof resource.id !== 'string' || typeof resource.url !== 'string') {
        throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
      }
      metadata = { resource };
      metadataCheckedAt = checkedAt;
    }

    const resourceChanged = dataset && !sameResource(dataset.resource, resource);
    if (dataset && !resourceChanged && isFresh(dataset.validatedAt, maxAgeMs)) {
      dataset.resource = resource;
      return { dataset, cache: 'hit', downloadStatus: dataset.downloadStatus };
    }

    const headers = { Accept: accept };
    if (dataset && !resourceChanged && dataset.validators.url === resource.url) {
      if (dataset.validators.etag) headers['If-None-Match'] = dataset.validators.etag;
      if (dataset.validators.lastModified) headers['If-Modified-Since'] = dataset.validators.lastModified;
    }
    const downloaded = await request(resource.url, {
      acceptedTypes: new Set(acceptedContentTypes),
      byteLimit: maxBytes,
      compressedLimit: maxCompressedBytes,
      headers,
      allowNotModified: Boolean(dataset && !resourceChanged),
    });
    if (downloaded.notModified) {
      dataset.validatedAt = checkedAt;
      dataset.resource = resource;
      dataset.downloadStatus = 'not-modified';
      return { dataset, cache: 'revalidated', downloadStatus: 'not-modified' };
    }

    const parsed = await parse(downloaded.bytes, { maxRows, sourceId, resource });
    if (Number.isSafeInteger(parsed?.totalRows) && parsed.totalRows > maxRows) {
      throw codedError('source limit exceeded', 'SOURCE_LIMIT');
    }
    if (!parsed || !Array.isArray(parsed.features) || !Number.isSafeInteger(parsed.totalRows)
      || parsed.totalRows < 0
      || !Number.isSafeInteger(parsed.invalidRows) || parsed.invalidRows < 0
      || parsed.features.length + parsed.invalidRows > parsed.totalRows
      || (parsed.duplicateRows !== undefined
        && (!Number.isSafeInteger(parsed.duplicateRows) || parsed.duplicateRows < 0))) {
      throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
    }
    const assigned = assignPublicIds(sourceId, parsed.features, idHash);
    if (parsed.totalRows > 0 && assigned.features.length === 0) {
      throw codedError('invalid source data', 'INVALID_SOURCE_DATA');
    }
    dataset = {
      features: assigned.features,
      buckets: buildBucketIndex(assigned.features, bucketDegrees),
      bucketDegrees,
      totalRows: parsed.totalRows,
      invalidRows: parsed.invalidRows,
      duplicateRows: assigned.duplicateRows + (parsed.duplicateRows || 0),
      loadedAt: checkedAt,
      validatedAt: checkedAt,
      resource,
      validators: {
        url: resource.url,
        etag: headerValue(downloaded.response, 'etag'),
        lastModified: headerValue(downloaded.response, 'last-modified'),
      },
      decodedBytes: downloaded.decodedBytes,
      compressedBytes: downloaded.compressedBytes,
      downloadStatus: 'downloaded',
    };
    return { dataset, cache: 'miss', downloadStatus: 'downloaded' };
  }

  async function currentDataset() {
    if (!pending) pending = refresh().finally(() => { pending = null; });
    try { return await pending; }
    catch (error) {
      const failedAt = now();
      if (dataset && failedAt >= dataset.validatedAt && failedAt - dataset.validatedAt <= maxStaleMs) {
        return { dataset, cache: 'stale', downloadStatus: 'failed-revalidation', stale: true };
      }
      if (['SOURCE_LIMIT', 'INVALID_SOURCE_METADATA', 'INVALID_SOURCE_DATA', 'TIMEOUT'].includes(error?.code)) throw error;
      throw codedError('source temporarily unavailable', 'UPSTREAM_UNAVAILABLE');
    }
  }

  async function query(bbox, { maxFeatures = Number.MAX_SAFE_INTEGER } = {}) {
    if (!validBounds(bbox) || !Number.isSafeInteger(maxFeatures) || maxFeatures <= 0) {
      throw codedError('invalid source query', 'INVALID_SOURCE_QUERY');
    }
    const state = await currentDataset();
    const result = queryBuckets(state.dataset, bbox, maxFeatures);
    const isPartial = state.dataset.invalidRows > 0 || state.dataset.duplicateRows > 0 || result.truncated;
    const status = state.stale ? 'stale' : isPartial ? 'partial' : 'current';
    const resource = state.dataset.resource;
    return {
      type: 'FeatureCollection',
      features: result.features,
      sourceStatus: {
        status,
        cache: state.cache,
        downloadStatus: state.downloadStatus,
        sourceId,
        totalRows: state.dataset.totalRows,
        indexedFeatures: state.dataset.features.length,
        invalidRows: state.dataset.invalidRows,
        duplicateRows: state.dataset.duplicateRows,
        truncated: result.truncated,
        decodedBytes: state.dataset.decodedBytes,
        compressedBytes: state.dataset.compressedBytes,
        metadataModified: resource.metadataModified ?? null,
        resourceModified: resource.resourceModified ?? null,
        datasetLastUpdatedDate: resource.datasetLastUpdatedDate ?? null,
        licence: resource.licence ?? null,
        ...(resource.legalReview ? { legalReview: resource.legalReview } : {}),
        ...(resource.termsConflict ? { termsConflict: resource.termsConflict } : {}),
      },
    };
  }

  return Object.freeze({ query });
}

/** Create the two fixed official CKAN-backed regional download clients. */
export function createIndexedRegionalDownloads({ fetchImpl = fetch, now = () => Date.now(), withRequestSlot, timeoutMs, idHash } = {}) {
  const clients = new Map();
  for (const [sourceId, config] of Object.entries(SOURCE_CONFIGS)) {
    clients.set(sourceId, createIndexedRegionalDownload({
      sourceId,
      fetchImpl,
      now,
      withRequestSlot,
      timeoutMs,
      idHash,
      parse: config.parse,
      maxBytes: config.maxBytes,
      maxCompressedBytes: config.maxCompressedBytes,
      maxRows: config.maxRows,
      maxAgeMs: config.maxAgeMs,
      metadataMaxAgeMs: config.metadataMaxAgeMs,
      maxStaleMs: config.maxStaleMs,
      acceptedContentTypes: config.acceptedContentTypes,
      accept: config.accept,
      resolveResource: async ({ requestJson }) => {
        const metadataUrl = new URL(config.metadataUrl);
        if (metadataUrl.protocol !== 'https:' || metadataUrl.hostname !== config.metadataHost) {
          throw codedError('invalid source metadata', 'INVALID_SOURCE_METADATA');
        }
        return validateResource(config, await requestJson(metadataUrl));
      },
    }));
  }
  return Object.freeze({
    load(sourceId, { bbox, maxFeatures }) {
      const client = clients.get(sourceId);
      if (!client) throw codedError('unknown indexed regional source', 'INVALID_SOURCE_QUERY');
      return client.query(bbox, { maxFeatures });
    },
  });
}

export const INDEXED_REGIONAL_DOWNLOAD_SOURCE_IDS = Object.freeze(Object.keys(SOURCE_CONFIGS));
