const MAX_FEATURES = 1_000;
const MAX_TEXT_LENGTH = 240;
const MAX_INPUT_COORDINATES_PER_FEATURE = 50_000;
const MAX_INPUT_COORDINATES_PER_RESPONSE = 100_000;
const MAX_GEOMETRY_DEPTH = 4;
const MAX_HERITAGE_OUTPUT_COORDINATES = 4_000;
const MAX_POLYGONS_PER_FEATURE = 256;
const MAX_RINGS_PER_FEATURE = 512;
const MAX_TOPOLOGY_COMPARISONS = 2_000_000;

export const OGC_MAX_RESPONSE_BYTES = 2_000_000;

const OGC_FEATURE_SOURCES = Object.freeze({
  'au-dea-hotspots': Object.freeze({
    endpoint: 'https://hotspots.dea.ga.gov.au/geoserver/wfs',
    typeName: 'public:hotspots_three_days',
    propertyName: 'geometry,datetime,accuracy,confidence,fire_category_name,satellite,sensor',
    geometryTypes: Object.freeze(['Point']),
  }),
  'vic-parks': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:parkres',
    propertyName: 'geom,name,area_type,manager',
    geometryTypes: Object.freeze(['Polygon', 'MultiPolygon']),
  }),
  'vic-recreation-tracks': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:recweb_tracks',
    propertyName: 'geom,name,trk_class,asset_cls',
    geometryTypes: Object.freeze(['LineString', 'MultiLineString']),
  }),
  'vic-heritage': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:heritage_register',
    propertyName: 'geom,site_name,heritage_object',
    geometryTypes: Object.freeze(['Polygon', 'MultiPolygon']),
  }),
});

export const OGC_SOURCE_CREDITS = Object.freeze({
  'au-dea-hotspots': 'Digital Earth Australia Hotspots',
  'vic-parks': 'State of Victoria (DataVic)',
  'vic-recreation-tracks': 'State of Victoria (DataVic)',
  'vic-heritage': 'State of Victoria (DataVic)',
});

function sourceConfig(sourceId) {
  if (!Object.hasOwn(OGC_FEATURE_SOURCES, sourceId)) throw new Error(`Unknown OGC regional source: ${sourceId}`);
  return OGC_FEATURE_SOURCES[sourceId];
}

