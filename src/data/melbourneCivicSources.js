const ODS_BASE = 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets';
const DEFAULT_PAGE_ROWS = 100;
const DEFAULT_PAGE_BYTES = 1_000_000;
const DEFAULT_TOTAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_SPATIAL_REQUESTS = 12;
const PARKING_CACHE_MS = 120_000;
const PARKING_STALE_MS = 5 * 60_000;
const PARKING_LAST_GOOD_MS = 10 * 60_000;
const MEMORIAL_EXPORT_CACHE_MS = 6 * 60 * 60_000;
const MEMORIAL_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
const MEMORIAL_EXPORT_MAX_ROWS = 2_000;

export const CITY_OF_MELBOURNE_CREDIT = 'City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.';

const SPATIAL_DATASETS = Object.freeze({
  'melbourne-drinking-fountains': Object.freeze([Object.freeze({
    dataset: 'drinking-fountains',
    geometryField: 'geo_point_2d',
    select: 'assetid,type,evaluationdate,geo_point_2d',
    orderBy: 'assetid',
    rowKey: 'assetid',
  })]),
  'melbourne-barbecues': Object.freeze([Object.freeze({
    dataset: 'public-barbecues',
    geometryField: 'geo_point_2d',
    select: 'assetid,type,evaluationdate,geo_point_2d',
    orderBy: 'assetid',
    rowKey: 'assetid',
  })]),
  'melbourne-development': Object.freeze([Object.freeze({
    dataset: 'development-activity-monitor',
    geometryField: 'geopoint',
    select: 'development_key,status,year_completed,clue_small_area,floors_above,resi_dwellings,hotel_rooms,geopoint',
    orderBy: 'development_key',
    rowKey: 'development_key',
  })]),
  'melbourne-culture': Object.freeze([
    Object.freeze({
      dataset: 'outdoor-artworks',
      geometryField: 'geo_point_2d',
      select: 'asset_id,title,object_type,classification,art_date,geo_point_2d',
      orderBy: 'asset_id',
      rowKey: 'asset_id',
    }),
    Object.freeze({
      dataset: 'public-memorials-and-sculptures',
      geometryField: 'co_ordinates',
      select: 'title,co_ordinates',
      orderBy: '',
      transport: 'export',
      maxBytes: MEMORIAL_EXPORT_MAX_BYTES,
      maxRows: MEMORIAL_EXPORT_MAX_ROWS,
    }),
  ]),
});

const PARKING_TABLES = Object.freeze({
  sensors: Object.freeze({
    dataset: 'on-street-parking-bay-sensors',
    select: 'lastupdated,status_timestamp,zone_number,status_description,kerbsideid,location',
    maxRows: 8_000,
    maxBytes: 4 * 1024 * 1024,
  }),
  bays: Object.freeze({
    dataset: 'on-street-parking-bays',
    select: 'kerbsideid,latitude,longitude,lastupdated,location',
    where: 'kerbsideid is not null',
    maxRows: 32_000,
    maxBytes: 4 * 1024 * 1024,
  }),
});

