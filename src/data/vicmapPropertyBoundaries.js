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
const VICTORIA_EXTENT = Object.freeze({ west: 140.95, south: -39.25, east: 150, north: -33.9 });
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

function insideVictoria(bbox) {
  return bbox.east >= VICTORIA_EXTENT.west && bbox.west <= VICTORIA_EXTENT.east
    && bbox.north >= VICTORIA_EXTENT.south && bbox.south <= VICTORIA_EXTENT.north;
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

function ring(value, meter) {
  if (!Array.isArray(value) || value.length < 4) throw new Error('invalid Vicmap geometry');
  const normalized = value.map((item) => position(item, meter));
  if (!samePosition(normalized[0], normalized.at(-1))) throw new Error('invalid Vicmap geometry');
  const distinct = new Set(normalized.slice(0, -1).map((item) => `${item[0]},${item[1]}`));
  if (distinct.size < 3) throw new Error('invalid Vicmap geometry');
  return normalized;
}

function geometry(value, meter) {
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
    return polygon.map((item) => ring(item, meter));
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
export function vicmapParcelRequest(bbox) {
  if (!validBounds(bbox)) throw codedError('invalid Vicmap bounds', 'INVALID_VICMAP_BOUNDS');
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
export function normalizeVicmapParcelPayload(payload) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features) || payload.features.length > 501) {
    throw new Error('invalid Vicmap response');
  }
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
        geometry: geometry(row.geometry, meter),
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
  if (!unique.size && payload.features.length) throw new Error('invalid Vicmap response');
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
