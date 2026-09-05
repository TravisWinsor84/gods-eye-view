const MAX_FEATURES = 1_000;
const PAGE_SIZE = 500;
const MAX_TEXT_LENGTH = 240;

const GA_SERVICES = Object.freeze({
  'au-emergency-facilities': Object.freeze({
    base: 'https://services.ga.gov.au/gis/rest/services/Emergency_Management_Facilities/MapServer',
    layers: Object.freeze([0, 1, 2, 3, 4, 5]),
    outFields: 'featuretype,class,facility_name,facility_operationalstatus,abs_suburb,facility_state,facility_attribute_source,facility_attribute_date,facility_source,facility_date,facility_spatial_confidence,facility_revised,validated',
  }),
  'au-health-facilities': Object.freeze({
    base: 'https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer',
    layers: Object.freeze([0, 1, 2]),
    outFields: 'operationalstatus,ga_class,organisation_name,suburb,state,nhsd_service_type,ga_source_date',
  }),
  'au-place-names': Object.freeze({
    base: 'https://services.ga.gov.au/gis/rest/services/Composite_Gazetteer_of_Australia/MapServer',
    layers: Object.freeze([0]),
    outFields: 'name,feature,category,theme,authority,supply_date',
  }),
});

export const GA_SOURCE_CREDITS = Object.freeze({
  'au-emergency-facilities': '© Commonwealth of Australia (Geoscience Australia) 2023. This material is released under the Creative Commons Attribution 4.0 International Licence. Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.',
  'au-health-facilities': '© Commonwealth of Australia (Geoscience Australia) 2025\nThis material is released under the Creative Commons Attribution 4.0 International Licence.\n\nIncorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.',
  'au-place-names': 'Geoscience Australia',
});

const LAYER_TYPES = Object.freeze({
  'au-emergency-facilities': Object.freeze({
    0: 'ambulance station',
    1: 'other emergency management facility',
    2: 'policing facility',
    3: 'metropolitan fire facility',
    4: 'rural or country fire facility',
    5: 'state emergency service',
  }),
  'au-health-facilities': Object.freeze({
    0: 'general practice',
    1: 'hospital',
    2: 'pharmacy',
  }),
  'au-place-names': Object.freeze({ 0: 'place name' }),
});

function sourceConfig(sourceId) {
  if (!Object.hasOwn(GA_SERVICES, sourceId)) throw new Error(`Unknown GA regional source: ${sourceId}`);
  return GA_SERVICES[sourceId];
}

function validBbox(bbox) {
  return bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every(Number.isFinite)
    && bbox.west >= -180 && bbox.east <= 180 && bbox.south >= -90 && bbox.north <= 90
    && bbox.west < bbox.east && bbox.south < bbox.north;
}

function validLimit(limit) {
  return Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_FEATURES;
}

function pageRequest(sourceId, layer, bbox, remaining, offset) {
  const source = sourceConfig(sourceId);
  if (!source.layers.includes(layer)) throw new Error(`unexpected GA layer ${layer} for ${sourceId}`);
  if (!validBbox(bbox)) throw new Error('invalid GA bounding box');
  if (!validLimit(remaining)) throw new Error('invalid GA page limit');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= MAX_FEATURES) throw new Error('invalid GA page offset');

  const url = new URL(`${source.base}/${layer}/query`);
  url.search = new URLSearchParams({
    f: 'geojson',
    where: '1=1',
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: source.outFields,
    returnGeometry: 'true',
    resultOffset: String(offset),
    resultRecordCount: String(Math.min(PAGE_SIZE, remaining)),
  }).toString();

  return Object.freeze({
    layer,
    offset,
    url,
    requestedCount: Math.min(PAGE_SIZE, remaining),
    nextPage(nextOffset, nextRemaining) {
      return pageRequest(sourceId, layer, bbox, nextRemaining, nextOffset);
    },
  });
}

/** Build one fixed first-page request per accepted ArcGIS sublayer. */
export function gaArcGisRequests(sourceId, bbox, limit) {
  const source = sourceConfig(sourceId);
  if (!validLimit(limit)) throw new Error('invalid GA feature limit');
  return source.layers.map((layer) => pageRequest(sourceId, layer, bbox, limit, 0));
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function coordinate(value, min, max) {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function pointGeometry(geometry) {
  if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null;
  const longitude = coordinate(geometry.coordinates[0], -180, 180);
  const latitude = coordinate(geometry.coordinates[1], -90, 90);
  return longitude === null || latitude === null
    ? null
    : { type: 'Point', coordinates: [longitude, latitude] };
}

function isoDate(value) {
  const timestamp = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) return '';
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return '';
  }
}

function setText(target, key, value, maxLength = MAX_TEXT_LENGTH) {
  const text = cleanText(value, maxLength);
  if (text) target[key] = text;
}

function setDate(target, value) {
  const date = isoDate(value);
  if (date) target.sourceDate = date;
}

