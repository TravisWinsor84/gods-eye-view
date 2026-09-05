import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OGC_SOURCE_CREDITS,
  normalizeOgcFeature,
  normalizeOgcPayload,
  ogcFeatureRequest,
} from './ogcRegionalSources.js';

const BBOX = Object.freeze({ west: 144, south: -38, east: 146, north: -37 });

function feature(geometry, properties = {}, id = undefined) {
  return { type: 'Feature', ...(id === undefined ? {} : { id }), geometry, properties };
}

const POLYGON = {
  type: 'Polygon',
  coordinates: [[[144, -38], [146, -38], [146, -37], [144, -37], [144, -38]]],
};

test('builds only fixed WFS requests with bbox, EPSG:4326, GeoJSON and count caps', () => {
  const expected = {
    'au-dea-hotspots': ['https://hotspots.dea.ga.gov.au/geoserver/wfs', 'public:hotspots_three_days'],
    'vic-parks': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:parkres'],
    'vic-recreation-tracks': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:recweb_tracks'],
    'vic-heritage': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:heritage_register'],
    'vic-fire-context': ['https://opendata.maps.vic.gov.au/geoserver/wfs', 'open-data-platform:fire_history'],
  };

  for (const [sourceId, [base, typeName]] of Object.entries(expected)) {
    const url = ogcFeatureRequest(sourceId, BBOX, 1_000);
    assert.equal(`${url.origin}${url.pathname}`, base);
    assert.equal(url.searchParams.get('service'), 'WFS');
    assert.equal(url.searchParams.get('request'), 'GetFeature');
    assert.equal(url.searchParams.get('version'), '2.0.0');
    assert.equal(url.searchParams.get('typeName'), typeName);
    assert.equal(url.searchParams.get('bbox'), '144,-38,146,-37,EPSG:4326');
    assert.equal(url.searchParams.get('srsName'), 'EPSG:4326');
    assert.equal(url.searchParams.get('outputFormat'), 'application/json');
    assert.equal(url.searchParams.get('count'), '1000');
    assert.equal(url.searchParams.get('maxFeatures'), '1000');
    assert.ok(url.searchParams.get('propertyName'));
    assert.doesNotMatch(url.searchParams.get('propertyName'), /(?:^|,)(?:id|ufi|vhr_num|hermes_num|comments|clos_[^,]*|maintained_by)(?:,|$)/i);
  }
  assert.throws(() => ogcFeatureRequest('unknown', BBOX, 10), /Unknown OGC regional source/);
  assert.throws(() => ogcFeatureRequest('vic-parks', { ...BBOX, west: Number.NaN }, 10), /invalid OGC bounding box/);
  assert.throws(() => ogcFeatureRequest('vic-parks', BBOX, 1_001), /invalid OGC feature limit/);
});

test('builds the six final-gap DataVic requests with exact public property allowlists', () => {
  const expected = {
    'vic-ev-chargers': ['open-data-platform:dcav_site', 'geom,location,region,lead_organisation,estimated_project_completion,plug_type,company,number_of_chargers'],
    'vic-renewable-facilities': ['open-data-platform:renewables', 'geom,name,type,approval_status,construction_status,lga,size_mw,turbines,ancillary_battery,ancillary_battery_size'],
    'vic-flood-history-2022': ['open-data-platform:vic_flood_history_public', 'geom,subtype,obs_date,source,label'],
    'vic-epa-priority-sites': ['open-data-platform:psr_polygon', 'geom,municipality,suburb,issue,data_extracted_on'],
    'vic-landfill-register': ['open-data-platform:vlr_polygon', 'geom,suburb,council,landfill_name,operating_status,waste_type_accepted,estimated_year_of_closure,estimated_total_waste_volume,data_extracted_on'],
    'vic-recreation-assets': ['open-data-platform:recweb_asset', 'geom,name,asset_cls,category,dis_access,label,published,vers_date,fac_type,type_'],
  };

  for (const [sourceId, [typeName, propertyName]] of Object.entries(expected)) {
    const url = ogcFeatureRequest(sourceId, BBOX, sourceId === 'vic-flood-history-2022' ? 1 : 100);
    assert.equal(url.origin, 'https://opendata.maps.vic.gov.au');
    assert.equal(url.searchParams.get('typeName'), typeName);
    assert.equal(url.searchParams.get('propertyName'), propertyName);
    assert.equal(url.searchParams.get('count'), sourceId === 'vic-flood-history-2022' ? '1' : '100');
    assert.equal(url.searchParams.get('maxFeatures'), url.searchParams.get('count'));
  }
});