function validBbox(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west >= -180 && bbox.east <= 180 && bbox.south >= -90 && bbox.north <= 90
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

function validLimit(limit) {
  return Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_FEATURES;
}

/** Build one fixed WFS 2 request. Browser-controlled input is limited to bbox. */
export function ogcFeatureRequest(sourceId, bbox, limit) {
  const source = sourceConfig(sourceId);
  if (!validBbox(bbox)) throw new Error('invalid OGC bounding box');
  if (!validLimit(limit)) throw new Error('invalid OGC feature limit');
  const url = new URL(source.endpoint);
  url.search = new URLSearchParams({
    service: 'WFS',
    request: 'GetFeature',
    version: '2.0.0',
    typeName: source.typeName,
    srsName: 'EPSG:4326',
    outputFormat: 'application/json',
    bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north},EPSG:4326`,
    count: String(limit),
    // GeoServer accepts maxFeatures as the WFS 1.x-compatible hard ceiling.
    maxFeatures: String(limit),
    propertyName: source.propertyName,
  }).toString();
  return url;
}

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string'
    ? value.replace(/[<>\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function isoDate(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return '';
  }
}

function position(value, meter) {
  if (!Array.isArray(value) || value.length < 2 || value.some(Array.isArray)) {
    throw codedError('invalid OGC geometry position', 'INVALID_OGC_GEOMETRY');
  }
  const longitude = value[0];
  const latitude = value[1];
  if (typeof longitude !== 'number' || typeof latitude !== 'number'
    || !Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw codedError('invalid OGC geometry coordinate', 'INVALID_OGC_GEOMETRY');
  }
  meter.feature += 1;
  meter.response += 1;
  if (meter.feature > MAX_INPUT_COORDINATES_PER_FEATURE || meter.response > MAX_INPUT_COORDINATES_PER_RESPONSE) {
    throw codedError('OGC geometry coordinate limit exceeded', 'OGC_COORDINATE_LIMIT');
  }
  return [longitude, latitude];
}

function samePosition(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function orientation(a, b, c) {
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(cross) <= Number.EPSILON * 64) return 0;
  return cross > 0 ? 1 : -1;
}

function onSegment(a, b, c) {
  return b[0] >= Math.min(a[0], c[0]) && b[0] <= Math.max(a[0], c[0])
    && b[1] >= Math.min(a[1], c[1]) && b[1] <= Math.max(a[1], c[1]);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC !== abD && cdA !== cdB) return true;
  return (abC === 0 && onSegment(a, c, b)) || (abD === 0 && onSegment(a, d, b))
    || (cdA === 0 && onSegment(c, a, d)) || (cdB === 0 && onSegment(c, b, d));
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function validateRing(ring, { checkIntersections = true } = {}) {
  if (ring.length < 4 || !samePosition(ring[0], ring.at(-1))) {
    throw codedError('invalid OGC geometry ring', 'INVALID_OGC_GEOMETRY');
  }
  const distinct = new Set(ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`));
  if (distinct.size < 3 || signedArea(ring) === 0) {
    throw codedError('invalid OGC geometry ring', 'INVALID_OGC_GEOMETRY');
  }
  if (!checkIntersections) return;
  const segmentCount = ring.length - 1;
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    index,
    minX: Math.min(ring[index][0], ring[index + 1][0]),
    maxX: Math.max(ring[index][0], ring[index + 1][0]),
    minY: Math.min(ring[index][1], ring[index + 1][1]),
    maxY: Math.max(ring[index][1], ring[index + 1][1]),
  })).sort((left, right) => left.minX - right.minX || left.index - right.index);
  const active = [];
  let comparisons = 0;
  for (const current of segments) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].maxX < current.minX) active.splice(index, 1);
    }
    for (const prior of active) {
      if (prior.maxY < current.minY || current.maxY < prior.minY) continue;
      const adjacent = Math.abs(prior.index - current.index) === 1
        || (Math.min(prior.index, current.index) === 0 && Math.max(prior.index, current.index) === segmentCount - 1);
      if (adjacent) continue;
      comparisons += 1;
      if (comparisons > MAX_TOPOLOGY_COMPARISONS) {
        throw codedError('OGC geometry topology validation limit exceeded', 'OGC_COORDINATE_LIMIT');
      }
      if (segmentsIntersect(
        ring[prior.index], ring[prior.index + 1], ring[current.index], ring[current.index + 1],
      )) {
        throw codedError('invalid OGC geometry self-intersection', 'INVALID_OGC_GEOMETRY');
      }
    }
    active.push(current);
  }
}

function line(value, meter) {
  if (!Array.isArray(value) || value.length < 2) throw codedError('invalid OGC geometry line', 'INVALID_OGC_GEOMETRY');
  return value.map((item) => position(item, meter));
}

function ring(value, meter) {
  if (!Array.isArray(value)) throw codedError('invalid OGC geometry ring', 'INVALID_OGC_GEOMETRY');
  const input = value.map((item) => position(item, meter));
  const normalized = input.filter((item, index) => index === 0 || !samePosition(item, input[index - 1]));
  validateRing(normalized);
  return normalized;
}

function assertGeometryNesting(coordinates) {
  const stack = [{ value: coordinates, depth: 0 }];
  let arrayCount = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!Array.isArray(value)) continue;
    arrayCount += 1;
    if (depth > MAX_GEOMETRY_DEPTH || arrayCount > MAX_INPUT_COORDINATES_PER_RESPONSE) {
      throw codedError('invalid OGC geometry nesting', 'INVALID_OGC_GEOMETRY');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (Array.isArray(value[index])) stack.push({ value: value[index], depth: depth + 1 });
    }
  }
}

function simplifyRing(ringValue, limit) {
  if (ringValue.length <= limit) return ringValue;
  const originalWinding = Math.sign(signedArea(ringValue));
  const openLength = ringValue.length - 1;
  const keepOpen = Math.max(3, limit - 1);
  const simplified = [];
  for (let index = 0; index < keepOpen; index += 1) {
    simplified.push(ringValue[Math.floor((index * openLength) / keepOpen)]);
  }
  simplified.push(simplified[0]);
  validateRing(simplified);
  if (Math.sign(signedArea(simplified)) !== originalWinding) {
    throw codedError('invalid OGC geometry winding after simplification', 'INVALID_OGC_GEOMETRY');
  }
  return simplified;
}

