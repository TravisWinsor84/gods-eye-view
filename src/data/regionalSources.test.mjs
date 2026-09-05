import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CIVIC_SOURCE_VALIDATION,
  REGIONAL_SOURCES,
  normalizeRegionalFeatureCollection,
  regionalSourceAttribution,
} from './regionalSources.js';

test('registry declares the approved regional source IDs with immutable source contracts', () => {
  assert.deepEqual(Object.keys(REGIONAL_SOURCES), [
    'melbourne-trees',
    'melbourne-places',
    'melbourne-cycling',
    'melbourne-water-history',
    'vic-epa-air',
    'vic-cfa-alerts',
    'vic-fire-context',
    'vic-freight-network',
    'au-hydrology',
    'ptv-transit',
    'au-hospital-ed-performance',
  ]);
  assert.equal(Object.isFrozen(REGIONAL_SOURCES), true);
  assert.equal(Object.isFrozen(REGIONAL_SOURCES['melbourne-trees']), true);
  assert.equal(REGIONAL_SOURCES['melbourne-trees'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].refreshMs, 300_000);
  assert.equal(REGIONAL_SOURCES['ptv-transit'].serverCredential, 'TRANSPORT_VIC_OPEN_DATA_API_KEY');
  assert.match(REGIONAL_SOURCES['ptv-transit'].endpoint, /opendata\.transport\.vic\.gov\.au\/dataset\/gtfs-realtime/);
  assert.equal(REGIONAL_SOURCES['vic-cfa-alerts'].runtimeEligible, false);
  assert.ok(Number.isInteger(REGIONAL_SOURCES['melbourne-trees'].maxFeatures));
});

test('civic validation decisions keep executable and non-executable contracts separate', () => {
  const requiredFields = ['publisher', 'officialUrl', 'endpoint', 'licence', 'cacheMs', 'geometry', 'sensitivityReview', 'runtimeEligible'];
  for (const [sourceId, decision] of Object.entries(CIVIC_SOURCE_VALIDATION)) {
    assert.deepEqual(requiredFields.filter((field) => !Object.hasOwn(decision, field)), [], sourceId);
    assert.equal(Object.isFrozen(decision), true, sourceId);
  }
  const aihw = CIVIC_SOURCE_VALIDATION['au-hospital-ed-performance'];
  assert.equal(aihw.runtimeEligible, true);
  assert.equal(aihw.cacheMs, 86_400_000);
  assert.equal(aihw.credential, 'none');

  for (const sourceId of [
    'vahi-daily-ed-wait',
    'vahi-quarterly-emergency-care',
    'ambulance-victoria-quarterly-performance',
    'victraffic-cameras',
    'boating-vic-cameras',
    'gippsland-ports-webcams',
    'port-phillip-marina-webcam',
    'ffmvic-cameras',
    'bom-imagery',
  ]) {
    const decision = CIVIC_SOURCE_VALIDATION[sourceId];
    assert.equal(decision.runtimeEligible, false, sourceId);
    assert.equal(decision.endpoint, null, sourceId);
    assert.equal('request' in decision, false, sourceId);
    assert.equal('proxyRequest' in decision, false, sourceId);
  }
});

