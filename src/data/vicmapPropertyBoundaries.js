const PARCEL_QUERY_ENDPOINT = 'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query';
const PARCEL_FIELDS = Object.freeze([
  'OBJECTID',
  'parcel_pfi',
  'parcel_spi',
  'parcel_desc_type',
  'parcel_road',
  'parcel_lga_code',
  'parcel_crown_status',
  'parcel_status',
  'parv_horiz_pos_uncertainty',
]);
const VICTORIA_EXTENT = Object.freeze({ west: 140.93, south: -39.25, east: 150.02, north: -33.95 });
// Conservative simplification of the ABS ASGS 2021 Victoria state boundary,
// buffered below by roughly three kilometres so legitimate border/coastal
// parcels fail open at the geographic gate. It is an admission guard, not a
// legal boundary representation.
const VICTORIA_GATE_TOLERANCE_DEGREES = 0.03;
const VICTORIA_COVERAGE_RINGS = Object.freeze([
  Object.freeze([
    [145.176, -38.397], [145.235, -38.41], [145.184, -38.375], [145.255, -38.223],
    [145.489, -38.233], [145.549, -38.372], [145.416, -38.407], [145.372, -38.536],
    [145.607, -38.679], [145.766, -38.667], [145.921, -38.91], [146.034, -38.813],
    [146.127, -38.834], [146.346, -39.125], [146.425, -39.131], [146.479, -38.792],
    [146.293, -38.905], [146.212, -38.693], [146.551, -38.704], [146.926, -38.594],
    [146.883, -38.635], [147.788, -37.955], [148.29, -37.811], [149.485, -37.775],
    [149.775, -37.558], [149.976, -37.505], [148.109, -36.801], [148.218, -36.598],
    [148.038, -36.39], [148.038, -36.141], [147.912, -35.995], [147.405, -35.943],
    [147.32, -36.061], [147.123, -35.994], [147.053, -36.108], [146.944, -36.116],
    [146.503, -35.958], [146.369, -36.051], [145.811, -35.992], [145.535, -35.802],
    [144.992, -35.852], [144.924, -35.989], [144.982, -36.072], [144.727, -36.118],
    [143.97, -35.5], [143.62, -35.388], [143.571, -35.207], [143.395, -35.192],
    [143.322, -35.037], [143.348, -34.792], [143.112, -34.681], [142.887, -34.68],
    [142.791, -34.546], [142.689, -34.617], [142.699, -34.725], [142.557, -34.775],
    [142.468, -34.564], [142.368, -34.53], [142.397, -34.338], [142.236, -34.307],
    [142.166, -34.152], [141.73, -34.091], [141.51, -34.216], [141.495, -34.155],
    [141.023, -34.06], [140.964, -33.981], [140.966, -38.056], [141.295, -38.221],
    [141.374, -38.387], [141.626, -38.406], [141.602, -38.313], [141.742, -38.253],
    [142.146, -38.391], [142.373, -38.349], [143.511, -38.858], [144.332, -38.323],
    [144.672, -38.265], [144.623, -38.251], [144.706, -38.21], [144.692, -38.12],
    [144.478, -38.164], [144.362, -38.105], [144.507, -38.091], [144.899, -37.84],
    [145.096, -38.021], [145.118, -38.144], [144.923, -38.349], [144.652, -38.304],
    [144.888, -38.499], [145.176, -38.397],
  ]),
  Object.freeze([[145.161, -38.472], [145.116, -38.518], [145.361, -38.566], [145.299, -38.451], [145.161, -38.472]]),
  Object.freeze([[145.277, -38.388], [145.27, -38.409], [145.353, -38.42], [145.503, -38.353], [145.452, -38.307], [145.297, -38.282], [145.277, -38.388]]),
  Object.freeze([[146.568, -38.742], [146.501, -38.763], [146.465, -38.739], [146.545, -38.791], [146.668, -38.748], [146.568, -38.742]]),
]);
const MAX_SPAN_METRES = 750;
const MAX_AREA_SQUARE_METRES = 250_000;
const EARTH_METRES_PER_DEGREE = 111_320;
const MAX_FEATURES = 500;
const MAX_COORDINATES_PER_FEATURE = 5_000;
const MAX_COORDINATES_PER_RESPONSE = 50_000;
const MAX_RINGS_PER_FEATURE = 128;
const MAX_TEXT = 180;
const PARCEL_CAVEAT = 'Reference parcel geometry only; not a survey or legal boundary determination.';