test('normalizes final-gap DataVic fields into safe reference meanings without provider-private fields', () => {
  const cases = [
    ['vic-ev-chargers', { location: 'Tatura', region: 'Hume', lead_organisation: 'Tatura Carwash', estimated_project_completion: '2025-06-30', plug_type: 'CCS2', company: 'Example operator', number_of_chargers: 2 }, 'Point', [144.95, -37.8], ['location', 'region', 'leadOrganisation', 'estimatedProjectCompletion', 'plugType', 'company', 'numberOfChargers'], /funded.*not.*(?:occupancy|live availability)/i],
    ['vic-renewable-facilities', { name: 'Macorna Solar Farm', type: 'Solar', approval_status: 'Approved', construction_status: 'Not Constructed', lga: 'Gannawarra', size_mw: 100, turbines: 0, ancillary_battery: 'Proposed', ancillary_battery_size: '20 MW' }, 'MultiPolygon', [POLYGON.coordinates], ['facilityType', 'approvalStatus', 'constructionStatus', 'lga', 'sizeMw', 'turbines', 'ancillaryBattery', 'ancillaryBatterySize'], /context.*not live generation/i],
    ['vic-flood-history-2022', { subtype: 2, obs_date: '2022-11-01T00:00:00Z', source: 'Satellite Image Interpretation - Automated', label: 'Observed water' }, 'MultiPolygon', [POLYGON.coordinates], ['subtype', 'observedAt', 'evidenceSource', 'label'], /historical.*incomplete.*not current/i],
    ['vic-epa-priority-sites', { municipality: 'Moreland', suburb: 'Pascoe Vale', issue: 'Requires assessment', data_extracted_on: '2026-09-05T07:30:00Z' }, 'MultiPolygon', [POLYGON.coordinates], ['municipality', 'suburb', 'issue', 'dataExtractedAt'], /absence.*not.*(?:uncontaminated|safe)/i],
    ['vic-landfill-register', { suburb: 'Frankston North', council: 'Frankston City Council', landfill_name: 'Example landfill', operating_status: 'Closed', waste_type_accepted: 'Municipal Solid Waste', estimated_year_of_closure: '1992', estimated_total_waste_volume: 'Not available', data_extracted_on: '2026-09-05T18:11:04Z' }, 'MultiPolygon', [POLYGON.coordinates], ['suburb', 'council', 'landfillName', 'operatingStatus', 'wasteTypeAccepted', 'estimatedYearOfClosure', 'estimatedTotalWasteVolume', 'dataExtractedAt'], /register.*lag.*not current/i],
    ['vic-recreation-assets', { name: 'Goat Island', asset_cls: 'JETTY', category: 'Water access', dis_access: 'Limited', label: 'Jetty', published: 'Y', vers_date: '2026-09-05T00:00:00Z', fac_type: 'ASSET', type_: 'Facility' }, 'Point', [144.95, -37.8], ['assetClass', 'category', 'disabilityAccess', 'label', 'published', 'versionDate', 'facilityType', 'assetType'], /inventory.*not.*(?:open|maintained)/i],
  ];

  for (const [sourceId, publicInput, geometryType, coordinates, publicKeys, caveat] of cases) {
    const properties = {
      ...publicInput,
      id: 'private-id', ufi: 'private-ufi', address: 'private address', comments: 'private comments',
      description: 'private description', latitude: -37.8, longitude: 144.95, external_link: 'https://private.invalid',
      notice_number: 'private notice', licence_id: 'private licence', serial_no: 'private serial', photo_id: 'private photo',
    };
    const normalized = normalizeOgcFeature(sourceId, feature({ type: geometryType, coordinates }, properties, 'provider-private-id'));
    assert.equal(normalized.properties.sourceId, sourceId);
    assert.equal(normalized.properties.referenceOnly, true);
    assert.match(normalized.properties.caveat, caveat, sourceId);
    for (const key of publicKeys) assert.ok(Object.hasOwn(normalized.properties, key), `${sourceId}: ${key}`);
    assert.doesNotMatch(JSON.stringify(normalized), /private-|provider-private|latitude|longitude|external_link|notice_number|licence_id|serial_no|photo_id/i);
  }
});

