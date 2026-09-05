const MAX_FEATURES = 1_000;
const MAX_TEXT_LENGTH = 240;
const MAX_INPUT_COORDINATES_PER_FEATURE = 50_000;
const MAX_INPUT_COORDINATES_PER_RESPONSE = 100_000;
const MAX_GEOMETRY_DEPTH = 4;
const MAX_HERITAGE_OUTPUT_COORDINATES = 4_000;
const MAX_POLYGONS_PER_FEATURE = 256;
const MAX_RINGS_PER_FEATURE = 512;
const MAX_TOPOLOGY_COMPARISONS = 150_000;

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
  'vic-ev-chargers': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:dcav_site',
    propertyName: 'geom,location,region,lead_organisation,estimated_project_completion,plug_type,company,number_of_chargers',
    geometryTypes: Object.freeze(['Point']),
  }),
  'vic-renewable-facilities': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:renewables',
    propertyName: 'geom,name,type,approval_status,construction_status,lga,size_mw,turbines,ancillary_battery,ancillary_battery_size',
    geometryTypes: Object.freeze(['Polygon', 'MultiPolygon']),
  }),
  'vic-flood-history-2022': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:vic_flood_history_public',
    propertyName: 'geom,subtype,obs_date,source,label',
    geometryTypes: Object.freeze(['Polygon', 'MultiPolygon']),
    maxInputCoordinatesPerFeature: 60_000,
    maxInputCoordinatesPerResponse: 75_000,
    maxOutputCoordinatesPerFeature: 4_000,
    maxTopologyComparisons: 500_000,
  }),
  'vic-epa-priority-sites': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:psr_polygon',
    propertyName: 'geom,municipality,suburb,issue,data_extracted_on',
    geometryTypes: Object.freeze(['Polygon', 'MultiPolygon']),
  }),
  'vic-landfill-register': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:vlr_polygon',
    propertyName: 'geom,suburb,council,landfill_name,operating_status,waste_type_accepted,estimated_year_of_closure,estimated_total_waste_volume,data_extracted_on',
    geometryTypes: Object.freeze(['Polygon', 'MultiPolygon']),
  }),
  'vic-recreation-assets': Object.freeze({
    endpoint: 'https://opendata.maps.vic.gov.au/geoserver/wfs',
    typeName: 'open-data-platform:recweb_asset',
    propertyName: 'geom,name,asset_cls,category,dis_access,label,published,vers_date,fac_type,type_',
    geometryTypes: Object.freeze(['Point']),
  }),
});

