import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA_CREDITS } from './dataCredits.js';

let vicmap = {};
try {
  vicmap = await import('./vicmapPropertyBoundaries.js');
} catch {
  // The first TDD run intentionally exercises the missing implementation.
}

const MELBOURNE_BLOCK = Object.freeze({ west: 144.96, south: -37.815, east: 144.965, north: -37.811 });

test('builds only a fixed high-zoom Vicmap parcel query with public fields', () => {
  assert.equal(typeof vicmap.vicmapParcelRequest, 'function');
  const url = vicmap.vicmapParcelRequest(MELBOURNE_BLOCK, 18);
  assert.equal(`${url.origin}${url.pathname}`, 'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query');
  assert.equal(url.searchParams.get('f'), 'geojson');
  assert.equal(url.searchParams.get('where'), '1=1');
  assert.equal(url.searchParams.get('geometry'), '144.96,-37.815,144.965,-37.811');
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryEnvelope');
  assert.equal(url.searchParams.get('inSR'), '4326');
  assert.equal(url.searchParams.get('outSR'), '4326');
  assert.equal(url.searchParams.get('spatialRel'), 'esriSpatialRelIntersects');
  assert.equal(url.searchParams.get('returnGeometry'), 'true');
  assert.equal(url.searchParams.get('returnZ'), 'false');
  assert.equal(url.searchParams.get('returnM'), 'false');
  assert.equal(url.searchParams.get('orderByFields'), 'OBJECTID ASC');
  assert.equal(url.searchParams.get('resultRecordCount'), '501');
  assert.equal(url.searchParams.get('outFields'), 'OBJECTID,parcel_pfi,parcel_spi,parcel_desc_type,parcel_road,parcel_lga_code,parcel_crown_status,parcel_status,parv_horiz_pos_uncertainty');
  assert.doesNotMatch(url.searchParams.get('outFields'), /owner|address|propnum|crefno|task_id|Shape__/i);
});

test('requires an independently validated zoom of 18 or closer', () => {
  assert.throws(() => vicmap.vicmapParcelRequest(MELBOURNE_BLOCK), { code: 'VICMAP_ZOOM_REQUIRED' });
  assert.throws(() => vicmap.vicmapParcelRequest(MELBOURNE_BLOCK, 17.999), { code: 'VICMAP_ZOOM_REQUIRED' });
  assert.throws(() => vicmap.vicmapParcelRequest(MELBOURNE_BLOCK, -1), { code: 'INVALID_VICMAP_ZOOM' });
  assert.throws(() => vicmap.vicmapParcelRequest(MELBOURNE_BLOCK, Number.NaN), { code: 'INVALID_VICMAP_ZOOM' });
  assert.doesNotThrow(() => vicmap.vicmapParcelRequest(MELBOURNE_BLOCK, 18));
  assert.doesNotThrow(() => vicmap.vicmapParcelRequest(MELBOURNE_BLOCK, 19.5));
});

test('rejects cadastral requests outside Victoria or larger than a map block', () => {
  assert.equal(typeof vicmap.vicmapParcelRequest, 'function');
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 144.9, south: -37.9, east: 145, north: -37.8 }, 18), /zoom in/i);
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 151.20, south: -33.87, east: 151.205, north: -33.866 }, 18), /outside Victoria/i);
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 149, south: -34.5, east: 149.004, north: -34.496 }, 18), /outside Victoria/i);
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 144.96, south: -37.815, east: 144.95, north: -37.811 }, 18), /invalid Vicmap bounds/i);
  for (const bbox of [
    { west: 141.468, south: -34.19, east: 141.472, north: -34.186 }, // Mildura
    { west: 145.397, south: -36.443, east: 145.401, north: -36.439 }, // Tatura
    { west: 143.848, south: -37.564, east: 143.852, north: -37.56 }, // Ballarat
    { west: 149.75, south: -37.566, east: 149.754, north: -37.562 }, // Mallacoota
  ]) assert.doesNotThrow(() => vicmap.vicmapParcelRequest(bbox, 18));
});

test('independently enforces the 750 metre span and 0.25 square kilometre area gates', () => {
  assert.doesNotThrow(() => vicmap.vicmapParcelRequest({
    west: 144.96, south: -37.815, east: 144.968414, north: -37.812036,
  }, 18));
  assert.throws(() => vicmap.vicmapParcelRequest({
    west: 144.96, south: -37.815, east: 144.968642, north: -37.812305,
  }, 18), { code: 'VICMAP_ZOOM_REQUIRED' });
  assert.throws(() => vicmap.vicmapParcelRequest({
    west: 144.96, south: -37.815, east: 144.965799, north: -37.810508,
  }, 18), { code: 'VICMAP_ZOOM_REQUIRED' });
});