test('uses safe regional fallback titles for untitled EPA and landfill polygons', () => {
  const epa = normalizeOgcFeature('vic-epa-priority-sites', feature(POLYGON, { suburb: 'Pascoe Vale', municipality: 'Merri-bek' }));
  const landfill = normalizeOgcFeature('vic-landfill-register', feature(POLYGON, { suburb: 'Frankston North', landfill_name: 'Not available' }));
  assert.equal(epa.properties.title, 'Pascoe Vale priority site register area');
  assert.equal(landfill.properties.title, 'Frankston North landfill register area');
});

test('normalizes DataVic fire history as historical context rather than a live incident', () => {
  const result = normalizeOgcFeature('vic-fire-context', feature(POLYGON, {
    name: 'METROPOLITAN 20', firetype: 'Bushfire', season: 2025,
    start_date: '2024-12-16T00:00:00Z', area_ha: 0.95,
    cause: 'Deliberate Lighting', globalid: 'private-provider-id',
  }));
  assert.equal(result.properties.title, 'METROPOLITAN 20');
  assert.equal(result.properties.historical, true);
  assert.equal(result.properties.fireType, 'Bushfire');
  assert.equal(result.properties.season, 2025);
  assert.equal(result.properties.areaHa, 0.95);
  assert.match(result.properties.caveat, /historical.*not.*current/i);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-id|globalid/i);
});

test('preserves a bounded flood outlier exactly within its source-only cap and marks it partial', () => {
  const openRing = Array.from({ length: 56_000 }, (_, index) => {
    const angle = (index / 56_000) * Math.PI * 2;
    return [145 + Math.cos(angle), -37 + Math.sin(angle)];
  });
  const ring = [...openRing, openRing[0]];
  const payload = {
    type: 'FeatureCollection', numberMatched: 1_826, numberReturned: 1,
    features: [feature({ type: 'MultiPolygon', coordinates: [[ring]] }, {
      subtype: 2, obs_date: '2022-11-01T00:00:00Z', source: 'Satellite interpretation', label: 'Observed extent',
    })],
  };
  const first = normalizeOgcPayload('vic-flood-history-2022', payload, { maxFeatures: 1 });
  const second = normalizeOgcPayload('vic-flood-history-2022', payload, { maxFeatures: 1 });
  assert.deepEqual(first, second);
  assert.equal(first.features[0].geometry.type, 'MultiPolygon');
  assert.equal(first.features[0].geometry.coordinates.length, 1);
  assert.equal(first.features[0].geometry.coordinates[0].length, 1);
  assert.deepEqual(first.features[0].geometry.coordinates[0][0][0], first.features[0].geometry.coordinates[0][0].at(-1));
  assert.equal(first.sourceStatus.coordinateCount, 56_001);
  assert.equal(first.sourceStatus.outputCoordinateCount, 56_001);
  assert.equal(first.sourceStatus.simplifiedFeatures, 0);
  assert.equal(first.sourceStatus.capped, true);
  assert.equal(first.sourceStatus.status, 'partial');
});

test('keeps the flood input ceiling bounded and omits an oversized feature while retaining valid siblings', () => {
  const tooLargeRing = Array.from({ length: 60_001 }, (_, index) => [144 + index / 1_000_000, -38]);
  tooLargeRing.push(tooLargeRing[0]);
  const result = normalizeOgcPayload('vic-flood-history-2022', {
    type: 'FeatureCollection', numberMatched: 2, numberReturned: 2,
    features: [
      feature({ type: 'MultiPolygon', coordinates: [[tooLargeRing]] }, { label: 'Oversized' }),
      feature({ type: 'MultiPolygon', coordinates: [POLYGON.coordinates] }, { label: 'Retained', obs_date: '2022-10-20' }),
    ],
  }, { maxFeatures: 2 });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.label, 'Retained');
  assert.equal(result.sourceStatus.invalidFeatures, 1);
  assert.equal(result.sourceStatus.status, 'partial');
});

