const MAX_TEXT_LENGTH = 512;

export const REGIONAL_SOURCES = Object.freeze({
  'melbourne-trees': Object.freeze({
    name: 'Melbourne Urban Forest', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily', credit: 'City of Melbourne Open Data', credential: 'none',
  }),
  'melbourne-places': Object.freeze({
    name: 'Melbourne Public Places', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'point', refreshMs: 86_400_000, refresh: 'daily', credit: 'City of Melbourne Open Data', credential: 'none',
  }),
  'melbourne-cycling': Object.freeze({
    name: 'Melbourne Cycling Network', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'line', refreshMs: 86_400_000, refresh: 'daily', credit: 'City of Melbourne Open Data', credential: 'none',
  }),
  'melbourne-water-history': Object.freeze({
    name: 'Melbourne Water History', source: 'City of Melbourne Open Data', publisher: 'City of Melbourne',
    endpoint: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/', licence: 'CC BY (as declared by the selected dataset)',
    geometry: 'line-or-polygon', refreshMs: 604_800_000, refresh: 'weekly', credit: 'City of Melbourne Open Data', credential: 'none',
  }),
  'vic-epa-air': Object.freeze({
    name: 'Victoria Air Quality', source: 'EPA Victoria', publisher: 'Environment Protection Authority Victoria',
    endpoint: 'https://www.epa.vic.gov.au/for-community/monitoring-your-environment/monitoring-victorias-water-quality', licence: 'EPA Victoria terms',
    geometry: 'point', refreshMs: 300_000, refresh: 'five minutes; upstream observations update hourly', credit: 'EPA Victoria', credential: 'none',
  }),
  'vic-cfa-alerts': Object.freeze({
    name: 'Victoria Fire Alerts', source: 'VicEmergency', publisher: 'Emergency Management Victoria',
    endpoint: 'https://www.emergency.vic.gov.au/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'point when an RSS item is geolocated', refreshMs: 300_000, refresh: 'five minutes', credit: 'VicEmergency / Emergency Management Victoria', credential: 'none',
  }),
  'vic-fire-context': Object.freeze({
    name: 'Victoria Fire Context', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://discover.data.vic.gov.au/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'polygon-or-line', refreshMs: 86_400_000, refresh: 'daily viewport query', credit: 'State of Victoria (DataVic)', credential: 'none',
  }),
  'vic-freight-network': Object.freeze({
    name: 'Victorian Freight Network', source: 'DataVic', publisher: 'State of Victoria',
    endpoint: 'https://discover.data.vic.gov.au/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'line-or-point', refreshMs: 86_400_000, refresh: 'daily viewport query', credit: 'State of Victoria (DataVic)', credential: 'none',
  }),
  'au-hydrology': Object.freeze({
    name: 'Australian Hydrology', source: 'Australian Hydrological Geospatial Fabric', publisher: 'Bureau of Meteorology / Geoscience Australia',
    endpoint: 'https://www.bom.gov.au/water/geofabric/', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'line-or-polygon', refreshMs: 604_800_000, refresh: 'weekly viewport query', credit: 'Bureau of Meteorology / Geoscience Australia', credential: 'none',
  }),
  'ptv-transit': Object.freeze({
    name: 'PTV Transit', source: 'PTV Timetable API', publisher: 'Public Transport Victoria',
    endpoint: 'https://timetableapi.ptv.vic.gov.au/swagger/ui/index', licence: 'Creative Commons Attribution 4.0 International',
    geometry: 'point', refreshMs: 60_000, refresh: 'one minute when server credentials are configured', credit: 'Source: Licensed from Public Transport Victoria under a Creative Commons Attribution 4.0 International Licence.', credential: 'server-required',
  }),
});

function sourceFor(sourceId) {
  const source = REGIONAL_SOURCES[sourceId];
  if (!source) throw new Error(`Unknown regional source: ${sourceId}`);
  return source;
}

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function coordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && coordinate(value[0], -180, 180) !== null && coordinate(value[1], -90, 90) !== null;
}

function validCoordinates(type, coordinates) {
  if (type === 'Point') return validPosition(coordinates);
  if (!Array.isArray(coordinates) || !coordinates.length) return false;
  if (type === 'LineString' || type === 'MultiPoint') return coordinates.every(validPosition);
  if (type === 'Polygon' || type === 'MultiLineString') return coordinates.every((part) => Array.isArray(part) && part.length && part.every(validPosition));
  if (type === 'MultiPolygon') return coordinates.every((polygon) => Array.isArray(polygon) && polygon.length
    && polygon.every((ring) => Array.isArray(ring) && ring.length && ring.every(validPosition)));
  return false;
}

function normalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object' || !validCoordinates(geometry.type, geometry.coordinates)) return null;
  return { type: geometry.type, coordinates: geometry.coordinates };
}

