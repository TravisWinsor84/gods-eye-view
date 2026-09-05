import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CIVIC_SOURCE_VALIDATION,
  REGIONAL_SOURCES,
  normalizeRegionalFeatureCollection,
  regionalSourceAttribution,
  regionalSourceAvailability,
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
    'au-emergency-facilities',
    'au-health-facilities',
    'au-place-names',
    'au-dea-hotspots',
    'vic-parks',
    'vic-recreation-tracks',
    'vic-heritage',
    'vic-ev-chargers',
    'vic-renewable-facilities',
    'vic-flood-history-2022',
    'vic-epa-priority-sites',
    'vic-landfill-register',
    'vic-recreation-assets',
    'melbourne-drinking-fountains',
    'melbourne-barbecues',
    'melbourne-parking-live',
    'melbourne-development',
    'melbourne-culture',
    'au-public-toilets',
    'vic-transport-stops',
    'vic-waste-facilities',
    'vic-property-boundaries',
    'ptv-transit',
    'vic-road-unplanned',
    'vic-lane-signals',
    'vic-wetlands-2025',
    'au-hospital-ed-performance',
  ]);
  assert.equal(Object.isFrozen(REGIONAL_SOURCES), true);
  assert.equal(Object.isFrozen(REGIONAL_SOURCES['melbourne-trees']), true);
  assert.equal(REGIONAL_SOURCES['melbourne-trees'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].runtimeEligible, false);
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].credential, 'registration-required');
  assert.equal(REGIONAL_SOURCES['vic-epa-air'].endpoint, null);
  assert.equal(REGIONAL_SOURCES['ptv-transit'].serverCredential, 'TRANSPORT_VIC_OPEN_DATA_API_KEY');
  assert.match(REGIONAL_SOURCES['ptv-transit'].endpoint, /opendata\.transport\.vic\.gov\.au\/dataset\/gtfs-realtime/);
  assert.equal(REGIONAL_SOURCES['vic-road-unplanned'].serverCredential, 'TRANSPORT_VIC_OPEN_DATA_API_KEY');
  assert.match(REGIONAL_SOURCES['vic-road-unplanned'].refresh, /context only/i);
  assert.equal(REGIONAL_SOURCES['vic-lane-signals'].geometry, 'point');
  assert.match(REGIONAL_SOURCES['vic-lane-signals'].refresh, /obey.*physical/i);
  assert.equal(REGIONAL_SOURCES['vic-wetlands-2025'].requiredServerEnv, 'VIC_WETLANDS_2025_DATA_DIR');
  assert.match(REGIONAL_SOURCES['vic-wetlands-2025'].refresh, /reference.*not live/i);
  assert.equal(REGIONAL_SOURCES['vic-cfa-alerts'].runtimeEligible, false);
  assert.equal(REGIONAL_SOURCES['au-emergency-facilities'].runtimeEligible, true);
  assert.equal(REGIONAL_SOURCES['au-health-facilities'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['au-place-names'].credential, 'none');
  assert.equal(REGIONAL_SOURCES['au-dea-hotspots'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['au-dea-hotspots'].licence, 'Dataset-specific catalogue licence unspecified; fallback: Creative Commons Attribution 4.0 International under Geoscience Australia general copyright terms, subject to accompanying notices.');
  assert.match(REGIONAL_SOURCES['au-dea-hotspots'].credit, /Commonwealth of Australia \(Geoscience Australia\) 2026/);
  assert.equal(REGIONAL_SOURCES['vic-parks'].geometry, 'polygon');
  assert.equal(REGIONAL_SOURCES['vic-recreation-tracks'].geometry, 'line');
  assert.equal(REGIONAL_SOURCES['vic-heritage'].refresh, 'unknown publisher cadence; daily viewport cache');
  assert.equal(REGIONAL_SOURCES['vic-ev-chargers'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['vic-renewable-facilities'].geometry, 'polygon');
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxFeatures, 1);
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxResponseBytes, 1_500_000);
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxInputCoordinatesPerFeature, 60_000);
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxInputCoordinatesPerResponse, 75_000);
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxOutputCoordinatesPerFeature, 60_000);
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxRingsPerFeature, 2_000);
  assert.equal(REGIONAL_SOURCES['vic-flood-history-2022'].maxTopologyComparisons, 20_000_000);
  assert.match(REGIONAL_SOURCES['vic-epa-priority-sites'].refresh, /absence does not mean uncontaminated or safe/i);
  assert.match(REGIONAL_SOURCES['vic-landfill-register'].refresh, /possible register lag/i);
  assert.match(REGIONAL_SOURCES['vic-recreation-assets'].refresh, /does not prove open or maintained/i);
  assert.equal(REGIONAL_SOURCES['melbourne-parking-live'].refreshMs, 120_000);
  assert.equal(REGIONAL_SOURCES['melbourne-parking-live'].maxStaleMs, 600_000);
  assert.equal(REGIONAL_SOURCES['melbourne-drinking-fountains'].maxStaleMs, 259_200_000);
  assert.equal(REGIONAL_SOURCES['melbourne-barbecues'].maxStaleMs, 259_200_000);
  assert.match(REGIONAL_SOURCES['melbourne-drinking-fountains'].refresh, /publisher source cadence is daily/i);
  assert.match(REGIONAL_SOURCES['melbourne-barbecues'].refresh, /three missed publisher cycles/i);
  assert.equal(REGIONAL_SOURCES['melbourne-culture'].geometry, 'point');
  assert.equal(REGIONAL_SOURCES['au-public-toilets'].endpoint, 'https://data.gov.au/data/api/3/action/package_show?id=553b3049-2b8b-46a2-95e6-640d7986a8c1');
  assert.equal(REGIONAL_SOURCES['au-public-toilets'].maxFeatures, 1_000);
  assert.equal(REGIONAL_SOURCES['au-public-toilets'].maxRows, 30_000);
  assert.match(REGIONAL_SOURCES['au-public-toilets'].licence, /legal review.*conflict/i);
  assert.equal(REGIONAL_SOURCES['vic-transport-stops'].endpoint, 'https://opendata.transport.vic.gov.au/api/3/action/package_show?id=public-transport-lines-and-stops');
  assert.equal(REGIONAL_SOURCES['vic-transport-stops'].maxRows, 40_000);
  assert.match(REGIONAL_SOURCES['vic-transport-stops'].refresh, /reference.*not realtime/i);
  assert.equal(REGIONAL_SOURCES['vic-waste-facilities'].endpoint, 'https://discover.data.vic.gov.au/api/3/action/package_show?id=victoria-s-waste-and-resource-recovery-infrastructure-map-data');
  assert.equal(REGIONAL_SOURCES['vic-waste-facilities'].maxRows, 1_000);
  assert.match(REGIONAL_SOURCES['vic-waste-facilities'].refresh, /October 2025.*not.*currently operating/i);
  assert.equal(REGIONAL_SOURCES['vic-waste-facilities'].credit, 'Victoria’s Waste and Recycling Infrastructure Map © Recycling Victoria 2023. Licensed under Creative Commons Attribution 4.0 International.');
  assert.equal(REGIONAL_SOURCES['vic-property-boundaries'].minZoom, 18);
  assert.equal(REGIONAL_SOURCES['vic-property-boundaries'].maxFeatures, 500);
  assert.match(REGIONAL_SOURCES['vic-property-boundaries'].refresh, /weekly.*not.*legal boundary/i);
  assert.ok(Number.isInteger(REGIONAL_SOURCES['melbourne-trees'].maxFeatures));
});