test('admits a bounded complex renewable multipolygon without weakening the global topology budget', () => {
  const polygons = Array.from({ length: 200 }, (_, index) => {
    const centerX = 140 + (index % 20) * 0.1;
    const centerY = -39 + Math.floor(index / 20) * 0.1;
    const open = Array.from({ length: 60 }, (_unused, vertex) => {
      const angle = (vertex / 60) * Math.PI * 2;
      return [centerX + Math.cos(angle) * 0.01, centerY + Math.sin(angle) * 0.01];
    });
    return [[...open, open[0]]];
  });
  const result = normalizeOgcPayload('vic-renewable-facilities', {
    type: 'FeatureCollection', numberMatched: 1, numberReturned: 1,
    features: [feature({ type: 'MultiPolygon', coordinates: polygons }, { name: 'Complex valid facility' })],
  }, { maxFeatures: 1 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'current');
  assert.equal(result.sourceStatus.coordinateCount, 12_200);
});

test('preserves all 1410 flood rings and coordinates for a live-scale bounded feature', () => {
  const shell = [[0, -40], [50, -40], [50, 0], [0, 0], [0, -40]];
  const holes = Array.from({ length: 1_409 }, (_, index) => {
    const centerX = 0.2 + (index % 47);
    const centerY = -39.5 + Math.floor(index / 47);
    const open = Array.from({ length: 40 }, (_unused, vertex) => {
      const angle = (vertex / 40) * Math.PI * 2;
      return [centerX + Math.cos(angle) * 0.05, centerY + Math.sin(angle) * 0.05];
    });
    return [...open, open[0]];
  });
  const result = normalizeOgcPayload('vic-flood-history-2022', {
    type: 'FeatureCollection', numberMatched: 1_826, numberReturned: 1,
    features: [feature({ type: 'MultiPolygon', coordinates: [[shell, ...holes]] }, {
      label: 'Live-scale ring structure', obs_date: '2022-10-20', source: 'Observed evidence',
    })],
  }, { maxFeatures: 1 });
  const outputRings = result.features[0].geometry.coordinates[0].length;
  assert.equal(outputRings, 1_410);
  assert.ok(result.sourceStatus.coordinateCount > 56_000);
  assert.equal(result.sourceStatus.outputCoordinateCount, result.sourceStatus.coordinateCount);
  assert.ok(result.sourceStatus.outputCoordinateCount <= 60_000);
  assert.equal(result.sourceStatus.simplifiedFeatures, 0);
  assert.equal(result.sourceStatus.status, 'partial');
});

test('flood geometry still rejects a self-intersecting ring', () => {
  const bowTie = [[144, -38], [145, -37], [144, -37], [145, -38], [144, -38]];
  assert.throws(() => normalizeOgcPayload('vic-flood-history-2022', {
    type: 'FeatureCollection', numberMatched: 1, numberReturned: 1,
    features: [feature({ type: 'MultiPolygon', coordinates: [[bowTie]] }, { label: 'Invalid flood ring' })],
  }, { maxFeatures: 1 }), /no valid features/i);
});

test('flood geometry intentionally tolerates inter-ring overlap within its bounded historical contract', () => {
  const shell = [[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]];
  const overlappingA = [[144.2, -37.8], [145.2, -37.8], [145.2, -36.8], [144.2, -36.8], [144.2, -37.8]];
  const overlappingB = [[144.8, -37.4], [145.8, -37.4], [145.8, -36.4], [144.8, -36.4], [144.8, -37.4]];
  const result = normalizeOgcPayload('vic-flood-history-2022', {
    type: 'FeatureCollection', numberMatched: 1, numberReturned: 1,
    features: [feature({ type: 'MultiPolygon', coordinates: [[shell, overlappingA, overlappingB]] }, { label: 'Historical overlap' })],
  }, { maxFeatures: 1 });
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].geometry.coordinates[0].length, 3);
});

test('flood geometry rejects 2001 rings even below the coordinate ceiling', () => {
  const rings = Array.from({ length: 2_001 }, (_, index) => {
    const x = 140 + (index % 100) * 0.001;
    const y = -39 + Math.floor(index / 100) * 0.001;
    return [[x, y], [x + 0.0004, y], [x + 0.0004, y + 0.0004], [x, y + 0.0004], [x, y]];
  });
  assert.throws(() => normalizeOgcPayload('vic-flood-history-2022', {
    type: 'FeatureCollection', numberMatched: 1, numberReturned: 1,
    features: [feature({ type: 'MultiPolygon', coordinates: [rings] }, { label: 'Too many rings' })],
  }, { maxFeatures: 1 }), /no valid features/i);
});

test('hotspots retain observation uncertainty and confidence without IDs or safety-of-life claims', () => {
  const normalized = normalizeOgcFeature('au-dea-hotspots', feature(
    { type: 'Point', coordinates: [144.96, -37.81] },
    {
      datetime: '2026-09-03T05:48:28Z', accuracy: '± 2km', confidence: 80,
      satellite: 'HIMAWARI-9', sensor: 'AHI', id: 1234, filename: 'private-path',
      evacuate: true, comments: 'operator free text',
    },
    'hotspots.1234',
  ));

  assert.equal(normalized.properties.observedAt, '2026-09-03T05:48:28.000Z');
  assert.equal(normalized.properties.positionalUncertainty, '± 2km');
  assert.equal(normalized.properties.confidence, 80);
  assert.match(normalized.properties.caveat, /375 m/i);
  assert.match(normalized.properties.caveat, /not.*warning|not.*evacuation/i);
  assert.doesNotMatch(JSON.stringify(normalized), /1234|private-path|operator free text|evacuate/);
});