function simplifyHeritagePolygons(polygons) {
  const rings = polygons.flat();
  if (rings.length > MAX_RINGS_PER_FEATURE || rings.length * 4 > MAX_HERITAGE_OUTPUT_COORDINATES) {
    throw codedError('OGC heritage geometry is excessive', 'OGC_COORDINATE_LIMIT');
  }
  const current = rings.reduce((sum, item) => sum + item.length, 0);
  if (current <= MAX_HERITAGE_OUTPUT_COORDINATES) return polygons;
  const base = rings.length * 4;
  const available = MAX_HERITAGE_OUTPUT_COORDINATES - base;
  const weights = rings.map((item) => Math.max(0, item.length - 4));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const limits = weights.map((weight) => 4 + Math.floor((available * weight) / totalWeight));
  let remaining = MAX_HERITAGE_OUTPUT_COORDINATES - limits.reduce((sum, limit) => sum + limit, 0);
  for (let index = 0; remaining > 0; index = (index + 1) % limits.length) {
    if (limits[index] < rings[index].length) { limits[index] += 1; remaining -= 1; }
  }
  let ringIndex = 0;
  return polygons.map((polygon) => polygon.map((item) => simplifyRing(item, limits[ringIndex++])));
}

function normalizeGeometry(sourceId, geometry, meter) {
  const source = sourceConfig(sourceId);
  if (!geometry || typeof geometry !== 'object' || !source.geometryTypes.includes(geometry.type)) return null;
  assertGeometryNesting(geometry.coordinates);
  meter.feature = 0;
  if (geometry.type === 'Point') return { type: 'Point', coordinates: position(geometry.coordinates, meter) };
  if (geometry.type === 'LineString') return { type: 'LineString', coordinates: line(geometry.coordinates, meter) };
  if (geometry.type === 'MultiLineString') {
    if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) throw codedError('invalid OGC geometry nesting', 'INVALID_OGC_GEOMETRY');
    return { type: 'MultiLineString', coordinates: geometry.coordinates.map((item) => line(item, meter)) };
  }
  const rawPolygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(rawPolygons) || !rawPolygons.length || rawPolygons.length > MAX_POLYGONS_PER_FEATURE) {
    throw codedError('invalid OGC geometry nesting', 'INVALID_OGC_GEOMETRY');
  }
  let ringCount = 0;
  let polygons = rawPolygons.map((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) throw codedError('invalid OGC geometry nesting', 'INVALID_OGC_GEOMETRY');
    ringCount += polygon.length;
    if (ringCount > MAX_RINGS_PER_FEATURE) throw codedError('OGC geometry ring limit exceeded', 'OGC_COORDINATE_LIMIT');
    return polygon.map((item) => ring(item, meter));
  });
  if (sourceId === 'vic-heritage') polygons = simplifyHeritagePolygons(polygons);
  return {
    type: geometry.type,
    coordinates: geometry.type === 'Polygon' ? polygons[0] : polygons,
  };
}

