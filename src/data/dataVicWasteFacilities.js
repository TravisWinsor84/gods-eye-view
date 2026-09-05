const DATASTORE_ENDPOINT = 'https://discover.data.vic.gov.au/api/3/action/datastore_search';
const METADATA_ENDPOINT = 'https://discover.data.vic.gov.au/api/3/action/package_show?id=victoria-s-waste-and-resource-recovery-infrastructure-map-data';
const PACKAGE_ID = '729d86ce-aae3-4f67-992c-3a7f8fa3823a';
const PACKAGE_NAME = 'victoria-s-waste-and-resource-recovery-infrastructure-map-data';
const RESOURCE_ID = 'e44f5d96-51e8-48ec-b674-299d100a0231';
const PUBLIC_FIELDS = Object.freeze([
  'Facility Name',
  'Facility Type',
  'Infrastructure Type',
  'Suburb',
  'LGA',
  'Latitude',
  'Longitude',
]);
const MAX_PAGE_ROWS = 500;
const MAX_DATASET_ROWS = 1_000;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PUBLIC_TEXT = 180;
const DEFAULT_TIMEOUT_MS = 20_000;
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000;
const SNAPSHOT_CAVEAT = 'October 2025 reference snapshot; inclusion does not imply the facility is currently operating.';

function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PUBLIC_TEXT)
    : '';
}