test('normalizes bounded parcel polygons without exposing provider or address-adjacent IDs', () => {
  assert.equal(typeof vicmap.normalizeVicmapParcelPayload, 'function');
  const result = vicmap.normalizeVicmapParcelPayload({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', id: 13626,
      geometry: { type: 'Polygon', coordinates: [[
        [144.9613, -37.8119], [144.9614, -37.8122], [144.9610, -37.8122], [144.9613, -37.8119],
      ]] },
      properties: {
        OBJECTID: 13626,
        parcel_pfi: '455549767',
        parcel_spi: '6402\\PS801172',
        parcel_desc_type: '15',
        parcel_road: 'N',
        parcel_lga_code: '343',
        parcel_crown_status: null,
        parcel_status: 'A',
        parv_horiz_pos_uncertainty: 2.69,
        parcel_p_number: 'private-adjacent',
        parcel_crefno: 'private-reference',
        parcel_task_id: 'private-workflow',
        Shape__Area: 123,
      },
    }],
  }, { bbox: MELBOURNE_BLOCK });
  assert.equal(result.features.length, 1);
  assert.match(result.features[0].id, /^vic-property-boundaries-[0-9a-f]{24}$/);
  assert.deepEqual(result.features[0].properties, {
    sourceId: 'vic-property-boundaries',
    title: 'Vicmap parcel 6402\\PS801172',
    parcelPfi: '455549767',
    parcelSpi: '6402\\PS801172',
    descriptionType: '15',
    roadParcel: 'N',
    lgaCode: '343',
    status: 'A',
    horizontalPositionUncertaintyMetres: 2.69,
    referenceOnly: true,
    caveat: 'Reference parcel geometry only; not a survey or legal boundary determination.',
  });
  assert.deepEqual(result.sourceStatus, {
    status: 'current', capped: false, featureCount: 1, coordinateCount: 4, invalidFeatures: 0, duplicateFeatures: 0,
  });
  assert.doesNotMatch(JSON.stringify(result), /OBJECTID|private-|Shape__|parcel_p_number|parcel_crefno|task_id/i);
});

test('returns an explicit zoom-required result instead of truncating 501 parcels', () => {
  assert.equal(typeof vicmap.normalizeVicmapParcelPayload, 'function');
  const feature = {
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [[
      [144.96, -37.81], [144.961, -37.81], [144.961, -37.811], [144.96, -37.81],
    ]] }, properties: { OBJECTID: 1, parcel_spi: '1\\PS1' },
  };
  const result = vicmap.normalizeVicmapParcelPayload({
    type: 'FeatureCollection',
    features: Array.from({ length: 501 }, (_, index) => ({
      ...feature, id: index + 1, properties: { ...feature.properties, OBJECTID: index + 1 },
    })),
  }, { bbox: MELBOURNE_BLOCK });
  assert.deepEqual(result, {
    type: 'FeatureCollection', features: [],
    sourceStatus: { status: 'zoom-required', capped: true, matchedAtLeast: 501 },
  });
});

test('rejects zero-area, self-intersecting, detached-hole and out-of-scope rings', () => {
  const payload = (rings) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } }],
  });
  const invalidRings = [
    [[[144.961, -37.812], [144.962, -37.812], [144.963, -37.812], [144.961, -37.812]]],
    [[[144.961, -37.813], [144.963, -37.811], [144.961, -37.811], [144.963, -37.813], [144.961, -37.813]]],
    [
      [[144.961, -37.813], [144.964, -37.813], [144.964, -37.811], [144.961, -37.813]],
      [[144.965, -37.814], [144.966, -37.814], [144.966, -37.813], [144.965, -37.814]],
    ],
    [[[149, -34.5], [149.001, -34.5], [149.001, -34.499], [149, -34.5]]],
  ];
  for (const rings of invalidRings) {
    assert.throws(
      () => vicmap.normalizeVicmapParcelPayload(payload(rings), { bbox: MELBOURNE_BLOCK }),
      { code: 'INVALID_VICMAP_RESPONSE' },
    );
  }
});

test('accepts a live Ballarat parcel with near-collinear non-touching edges', () => {
  const bbox = { west: 143.848, south: -37.564, east: 143.85, north: -37.562 };
  const ring = [
    [143.847675461767, -37.5636757347969], [143.847684518582, -37.5636227721948],
    [143.847702528905, -37.5635324740685], [143.847855361081, -37.5635502631143],
    [143.847986857371, -37.5635656510413], [143.847988256946, -37.5635658169546],
    [143.84826834716, -37.5635988856772], [143.848266823617, -37.5636070538773],
    [143.848251612444, -37.5636885991109], [143.848249743949, -37.5636986037375],
    [143.847757275832, -37.5636402336651], [143.847748053727, -37.5636852331412],
    [143.847675461767, -37.5636757347969],
  ];
  const result = vicmap.normalizeVicmapParcelPayload({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { OBJECTID: 3434946 }, geometry: { type: 'Polygon', coordinates: [ring] } }],
  }, { bbox });
  assert.equal(result.sourceStatus.status, 'current');
  assert.equal(result.features.length, 1);
});

test('publishes Vicmap Property attribution in the canonical display credit list', () => {
  const credit = DATA_CREDITS.find(({ key }) => key === 'vic-property-boundaries');
  assert.ok(credit);
  assert.match(credit.html, /State of Victoria.*Vicmap Property.*Creative Commons Attribution 4\.0 International/i);
});
