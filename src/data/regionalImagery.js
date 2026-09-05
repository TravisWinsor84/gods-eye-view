const WEB_MERCATOR_HALF_WORLD = 20_037_508.342789244;
const WEB_MERCATOR_MAX_LATITUDE = 85.05112878;

/**
 * Fixed server-side imagery contracts verified against provider metadata.
 *
 * Candidates intentionally omitted after verification on 2026-09-05:
 * - DEA `water_observations` is a style, not a WMS layer, and the matching
 *   published summary layers are marked deprecated.
 * - GA `DEM_SRTM_1Second/MapServer/WMSServer` returns HTTP 403.
 * - NSHA 2018 ArcGIS `show:0` is coast/state-border reference data, not a
 *   seismic-hazard raster.
 */
export const REGIONAL_IMAGERY_SOURCES = Object.freeze({
  'au-dea-land-cover': Object.freeze({
    kind: 'wms',
    base: 'https://ows.dea.ga.gov.au/',
    layer: 'ga_ls_landcover',
    style: 'level3',
    time: '2020-01-01',
    crs: 'EPSG:3857',
    freshnessClass: 'annual',
    attribution: 'Digital Earth Australia / Geoscience Australia (CC BY 4.0)',
  }),
});

function webMercatorX(longitude) {
  return longitude * WEB_MERCATOR_HALF_WORLD / 180;
}

function webMercatorY(latitude) {
  const clamped = Math.max(-WEB_MERCATOR_MAX_LATITUDE, Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude));
  return Math.log(Math.tan((90 + clamped) * Math.PI / 360)) / Math.PI * WEB_MERCATOR_HALF_WORLD;
}

/** Build the exact upstream request for a normalized local imagery request. */
export function buildRegionalImageryUrl(id, request) {
  const source = REGIONAL_IMAGERY_SOURCES[id];
  if (!source) throw new TypeError('unknown regional imagery source');

  const { west, south, east, north, width, height } = request || {};
  if (![west, south, east, north, width, height].every(Number.isFinite)) {
    throw new TypeError('invalid regional imagery request');
  }

  const url = new URL(source.base);
  url.search = new URLSearchParams({
    service: 'WMS',
    request: 'GetMap',
    version: '1.3.0',
    layers: source.layer,
    styles: source.style,
    format: 'image/png',
    transparent: 'true',
    crs: source.crs,
    bbox: [webMercatorX(west), webMercatorY(south), webMercatorX(east), webMercatorY(north)].join(','),
    width: String(width),
    height: String(height),
    time: source.time,
  }).toString();
  return url;
}