test('normalizes AIHW aggregate historical ED performance with provenance and freshness', () => {
  const result = normalizeRegionalFeatureCollection('au-hospital-ed-performance', {
    extract: {
      result: { data: [{
        reporting_unit_code: 'H9999',
        reporting_unit_name: 'Example Public Hospital',
        reporting_unit_type_code: 'H',
        measure_code: 'MYH0010',
        measure_name: 'Percentage of patients who commenced treatment within the recommended time',
        reported_measure_code: 'MYH-RM0037',
        reported_measure_name: 'Urgent presentations',
        reporting_start_date: '2024-07-01',
        reporting_end_date: '2025-06-30',
        value: 74.2,
        lower_value: 72.1,
        upper_value: 76.3,
        units_name: 'percent',
        units_display: '%',
        caveat: 'Preliminary annual result',
        caveat_codes: 'P',
        caveat_footnotes: 'Subject to revision',
      }] },
      version_information: {
        api_version: '1.6.4.0', data_version: 2026052802,
        date_uploaded: '2026-05-28T00:00:00', requested_time_stamp: '2026-09-05T12:00:00+10:00',
      },
    },
    reportingUnits: { result: [{
      reporting_unit_code: 'H9999', latitude: -37.81, longitude: 144.96,
    }] },
  });

  assert.deepEqual(result.features[0].geometry.coordinates, [144.96, -37.81]);
  assert.deepEqual(result.features[0].properties.reportingPeriod, { start: '2024-07-01', end: '2025-06-30' });
  assert.deepEqual(result.features[0].properties.freshness, {
    apiVersion: '1.6.4.0', dataVersion: 2026052802,
    uploadedAt: '2026-05-28T00:00:00', requestedAt: '2026-09-05T12:00:00+10:00',
  });
  assert.equal(result.features[0].properties.value, 74.2);
  assert.equal(result.features[0].properties.errorState, 'caveated');
  assert.deepEqual(result.features[0].properties.caveats, [{ code: 'P', label: 'Preliminary annual result', footnote: 'Subject to revision' }]);
  assert.equal(result.features[0].properties.sourceId, 'au-hospital-ed-performance');
  assert.equal(result.features[0].properties.source, 'Australian Institute of Health and Welfare');
  assert.equal(result.features[0].properties.officialUrl, 'https://www.aihw.gov.au/hospitals/other-resources/myhospitals-api');
  assert.equal(result.features[0].properties.context, 'aggregate historical ED performance');
});

test('never surfaces suppressed AIHW values as numbers', () => {
  const result = normalizeRegionalFeatureCollection('au-hospital-ed-performance', {
    extract: {
      result: { data: [{
        reporting_unit_code: 'H9999', reporting_unit_name: 'Example Public Hospital', reporting_unit_type_code: 'H',
        measure_code: 'MYH0011', measure_name: 'Number of patients presenting to the emergency department',
        reported_measure_code: 'MYH-RM0030', reported_measure_name: 'Resuscitation',
        reporting_start_date: '2024-07-01', reporting_end_date: '2025-06-30',
        value: 123, lower_value: 100, upper_value: 140, suppression: 'Suppressed',
        suppression_codes: 'NP', caveat_footnotes: 'Not published for confidentiality reasons',
      }] },
      version_information: { data_version: 2026052802, date_uploaded: '2026-05-28T00:00:00' },
    },
    reportingUnits: { result: [{ reporting_unit_code: 'H9999', latitude: -37.81, longitude: 144.96 }] },
  });

  const properties = result.features[0].properties;
  assert.equal(properties.suppressed, true);
  assert.equal(properties.errorState, 'suppressed');
  assert.equal('value' in properties, false);
  assert.equal('lowerValue' in properties, false);
  assert.equal('upperValue' in properties, false);
  assert.deepEqual(properties.caveats, [{ code: 'NP', label: 'Suppressed', footnote: 'Not published for confidentiality reasons' }]);
});

test('deduplicates mirrored AIHW suppression caveats while retaining distinct notices', () => {
  const result = normalizeRegionalFeatureCollection('au-hospital-ed-performance', {
    extract: {
      result: { data: [{
        reporting_unit_code: 'H9999', reporting_unit_name: 'Example Public Hospital', reporting_unit_type_code: 'H',
        measure_code: 'MYH0011', measure_name: 'Number of patients presenting to the emergency department',
        reported_measure_code: 'MYH-RM0030', reported_measure_name: 'Resuscitation',
        reporting_start_date: '2024-07-01', reporting_end_date: '2025-06-30', value: null,
        suppression: '<5', suppression_codes: 'X01', suppression_footnotes: '<5',
        caveat: '<5', caveat_codes: 'X01', caveat_footnotes: '<5',
        data_set_caveat: 'Data revised after publication', data_set_caveat_codes: 'R01',
        data_set_caveat_footnotes: 'Revision applies to this reporting period',
      }] },
      version_information: { data_version: 2026052802, date_uploaded: '2026-05-28T00:00:00' },
    },
    reportingUnits: { result: [{ reporting_unit_code: 'H9999', latitude: -37.81, longitude: 144.96 }] },
  });

  assert.deepEqual(result.features[0].properties.caveats, [
    { code: 'X01', label: '<5', footnote: '<5' },
    { code: 'R01', label: 'Data revised after publication', footnote: 'Revision applies to this reporting period' },
  ]);
});