function publicProperties(sourceId, input) {
  if (sourceId === 'au-dea-hotspots') {
    const properties = {
      title: 'Satellite hotspot observation', sourceId, source: 'Digital Earth Australia',
      freshnessClass: 'observation',
      caveat: 'Satellite hotspot observation context only. Nominal 375 m-type detections can have larger positional uncertainty and are not warning or evacuation advice.',
    };
    const observedAt = isoDate(input?.datetime);
    if (observedAt) properties.observedAt = observedAt;
    const uncertainty = cleanText(input?.accuracy, 60);
    if (uncertainty) properties.positionalUncertainty = uncertainty;
    if (typeof input?.confidence === 'number' && Number.isFinite(input.confidence)
      && input.confidence >= 0 && input.confidence <= 100) properties.confidence = input.confidence;
    const category = cleanText(input?.fire_category_name, 80);
    if (category) properties.observationType = category;
    const satellite = cleanText(input?.satellite, 80);
    if (satellite) properties.satellite = satellite;
    const sensor = cleanText(input?.sensor, 80);
    if (sensor) properties.sensor = sensor;
    return properties;
  }
  if (sourceId === 'vic-parks') {
    return {
      title: cleanText(input?.name, 180) || 'Victorian reserve',
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'reference', referenceOnly: true,
      ...(cleanText(input?.area_type, 120) ? { reserveType: cleanText(input.area_type, 120) } : {}),
      ...(cleanText(input?.manager, 120) ? { manager: cleanText(input.manager, 120) } : {}),
      caveat: 'Reference reserve boundary only.',
    };
  }
  if (sourceId === 'vic-recreation-tracks') {
    return {
      title: cleanText(input?.name, 180) || 'Victorian recreation track',
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'reference', referenceOnly: true,
      ...(cleanText(input?.trk_class, 80) ? { trackClass: cleanText(input.trk_class, 80) } : {}),
      ...(cleanText(input?.asset_cls, 80) ? { assetClass: cleanText(input.asset_cls, 80) } : {}),
      caveat: 'Reference alignment only; not live closure or condition state.',
    };
  }
  return {
    title: cleanText(input?.site_name, 180) || 'Victorian heritage place',
    sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'unknown', referenceOnly: true,
    ...(cleanText(input?.heritage_object, 120) ? { objectType: cleanText(input.heritage_object, 120) } : {}),
    caveat: 'Reference heritage boundary with unknown cadence.',
  };
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizedFeature(sourceId, row, meter) {
  const geometry = normalizeGeometry(sourceId, row?.geometry, meter);
  if (!geometry) return null;
  const properties = publicProperties(sourceId, row?.properties || {});
  const identity = JSON.stringify([geometry, properties]);
  return {
    identity,
    feature: {
      type: 'Feature', geometry, properties,
    },
  };
}

/** Normalize one WFS feature without retaining provider identifiers. */
export function normalizeOgcFeature(sourceId, row) {
  const normalized = normalizedFeature(sourceId, row, { feature: 0, response: 0 });
  return normalized ? {
    ...normalized.feature,
    id: `ogc-${sourceId}-${stableHash(normalized.identity)}`,
  } : null;
}

/** Sanitize, bound, deduplicate and deterministically order one WFS response. */
export function normalizeOgcPayload(sourceId, payload, { maxFeatures = MAX_FEATURES } = {}) {
  sourceConfig(sourceId);
  if (!validLimit(maxFeatures)) throw new Error('invalid OGC feature limit');
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw codedError('OGC payload must contain a FeatureCollection', 'INVALID_OGC_RESPONSE');
  }
  if (payload.features.length > maxFeatures) throw codedError('OGC response exceeded feature limit', 'OGC_FEATURE_LIMIT');
  if (payload.numberReturned !== undefined
    && (!Number.isSafeInteger(payload.numberReturned) || payload.numberReturned < 0 || payload.numberReturned !== payload.features.length)) {
    throw codedError('invalid OGC collection counts', 'INVALID_OGC_RESPONSE');
  }
  const matchedCandidate = Number.isSafeInteger(payload.numberMatched) && payload.numberMatched >= 0
    ? payload.numberMatched
    : Number.isSafeInteger(payload.totalFeatures) && payload.totalFeatures >= 0
      ? payload.totalFeatures
      : null;
  const capped = matchedCandidate === null
    ? payload.features.length === maxFeatures
    : matchedCandidate > payload.features.length;

  const meter = { feature: 0, response: 0 };
  const byIdentity = new Map();
  let invalidFeatures = 0;
  let duplicateFeatures = 0;
  for (let index = 0; index < payload.features.length; index += 1) {
    const normalized = normalizedFeature(sourceId, payload.features[index], meter);
    if (!normalized) { invalidFeatures += 1; continue; }
    if (byIdentity.has(normalized.identity)) duplicateFeatures += 1;
    else byIdentity.set(normalized.identity, normalized.feature);
  }
  const collisionCounts = new Map();
  const features = [...byIdentity.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([identity, value]) => {
    const baseId = `ogc-${sourceId}-${stableHash(identity)}`;
    const count = (collisionCounts.get(baseId) || 0) + 1;
    collisionCounts.set(baseId, count);
    return { ...value, id: count === 1 ? baseId : `${baseId}-${count}` };
  });
  features.sort((left, right) => left.properties.title.localeCompare(right.properties.title) || left.id.localeCompare(right.id));
  const partial = capped || invalidFeatures > 0 || duplicateFeatures > 0;
  return {
    type: 'FeatureCollection', features,
    sourceStatus: {
      status: partial ? 'partial' : 'current',
      capped,
      ...(matchedCandidate === null ? {} : { numberMatched: matchedCandidate }),
      invalidFeatures,
      duplicateFeatures,
      coordinateCount: meter.response,
    },
  };
}

export const OGC_GEOMETRY_LIMITS = Object.freeze({
  maxDepth: MAX_GEOMETRY_DEPTH,
  maxCoordinatesPerFeature: MAX_INPUT_COORDINATES_PER_FEATURE,
  maxCoordinatesPerResponse: MAX_INPUT_COORDINATES_PER_RESPONSE,
  maxHeritageOutputCoordinates: MAX_HERITAGE_OUTPUT_COORDINATES,
});
