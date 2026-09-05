import test from 'node:test';
import assert from 'node:assert/strict';

let vicmap = {};
try {
  vicmap = await import('./vicmapPropertyBoundaries.js');
} catch {
  // The first TDD run intentionally exercises the missing implementation.
}

const MELBOURNE_BLOCK = Object.freeze({ west: 144.96, south: -37.815, east: 144.965, north: -37.811 });

test('builds only a fixed high-zoom Vicmap parcel query with public fields', () => {
  assert.equal(typeof vicmap.vicmapParcelRequest, 'function');
  const url = vicmap.vicmapParcelRequest(MELBOURNE_BLOCK);
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

test('rejects cadastral requests outside Victoria or larger than a map block', () => {
  assert.equal(typeof vicmap.vicmapParcelRequest, 'function');
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 144.9, south: -37.9, east: 145, north: -37.8 }), /zoom in/i);
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 151.20, south: -33.87, east: 151.205, north: -33.866 }), /outside Victoria/i);
  assert.throws(() => vicmap.vicmapParcelRequest({ west: 144.96, south: -37.815, east: 144.95, north: -37.811 }), /invalid Vicmap bounds/i);
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
  });
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
  });
  assert.deepEqual(result, {
    type: 'FeatureCollection', features: [],
    sourceStatus: { status: 'zoom-required', capped: true, matchedAtLeast: 501 },
  });
});