function publicProperties(sourceId, layer, input) {
  const properties = {
    sourceId,
    source: 'Geoscience Australia',
    freshnessClass: 'reference',
    referenceOnly: true,
  };

  if (sourceId === 'au-emergency-facilities') {
    properties.title = cleanText(input?.facility_name, 180) || 'Emergency management facility';
    properties.facilityType = LAYER_TYPES[sourceId][layer];
    setText(properties, 'classification', input?.class || input?.featuretype, 120);
    setText(properties, 'status', input?.facility_operationalstatus, 80);
    setText(properties, 'locality', input?.abs_suburb, 120);
    setText(properties, 'state', input?.facility_state, 40);
    setText(properties, 'sourceName', input?.facility_source || input?.facility_attribute_source, 180);
    setText(properties, 'spatialConfidence', input?.facility_spatial_confidence, 80);
    setText(properties, 'referenceStatus', input?.validated, 40);
    setDate(properties, input?.facility_revised ?? input?.facility_date ?? input?.facility_attribute_date);
  } else if (sourceId === 'au-health-facilities') {
    properties.title = cleanText(input?.organisation_name, 180) || 'Health facility';
    properties.facilityType = LAYER_TYPES[sourceId][layer];
    setText(properties, 'classification', input?.ga_class, 120);
    setText(properties, 'serviceType', input?.nhsd_service_type, 120);
    setText(properties, 'status', input?.operationalstatus, 80);
    setText(properties, 'locality', input?.suburb, 120);
    setText(properties, 'state', input?.state, 40);
    setDate(properties, input?.ga_source_date);
  } else {
    properties.title = cleanText(input?.name, 180) || 'Australian place name';
    setText(properties, 'placeType', input?.feature, 120);
    setText(properties, 'category', input?.category, 120);
    setText(properties, 'theme', input?.theme, 120);
    setText(properties, 'authority', input?.authority, 120);
    setDate(properties, input?.supply_date);
  }
  return properties;
}

function featureId(sourceId, layer, geometry, properties) {
  const input = `${sourceId}|${layer}|${geometry.coordinates.join(',')}|${properties.title}|${properties.sourceDate || ''}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `ga-${sourceId.slice(3)}-${layer}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeFeature(sourceId, layer, row) {
  const geometry = pointGeometry(row?.geometry);
  if (!geometry) return null;
  const properties = publicProperties(sourceId, layer, row?.properties || {});
  return {
    type: 'Feature',
    id: featureId(sourceId, layer, geometry, properties),
    geometry,
    properties,
  };
}

/** Sanitize one source's paged ArcGIS responses into a bounded collection. */
export function normalizeGaRegionalPayload(sourceId, payloads) {
  const source = sourceConfig(sourceId);
  if (!Array.isArray(payloads) || payloads.length > source.layers.length) {
    throw new Error(`${sourceId} payloads must contain at most one entry per accepted layer`);
  }

  const byLayer = new Map();
  for (const entry of payloads) {
    if (!source.layers.includes(entry?.layer)) throw new Error(`unexpected GA layer ${entry?.layer} for ${sourceId}`);
    if (byLayer.has(entry.layer)) throw new Error(`duplicate GA layer ${entry.layer} for ${sourceId}`);
    byLayer.set(entry.layer, entry);
  }

  const features = [];
  const layers = [];
  let capped = false;
  for (const layer of source.layers) {
    const entry = byLayer.get(layer);
    const retainedFeatures = Array.isArray(entry?.payloads)
      && entry.payloads.some((payload) => Array.isArray(payload?.features) && payload.features.length > 0);
    if (!entry || (entry.error && !retainedFeatures)) {
      layers.push({
        layer,
        type: LAYER_TYPES[sourceId][layer],
        status: 'unavailable',
        featureCount: 0,
        ...(entry?.error ? { error: 'upstream-unavailable' } : {}),
      });
      continue;
    }
    if (!Array.isArray(entry.payloads) || entry.payloads.length > 2) {
      throw new Error(`${sourceId} layer ${layer} must contain bounded payload pages`);
    }
    for (const payload of entry.payloads) {
      if (!Array.isArray(payload?.features)) throw new Error(`${sourceId} layer ${layer} payload must contain a features array`);
    }
    if (features.length >= MAX_FEATURES && (entry.truncated || entry.error || entry.payloads.some((payload) => payload.features.length > 0))) {
      capped = true;
      layers.push({
        layer,
        type: LAYER_TYPES[sourceId][layer],
        status: 'capped',
        featureCount: 0,
        capped: true,
        unprocessed: true,
      });
      continue;
    }
    let featureCount = 0;
    let layerCapped = false;
    for (let payloadIndex = 0; payloadIndex < entry.payloads.length; payloadIndex += 1) {
      const payload = entry.payloads[payloadIndex];
      for (let rowIndex = 0; rowIndex < payload.features.length; rowIndex += 1) {
        if (features.length >= MAX_FEATURES) {
          capped = true;
          layerCapped = true;
          break;
        }
        const row = payload.features[rowIndex];
        const normalized = normalizeFeature(sourceId, layer, row);
        if (!normalized) continue;
        features.push(normalized);
        featureCount += 1;
      }
      if (features.length >= MAX_FEATURES) {
        if (featureCount < payload.features.length || payloadIndex < entry.payloads.length - 1 || entry.truncated) {
          capped = true;
          layerCapped = true;
        }
        break;
      }
    }
    if (entry.truncated) capped = true;
    const partial = Boolean(entry.truncated || entry.error || layerCapped);
    layers.push({
      layer,
      type: LAYER_TYPES[sourceId][layer],
      status: partial ? 'partial' : 'current',
      featureCount,
      ...(entry.error ? { error: 'upstream-unavailable' } : {}),
      ...(layerCapped ? { capped: true } : {}),
    });
  }

  const currentCount = layers.filter(({ status }) => status === 'current').length;
  const usableCount = layers.filter(({ status }) => status === 'current' || status === 'partial').length;
  const status = !capped && currentCount === layers.length ? 'current' : usableCount > 0 ? 'partial' : 'unavailable';
  return {
    type: 'FeatureCollection',
    features,
    sourceStatus: { status, layers, capped },
  };
}