test('parks expose only safe reserve name, type and manager fields', () => {
  const normalized = normalizeOgcFeature('vic-parks', feature(POLYGON, {
    name: 'Example Reserve', area_type: 'National Park', manager: 'Parks Victoria',
    prims_id: 'internal-park-id', veac_rec: 'free text', search_name: 'alternate text',
  }));
  assert.equal(normalized.properties.title, 'Example Reserve');
  assert.equal(normalized.properties.reserveType, 'National Park');
  assert.equal(normalized.properties.manager, 'Parks Victoria');
  assert.equal(normalized.properties.referenceOnly, true);
  assert.doesNotMatch(JSON.stringify(normalized), /internal-park-id|free text|alternate text/);
});

test('tracks are reference alignments and strip closure, maintenance and free-text fields', () => {
  const normalized = normalizeOgcFeature('vic-recreation-tracks', feature({
    type: 'MultiLineString', coordinates: [[[144.9, -37.8], [145, -37.7]]],
  }, {
    name: 'Example Track', trk_class: 'BASIC', asset_cls: 'TRACK',
    clos_stat: 'Closed', clos_desc: 'incident details', maintained_by: 'private contact',
    comments: 'free text', serial_no: 'internal-track-id',
  }));
  assert.equal(normalized.properties.title, 'Example Track');
  assert.equal(normalized.properties.trackClass, 'BASIC');
  assert.equal(normalized.properties.referenceOnly, true);
  assert.match(normalized.properties.caveat, /not.*live closure|not.*condition/i);
  assert.doesNotMatch(JSON.stringify(normalized), /Closed|incident details|private contact|free text|internal-track-id/);
});

test('heritage exposes only site name and object type with unknown cadence', () => {
  const normalized = normalizeOgcFeature('vic-heritage', feature(POLYGON, {
    site_name: 'Example Heritage Site', heritage_object: 'Building', id: 42,
    hermes_num: 'internal-hermes', ufi: 'internal-ufi', notes: 'sensitive free text',
  }));
  assert.equal(normalized.properties.title, 'Example Heritage Site');
  assert.equal(normalized.properties.objectType, 'Building');
  assert.equal(normalized.properties.freshnessClass, 'unknown');
  assert.match(normalized.properties.caveat, /unknown cadence/i);
  assert.doesNotMatch(JSON.stringify(normalized), /42|internal-hermes|internal-ufi|sensitive free text/);
});

test('normalization rejects excessive or invalid geometry and never reads beyond feature cap', () => {
  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection',
    features: [feature({ type: 'Polygon', coordinates: [[[[144, -38]]]] }, { name: 'Bad nesting' })],
  }, { maxFeatures: 10 }), (error) => error?.code === 'INVALID_OGC_RESPONSE');
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection',
    features: [feature({ type: 'Polygon', coordinates: [[[[[[144, -38]]]]]] }, { site_name: 'Too deep' })],
  }, { maxFeatures: 10 }), (error) => error?.code === 'OGC_NESTING_LIMIT');
  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection',
    features: [feature({ type: 'Polygon', coordinates: [[[144, -38], [Infinity, -38], [146, -37], [144, -38]]] }, { name: 'Bad coordinate' })],
  }, { maxFeatures: 10 }), (error) => error?.code === 'INVALID_OGC_RESPONSE');

  const rows = [feature(POLYGON, { name: 'One' })];
  Object.defineProperty(rows, 1, { enumerable: true, get() { throw new Error('feature beyond cap was read'); } });
  rows.length = 2;
  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection', features: rows,
  }, { maxFeatures: 1 }), /feature limit/);
});

