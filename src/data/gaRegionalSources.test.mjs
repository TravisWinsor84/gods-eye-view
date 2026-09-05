import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GA_SOURCE_CREDITS,
  gaArcGisRequests,
  normalizeGaRegionalPayload,
} from './gaRegionalSources.js';

const BBOX = Object.freeze({ west: 144, south: -38, east: 146, north: -37 });

function point(properties, coordinates = [144.96, -37.81], id = undefined) {
  return { type: 'Feature', ...(id === undefined ? {} : { id }), geometry: { type: 'Point', coordinates }, properties };
}

function layerPayload(layer, features, extra = {}) {
  return { layer, payloads: [{ type: 'FeatureCollection', features, ...extra }] };
}

test('queries every accepted emergency facility layer within the bbox', () => {
  const requests = gaArcGisRequests('au-emergency-facilities', BBOX, 1_000);
  assert.deepEqual(requests.map((request) => request.layer), [0, 1, 2, 3, 4, 5]);
  assert.ok(requests.every((request) => request.url.searchParams.get('geometry') === '144,-38,146,-37'));
  assert.ok(requests.every((request) => request.url.searchParams.get('geometryType') === 'esriGeometryEnvelope'));
  assert.ok(requests.every((request) => request.url.searchParams.get('inSR') === '4326'));
  assert.ok(requests.every((request) => request.url.searchParams.get('outSR') === '4326'));
  assert.ok(requests.every((request) => request.url.searchParams.get('returnGeometry') === 'true'));
  assert.ok(requests.every((request) => request.url.searchParams.get('f') === 'geojson'));
});

test('uses fixed minimal field allow-lists and never requests sensitive provider fields', () => {
  const sensitive = /objectid|gnaf_|nhsd_service_id|auth_id|comment_|address|postcode|contact/i;
  for (const sourceId of ['au-emergency-facilities', 'au-health-facilities', 'au-place-names']) {
    const requests = gaArcGisRequests(sourceId, BBOX, 1_000);
    for (const request of requests) {
      const fields = request.url.searchParams.get('outFields');
      assert.ok(fields && fields !== '*', `${sourceId}/${request.layer} needs a fixed field list`);
      assert.doesNotMatch(fields, sensitive);
      assert.match(request.url.href, /^https:\/\/services\.ga\.gov\.au\/gis\/rest\/services\//);
      assert.equal(request.url.searchParams.get('where'), '1=1');
      assert.equal(request.url.searchParams.get('resultOffset'), '0');
      assert.ok(Number(request.url.searchParams.get('resultRecordCount')) <= 500);
    }
  }
});

test('pagination remains on the fixed source and layer while enforcing request caps', () => {
  const [request] = gaArcGisRequests('au-place-names', BBOX, 1_000);
  const second = request.nextPage(500, 900);
  assert.equal(second.layer, 0);
  assert.equal(second.url.origin, 'https://services.ga.gov.au');
  assert.equal(second.url.pathname, '/gis/rest/services/Composite_Gazetteer_of_Australia/MapServer/0/query');
  assert.equal(second.url.searchParams.get('resultOffset'), '500');
  assert.equal(second.url.searchParams.get('resultRecordCount'), '500');
  assert.throws(() => request.nextPage(-1, 10), /invalid GA page offset/);
  assert.throws(() => request.nextPage(500, 1_001), /invalid GA page limit/);
  assert.throws(() => gaArcGisRequests('au-place-names', BBOX, 0), /invalid GA feature limit/);
  assert.throws(() => gaArcGisRequests('unknown', BBOX, 10), /Unknown GA regional source/);
});

test('health facilities remain reference data and strip capacity, waits, IDs and addresses', () => {
  const result = normalizeGaRegionalPayload('au-health-facilities', [layerPayload(1, [point({
    organisation_name: 'Royal Example Hospital',
    operationalstatus: 'Operational',
    ga_class: 'Hospital',
    nhsd_service_type: 'Public hospital',
    suburb: 'Melbourne',
    state: 'VIC',
    ga_source_date: 1_735_689_600_000,
    capacity: 999,
    waitTime: 3,
    address: '1 Private Street',
    objectid: 42,
    nhsd_service_id: 'secret-nhsd-id',
    gnaf_address_detail_pid: 'secret-gnaf-id',
    contact: 'private@example.invalid',
  }, undefined, 42)])]);

  const feature = result.features[0];
  assert.equal(feature.properties.title, 'Royal Example Hospital');
  assert.equal(feature.properties.facilityType, 'hospital');
  assert.equal(feature.properties.freshnessClass, 'reference');
  assert.equal(feature.properties.referenceOnly, true);
  assert.equal(feature.properties.locality, 'Melbourne');
  assert.equal(feature.properties.state, 'VIC');
  assert.equal(feature.properties.sourceDate, '2025-01-01T00:00:00.000Z');
  assert.equal('capacity' in feature.properties, false);
  assert.equal('waitTime' in feature.properties, false);
  assert.equal('address' in feature.properties, false);
  assert.doesNotMatch(JSON.stringify(feature), /secret-nhsd-id|secret-gnaf-id|Private Street|private@example/);
  assert.notEqual(feature.id, '42');
});

test('emergency facilities expose public reference status without operational inference or free text', () => {
  const result = normalizeGaRegionalPayload('au-emergency-facilities', [layerPayload(5, [point({
    facility_name: 'Example SES Unit',
    facility_operationalstatus: 'Operational',
    class: 'State Emergency Service',
    abs_suburb: 'Carlton',
    facility_state: 'VIC',
    facility_source: 'Geoscience Australia',
    facility_revised: 1_735_689_600_000,
    facility_spatial_confidence: 'High',
    validated: 'Yes',
    facility_address: '2 Private Road',
    comment_: 'staffing note',
    descripton: 'free text',
    gnaf_address_detail_pid: 'secret-gnaf-id',
  })])]);

  const properties = result.features[0].properties;
  assert.equal(properties.title, 'Example SES Unit');
  assert.equal(properties.facilityType, 'state emergency service');
  assert.equal(properties.freshnessClass, 'reference');
  assert.equal(properties.referenceOnly, true);
  assert.equal(properties.status, 'Operational');
  assert.equal(properties.spatialConfidence, 'High');
  assert.equal(properties.sourceDate, '2025-01-01T00:00:00.000Z');
  assert.equal('readiness' in properties, false);
  assert.equal('staffing' in properties, false);
  assert.doesNotMatch(JSON.stringify(properties), /Private Road|staffing note|free text|secret-gnaf-id/);
});

test('place names retain safe classification and provenance but strip provider identifiers', () => {
  const result = normalizeGaRegionalPayload('au-place-names', [layerPayload(0, [point({
    id: 'internal-id', auth_id: 'authority-secret', objectid: 9,
    name: 'Mount Example', feature: 'MOUNTAIN', category: 'PHYSICAL', theme: 'LAND',
    authority: 'VIC', supply_date: 1_735_689_600_000,
  }, undefined, 9)])]);
  const feature = result.features[0];
  assert.equal(feature.properties.title, 'Mount Example');
  assert.equal(feature.properties.placeType, 'MOUNTAIN');
  assert.equal(feature.properties.authority, 'VIC');
  assert.equal(feature.properties.sourceDate, '2025-01-01T00:00:00.000Z');
  assert.equal(feature.properties.freshnessClass, 'reference');
  assert.doesNotMatch(JSON.stringify(feature), /internal-id|authority-secret|objectid/);
  assert.notEqual(feature.id, '9');
});

test('reports partial sublayer failures without leaking provider errors or erasing successful layers', () => {
  const result = normalizeGaRegionalPayload('au-health-facilities', [
    layerPayload(0, [point({ organisation_name: 'Example GP', suburb: 'Richmond', state: 'VIC' })]),
    { layer: 1, error: new Error('upstream secret details') },
    layerPayload(2, [point({ organisation_name: 'Example Pharmacy', suburb: 'Richmond', state: 'VIC' }, [144.97, -37.82])]),
  ]);
  assert.equal(result.features.length, 2);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.deepEqual(result.sourceStatus.layers.map(({ layer, status }) => [layer, status]), [
    [0, 'current'], [1, 'unavailable'], [2, 'current'],
  ]);
  assert.doesNotMatch(JSON.stringify(result), /upstream secret details/);
});

test('marks a provider-truncated sublayer and source as partial', () => {
  const result = normalizeGaRegionalPayload('au-place-names', [{
    ...layerPayload(0, [point({ name: 'Example Place' })]),
    truncated: true,
  }]);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.layers[0].status, 'partial');
  assert.equal(result.sourceStatus.capped, true);
});