export const OGC_SOURCE_CREDITS = Object.freeze({
  'au-dea-hotspots': '© Commonwealth of Australia (Geoscience Australia) 2026. This material is licensed under the Creative Commons Attribution 4.0 International Licence. Observe and retain any copyright or related notices that may accompany this material as part of the attribution.',
  'vic-parks': 'State of Victoria (DataVic)',
  'vic-recreation-tracks': 'State of Victoria (DataVic)',
  'vic-heritage': 'State of Victoria (DataVic)',
  'vic-ev-chargers': 'State of Victoria (DataVic)',
  'vic-renewable-facilities': 'State of Victoria (DataVic)',
  'vic-flood-history-2022': 'State of Victoria (DataVic)',
  'vic-epa-priority-sites': 'State of Victoria (DataVic)',
  'vic-landfill-register': 'State of Victoria (DataVic)',
  'vic-recreation-assets': 'State of Victoria (DataVic)',
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

function finiteNonNegative(value) {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function knownText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = cleanText(value, maxLength);
  return /^(?:not available|n\/?a|unknown)$/i.test(text) ? '' : text;
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
  if (meter.response > meter.maxInputCoordinatesPerResponse) {
    throw codedError('OGC geometry coordinate limit exceeded', 'OGC_COORDINATE_LIMIT');
  }
  if (meter.feature > meter.maxInputCoordinatesPerFeature) {
    throw codedError('invalid OGC feature coordinate count', 'INVALID_OGC_GEOMETRY');
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

function consumeTopologyBudget(budget, count = 1) {
  budget.comparisons += count;
  if (budget.comparisons > budget.maxComparisons) {
    throw codedError('OGC geometry topology validation limit exceeded', 'OGC_TOPOLOGY_LIMIT');
  }
}

function validateRing(ring, budget, { checkIntersections = true } = {}) {
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
  for (const current of segments) {
    for (let index = active.length - 1; index >= 0; index -= 1) {
      consumeTopologyBudget(budget);
      if (active[index].maxX < current.minX) active.splice(index, 1);
    }
    for (const prior of active) {
      consumeTopologyBudget(budget);
      if (prior.maxY < current.minY || current.maxY < prior.minY) continue;
      const adjacent = Math.abs(prior.index - current.index) === 1
        || (Math.min(prior.index, current.index) === 0 && Math.max(prior.index, current.index) === segmentCount - 1);
      if (adjacent) continue;
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
  validateRing(normalized, meter.topology);
  return normalized;
}

function ringBounds(ringValue) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let index = 0; index < ringValue.length - 1; index += 1) {
    bounds.minX = Math.min(bounds.minX, ringValue[index][0]);
    bounds.minY = Math.min(bounds.minY, ringValue[index][1]);
    bounds.maxX = Math.max(bounds.maxX, ringValue[index][0]);
    bounds.maxY = Math.max(bounds.maxY, ringValue[index][1]);
  }
  return bounds;
}

function boundsOverlap(left, right) {
  return left.minX <= right.maxX && right.minX <= left.maxX
    && left.minY <= right.maxY && right.minY <= left.maxY;
}

function ringBoundariesIntersect(left, right, leftBounds, rightBounds, budget) {
  consumeTopologyBudget(budget);
  if (!boundsOverlap(leftBounds, rightBounds)) return false;
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    const a = left[leftIndex];
    const b = left[leftIndex + 1];
    const leftSegment = {
      minX: Math.min(a[0], b[0]), minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]), maxY: Math.max(a[1], b[1]),
    };
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      consumeTopologyBudget(budget);
      const c = right[rightIndex];
      const d = right[rightIndex + 1];
      if (leftSegment.maxX < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < leftSegment.minX
        || leftSegment.maxY < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < leftSegment.minY) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function pointInRing(point, ringValue, bounds, budget) {
  if (point[0] < bounds.minX || point[0] > bounds.maxX || point[1] < bounds.minY || point[1] > bounds.maxY) {
    return 'outside';
  }
  let inside = false;
  for (let index = 0; index < ringValue.length - 1; index += 1) {
    consumeTopologyBudget(budget);
    const left = ringValue[index];
    const right = ringValue[index + 1];
    if (orientation(left, point, right) === 0 && onSegment(left, point, right)) return 'boundary';
    if ((left[1] > point[1]) !== (right[1] > point[1])) {
      const longitude = left[0] + ((point[1] - left[1]) * (right[0] - left[0])) / (right[1] - left[1]);
      if (longitude > point[0]) inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

function polygonContainsPoint(point, polygon, infos, budget) {
  if (pointInRing(point, polygon[0], infos[0], budget) !== 'inside') return false;
  for (let index = 1; index < polygon.length; index += 1) {
    if (pointInRing(point, polygon[index], infos[index], budget) !== 'outside') return false;
  }
  return true;
}

function validatePolygonTopology(polygons, budget) {
  const polygonInfos = polygons.map((polygon) => polygon.map(ringBounds));
  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex];
    const infos = polygonInfos[polygonIndex];
    const shell = polygon[0];
    const shellBounds = infos[0];
    for (let holeIndex = 1; holeIndex < polygon.length; holeIndex += 1) {
      const hole = polygon[holeIndex];
      const holeBounds = infos[holeIndex];
      if (ringBoundariesIntersect(shell, hole, shellBounds, holeBounds, budget)
        || pointInRing(hole[0], shell, shellBounds, budget) !== 'inside') {
        throw codedError('invalid OGC polygon topology', 'INVALID_OGC_GEOMETRY');
      }
      for (let priorIndex = 1; priorIndex < holeIndex; priorIndex += 1) {
        consumeTopologyBudget(budget);
        const prior = polygon[priorIndex];
        const priorBounds = infos[priorIndex];
        if (!boundsOverlap(priorBounds, holeBounds)) continue;
        if (ringBoundariesIntersect(prior, hole, priorBounds, holeBounds, budget)
          || pointInRing(hole[0], prior, priorBounds, budget) !== 'outside'
          || pointInRing(prior[0], hole, holeBounds, budget) !== 'outside') {
          throw codedError('invalid OGC polygon topology', 'INVALID_OGC_GEOMETRY');
        }
      }
    }
  }

  for (let rightIndex = 1; rightIndex < polygons.length; rightIndex += 1) {
    const right = polygons[rightIndex];
    const rightInfos = polygonInfos[rightIndex];
    for (let leftIndex = 0; leftIndex < rightIndex; leftIndex += 1) {
      consumeTopologyBudget(budget);
      const left = polygons[leftIndex];
      const leftInfos = polygonInfos[leftIndex];
      if (!boundsOverlap(leftInfos[0], rightInfos[0])) continue;
      for (let leftRing = 0; leftRing < left.length; leftRing += 1) {
        for (let rightRing = 0; rightRing < right.length; rightRing += 1) {
          if (ringBoundariesIntersect(
            left[leftRing], right[rightRing], leftInfos[leftRing], rightInfos[rightRing], budget,
          )) throw codedError('invalid OGC multipolygon topology', 'INVALID_OGC_GEOMETRY');
        }
      }
      if (polygonContainsPoint(left[0][0], right, rightInfos, budget)
        || polygonContainsPoint(right[0][0], left, leftInfos, budget)) {
        throw codedError('invalid OGC multipolygon topology', 'INVALID_OGC_GEOMETRY');
      }
    }
  }
}

function assertGeometryNesting(coordinates) {
  const stack = [{ value: coordinates, depth: 0 }];
  let arrayCount = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (!Array.isArray(value)) continue;
    arrayCount += 1;
    if (depth > MAX_GEOMETRY_DEPTH || arrayCount > MAX_INPUT_COORDINATES_PER_RESPONSE) {
      throw codedError('invalid OGC geometry nesting', 'OGC_NESTING_LIMIT');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (Array.isArray(value[index])) stack.push({ value: value[index], depth: depth + 1 });
    }
  }
}

function simplifyRing(ringValue, limit, budget) {
  if (ringValue.length <= limit) return ringValue;
  const originalWinding = Math.sign(signedArea(ringValue));
  const openLength = ringValue.length - 1;
  const keepOpen = Math.max(3, limit - 1);
  const simplified = [];
  for (let index = 0; index < keepOpen; index += 1) {
    simplified.push(ringValue[Math.floor((index * openLength) / keepOpen)]);
  }
  simplified.push(simplified[0]);
  validateRing(simplified, budget);
  if (Math.sign(signedArea(simplified)) !== originalWinding) {
    throw codedError('invalid OGC geometry winding after simplification', 'INVALID_OGC_GEOMETRY');
  }
  return simplified;
}

function simplifyPolygons(polygons, maxOutputCoordinates, budget, errorLabel) {
  const rings = polygons.flat();
  if (rings.length > MAX_RINGS_PER_FEATURE || rings.length * 4 > maxOutputCoordinates) {
    throw codedError(`invalid OGC ${errorLabel} geometry size`, 'INVALID_OGC_GEOMETRY');
  }
  const current = rings.reduce((sum, item) => sum + item.length, 0);
  if (current <= maxOutputCoordinates) return polygons;
  const base = rings.length * 4;
  const available = maxOutputCoordinates - base;
  const weights = rings.map((item) => Math.max(0, item.length - 4));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const limits = weights.map((weight) => 4 + Math.floor((available * weight) / totalWeight));
  let remaining = maxOutputCoordinates - limits.reduce((sum, limit) => sum + limit, 0);
  for (let index = 0; remaining > 0; index = (index + 1) % limits.length) {
    if (limits[index] < rings[index].length) { limits[index] += 1; remaining -= 1; }
  }
  let ringIndex = 0;
  return polygons.map((polygon) => polygon.map((item) => simplifyRing(item, limits[ringIndex++], budget)));
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
    throw codedError('invalid OGC polygon geometry', 'INVALID_OGC_GEOMETRY');
  }
  let ringCount = 0;
  let polygons = rawPolygons.map((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) throw codedError('invalid OGC geometry nesting', 'INVALID_OGC_GEOMETRY');
    ringCount += polygon.length;
    if (ringCount > MAX_RINGS_PER_FEATURE) throw codedError('invalid OGC geometry ring count', 'INVALID_OGC_GEOMETRY');
    return polygon.map((item) => ring(item, meter));
  });
  validatePolygonTopology(polygons, meter.topology);
  const maxOutputCoordinates = source.maxOutputCoordinatesPerFeature
    ?? (sourceId === 'vic-heritage' ? MAX_HERITAGE_OUTPUT_COORDINATES : null);
  if (maxOutputCoordinates !== null) {
    const simplified = simplifyPolygons(polygons, maxOutputCoordinates, meter.topology,
      sourceId === 'vic-heritage' ? 'heritage' : 'flood');
    if (simplified !== polygons) {
      validatePolygonTopology(simplified, meter.topology);
      meter.simplifiedFeatures += 1;
    }
    polygons = simplified;
  }
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
  if (sourceId === 'vic-ev-chargers') {
    const numberOfChargers = finiteNonNegative(input?.number_of_chargers);
    return {
      title: cleanText(input?.location, 180) || cleanText(input?.company, 180) || 'Victorian funded EV charger site',
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'reference', referenceOnly: true,
      ...(cleanText(input?.location, 180) ? { location: cleanText(input.location, 180) } : {}),
      ...(cleanText(input?.region, 120) ? { region: cleanText(input.region, 120) } : {}),
      ...(cleanText(input?.lead_organisation, 180) ? { leadOrganisation: cleanText(input.lead_organisation, 180) } : {}),
      ...(isoDate(input?.estimated_project_completion) ? { estimatedProjectCompletion: isoDate(input.estimated_project_completion) } : {}),
      ...(cleanText(input?.plug_type, 180) ? { plugType: cleanText(input.plug_type, 180) } : {}),
      ...(cleanText(input?.company, 180) ? { company: cleanText(input.company, 180) } : {}),
      ...(numberOfChargers === null ? {} : { numberOfChargers }),
      caveat: 'Reference government-funded site only; not occupancy, service, pricing or live availability.',
    };
  }
  if (sourceId === 'vic-renewable-facilities') {
    const sizeMw = finiteNonNegative(input?.size_mw);
    const turbines = finiteNonNegative(input?.turbines);
    return {
      title: cleanText(input?.name, 180) || 'Victorian renewable facility area',
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'unknown', referenceOnly: true,
      ...(cleanText(input?.type, 120) ? { facilityType: cleanText(input.type, 120) } : {}),
      ...(cleanText(input?.approval_status, 120) ? { approvalStatus: cleanText(input.approval_status, 120) } : {}),
      ...(cleanText(input?.construction_status, 120) ? { constructionStatus: cleanText(input.construction_status, 120) } : {}),
      ...(cleanText(input?.lga, 120) ? { lga: cleanText(input.lga, 120) } : {}),
      ...(sizeMw === null ? {} : { sizeMw }),
      ...(turbines === null ? {} : { turbines }),
      ...(cleanText(input?.ancillary_battery, 120) ? { ancillaryBattery: cleanText(input.ancillary_battery, 120) } : {}),
      ...(typeof input?.ancillary_battery_size === 'number' && Number.isFinite(input.ancillary_battery_size)
        ? { ancillaryBatterySize: input.ancillary_battery_size }
        : cleanText(input?.ancillary_battery_size, 120) ? { ancillaryBatterySize: cleanText(input.ancillary_battery_size, 120) } : {}),
      caveat: 'Planning and infrastructure context only; not live generation or operating state.',
    };
  }
  if (sourceId === 'vic-flood-history-2022') {
    const subtype = typeof input?.subtype === 'number' && Number.isFinite(input.subtype)
      ? input.subtype : cleanText(input?.subtype, 80);
    return {
      title: cleanText(input?.label, 180) || 'October 2022 observed flood evidence',
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'historical', referenceOnly: true, historical: true,
      ...(subtype === '' ? {} : { subtype }),
      ...(isoDate(input?.obs_date) ? { observedAt: isoDate(input.obs_date) } : {}),
      ...(cleanText(input?.source, 180) ? { evidenceSource: cleanText(input.source, 180) } : {}),
      ...(cleanText(input?.label, 180) ? { label: cleanText(input.label, 180) } : {}),
      caveat: 'Historical and incomplete October 2022 observed evidence only; not current or peak extent, flash-flood coverage or warning.',
    };
  }
  if (sourceId === 'vic-epa-priority-sites') {
    const suburb = cleanText(input?.suburb, 120);
    const municipality = cleanText(input?.municipality, 120);
    return {
      title: `${suburb || municipality || 'Victorian'} priority site register area`,
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'reference', referenceOnly: true,
      ...(municipality ? { municipality } : {}), ...(suburb ? { suburb } : {}),
      ...(cleanText(input?.issue, 240) ? { issue: cleanText(input.issue, 240) } : {}),
      ...(isoDate(input?.data_extracted_on) ? { dataExtractedAt: isoDate(input.data_extracted_on) } : {}),
      caveat: 'Priority Sites Register footprint; absence does not mean land is uncontaminated or safe.',
    };
  }
  if (sourceId === 'vic-landfill-register') {
    const suburb = cleanText(input?.suburb, 120);
    const landfillName = knownText(input?.landfill_name, 180);
    return {
      title: landfillName || `${suburb || 'Victorian'} landfill register area`,
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'reference', referenceOnly: true,
      ...(suburb ? { suburb } : {}),
      ...(cleanText(input?.council, 180) ? { council: cleanText(input.council, 180) } : {}),
      ...(landfillName ? { landfillName } : {}),
      ...(cleanText(input?.operating_status, 120) ? { operatingStatus: cleanText(input.operating_status, 120) } : {}),
      ...(cleanText(input?.waste_type_accepted, 180) ? { wasteTypeAccepted: cleanText(input.waste_type_accepted, 180) } : {}),
      ...(cleanText(input?.estimated_year_of_closure, 80) ? { estimatedYearOfClosure: cleanText(input.estimated_year_of_closure, 80) } : {}),
      ...(cleanText(input?.estimated_total_waste_volume, 120) ? { estimatedTotalWasteVolume: cleanText(input.estimated_total_waste_volume, 120) } : {}),
      ...(isoDate(input?.data_extracted_on) ? { dataExtractedAt: isoDate(input.data_extracted_on) } : {}),
      caveat: 'Reference register with possible register lag; not current operation or safety evidence.',
    };
  }
  if (sourceId === 'vic-recreation-assets') {
    return {
      title: cleanText(input?.name, 180) || cleanText(input?.label, 180) || 'Victorian recreation asset',
      sourceId, source: 'State of Victoria (DataVic)', freshnessClass: 'reference', referenceOnly: true,
      ...(cleanText(input?.asset_cls, 120) ? { assetClass: cleanText(input.asset_cls, 120) } : {}),
      ...(cleanText(input?.category, 120) ? { category: cleanText(input.category, 120) } : {}),
      ...(cleanText(input?.dis_access, 120) ? { disabilityAccess: cleanText(input.dis_access, 120) } : {}),
      ...(cleanText(input?.label, 180) ? { label: cleanText(input.label, 180) } : {}),
      ...(cleanText(input?.published, 20) ? { published: cleanText(input.published, 20) } : {}),
      ...(isoDate(input?.vers_date) ? { versionDate: isoDate(input.vers_date) } : {}),
      ...(cleanText(input?.fac_type, 120) ? { facilityType: cleanText(input.fac_type, 120) } : {}),
      ...(cleanText(input?.type_, 120) ? { assetType: cleanText(input.type_, 120) } : {}),
      caveat: 'Public-land amenity inventory; inventory presence does not prove the asset is open or maintained.',
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

function normalizationMeter(sourceId) {
  const source = sourceConfig(sourceId);
  return {
    feature: 0,
    response: 0,
    simplifiedFeatures: 0,
    topology: { comparisons: 0, maxComparisons: source.maxTopologyComparisons ?? MAX_TOPOLOGY_COMPARISONS },
    maxInputCoordinatesPerFeature: source.maxInputCoordinatesPerFeature ?? MAX_INPUT_COORDINATES_PER_FEATURE,
    maxInputCoordinatesPerResponse: source.maxInputCoordinatesPerResponse ?? MAX_INPUT_COORDINATES_PER_RESPONSE,
  };
}

function outputCoordinateCount(features) {
  let count = 0;
  const stack = features.map((item) => item.geometry.coordinates);
  while (stack.length) {
    const value = stack.pop();
    if (!Array.isArray(value)) continue;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') count += 1;
    else for (const child of value) stack.push(child);
  }
  return count;
}

/** Normalize one WFS feature without retaining provider identifiers. */
export function normalizeOgcFeature(sourceId, row) {
  const normalized = normalizedFeature(sourceId, row, normalizationMeter(sourceId));
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
  const countCandidate = (value, allowUnknown = false) => {
    if (value === undefined || (allowUnknown && value === 'unknown')) return null;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw codedError('invalid OGC collection counts', 'INVALID_OGC_RESPONSE');
    }
    return value;
  };
  const numberMatched = countCandidate(payload.numberMatched, true);
  const totalFeatures = countCandidate(payload.totalFeatures, true);
  if ((numberMatched !== null && numberMatched < payload.features.length)
    || (totalFeatures !== null && totalFeatures < payload.features.length)
    || (numberMatched !== null && totalFeatures !== null && numberMatched !== totalFeatures)) {
    throw codedError('invalid OGC collection counts', 'INVALID_OGC_RESPONSE');
  }
  const matchedCandidate = numberMatched ?? totalFeatures;
  const capped = matchedCandidate === null
    ? payload.features.length === maxFeatures
    : matchedCandidate > payload.features.length;

  const meter = normalizationMeter(sourceId);
  const byIdentity = new Map();
  let invalidFeatures = 0;
  let duplicateFeatures = 0;
  for (let index = 0; index < payload.features.length; index += 1) {
    let normalized;
    try {
      normalized = normalizedFeature(sourceId, payload.features[index], meter);
    } catch (error) {
      if (error?.code !== 'INVALID_OGC_GEOMETRY') throw error;
      invalidFeatures += 1;
      continue;
    }
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
  if (features.length === 0 && (payload.features.length > 0 || (matchedCandidate !== null && matchedCandidate > 0))) {
    throw codedError('OGC response contained no valid features', 'INVALID_OGC_RESPONSE');
  }
  const partial = capped || invalidFeatures > 0 || duplicateFeatures > 0 || meter.simplifiedFeatures > 0;
  return {
    type: 'FeatureCollection', features,
    sourceStatus: {
      status: partial ? 'partial' : 'current',
      capped,
      ...(matchedCandidate === null ? {} : { numberMatched: matchedCandidate }),
      invalidFeatures,
      duplicateFeatures,
      coordinateCount: meter.response,
      outputCoordinateCount: outputCoordinateCount(features),
      simplifiedFeatures: meter.simplifiedFeatures,
    },
  };
}

export const OGC_GEOMETRY_LIMITS = Object.freeze({
  maxDepth: MAX_GEOMETRY_DEPTH,
  maxCoordinatesPerFeature: MAX_INPUT_COORDINATES_PER_FEATURE,
  maxCoordinatesPerResponse: MAX_INPUT_COORDINATES_PER_RESPONSE,
  maxHeritageOutputCoordinates: MAX_HERITAGE_OUTPUT_COORDINATES,
  maxTopologyComparisons: MAX_TOPOLOGY_COMPARISONS,
  floodHistory2022: Object.freeze({
    maxCoordinatesPerFeature: 60_000,
    maxCoordinatesPerResponse: 75_000,
    maxOutputCoordinatesPerFeature: 4_000,
    maxTopologyComparisons: 500_000,
  }),
});