test('heritage simplification stays bounded, closed and deterministic while invalid rings fail closed', () => {
  const ring = [];
  for (let index = 0; index < 12_000; index += 1) {
    const angle = (Math.PI * 2 * index) / 12_000;
    ring.push([145 + Math.cos(angle) * 0.1, -37.8 + Math.sin(angle) * 0.1]);
  }
  ring.push(ring[0]);
  const input = feature({ type: 'Polygon', coordinates: [ring] }, { site_name: 'Large Site', heritage_object: 'Precinct' });
  const first = normalizeOgcPayload('vic-heritage', { type: 'FeatureCollection', features: [input] }, { maxFeatures: 10 });
  const second = normalizeOgcPayload('vic-heritage', { type: 'FeatureCollection', features: [input] }, { maxFeatures: 10 });
  const outputRing = first.features[0].geometry.coordinates[0];
  assert.ok(outputRing.length <= 4_001);
  assert.deepEqual(outputRing[0], outputRing.at(-1));
  assert.deepEqual(first, second);

  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', features: [feature({
      type: 'Polygon', coordinates: [[[144, -38], [145, -37], [144, -37], [145, -38], [144, -38]]],
    }, { site_name: 'Self crossing' })],
  }, { maxFeatures: 10 }), (error) => error?.code === 'INVALID_OGC_RESPONSE');
});

test('rejects polygon holes outside or crossing the shell', () => {
  const shell = [[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]];
  const outsideHole = [[147, -37.8], [147.2, -37.8], [147.2, -37.6], [147, -37.6], [147, -37.8]];
  const crossingHole = [[145.8, -37.8], [146.2, -37.8], [146.2, -37.4], [145.8, -37.4], [145.8, -37.8]];

  for (const hole of [outsideHole, crossingHole]) {
    assert.throws(() => normalizeOgcFeature('vic-parks', feature({
      type: 'Polygon', coordinates: [shell, hole],
    }, { name: 'Invalid reserve' })), /invalid OGC polygon topology/);
  }
});

test('rejects polygon holes that overlap, touch or nest', () => {
  const shell = [[144, -38], [148, -38], [148, -34], [144, -34], [144, -38]];
  const left = [[145, -37], [146, -37], [146, -36], [145, -36], [145, -37]];
  const invalidPairs = [
    [[145.5, -36.5], [146.5, -36.5], [146.5, -35.5], [145.5, -35.5], [145.5, -36.5]],
    [[146, -37], [147, -37], [147, -36], [146, -36], [146, -37]],
    [[145.2, -36.8], [145.8, -36.8], [145.8, -36.2], [145.2, -36.2], [145.2, -36.8]],
  ];

  for (const right of invalidPairs) {
    assert.throws(() => normalizeOgcFeature('vic-parks', feature({
      type: 'Polygon', coordinates: [shell, left, right],
    }, { name: 'Invalid reserve holes' })), /invalid OGC polygon topology/);
  }
});

test('rejects overlapping, touching or contained sibling multipolygon members', () => {
  const left = [[[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]]];
  const invalidSiblings = [
    [[[145, -37], [147, -37], [147, -35], [145, -35], [145, -37]]],
    [[[146, -38], [148, -38], [148, -36], [146, -36], [146, -38]]],
    [[[144.5, -37.5], [145.5, -37.5], [145.5, -36.5], [144.5, -36.5], [144.5, -37.5]]],
  ];

  for (const right of invalidSiblings) {
    assert.throws(() => normalizeOgcFeature('vic-parks', feature({
      type: 'MultiPolygon', coordinates: [left, right],
    }, { name: 'Invalid reserve members' })), /invalid OGC multipolygon topology/);
  }
});

test('accepts valid holes without imposing GeoJSON winding direction', () => {
  const shell = [[144, -38], [146, -38], [146, -36], [144, -36], [144, -38]];
  const sameWindingHole = [[144.5, -37.5], [145, -37.5], [145, -37], [144.5, -37], [144.5, -37.5]];
  const normalized = normalizeOgcFeature('vic-parks', feature({
    type: 'Polygon', coordinates: [shell, sameWindingHole],
  }, { name: 'Valid reserve' }));

  assert.deepEqual(normalized.geometry.coordinates, [shell, sameWindingHole]);
});

test('rejects heritage topology that becomes invalid only after simplification', () => {
  const shell = [];
  for (let index = 0; index <= 2_401; index += 1) shell.push([index * 10 / 2_401, 0]);
  shell.push([10, 4], [12, 5], [10, 6], [10, 10]);
  for (let index = 1; index <= 2_599; index += 1) shell.push([10 - index * 10 / 2_599, 10]);
  shell.push([0, 0]);
  const holeInSpike = [[10.6, 4.8], [11, 5], [10.6, 5.2], [10.5, 5], [10.6, 4.8]];

  assert.throws(() => normalizeOgcFeature('vic-heritage', feature({
    type: 'Polygon', coordinates: [shell, holeInSpike],
  }, { site_name: 'Topology-changing simplification' })), /invalid OGC polygon topology/);
});

