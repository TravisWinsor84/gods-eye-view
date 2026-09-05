const SOURCE_ID = 'vic-wetlands-2025';
const EDITION = '2025';
const RESOURCE_ID = 'a7069c00-29e4-407f-89f2-7a9da546b4a1';
const MAX_FEATURES = 500;
const MAX_VIEWPORT_DEGREES = 1;
const MAX_VIEWPORT_AREA_DEGREES = 0.5;
const MAX_CELL_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_COORDINATES = 1_000_000;
const PUBLIC_FIELDS = new Set([
  'id', 'wetlandType', 'waterRegime', 'source', 'sourceConfidence', 'edition', 'referenceOnly',
]);

function fail(message) {
  throw new Error(`[vic-wetlands-2025] ${message}`);
}

function validBbox(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west < bbox.east && bbox.south < bbox.north
    && bbox.west >= 140.5 && bbox.east <= 150.5
    && bbox.south >= -39.5 && bbox.north <= -33.5;
}

function intersects(left, right) {
  return left.west <= right.east && left.east >= right.west
    && left.south <= right.north && left.north >= right.south;
}

function compareFeatureIds(left, right) {
  const leftId = left.properties.id;
  const rightId = right.properties.id;
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function geometryStats(geometry) {
  const bbox = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  let coordinates = 0;
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      coordinates += 1;
      bbox.west = Math.min(bbox.west, value[0]);
      bbox.south = Math.min(bbox.south, value[1]);
      bbox.east = Math.max(bbox.east, value[0]);
      bbox.north = Math.max(bbox.north, value[1]);
      return;
    }
    for (const child of value) visit(child);
  };
  if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) fail('cell contains unsupported geometry');
  visit(geometry.coordinates);
  if (!coordinates) fail('cell contains empty geometry');
  return { bbox, coordinates };
}

async function digest(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const result = await globalThis.crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function validateIndex(index) {
  if (index?.schemaVersion !== 1 || index.sourceId !== SOURCE_ID || index.edition !== EDITION
    || index.resourceId !== RESOURCE_ID || index.referenceOnly !== true || !Array.isArray(index.cells)) {
    fail('index does not identify the pinned 2025 release');
  }
}

/**
 * Query a generated wetland cell index without silently truncating a viewport.
 * The caller owns transport; this function verifies every loaded cell first.
 */
export async function queryVicWetlands2025Index({ index, bbox, maxFeatures, loadCell }) {
  validateIndex(index);
  if (!validBbox(bbox)) fail('invalid or out-of-Victoria bbox');
  const width = bbox.east - bbox.west;
  const height = bbox.north - bbox.south;
  if (width > MAX_VIEWPORT_DEGREES || height > MAX_VIEWPORT_DEGREES
    || width * height > MAX_VIEWPORT_AREA_DEGREES) fail('viewport limit exceeded');
  if (!Number.isInteger(maxFeatures) || maxFeatures < 1 || maxFeatures > MAX_FEATURES) {
    fail(`feature limit must be an integer in [1, ${MAX_FEATURES}]`);
  }
  if (typeof loadCell !== 'function') fail('loadCell is required');

  const features = new Map();
  let responseBytes = 0;
  let responseCoordinates = 0;
  const cells = index.cells.filter((cell) => intersects(cell.bbox, bbox));
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell.bytes) || cell.bytes < 1 || cell.bytes > MAX_CELL_BYTES) {
      fail(`cell ${cell.id} exceeds decoded byte limit`);
    }
    const loaded = await loadCell(cell);
    const bytes = loaded instanceof Uint8Array ? loaded : new Uint8Array(loaded);
    responseBytes += bytes.byteLength;
    if (bytes.byteLength !== cell.bytes || responseBytes > MAX_RESPONSE_BYTES) {
      fail(`cell ${cell.id} exceeds decoded byte limit`);
    }
    if (await digest(bytes) !== cell.sha256) fail(`cell ${cell.id} SHA-256 verification failed`);
    const collection = JSON.parse(new TextDecoder().decode(bytes));
    if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      fail(`cell ${cell.id} is not a FeatureCollection`);
    }
    for (const feature of collection.features) {
      const keys = Object.keys(feature?.properties || {});
      if (keys.some((key) => !PUBLIC_FIELDS.has(key))
        || feature.properties.edition !== EDITION || feature.properties.referenceOnly !== true
        || !String(feature.properties.id || '').startsWith(`${SOURCE_ID}:`)) {
        fail(`cell ${cell.id} contains fields outside the public 2025 contract`);
      }
      const existing = features.get(feature.properties.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(feature)) {
          fail(`cell ${cell.id} conflicts with a duplicate feature ID`);
        }
        continue;
      }
      const stats = geometryStats(feature.geometry);
      if (!intersects(stats.bbox, bbox)) continue;
      responseCoordinates += stats.coordinates;
      if (responseCoordinates > MAX_RESPONSE_COORDINATES) fail('response geometry limit exceeded');
      features.set(feature.properties.id, feature);
      if (features.size > maxFeatures) fail('viewport exceeds requested feature limit');
    }
  }
  return {
    type: 'FeatureCollection',
    sourceId: SOURCE_ID,
    edition: EDITION,
    referenceOnly: true,
    referenceNotice: index.referenceNotice,
    features: [...features.values()].sort(compareFeatureIds),
  };
}