function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validBounds(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west >= -180 && bbox.east <= 180 && bbox.south >= -90 && bbox.north <= 90
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

function pointInBounds(point, bbox) {
  return point[0] >= bbox.west && point[0] <= bbox.east
    && point[1] >= bbox.south && point[1] <= bbox.north;
}

function orientation(left, middle, right) {
  const cross = (middle[1] - left[1]) * (right[0] - middle[0])
    - (middle[0] - left[0]) * (right[1] - middle[1]);
  if (Math.abs(cross) <= 1e-12) return 0;
  return cross > 0 ? 1 : -1;
}

function pointOnSegment(point, left, right) {
  return orientation(left, point, right) === 0
    && point[0] >= Math.min(left[0], right[0]) && point[0] <= Math.max(left[0], right[0])
    && point[1] >= Math.min(left[1], right[1]) && point[1] <= Math.max(left[1], right[1]);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return (abC === 0 && pointOnSegment(c, a, b))
    || (abD === 0 && pointOnSegment(d, a, b))
    || (cdA === 0 && pointOnSegment(a, c, d))
    || (cdB === 0 && pointOnSegment(b, c, d));
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const left = ring[previous];
    const right = ring[index];
    if (pointOnSegment(point, left, right)) return true;
    if ((right[1] > point[1]) !== (left[1] > point[1])
      && point[0] < ((left[0] - right[0]) * (point[1] - right[1])) / (left[1] - right[1]) + right[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function ringIntersectsBounds(ring, bbox) {
  const corners = [
    [bbox.west, bbox.south], [bbox.east, bbox.south],
    [bbox.east, bbox.north], [bbox.west, bbox.north],
  ];
  if (corners.some((corner) => pointInRing(corner, ring)) || ring.some((point) => pointInBounds(point, bbox))) return true;
  const edges = corners.map((corner, index) => [corner, corners[(index + 1) % corners.length]]);
  for (let index = 0; index < ring.length - 1; index += 1) {
    if (edges.some(([left, right]) => segmentsIntersect(ring[index], ring[index + 1], left, right))) return true;
  }
  return false;
}

function insideVictoria(bbox) {
  if (bbox.east < VICTORIA_EXTENT.west || bbox.west > VICTORIA_EXTENT.east
    || bbox.north < VICTORIA_EXTENT.south || bbox.south > VICTORIA_EXTENT.north) return false;
  const buffered = {
    west: bbox.west - VICTORIA_GATE_TOLERANCE_DEGREES,
    south: bbox.south - VICTORIA_GATE_TOLERANCE_DEGREES,
    east: bbox.east + VICTORIA_GATE_TOLERANCE_DEGREES,
    north: bbox.north + VICTORIA_GATE_TOLERANCE_DEGREES,
  };
  return VICTORIA_COVERAGE_RINGS.some((ringValue) => ringIntersectsBounds(ringValue, buffered));
}

function bboxMetres(bbox) {
  const midLatitudeRadians = ((bbox.south + bbox.north) / 2) * Math.PI / 180;
  const width = (bbox.east - bbox.west) * EARTH_METRES_PER_DEGREE * Math.cos(midLatitudeRadians);
  const height = (bbox.north - bbox.south) * EARTH_METRES_PER_DEGREE;
  return { width, height, area: width * height };
}

function cleanText(value, maxLength = MAX_TEXT) {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function cleanNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function position(value, meter) {
  if (!Array.isArray(value) || value.length < 2 || value.some(Array.isArray)) throw new Error('invalid Vicmap geometry');
  const longitude = value[0];
  const latitude = value[1];
  if (typeof longitude !== 'number' || typeof latitude !== 'number'
    || !Number.isFinite(longitude) || !Number.isFinite(latitude)
    || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error('invalid Vicmap geometry');
  }
  meter.feature += 1;
  meter.response += 1;
  if (meter.feature > MAX_COORDINATES_PER_FEATURE || meter.response > MAX_COORDINATES_PER_RESPONSE) {
    throw new Error('Vicmap geometry exceeded limit');
  }
  return [longitude, latitude];
}

function samePosition(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function ringArea(value) {
  let area = 0;
  for (let index = 0; index < value.length - 1; index += 1) {
    area += value[index][0] * value[index + 1][1] - value[index + 1][0] * value[index][1];
  }
  return area / 2;
}

function ringSelfIntersects(value) {
  const segments = value.length - 1;
  for (let left = 0; left < segments; left += 1) {
    for (let right = left + 1; right < segments; right += 1) {
      if (right === left + 1 || (left === 0 && right === segments - 1)) continue;
      if (segmentsIntersect(value[left], value[left + 1], value[right], value[right + 1])) return true;
    }
  }
  return false;
}

function ringsIntersect(left, right) {
  for (let leftIndex = 0; leftIndex < left.length - 1; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length - 1; rightIndex += 1) {
      if (segmentsIntersect(left[leftIndex], left[leftIndex + 1], right[rightIndex], right[rightIndex + 1])) return true;
    }
  }
  return false;
}

function ring(value, meter) {
  if (!Array.isArray(value) || value.length < 4) throw new Error('invalid Vicmap geometry');
  const normalized = value.map((item) => position(item, meter));
  if (!samePosition(normalized[0], normalized.at(-1))) throw new Error('invalid Vicmap geometry');
  for (let index = 1; index < normalized.length; index += 1) {
    if (samePosition(normalized[index - 1], normalized[index])) throw new Error('invalid Vicmap geometry');
  }
  const distinct = new Set(normalized.slice(0, -1).map((item) => `${item[0]},${item[1]}`));
  if (distinct.size < 3 || Math.abs(ringArea(normalized)) <= 1e-12 || ringSelfIntersects(normalized)) {
    throw new Error('invalid Vicmap geometry');
  }
  return normalized;
}

function geometry(value, meter, bbox) {
  if (!value || !['Polygon', 'MultiPolygon'].includes(value.type) || !Array.isArray(value.coordinates)) {
    throw new Error('invalid Vicmap geometry');
  }
  const polygons = value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  if (!polygons.length) throw new Error('invalid Vicmap geometry');
  let rings = 0;
  const normalized = polygons.map((polygon) => {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('invalid Vicmap geometry');
    rings += polygon.length;
    if (rings > MAX_RINGS_PER_FEATURE) throw new Error('Vicmap geometry exceeded limit');
    const normalizedRings = polygon.map((item) => ring(item, meter));
    const [outer, ...holes] = normalizedRings;
    if (!ringIntersectsBounds(outer, bbox)) throw new Error('Vicmap geometry is outside the requested viewport');
    for (let index = 0; index < holes.length; index += 1) {
      const hole = holes[index];
      if (!pointInRing(hole[0], outer) || ringsIntersect(outer, hole)) throw new Error('invalid Vicmap geometry');
      for (let previous = 0; previous < index; previous += 1) {
        if (ringsIntersect(holes[previous], hole)
          || pointInRing(hole[0], holes[previous]) || pointInRing(holes[previous][0], hole)) {
          throw new Error('invalid Vicmap geometry');
        }
      }
    }
    return normalizedRings;
  });
  return value.type === 'Polygon'
    ? { type: 'Polygon', coordinates: normalized[0] }
    : { type: 'MultiPolygon', coordinates: normalized };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
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

function publicProperties(input) {
  const parcelPfi = cleanText(input?.parcel_pfi);
  const parcelSpi = cleanText(input?.parcel_spi);
  const properties = {
    sourceId: 'vic-property-boundaries',
    title: parcelSpi ? `Vicmap parcel ${parcelSpi}` : parcelPfi ? `Vicmap parcel ${parcelPfi}` : 'Vicmap parcel',
    ...(parcelPfi ? { parcelPfi } : {}),
    ...(parcelSpi ? { parcelSpi } : {}),
    ...(cleanText(input?.parcel_desc_type, 80) ? { descriptionType: cleanText(input.parcel_desc_type, 80) } : {}),
    ...(cleanText(input?.parcel_road, 20) ? { roadParcel: cleanText(input.parcel_road, 20) } : {}),
    ...(cleanText(input?.parcel_lga_code, 40) ? { lgaCode: cleanText(input.parcel_lga_code, 40) } : {}),
    ...(cleanText(input?.parcel_crown_status, 80) ? { crownStatus: cleanText(input.parcel_crown_status, 80) } : {}),
    ...(cleanText(input?.parcel_status, 40) ? { status: cleanText(input.parcel_status, 40) } : {}),
    ...(cleanNumber(input?.parv_horiz_pos_uncertainty) === null
      ? {} : { horizontalPositionUncertaintyMetres: cleanNumber(input.parv_horiz_pos_uncertainty) }),
    referenceOnly: true,
    caveat: PARCEL_CAVEAT,
  };
  return properties;
}

/** Build the sole high-zoom cadastral request from a validated map viewport. */
export function vicmapParcelRequest(bbox, zoom) {
  if (!validBounds(bbox)) throw codedError('invalid Vicmap bounds', 'INVALID_VICMAP_BOUNDS');
  if (zoom === undefined) {
    throw codedError('zoom in to view Vicmap property boundaries', 'VICMAP_ZOOM_REQUIRED');
  }
  if (typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom < 0 || zoom > 30) {
    throw codedError('invalid Vicmap zoom', 'INVALID_VICMAP_ZOOM');
  }
  if (zoom < 18) throw codedError('zoom in to view Vicmap property boundaries', 'VICMAP_ZOOM_REQUIRED');
  if (!insideVictoria(bbox)) throw codedError('Vicmap bounds are outside Victoria', 'OUTSIDE_VICMAP_COVERAGE');
  const size = bboxMetres(bbox);
  if (size.width > MAX_SPAN_METRES || size.height > MAX_SPAN_METRES || size.area > MAX_AREA_SQUARE_METRES) {
    throw codedError('zoom in to view Vicmap property boundaries', 'VICMAP_ZOOM_REQUIRED');
  }
  const url = new URL(PARCEL_QUERY_ENDPOINT);
  url.search = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: PARCEL_FIELDS.join(','),
    returnGeometry: 'true',
    returnZ: 'false',
    returnM: 'false',
    orderByFields: 'OBJECTID ASC',
    resultRecordCount: '501',
  }).toString();
  return url;
}

/** Sanitize one bounded Vicmap GeoJSON response without provider object IDs. */
export function normalizeVicmapParcelPayload(payload, { bbox } = {}) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features) || payload.features.length > 501) {
    throw codedError('invalid Vicmap response', 'INVALID_VICMAP_RESPONSE');
  }
  if (!validBounds(bbox) || !insideVictoria(bbox)) throw codedError('invalid Vicmap response scope', 'INVALID_VICMAP_RESPONSE');
  if (payload.features.length === 501) {
    return {
      type: 'FeatureCollection', features: [],
      sourceStatus: { status: 'zoom-required', capped: true, matchedAtLeast: 501 },
    };
  }
  const meter = { feature: 0, response: 0 };
  const unique = new Map();
  let invalidFeatures = 0;
  let duplicateFeatures = 0;
  for (const row of payload.features) {
    meter.feature = 0;
    try {
      if (row?.type !== 'Feature' || !row.properties || typeof row.properties !== 'object') {
        throw new Error('invalid Vicmap feature');
      }
      const normalized = {
        type: 'Feature',
        geometry: geometry(row.geometry, meter, bbox),
        properties: publicProperties(row.properties),
      };
      const canonical = JSON.stringify(stableValue(normalized));
      if (unique.has(canonical)) {
        duplicateFeatures += 1;
        continue;
      }
      unique.set(canonical, { ...normalized, id: `vic-property-boundaries-${publicDigest(canonical)}` });
    } catch (error) {
      if (String(error?.message).includes('exceeded limit') && meter.response > MAX_COORDINATES_PER_RESPONSE) throw error;
      invalidFeatures += 1;
    }
  }
  if (!unique.size && payload.features.length) throw codedError('invalid Vicmap response', 'INVALID_VICMAP_RESPONSE');
  const features = [...unique.values()].sort((left, right) => left.id.localeCompare(right.id));
  const partial = invalidFeatures > 0 || duplicateFeatures > 0;
  return {
    type: 'FeatureCollection', features,
    sourceStatus: {
      status: partial ? 'partial' : 'current',
      capped: false,
      featureCount: features.length,
      coordinateCount: meter.response,
      invalidFeatures,
      duplicateFeatures,
    },
  };
}