test('keeps one topology-comparison budget across many omitted invalid features', () => {
  const rows = Array.from({ length: 70 }, (_, rowIndex) => {
    const polygons = Array.from({ length: 65 }, (_, polygonIndex) => {
      const west = 140 + rowIndex * 0.1 + polygonIndex / 10_000;
      return [[[west, -38], [west + 0.00005, -38], [west + 0.00005, -37.99995], [west, -38]]];
    });
    polygons.push(structuredClone(polygons[0]));
    return feature({ type: 'MultiPolygon', coordinates: polygons }, {
      name: `Expensive invalid reserve ${rowIndex}`,
    });
  });

  assert.throws(() => normalizeOgcPayload('vic-parks', {
    type: 'FeatureCollection', features: rows,
  }, { maxFeatures: rows.length }), (error) => error?.code === 'OGC_TOPOLOGY_LIMIT');
});

test('accepts bounded provider geometry with duplicate consecutive vertices or 65 polygons', () => {
  const park = normalizeOgcFeature('vic-parks', feature({
    type: 'Polygon',
    coordinates: [[[144, -38], [146, -38], [146, -38], [146, -37], [144, -37], [144, -38]]],
  }, { name: 'Duplicate vertex reserve' }));
  assert.equal(park.geometry.coordinates[0].length, 5);

  const polygons = Array.from({ length: 65 }, (_, index) => {
    const west = 144 + index / 1_000;
    return [[[west, -38], [west + 0.0005, -38], [west + 0.0005, -37.9995], [west, -38]]];
  });
  const heritage = normalizeOgcFeature('vic-heritage', feature({
    type: 'MultiPolygon', coordinates: polygons,
  }, { site_name: 'Bounded multipolygon heritage place' }));
  assert.equal(heritage.geometry.coordinates.length, 65);
});

test('deduplicates and orders sanitized features deterministically with partial status for dropped rows', () => {
  const goodA = feature(POLYGON, { name: 'A', area_type: 'Park', manager: 'Manager' }, 'internal-a');
  const goodB = feature({
    type: 'Polygon', coordinates: [[[145, -38], [146, -38], [146, -37], [145, -37], [145, -38]]],
  }, { name: 'B', area_type: 'Reserve', manager: 'Manager' }, 'internal-b');
  const bad = feature({ type: 'Point', coordinates: [145, -37.5] }, { name: 'Wrong geometry' });
  const left = normalizeOgcPayload('vic-parks', { type: 'FeatureCollection', features: [goodB, bad, goodA, goodA] }, { maxFeatures: 10 });
  const right = normalizeOgcPayload('vic-parks', { type: 'FeatureCollection', features: [goodA, goodB, goodA, bad] }, { maxFeatures: 10 });
  assert.deepEqual(left, right);
  assert.deepEqual(left.features.map(({ properties }) => properties.title), ['A', 'B']);
  assert.equal(left.sourceStatus.status, 'partial');
  assert.equal(left.sourceStatus.invalidFeatures, 1);
  assert.equal(left.sourceStatus.duplicateFeatures, 1);
  assert.doesNotMatch(JSON.stringify(left), /internal-a|internal-b/);
});

test('omits feature-local invalid geometry and topology while retaining valid rows as partial', () => {
  const valid = feature(POLYGON, { site_name: 'Valid heritage place', heritage_object: 'Building' });
  const selfCrossing = feature({
    type: 'Polygon', coordinates: [[[144, -38], [146, -37], [144, -37], [146, -38], [144, -38]]],
  }, { site_name: 'Invalid self-crossing place' });
  const overlappingSiblings = feature({
    type: 'MultiPolygon',
    coordinates: [
      [[[144, -38], [145, -38], [145, -37], [144, -37], [144, -38]]],
      [[[144.5, -37.5], [145.5, -37.5], [145.5, -36.5], [144.5, -36.5], [144.5, -37.5]]],
    ],
  }, { site_name: 'Invalid sibling polygons' });

  const result = normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 3, numberReturned: 3,
    features: [selfCrossing, valid, overlappingSiblings],
  }, { maxFeatures: 10 });

  assert.deepEqual(result.features.map(({ properties }) => properties.title), ['Valid heritage place']);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.invalidFeatures, 2);
  assert.equal(result.sourceStatus.numberMatched, 3);
});