function propertiesFor(row, title) {
  const properties = { title: cleanText(title, 180) || 'Untitled feature' };
  for (const key of ['category', 'type', 'status', 'aqi', 'description']) {
    const value = row?.[key];
    if (key === 'aqi' && Number.isFinite(Number(value))) properties.aqi = Number(value);
    else if (key === 'description' && cleanText(value)) properties.description = cleanText(value);
    else if (key !== 'aqi' && cleanText(value, 180)) properties[key] = cleanText(value, 180);
  }
  const url = safeUrl(row?.url || row?.link);
  if (url) properties.url = url;
  return properties;
}

function feature(id, geometry, properties) {
  return { type: 'Feature', ...(id === undefined || id === null || id === '' ? {} : { id: String(id) }), geometry, properties };
}

function recordFeatures(sourceId, payload) {
  if (!Array.isArray(payload?.results)) throw new Error(`${sourceId} payload must contain a results array`);
  return payload.results.flatMap(({ record } = {}) => {
    const fields = record?.fields;
    const longitude = coordinate(fields?.longitude ?? fields?.lon, -180, 180);
    const latitude = coordinate(fields?.latitude ?? fields?.lat, -90, 90);
    if (longitude === null || latitude === null) return [];
    return [feature(record?.id ?? fields?.id, { type: 'Point', coordinates: [longitude, latitude] }, propertiesFor(fields,
      fields?.common_name || fields?.name || fields?.title || fields?.asset_name))];
  });
}

function geoJsonFeatures(payload) {
  const rows = payload?.type === 'FeatureCollection' ? payload.features : payload?.features;
  if (!Array.isArray(rows)) throw new Error('GeoJSON payload must contain a features array');
  return rows.flatMap((row) => {
    const geometry = normalizeGeometry(row?.geometry);
    if (!geometry) return [];
    const properties = row?.properties || {};
    return [feature(row?.id ?? properties.id ?? properties.objectid, geometry, propertiesFor(properties,
      properties.title || properties.name || properties.road_name || properties.label || properties.feature_name))];
  });
}

function epaFeatures(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : payload?.stations;
  if (!Array.isArray(rows)) throw new Error('vic-epa-air payload must contain a data or stations array');
  return rows.flatMap((row) => {
    const longitude = coordinate(row?.longitude ?? row?.lon, -180, 180);
    const latitude = coordinate(row?.latitude ?? row?.lat, -90, 90);
    if (longitude === null || latitude === null) return [];
    const name = cleanText(row?.stationName || row?.station_name || row?.name, 180) || 'EPA monitoring station';
    const aqi = Number.isFinite(Number(row?.aqi ?? row?.airQualityIndex)) ? Number(row.aqi ?? row.airQualityIndex) : null;
    return [feature(row?.stationId ?? row?.station_id ?? row?.id, { type: 'Point', coordinates: [longitude, latitude] },
      propertiesFor({ ...row, aqi }, aqi === null ? name : `${name} - AQI ${aqi}`))];
  });
}

function rssValue(item, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(item);
  return cleanText(match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

function rssFeatures(payload) {
  if (typeof payload !== 'string') throw new Error('vic-cfa-alerts payload must be an RSS string');
  const items = [...payload.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  if (!items.length) throw new Error('vic-cfa-alerts payload contains no complete RSS items');
  return items.flatMap((item) => {
    const point = rssValue(item, 'georss:point').split(/\s+/).map(Number);
    const latitude = coordinate(point[0], -90, 90);
    const longitude = coordinate(point[1], -180, 180);
    if (latitude === null || longitude === null) return [];
    return [feature(rssValue(item, 'guid') || rssValue(item, 'link'), { type: 'Point', coordinates: [longitude, latitude] },
      propertiesFor({ link: rssValue(item, 'link') }, rssValue(item, 'title') || 'VicEmergency alert'))];
  });
}

function ptvFeatures(payload) {
  if (!Array.isArray(payload?.stops)) throw new Error('ptv-transit payload must contain a stops array');
  return payload.stops.flatMap((stop) => {
    const longitude = coordinate(stop?.stop_longitude ?? stop?.longitude, -180, 180);
    const latitude = coordinate(stop?.stop_latitude ?? stop?.latitude, -90, 90);
    if (longitude === null || latitude === null) return [];
    return [feature(stop?.stop_id ?? stop?.id, { type: 'Point', coordinates: [longitude, latitude] }, propertiesFor({
      category: stop?.route_type, type: stop?.stop_type,
    }, stop?.stop_name || stop?.name || 'PTV stop'))];
  });
}

/** Convert one approved source's public payload into a bounded GeoJSON FeatureCollection. */
export function normalizeRegionalFeatureCollection(sourceId, payload) {
  sourceFor(sourceId);
  let features;
  if (['melbourne-trees', 'melbourne-places'].includes(sourceId)) features = recordFeatures(sourceId, payload);
  else if (sourceId === 'vic-epa-air') features = epaFeatures(payload);
  else if (sourceId === 'vic-cfa-alerts') features = rssFeatures(payload);
  else if (sourceId === 'ptv-transit') features = ptvFeatures(payload);
  else features = geoJsonFeatures(payload);
  return { type: 'FeatureCollection', features };
}

/** Return the source's required display attribution, or reject an unknown source. */
export function regionalSourceAttribution(sourceId) {
  return sourceFor(sourceId).credit;
}