function cleanText(value, maxLength = 180) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function finiteCoordinate(value, min, max) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function pointFrom(value) {
  const longitude = finiteCoordinate(value?.lon, -180, 180);
  const latitude = finiteCoordinate(value?.lat, -90, 90);
  return longitude === null || latitude === null ? null : [longitude, latitude];
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function boundedDigest(value) {
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

function canonicalValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sourceRowIdentity(sourceId, dataset, row, coordinates) {
  const config = SPATIAL_DATASETS[sourceId]?.find((candidate) => candidate.dataset === dataset);
  const opaqueKey = config?.rowKey ? cleanText(String(row?.[config.rowKey] ?? ''), 180) : '';
  if (opaqueKey) return `${dataset}|key|${opaqueKey}`;
  return `${dataset}|fallback|${canonicalValue(row)}|${coordinates.join(',')}`;
}

function featureId(sourceId, dataset, row, coordinates) {
  const internalIdentity = sourceRowIdentity(sourceId, dataset, row, coordinates);
  return `${sourceId}-${boundedDigest(`${sourceId}|${internalIdentity}`)}`;
}

function feature(sourceId, dataset, row, coordinates, properties) {
  return {
    type: 'Feature',
    id: featureId(sourceId, dataset, row, coordinates),
    geometry: { type: 'Point', coordinates },
    properties,
  };
}

function inBounds(coordinates, bbox) {
  return coordinates[0] >= bbox.west && coordinates[0] <= bbox.east
    && coordinates[1] >= bbox.south && coordinates[1] <= bbox.north;
}

function buildSpatialRowIndex(sourceId, dataset, rows) {
  const cells = new Map();
  const indexed = [];
  const seen = new Set();
  let duplicates = 0;
  for (const row of rows) {
    const normalized = normalizeMelbourneCivicRecord(sourceId, row, { dataset });
    if (!normalized) continue;
    const entry = {
      row,
      coordinates: normalized.geometry.coordinates,
      identity: sourceRowIdentity(sourceId, dataset, row, normalized.geometry.coordinates),
    };
    if (seen.has(entry.identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(entry.identity);
    indexed.push(entry);
  }
  indexed.sort((left, right) => left.identity.localeCompare(right.identity));
  for (const entry of indexed) {
    const key = parkingCell(entry.coordinates);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
  }
  return { cells, duplicates };
}

function querySpatialRowIndex(index, bbox) {
  const rows = [];
  const westCell = Math.floor(bbox.west / PARKING_INDEX_CELL_DEGREES);
  const eastCell = Math.floor(bbox.east / PARKING_INDEX_CELL_DEGREES);
  const southCell = Math.floor(bbox.south / PARKING_INDEX_CELL_DEGREES);
  const northCell = Math.floor(bbox.north / PARKING_INDEX_CELL_DEGREES);
  for (let x = westCell; x <= eastCell; x += 1) {
    for (let y = southCell; y <= northCell; y += 1) {
      for (const entry of index.cells.get(`${x},${y}`) || []) {
        if (inBounds(entry.coordinates, bbox)) rows.push(entry);
      }
    }
  }
  return rows.sort((left, right) => left.identity.localeCompare(right.identity)).map(({ row }) => row);
}

function pageUrl(dataset, { select, where = '', offset = 0, limit = DEFAULT_PAGE_ROWS, orderBy = '' } = {}) {
  const url = new URL(`${ODS_BASE}/${dataset}/records`);
  if (select) url.searchParams.set('select', select);
  if (where) url.searchParams.set('where', where);
  if (orderBy) url.searchParams.set('order_by', orderBy);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  return url;
}

function exportUrl(dataset, { select, where = '', orderBy = '' } = {}) {
  const url = new URL(`${ODS_BASE}/${dataset}/exports/json`);
  if (select) url.searchParams.set('select', select);
  if (where) url.searchParams.set('where', where);
  if (orderBy) url.searchParams.set('order_by', orderBy);
  return url;
}

export function melbourneCivicSpatialRequests(sourceId, bbox, maxFeatures) {
  const configs = SPATIAL_DATASETS[sourceId];
  if (!configs) {
    if (sourceId === 'melbourne-parking-live') throw new Error('Melbourne parking uses provider-wide table requests');
    throw new Error(`Unknown Melbourne civic source: ${sourceId}`);
  }
  const limit = Math.min(DEFAULT_PAGE_ROWS, Math.max(1, Number(maxFeatures) || DEFAULT_PAGE_ROWS));
  return configs.map((config) => ({
    ...config,
    url: config.transport === 'export'
      ? exportUrl(config.dataset, { select: config.select })
      : pageUrl(config.dataset, {
        select: config.select,
        where: `in_bbox(${config.geometryField}, ${bbox.south}, ${bbox.west}, ${bbox.north}, ${bbox.east})`,
        limit,
        orderBy: config.orderBy,
      }),
  }));
}

function parkingCoordinates(row) {
  return pointFrom(row?.location)
    || (() => {
      const longitude = finiteCoordinate(row?.longitude, -180, 180);
      const latitude = finiteCoordinate(row?.latitude, -90, 90);
      return longitude === null || latitude === null ? null : [longitude, latitude];
    })();
}

export function normalizeMelbourneParking(sensor, bay, { nowMs = Date.now() } = {}) {
  const coordinates = parkingCoordinates(bay);
  if (!coordinates || sensor?.kerbsideid === null || sensor?.kerbsideid === undefined
    || String(sensor.kerbsideid) !== String(bay?.kerbsideid)) return null;
  const statusDescription = cleanText(sensor.status_description, 40);
  const status = statusDescription === 'Unoccupied' ? 'vacant'
    : statusDescription === 'Present' ? 'occupied' : 'unknown';
  const observedAt = cleanText(sensor.status_timestamp, 80);
  const observedMs = Date.parse(observedAt);
  const stale = !Number.isFinite(observedMs) || nowMs - observedMs > PARKING_STALE_MS || observedMs > nowMs + 60_000;
  const properties = {
    title: 'On-street parking sensor',
    status,
    observedAt,
    sensorUpdatedAt: cleanText(sensor.lastupdated, 80),
    bayUpdatedAt: cleanText(bay.lastupdated, 80),
    stale,
    freshnessClass: 'sensor-observation',
    caveat: 'Present or Unoccupied is a sensor observation only, not a guarantee that a bay is available or legal to use; check current street signs and conditions.',
  };
  return {
    type: 'Feature',
    id: `melbourne-parking-${stableHash(`${String(sensor.kerbsideid)}|${coordinates.join(',')}`)}`,
    geometry: { type: 'Point', coordinates },
    properties,
  };
}

const PARKING_INDEX_CELL_DEGREES = 0.05;

function parkingCell(coordinates) {
  return `${Math.floor(coordinates[0] / PARKING_INDEX_CELL_DEGREES)},${Math.floor(coordinates[1] / PARKING_INDEX_CELL_DEGREES)}`;
}

export function buildMelbourneParkingIndex(sensors, bays) {
  const baysByKerbside = new Map();
  for (const bayRow of bays) {
    if (bayRow?.kerbsideid === null || bayRow?.kerbsideid === undefined) continue;
    const key = String(bayRow.kerbsideid);
    if (!baysByKerbside.has(key)) baysByKerbside.set(key, []);
    baysByKerbside.get(key).push(bayRow);
  }
  const cells = new Map();
  let joinedRows = 0;
  let omittedWithoutGeometry = 0;
  for (const sensorRow of sensors) {
    const candidates = baysByKerbside.get(String(sensorRow?.kerbsideid)) || [];
    const sensorCoordinates = pointFrom(sensorRow?.location);
    const ranked = candidates.filter((candidate) => parkingCoordinates(candidate)).sort((left, right) => {
      const leftCoordinates = parkingCoordinates(left);
      const rightCoordinates = parkingCoordinates(right);
      if (sensorCoordinates) {
        const leftDistance = (leftCoordinates[0] - sensorCoordinates[0]) ** 2 + (leftCoordinates[1] - sensorCoordinates[1]) ** 2;
        const rightDistance = (rightCoordinates[0] - sensorCoordinates[0]) ** 2 + (rightCoordinates[1] - sensorCoordinates[1]) ** 2;
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      }
      const leftUpdated = Date.parse(left?.lastupdated);
      const rightUpdated = Date.parse(right?.lastupdated);
      const recency = (Number.isFinite(rightUpdated) ? rightUpdated : -Infinity) - (Number.isFinite(leftUpdated) ? leftUpdated : -Infinity);
      if (recency !== 0) return recency;
      const leftTie = `${leftCoordinates.join(',')}|${cleanText(left?.roadsegmentdescription, 180)}`;
      const rightTie = `${rightCoordinates.join(',')}|${cleanText(right?.roadsegmentdescription, 180)}`;
      return leftTie.localeCompare(rightTie);
    });
    const bayRow = ranked[0];
    const coordinates = parkingCoordinates(bayRow);
    if (!bayRow || !coordinates) {
      omittedWithoutGeometry += 1;
      continue;
    }
    const entry = { sensor: sensorRow, bay: bayRow, coordinates };
    const key = parkingCell(coordinates);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
    joinedRows += 1;
  }
  return Object.freeze({ cells, joinedRows, omittedWithoutGeometry });
}

export function queryMelbourneParkingIndex(index, bbox, { nowMs = Date.now(), maxFeatures = 1_000 } = {}) {
  const features = [];
  const seen = new Set();
  const westCell = Math.floor(bbox.west / PARKING_INDEX_CELL_DEGREES);
  const eastCell = Math.floor(bbox.east / PARKING_INDEX_CELL_DEGREES);
  const southCell = Math.floor(bbox.south / PARKING_INDEX_CELL_DEGREES);
  const northCell = Math.floor(bbox.north / PARKING_INDEX_CELL_DEGREES);
  const requestedCellCount = (eastCell - westCell + 1) * (northCell - southCell + 1);
  const candidateCells = [];
  if (requestedCellCount > index.cells.size * 4) {
    candidateCells.push(...index.cells.values());
  } else {
    for (let x = westCell; x <= eastCell; x += 1) {
      for (let y = southCell; y <= northCell; y += 1) {
        const entries = index.cells.get(`${x},${y}`);
        if (entries) candidateCells.push(entries);
      }
    }
  }
  let capped = false;
  outer: for (const entries of candidateCells) {
    for (const entry of entries) {
      if (!inBounds(entry.coordinates, bbox)) continue;
      const normalized = normalizeMelbourneParking(entry.sensor, entry.bay, { nowMs });
      if (!normalized || seen.has(normalized.id)) continue;
      seen.add(normalized.id);
      if (features.length >= maxFeatures) {
        capped = true;
        break outer;
      }
      features.push(normalized);
    }
  }
  return { type: 'FeatureCollection', features, capped };
}

function assetRecord(sourceId, row, dataset) {
  const coordinates = pointFrom(row?.geo_point_2d);
  if (!coordinates) return null;
  const type = cleanText(row?.type, 80) || (sourceId === 'melbourne-barbecues' ? 'Public barbecue' : 'Drinking Fountain');
  const properties = {
    title: type,
    type,
    ...(cleanText(row?.evaluationdate, 80) ? { inventoryAsOf: cleanText(row.evaluationdate, 80) } : {}),
    freshnessClass: 'inventory',
    caveat: 'Asset inventory only; presence does not guarantee current condition or operability.',
  };
  return feature(sourceId, dataset, row, coordinates, properties);
}

function developmentRecord(row, dataset) {
  const coordinates = pointFrom(row?.geopoint);
  if (!coordinates) return null;
  const locality = cleanText(row?.clue_small_area, 120);
  const properties = {
    title: locality ? `Development activity — ${locality}` : 'Development activity',
    ...(cleanText(row?.status, 60) ? { status: cleanText(row.status, 60) } : {}),
    ...(cleanText(row?.year_completed, 20) ? { yearCompleted: cleanText(row.year_completed, 20) } : {}),
    ...(locality ? { locality } : {}),
    ...(Number.isFinite(Number(row?.floors_above)) ? { floorsAbove: Number(row.floors_above) } : {}),
    ...(Number.isFinite(Number(row?.resi_dwellings)) ? { residentialDwellings: Number(row.resi_dwellings) } : {}),
    ...(Number.isFinite(Number(row?.hotel_rooms)) ? { hotelRooms: Number(row.hotel_rooms) } : {}),
    freshnessClass: 'monthly-context',
    caveat: 'Monthly planning and development context only; not live works, a permit decision, or legal advice.',
  };
  return feature('melbourne-development', dataset, row, coordinates, properties);
}

function cultureRecord(row, dataset) {
  const coordinates = pointFrom(dataset === 'outdoor-artworks' ? row?.geo_point_2d : row?.co_ordinates);
  if (!coordinates) return null;
  const title = cleanText(row?.title, 120) || 'Public artwork or memorial';
  const properties = {
    title,
    type: cleanText(row?.object_type || row?.classification, 80)
      || (dataset === 'public-memorials-and-sculptures' ? 'Memorial or sculpture' : 'Public artwork'),
    ...(cleanText(row?.art_date, 40) ? { date: cleanText(row.art_date, 40) } : {}),
    freshnessClass: 'reference',
    caveat: 'Reference metadata only; current condition and record-level media rights are not implied.',
  };
  return feature('melbourne-culture', dataset, row, coordinates, properties);
}

export function normalizeMelbourneCivicRecord(sourceId, row, { dataset } = {}) {
  if (sourceId === 'melbourne-drinking-fountains' || sourceId === 'melbourne-barbecues') {
    return assetRecord(sourceId, row, dataset || SPATIAL_DATASETS[sourceId][0].dataset);
  }
  if (sourceId === 'melbourne-development') return developmentRecord(row, dataset || 'development-activity-monitor');
  if (sourceId === 'melbourne-culture') return cultureRecord(row, dataset || 'outdoor-artworks');
  throw new Error(`Unknown Melbourne civic source: ${sourceId}`);
}

export function normalizeMelbourneCivicPayload(sourceId, payload, { nowMs = Date.now(), maxFeatures = 1_000, bbox } = {}) {
  if (sourceId === 'melbourne-parking-live') {
    if (!Array.isArray(payload?.sensors) || !Array.isArray(payload?.bays)) throw new Error('Melbourne parking payload must contain sensor and bay arrays');
    const index = buildMelbourneParkingIndex(payload.sensors, payload.bays);
    if (!bbox) {
      return queryMelbourneParkingIndex(index, { west: -180, south: -90, east: 180, north: 90 }, { nowMs, maxFeatures });
    }
    return queryMelbourneParkingIndex(index, bbox, { nowMs, maxFeatures });
  }
  const datasets = Array.isArray(payload) ? payload : [{ dataset: SPATIAL_DATASETS[sourceId]?.[0]?.dataset, results: payload?.results }];
  const features = [];
  const identities = new Set();
  const publicIdOwners = new Map();
  for (const item of datasets) {
    if (!Array.isArray(item?.results)) throw new Error(`${sourceId} payload must contain results arrays`);
    for (const row of item.results) {
      const normalized = normalizeMelbourneCivicRecord(sourceId, row, { dataset: item.dataset });
      if (normalized) {
        const identity = sourceRowIdentity(sourceId, item.dataset, row, normalized.geometry.coordinates);
        if (identities.has(identity)) continue;
        identities.add(identity);
        const originalId = normalized.id;
        let candidateId = originalId;
        let collision = 0;
        while (publicIdOwners.has(candidateId) && publicIdOwners.get(candidateId) !== identity) {
          collision += 1;
          candidateId = `${originalId}-${boundedDigest(`collision|${collision}|${identity}`).slice(0, 8)}`;
        }
        normalized.id = candidateId;
        publicIdOwners.set(candidateId, identity);
        features.push(normalized);
      }
      if (features.length >= maxFeatures) return { type: 'FeatureCollection', features };
    }
  }
  return { type: 'FeatureCollection', features };
}

async function readJsonCapped(response, maxBytes, meter) {
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
        if (length > maxBytes || meter.bytes + value.byteLength > meter.maxBytes) {
          const error = new Error('response too large');
          error.code = 'RESPONSE_TOO_LARGE';
          await reader.cancel(error).catch(() => {});
          throw error;
        }
        meter.bytes += value.byteLength;
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes || meter.bytes + bytes.byteLength > meter.maxBytes) {
      const error = new Error('response too large');
      error.code = 'RESPONSE_TOO_LARGE';
      throw error;
    }
    meter.bytes += bytes.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    const error = new Error('invalid JSON');
    error.code = 'INVALID_JSON';
    throw error;
  }
}

export function createMelbourneCivicClient({
  fetchImpl = fetch,
  withRequestSlot = (operation) => operation(),
  now = () => Date.now(),
  timeoutMs = 20_000,
  limits = {},
} = {}) {
  const pageRows = Math.min(DEFAULT_PAGE_ROWS, Math.max(1, Number(limits.pageRows) || DEFAULT_PAGE_ROWS));
  const pageBytes = Math.max(1, Number(limits.pageBytes) || DEFAULT_PAGE_BYTES);
  const totalBytes = Math.max(pageBytes, Number(limits.totalBytes) || DEFAULT_TOTAL_BYTES);
  const spatialRequestCap = Math.max(1, Number(limits.spatialRequests) || DEFAULT_SPATIAL_REQUESTS);
  let parkingCache = null;
  let parkingInFlight = null;
  const spatialExportCache = new Map();
  const spatialExportInFlight = new Map();

  async function fetchPage(url, meter, responseBytes = pageBytes) {
    return withRequestSlot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        const error = new Error('timeout');
        error.code = 'TIMEOUT';
        controller.abort(error);
      }, timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error',
        });
        if (!response?.ok) {
          const error = new Error('provider request failed');
          error.code = 'UPSTREAM_FAILED';
          throw error;
        }
        const contentType = response.headers?.get?.('content-type') || '';
        if (!/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
          const error = new Error('invalid provider media type');
          error.code = 'INVALID_MEDIA_TYPE';
          throw error;
        }
        return readJsonCapped(response, responseBytes, meter);
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async function downloadParkingTable(name, meter) {
    const config = PARKING_TABLES[name];
    const payload = await fetchPage(exportUrl(config.dataset, {
      select: config.select,
      where: config.where,
      orderBy: 'kerbsideid',
    }), meter, config.maxBytes);
    if (!Array.isArray(payload)) {
      const invalid = new Error('invalid provider response');
      invalid.code = 'INVALID_JSON';
      throw invalid;
    }
    const capped = payload.length > config.maxRows;
    const rows = payload.slice(0, config.maxRows);
    return {
      rows,
      status: capped ? 'partial' : 'current',
      capped,
      requestCount: 1,
      lastSuccessfulAt: now(),
    };
  }

  async function refreshParking() {
    const meter = { bytes: 0, maxBytes: totalBytes };
    const prior = parkingCache?.tables;
    const settled = await Promise.allSettled([
      downloadParkingTable('sensors', meter),
      downloadParkingTable('bays', meter),
    ]);
    const names = ['sensors', 'bays'];
    const tables = {};
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const result = settled[index];
      if (result.status === 'fulfilled') tables[name] = result.value;
      else if (prior?.[name]?.rows?.length && now() - prior[name].lastSuccessfulAt <= PARKING_LAST_GOOD_MS) {
        tables[name] = { ...prior[name], status: 'stale', failed: true };
      } else if (prior?.[name]) {
        tables[name] = { ...prior[name], rows: [], status: 'unavailable', failed: true, expired: true };
      } else throw result.reason;
    }
    parkingCache = {
      tables,
      index: buildMelbourneParkingIndex(tables.sensors.rows, tables.bays.rows),
      cachedAt: now(),
    };
    return parkingCache;
  }

  async function parkingSnapshot() {
    if (parkingCache && now() - parkingCache.cachedAt < PARKING_CACHE_MS) return parkingCache;
    if (!parkingInFlight) parkingInFlight = refreshParking().finally(() => { parkingInFlight = null; });
    return parkingInFlight;
  }

  async function loadParking({ bbox, maxFeatures }) {
    const snapshot = await parkingSnapshot();
    const normalized = queryMelbourneParkingIndex(snapshot.index, bbox, { nowMs: now(), maxFeatures });
    const sourceCapped = normalized.capped;
    delete normalized.capped;
    const tableStatus = Object.fromEntries(Object.entries(snapshot.tables).map(([name, table]) => [name, {
      status: table.status,
      rows: table.rows.length,
      capped: table.capped === true,
      lastSuccessfulAt: table.lastSuccessfulAt,
    }]));
    const staleRecords = normalized.features.filter(({ properties }) => properties.stale).length;
    const currentRecords = normalized.features.length - staleRecords;
    const allRecordsStale = normalized.features.length > 0 && currentRecords === 0;
    const partial = sourceCapped || staleRecords > 0 || Object.values(tableStatus).some(({ status }) => status !== 'current');
    return {
      ...normalized,
      sourceStatus: {
        status: allRecordsStale ? 'stale' : partial ? 'partial' : 'current',
        capped: sourceCapped || Object.values(tableStatus).some(({ capped }) => capped),
        staleRecords,
        currentRecords,
        tables: tableStatus,
      },
    };
  }

  async function loadSpatial(sourceId, { bbox, maxFeatures }) {
    const initial = melbourneCivicSpatialRequests(sourceId, bbox, maxFeatures);
    const meter = { bytes: 0, maxBytes: totalBytes };
    const datasetResults = await Promise.all(initial.map(async (request) => {
      if (request.transport === 'export') {
        try {
          let snapshot = spatialExportCache.get(request.dataset);
          if (!snapshot || now() - snapshot.cachedAt >= MEMORIAL_EXPORT_CACHE_MS) {
            let pending = spatialExportInFlight.get(request.dataset);
            if (!pending) {
              pending = (async () => {
                const payload = await fetchPage(request.url, meter, request.maxBytes);
                if (!Array.isArray(payload)) {
                  const invalid = new Error('invalid provider response');
                  invalid.code = 'INVALID_JSON';
                  throw invalid;
                }
                const capped = payload.length > request.maxRows;
                const rows = payload.slice(0, request.maxRows);
                return {
                  rows,
                  index: buildSpatialRowIndex(sourceId, request.dataset, rows),
                  capped,
                  cachedAt: now(),
                };
              })().finally(() => spatialExportInFlight.delete(request.dataset));
              spatialExportInFlight.set(request.dataset, pending);
            }
            snapshot = await pending;
            spatialExportCache.set(request.dataset, snapshot);
          }
          const rows = querySpatialRowIndex(snapshot.index, bbox);
          return {
            dataset: request.dataset,
            results: rows,
            status: snapshot.capped || snapshot.index.duplicates > 0 ? 'partial' : 'current',
            capped: snapshot.capped || snapshot.index.duplicates > 0,
            duplicates: snapshot.index.duplicates,
            failed: false,
            export: true,
          };
        } catch (error) {
          return {
            dataset: request.dataset,
            results: [],
            status: 'partial',
            capped: false,
            duplicates: 0,
            failed: true,
            error,
            export: true,
          };
        }
      }
      const rows = [];
      const seen = new Set();
      let duplicates = 0;
      let offset = 0;
      let totalCount = null;
      let requests = 0;
      let failure = null;
      while (rows.length < maxFeatures && requests < spatialRequestCap) {
        const requestRows = Math.min(pageRows, maxFeatures - rows.length);
        const url = new URL(request.url);
        url.searchParams.set('limit', String(requestRows));
        url.searchParams.set('offset', String(offset));
        try {
          const payload = await fetchPage(url, meter);
          if (!Array.isArray(payload?.results) || payload.results.length > requestRows
            || !Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
            const invalid = new Error('invalid provider response');
            invalid.code = 'INVALID_JSON';
            throw invalid;
          }
          totalCount = payload.total_count;
          for (const row of payload.results) {
            const normalized = normalizeMelbourneCivicRecord(sourceId, row, { dataset: request.dataset });
            const coordinates = normalized?.geometry?.coordinates || [0, 0];
            const identity = sourceRowIdentity(sourceId, request.dataset, row, coordinates);
            if (seen.has(identity)) duplicates += 1;
            else {
              seen.add(identity);
              rows.push(row);
            }
          }
          requests += 1;
          offset += requestRows;
          if (offset >= totalCount) break;
        } catch (error) {
          failure = error;
          break;
        }
      }
      return {
        dataset: request.dataset,
        results: rows,
        status: failure || duplicates > 0 || (totalCount !== null && offset < totalCount) ? 'partial' : 'current',
        capped: duplicates > 0 || (!failure && totalCount !== null && offset < totalCount),
        duplicates,
        failed: Boolean(failure),
        error: failure,
      };
    }));
    if (datasetResults.every(({ failed, results }) => failed && results.length === 0)) {
      throw datasetResults[0].error;
    }
    const normalized = normalizeMelbourneCivicPayload(sourceId, datasetResults, { maxFeatures: maxFeatures + 1 });
    const sourceCapped = normalized.features.length > maxFeatures
      || datasetResults.some(({ capped }) => capped);
    normalized.features = normalized.features.slice(0, maxFeatures);
    const partial = sourceCapped || datasetResults.some(({ status }) => status !== 'current');
    return {
      ...normalized,
      sourceStatus: {
        status: partial ? 'partial' : 'current',
        capped: sourceCapped,
        datasets: datasetResults.map(({ dataset, status, capped, failed, results, duplicates }) => ({
          dataset,
          status: failed && results.length === 0 ? 'unavailable' : status,
          capped,
          duplicates,
        })),
      },
    };
  }

  return Object.freeze({
    load(sourceId, options) {
      return sourceId === 'melbourne-parking-live' ? loadParking(options) : loadSpatial(sourceId, options);
    },
  });
}