function coordinate(value, min, max) {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validBounds(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west >= -180 && bbox.east <= 180 && bbox.south >= -90 && bbox.north <= 90
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

function isoDate(value) {
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value}Z`
    : value;
  const timestamp = typeof normalized === 'string' ? Date.parse(normalized) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '';
}

function publicDigest(value) {
  return [0x811c9dc5, 0x9e3779b9, 0x85ebca6b].map((seed) => {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }).join('');
}

async function readJsonCapped(response) {
  if (!response?.ok) throw new Error('DataVic waste source unavailable');
  const mediaType = String(response.headers?.get?.('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new Error('invalid DataVic waste response');
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new Error('DataVic waste response exceeded limit');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_JSON_BYTES) throw new Error('DataVic waste response exceeded limit');
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('invalid DataVic waste response');
  }
}

/** Build one fixed, public-field-only CKAN DataStore page request. */
export function dataVicWasteRequest({ offset, limit }) {
  if (!Number.isSafeInteger(offset) || offset < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_ROWS) {
    throw new Error('invalid DataVic waste page');
  }
  const url = new URL(DATASTORE_ENDPOINT);
  url.search = new URLSearchParams({
    resource_id: RESOURCE_ID,
    offset: String(offset),
    limit: String(limit),
    fields: PUBLIC_FIELDS.join(','),
  }).toString();
  return url;
}

/** Normalize one fixed-field DataStore page without retaining provider IDs. */
export function normalizeDataVicWastePayload(payload, { maxFeatures }) {
  if (!Number.isSafeInteger(maxFeatures) || maxFeatures < 1 || maxFeatures > 1_000
    || payload?.success !== true || !Number.isSafeInteger(payload?.result?.total)
    || payload.result.total < 0 || !Array.isArray(payload.result.records)
    || payload.result.records.length > maxFeatures) {
    throw new Error('invalid DataVic waste payload');
  }
  const features = [];
  let invalidRows = 0;
  for (const row of payload.result.records) {
    const title = cleanText(row?.['Facility Name']);
    const longitude = coordinate(row?.Longitude, -180, 180);
    const latitude = coordinate(row?.Latitude, -90, 90);
    if (!title || longitude === null || latitude === null) {
      invalidRows += 1;
      continue;
    }
    const properties = {
      sourceId: 'vic-waste-facilities',
      title,
      facilityType: cleanText(row['Facility Type']),
      infrastructureType: cleanText(row['Infrastructure Type']),
      suburb: cleanText(row.Suburb),
      lga: cleanText(row.LGA),
      referenceOnly: true,
      caveat: SNAPSHOT_CAVEAT,
    };
    for (const key of ['facilityType', 'infrastructureType', 'suburb', 'lga']) {
      if (!properties[key]) delete properties[key];
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties,
    });
  }
  return { features, total: payload.result.total, invalidRows };
}

function validateMetadata(payload) {
  const result = payload?.success === true ? payload.result : null;
  const resource = result?.resources?.find?.((candidate) => candidate?.id === RESOURCE_ID);
  if (result?.id !== PACKAGE_ID || result?.name !== PACKAGE_NAME
    || result?.license_title !== 'Creative Commons Attribution 4.0 International'
    || resource?.name !== 'October 2025' || resource?.format !== 'CSV'
    || resource?.datastore_active !== true) {
    throw new Error('invalid DataVic waste metadata');
  }
  const metadataModifiedAt = isoDate(result.metadata_modified);
  if (!metadataModifiedAt) throw new Error('invalid DataVic waste metadata');
  return { snapshot: resource.name, metadataModifiedAt };
}

function queryDataset(dataset, bbox, maxFeatures) {
  const matches = dataset.features.filter(({ geometry }) => {
    const [longitude, latitude] = geometry.coordinates;
    return longitude >= bbox.west && longitude <= bbox.east
      && latitude >= bbox.south && latitude <= bbox.north;
  });
  return { features: matches.slice(0, maxFeatures), capped: matches.length > maxFeatures };
}

/** Load and cache the fixed October 2025 DataStore snapshot, then query by viewport. */
export function createDataVicWasteFacilities({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  withRequestSlot = (operation) => operation(),
} = {}) {
  let cached = null;

  async function requestJson(url) {
    return withRequestSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await readJsonCapped(await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
          redirect: 'error',
        }));
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async function refresh() {
    const metadata = validateMetadata(await requestJson(METADATA_ENDPOINT));
    const rows = [];
    let total = null;
    for (let offset = 0; total === null || offset < total; offset += MAX_PAGE_ROWS) {
      const payload = await requestJson(dataVicWasteRequest({ offset, limit: MAX_PAGE_ROWS }));
      const page = normalizeDataVicWastePayload(payload, { maxFeatures: MAX_PAGE_ROWS });
      if (total === null) {
        total = page.total;
        if (total > MAX_DATASET_ROWS) throw new Error('DataVic waste dataset exceeded limit');
      } else if (page.total !== total) {
        throw new Error('invalid DataVic waste payload');
      }
      rows.push(...page.features);
      if (payload.result.records.length === 0 && rows.length < total) throw new Error('invalid DataVic waste payload');
    }
    if (rows.length > total) throw new Error('invalid DataVic waste payload');
    const unique = new Map();
    let duplicateRows = 0;
    for (const feature of rows) {
      const canonical = JSON.stringify(feature);
      if (unique.has(canonical)) {
        duplicateRows += 1;
        continue;
      }
      unique.set(canonical, {
        ...feature,
        id: `vic-waste-facilities-${publicDigest(canonical)}`,
      });
    }
    const features = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
    cached = {
      ...metadata,
      features,
      totalRows: total,
      invalidRows: total - rows.length,
      duplicateRows,
      cachedAt: now(),
    };
    return cached;
  }

  return Object.freeze({
    async load({ bbox, maxFeatures }) {
      if (!validBounds(bbox) || !Number.isSafeInteger(maxFeatures) || maxFeatures < 1 || maxFeatures > 1_000) {
        throw new Error('invalid DataVic waste query');
      }
      const cache = cached && now() >= cached.cachedAt && now() - cached.cachedAt < CACHE_MAX_AGE_MS
        ? 'hit'
        : 'miss';
      const dataset = cache === 'hit' ? cached : await refresh();
      const result = queryDataset(dataset, bbox, maxFeatures);
      return {
        type: 'FeatureCollection',
        features: result.features,
        sourceStatus: {
          status: result.capped || dataset.invalidRows || dataset.duplicateRows ? 'partial' : 'current',
          capped: result.capped,
          totalRows: dataset.totalRows,
          indexedRows: dataset.features.length,
          invalidRows: dataset.invalidRows,
          duplicateRows: dataset.duplicateRows,
          snapshot: dataset.snapshot,
          metadataModifiedAt: dataset.metadataModifiedAt,
          cache,
        },
      };
    },
  });
}