test('rejected hospital and camera decisions fail closed before payload access', () => {
  const unreadablePayload = {
    get result() {
      throw new Error('payload must not be read');
    },
  };
  for (const [sourceId, source] of Object.entries(CIVIC_SOURCE_VALIDATION).filter(([, candidate]) => !candidate.runtimeEligible)) {
    assert.throws(
      () => normalizeRegionalFeatureCollection(sourceId, unreadablePayload),
      new RegExp(`${sourceId} is not runtime eligible: ${source.decision}`),
    );
  }
});

test('normalizes City of Melbourne tree records', () => {
  const result = normalizeRegionalFeatureCollection('melbourne-trees', {
    results: [{ record: { id: 'tree-1', fields: {
      common_name: 'River red gum', latitude: -37.81, longitude: 144.96,
    } } }],
  });
  assert.deepEqual(result.features[0].geometry.coordinates, [144.96, -37.81]);
  assert.equal(result.features[0].properties.title, 'River red gum');
  assert.equal(result.features[0].id, 'tree-1');
});

test('normalizes Melbourne place records and drops malformed coordinates', () => {
  const result = normalizeRegionalFeatureCollection('melbourne-places', {
    results: [
      { record: { id: 'tap-1', fields: {
        name: 'Birrarung Marr drinking fountain', latitude: '-37.818', longitude: '144.973', category: 'drinking fountain',
      } } },
      { record: { id: 'bad-range', fields: { name: 'No location', latitude: '-91', longitude: '144.9' } } },
      { record: { id: 'bad-blank', fields: { name: 'Blank location', latitude: '', longitude: '144.9' } } },
      { record: { id: 'bad-boolean', fields: { name: 'Boolean location', latitude: false, longitude: '144.9' } } },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.category, 'drinking fountain');
});

test('constrains GeoJSON features to registered geometry and bounded public properties', () => {
  const result = normalizeRegionalFeatureCollection('melbourne-cycling', {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', id: 'cycle-1', geometry: { type: 'LineString', coordinates: [[144.96, -37.81], [144.97, -37.82]] }, properties: {
        name: 'Capital City Trail', unsafe: '<script>alert(1)</script>', description: 'x'.repeat(2_000),
      } },
      { type: 'Feature', id: 'invalid-coordinate', geometry: { type: 'Point', coordinates: [999, -37.8] }, properties: { name: 'Invalid' } },
      { type: 'Feature', id: 'wrong-geometry', geometry: { type: 'Point', coordinates: [144.96, -37.8] }, properties: { name: 'Not a cycleway' } },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].geometry.coordinates[0], [144.96, -37.81]);
  assert.equal(result.features[0].properties.title, 'Capital City Trail');
  assert.equal(result.features[0].properties.description.length, 512);
  assert.equal('unsafe' in result.features[0].properties, false);
});

test('normalizes EPA station payloads with an AQI title and rejects missing or non-numeric positions', () => {
  const result = normalizeRegionalFeatureCollection('vic-epa-air', {
    data: [
      { stationId: 'melbourne', stationName: 'Melbourne CBD', latitude: -37.8136, longitude: 144.9631, aqi: 42, category: 'Good' },
      { stationId: 'missing', stationName: 'Missing position', aqi: 12 },
      { stationId: 'blank', stationName: 'Blank position', latitude: '', longitude: 144.9 },
      { stationId: 'boolean', stationName: 'Boolean position', latitude: -37.8, longitude: false },
    ],
  });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.title, 'Melbourne CBD - AQI 42');
  assert.equal(result.features[0].properties.aqi, 42);
});

test('rejects the restricted CFA/VicEmergency RSS source before parsing its payload', () => {
  assert.throws(
    () => normalizeRegionalFeatureCollection('vic-cfa-alerts', '<rss><channel><item/></channel></rss>'),
    /vic-cfa-alerts is not runtime eligible: restricted source terms/,
  );
});