test('fails a nonempty matched response when no valid OGC features remain', () => {
  const invalid = feature({
    type: 'Polygon', coordinates: [[[144, -38], [146, -37], [144, -37], [146, -38], [144, -38]]],
  }, { site_name: 'Invalid self-crossing place' });

  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 1, numberReturned: 1, features: [invalid],
  }, { maxFeatures: 10 }), (error) => error?.code === 'INVALID_OGC_RESPONSE');
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 1, numberReturned: 0, features: [],
  }, { maxFeatures: 10 }), (error) => error?.code === 'INVALID_OGC_RESPONSE');

  const empty = normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 0, numberReturned: 0, features: [],
  }, { maxFeatures: 10 });
  assert.equal(empty.sourceStatus.status, 'current');
});

test('keeps response-wide coordinate and nesting exhaustion fatal across invalid features', () => {
  const invalidLongLine = (offset) => feature({
    type: 'LineString',
    coordinates: [
      ...Array.from({ length: 34_000 }, (_, index) => [144 + offset + index / 1_000_000, -37.8]),
      [Number.NaN, -37.8],
    ],
  }, { name: `Invalid long track ${offset}` });
  assert.throws(() => normalizeOgcPayload('vic-recreation-tracks', {
    type: 'FeatureCollection', features: [invalidLongLine(0), invalidLongLine(0.01), invalidLongLine(0.02)],
  }, { maxFeatures: 10 }), (error) => error?.code === 'OGC_COORDINATE_LIMIT');

  const valid = feature(POLYGON, { site_name: 'Valid heritage place' });
  const tooDeep = feature({
    type: 'Polygon', coordinates: [[[[[[144, -38]]]]]],
  }, { site_name: 'Excessively nested place' });
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', features: [valid, tooDeep],
  }, { maxFeatures: 10 }), (error) => error?.code === 'OGC_NESTING_LIMIT');
});

test('admits a live-scale bounded heritage collection without redundant topology validation', () => {
  const rows = Array.from({ length: 45 }, (_, rowIndex) => {
    const polygons = Array.from({ length: 65 }, (_, polygonIndex) => {
      const west = 140 + rowIndex * 0.1 + polygonIndex / 10_000;
      return [[[west, -38], [west + 0.00005, -38], [west + 0.00005, -37.99995], [west, -38]]];
    });
    return feature({ type: 'MultiPolygon', coordinates: polygons }, {
      site_name: `Valid bounded heritage place ${rowIndex}`,
    });
  });

  const result = normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: rows.length, numberReturned: rows.length, features: rows,
  }, { maxFeatures: rows.length });
  assert.equal(result.features.length, rows.length);
  assert.equal(result.sourceStatus.status, 'current');
});

test('marks an exact-count WFS response partial when collection metadata reports more matches', () => {
  const result = normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection',
    numberMatched: 645,
    numberReturned: 1,
    features: [feature(POLYGON, { site_name: 'Capped place', heritage_object: 'Building' })],
  }, { maxFeatures: 1 });
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.capped, true);
  assert.equal(result.sourceStatus.numberMatched, 645);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberReturned: 2, features: [feature(POLYGON, { site_name: 'Mismatch' })],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
});

test('rejects WFS numberMatched below numberReturned or the actual feature count', () => {
  const row = feature(POLYGON, { site_name: 'Contradictory counts' });
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 0, numberReturned: 1, features: [row],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 0, features: [row],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
  assert.throws(() => normalizeOgcPayload('vic-heritage', {
    type: 'FeatureCollection', numberMatched: 2, totalFeatures: 3, features: [row],
  }, { maxFeatures: 1 }), /invalid OGC collection counts/);
});

test('publishes fixed provider attribution contracts', () => {
  assert.equal(
    OGC_SOURCE_CREDITS['au-dea-hotspots'],
    '© Commonwealth of Australia (Geoscience Australia) 2026. This material is licensed under the Creative Commons Attribution 4.0 International Licence. Observe and retain any copyright or related notices that may accompany this material as part of the attribution.',
  );
  assert.equal(OGC_SOURCE_CREDITS['vic-parks'], 'State of Victoria (DataVic)');
  assert.equal(OGC_SOURCE_CREDITS['vic-recreation-tracks'], 'State of Victoria (DataVic)');
  assert.equal(OGC_SOURCE_CREDITS['vic-heritage'], 'State of Victoria (DataVic)');
});