test('reports regional source availability without exposing environment values', () => {
  const secret = 'provider-secret-must-not-escape';
  assert.deepEqual(regionalSourceAvailability('vic-epa-air', { UNRELATED_SECRET: secret }), {
    available: false,
    status: 'credentials-required',
    reason: 'EPA Victoria registration required',
  });
  assert.deepEqual(regionalSourceAvailability('melbourne-trees', {}), {
    available: true,
    status: 'available',
    reason: '',
  });
  assert.deepEqual(regionalSourceAvailability('ptv-transit', {}), {
    available: false,
    status: 'credentials-required',
    reason: 'Transport Victoria Open Data Portal key required',
  });
  assert.deepEqual(regionalSourceAvailability('ptv-transit', {
    TRANSPORT_VIC_OPEN_DATA_API_KEY: ` ${secret} `,
  }), { available: true, status: 'available', reason: '' });
  assert.deepEqual(regionalSourceAvailability('vic-road-unplanned', {
    TRANSPORT_VIC_OPEN_DATA_API_KEY: ` ${secret} `,
  }), { available: true, status: 'available', reason: '' });
  assert.deepEqual(regionalSourceAvailability('vic-wetlands-2025', {}), {
    available: false,
    status: 'artifact-required',
    reason: 'Reviewed Victorian Wetland Inventory 2025 artifacts required',
  });
  assert.deepEqual(regionalSourceAvailability('vic-wetlands-2025', {
    VIC_WETLANDS_2025_DATA_DIR: '/srv/godseye/wetlands',
  }), { available: true, status: 'available', reason: '' });
  assert.deepEqual(regionalSourceAvailability('ptv-transit', {
    VITE_TRANSPORT_VIC_OPEN_DATA_CONFIGURED: 'true',
  }), { available: true, status: 'available', reason: '' });
  assert.deepEqual(regionalSourceAvailability('vahi-daily-ed-wait', {}), {
    available: false,
    status: 'permission-required',
    reason: 'Regional source unavailable',
  });
  assert.doesNotMatch(JSON.stringify(regionalSourceAvailability('vic-epa-air', { UNRELATED_SECRET: secret })), new RegExp(secret));
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

test('rejects EPA payloads before reading them while the provider contract is unverified', () => {
  const unreadablePayload = {
    get data() {
      throw new Error('unverified EPA payload must not be read');
    },
  };
  assert.throws(
    () => normalizeRegionalFeatureCollection('vic-epa-air', unreadablePayload),
    /vic-epa-air is not runtime eligible/,
  );
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
      { featureId: 'ptv-metro-acde1234', entityId: 'provider-entity-secret', mode: 'metro', vehicleId: 'provider-vehicle-secret', tripId: 'trip-1', routeId: 'route-1', position: { latitude: -37.8183, longitude: 144.9671 }, timestamp: 1_800_000_000, feedTimestamp: 1_799_999_990, feedAgeSeconds: 10, stale: false, bearing: 90, occupancyStatus: 'MANY_SEATS_AVAILABLE' },
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
  assert.equal(transit.features[0].id, 'ptv-metro-acde1234');
  assert.equal('vehicleId' in transit.features[0].properties, false);
  assert.equal('entityId' in transit.features[0].properties, false);
  assert.equal(transit.features[0].properties.tripId, 'trip-1');
  assert.equal(transit.features[0].properties.routeId, 'route-1');
  assert.equal(transit.features[0].properties.stale, false);
  assert.deepEqual(transit.modeStatus, { metro: { status: 'current', feedTimestamp: 1_799_999_990, feedAgeSeconds: 10 } });
  assert.doesNotMatch(JSON.stringify(transit), /provider-entity-secret|provider-vehicle-secret/);
});

test('delegates GA facility and place-name payloads to their strict source sanitizer', () => {
  const health = normalizeRegionalFeatureCollection('au-health-facilities', [{
    layer: 1,
    payloads: [{ type: 'FeatureCollection', features: [{
      type: 'Feature', id: 77,
      geometry: { type: 'Point', coordinates: [144.96, -37.81] },
      properties: {
        organisation_name: 'Example Hospital', suburb: 'Melbourne', state: 'VIC',
        address: 'private address', nhsd_service_id: 'private-id', capacity: 50,
      },
    }] }],
  }]);
  assert.equal(health.features[0].properties.title, 'Example Hospital');
  assert.equal(health.features[0].properties.freshnessClass, 'reference');
  assert.doesNotMatch(JSON.stringify(health), /private address|private-id|capacity/);
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
  assert.match(regionalSourceAttribution('au-emergency-facilities'), /Commonwealth of Australia \(Geoscience Australia\) 2023/);
  assert.match(regionalSourceAttribution('au-health-facilities'), /G-NAF © Geoscape Australia/);
  assert.equal(regionalSourceAttribution('au-place-names'), 'Geoscience Australia');
  assert.match(regionalSourceAttribution('au-dea-hotspots'), /Creative Commons Attribution 4\.0 International Licence\. Observe and retain any copyright or related notices that may accompany this material as part of the attribution/);
  assert.equal(regionalSourceAttribution('melbourne-parking-live'), 'City of Melbourne Open Data — licensed under Creative Commons Attribution 4.0 International.');
  for (const sourceId of ['vic-ev-chargers', 'vic-renewable-facilities', 'vic-flood-history-2022', 'vic-epa-priority-sites', 'vic-landfill-register', 'vic-recreation-assets']) {
    assert.equal(regionalSourceAttribution(sourceId), 'State of Victoria (DataVic)');
  }
  assert.throws(() => regionalSourceAttribution('nope'), /Unknown regional source: nope/);
});