test('normalizes fire context, freight, hydrology, and Transport Victoria vehicle payloads independently', () => {
  const fire = normalizeRegionalFeatureCollection('vic-fire-context', {
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Bushfire Prone Area' }, geometry: {
      type: 'Polygon', coordinates: [[[144.9, -37.9], [145, -37.9], [145, -37.8], [144.9, -37.9]]],
    } }],
  });
  const freight = normalizeRegionalFeatureCollection('vic-freight-network', {
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { road_name: 'Western Freeway' }, geometry: {
      type: 'LineString', coordinates: [[144.8, -37.9], [144.9, -37.8]],
    } }],
  });
  const hydrology = normalizeRegionalFeatureCollection('au-hydrology', {
    features: [{ type: 'Feature', properties: { name: 'Merri Creek' }, geometry: {
      type: 'LineString', coordinates: [[144.98, -37.7], [144.99, -37.8]],
    } }],
  });
  const transit = normalizeRegionalFeatureCollection('ptv-transit', {
    vehicles: [
      { entityId: 'entity-1', mode: 'metro', vehicleId: 'vehicle-1', tripId: 'trip-1', routeId: 'route-1', position: { latitude: -37.8183, longitude: 144.9671 }, timestamp: 1_800_000_000, feedTimestamp: 1_799_999_990, feedAgeSeconds: 10, stale: false, bearing: 90, occupancyStatus: 'MANY_SEATS_AVAILABLE' },
      { entityId: 'bad-range', mode: 'tram', position: { latitude: -91, longitude: 144.9 } },
      { entityId: 'bad-nan', mode: 'bus', position: { latitude: -37.8, longitude: Number.NaN } },
    ],
    modeStatus: { metro: { status: 'current', feedTimestamp: 1_799_999_990, feedAgeSeconds: 10 } },
  });
  assert.equal(fire.features[0].properties.title, 'Bushfire Prone Area');
  assert.equal(freight.features[0].properties.title, 'Western Freeway');
  assert.equal(hydrology.features[0].properties.title, 'Merri Creek');
  assert.deepEqual(transit.features[0].geometry.coordinates, [144.9671, -37.8183]);
  assert.equal(transit.features[0].properties.title, 'Metro vehicle');
  assert.equal(transit.features[0].properties.vehicleId, 'vehicle-1');
  assert.equal(transit.features[0].properties.tripId, 'trip-1');
  assert.equal(transit.features[0].properties.routeId, 'route-1');
  assert.equal(transit.features[0].properties.stale, false);
  assert.deepEqual(transit.modeStatus, { metro: { status: 'current', feedTimestamp: 1_799_999_990, feedAgeSeconds: 10 } });
});

test('unknown and inherited source IDs fail closed everywhere', () => {
  for (const sourceId of ['unknown-source', 'toString', 'constructor', '__proto__']) {
    assert.throws(() => normalizeRegionalFeatureCollection(sourceId, {}), new RegExp(`Unknown regional source: ${sourceId}`));
    assert.throws(() => regionalSourceAttribution(sourceId), new RegExp(`Unknown regional source: ${sourceId}`));
  }
});

test('malformed source payloads fail closed with descriptive errors', () => {
  assert.throws(
    () => normalizeRegionalFeatureCollection('melbourne-trees', { results: 'not-an-array' }),
    /melbourne-trees payload must contain a results array/,
  );
});

test('source-aware maxima cap valid normalized features at each source contract limit', () => {
  const source = REGIONAL_SOURCES['melbourne-places'];
  const result = normalizeRegionalFeatureCollection('melbourne-places', {
    results: Array.from({ length: source.maxFeatures + 2 }, (_, index) => ({ record: { id: `place-${index}`, fields: {
      name: `Place ${index}`, latitude: -37.8, longitude: 144.9,
    } } })),
  });
  assert.equal(result.features.length, source.maxFeatures);
  assert.equal(result.features.at(-1).id, `place-${source.maxFeatures - 1}`);
});

test('normalization stops before reading rows after a source feature cap', () => {
  const source = REGIONAL_SOURCES['melbourne-places'];
  const results = Array.from({ length: source.maxFeatures }, (_, index) => ({ record: { id: `place-${index}`, fields: {
    name: `Place ${index}`, latitude: -37.8, longitude: 144.9,
  } } }));
  results.push({
    get record() {
      throw new Error('rows after the feature cap must not be normalized');
    },
  });
  const result = normalizeRegionalFeatureCollection('melbourne-places', { results });
  assert.equal(result.features.length, source.maxFeatures);
});

test('attribution is exact, source-scoped, and rejects unknown IDs', () => {
  assert.equal(regionalSourceAttribution('melbourne-trees'), 'City of Melbourne Open Data');
  assert.equal(regionalSourceAttribution('vic-epa-air'), 'EPA Victoria');
  assert.equal(regionalSourceAttribution('au-hospital-ed-performance'), 'Based on Australian Institute of Health and Welfare material.');
  assert.throws(() => regionalSourceAttribution('nope'), /Unknown regional source: nope/);
});