test('caps output features and rejects malformed or unexpected layer payloads', () => {
  const rows = Array.from({ length: 1_005 }, (_, index) => point({
    name: `Place ${index}`, feature: 'LOCALITY', authority: 'VIC',
  }, [144 + index / 100_000, -37.8]));
  const result = normalizeGaRegionalPayload('au-place-names', [layerPayload(0, rows)]);
  assert.equal(result.features.length, 1_000);
  assert.equal(result.sourceStatus.capped, true);
  assert.throws(
    () => normalizeGaRegionalPayload('au-place-names', [layerPayload(1, [])]),
    /unexpected GA layer/,
  );
  assert.throws(
    () => normalizeGaRegionalPayload('au-place-names', [{ layer: 0, payloads: [{ features: 'bad' }] }]),
    /must contain a features array/,
  );
});

test('does not read provider rows after the normalized feature cap', () => {
  const rows = Array.from({ length: 1_000 }, (_, index) => point({ name: `Place ${index}` }, [144.9, -37.8]));
  Object.defineProperty(rows, 1_000, {
    enumerable: true,
    get() { throw new Error('row beyond the feature cap was read'); },
  });
  rows.length = 1_001;
  const result = normalizeGaRegionalPayload('au-place-names', [layerPayload(0, rows)]);
  assert.equal(result.features.length, 1_000);
  assert.equal(result.sourceStatus.capped, true);
});

test('publishes exact GA and G-NAF attribution contracts', () => {
  assert.equal(
    GA_SOURCE_CREDITS['au-emergency-facilities'],
    '© Commonwealth of Australia (Geoscience Australia) 2023. This material is released under the Creative Commons Attribution 4.0 International Licence. Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.',
  );
  assert.equal(
    GA_SOURCE_CREDITS['au-health-facilities'],
    '© Commonwealth of Australia (Geoscience Australia) 2025\nThis material is released under the Creative Commons Attribution 4.0 International Licence.\n\nIncorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.',
  );
  assert.equal(GA_SOURCE_CREDITS['au-place-names'], 'Geoscience Australia');
});
