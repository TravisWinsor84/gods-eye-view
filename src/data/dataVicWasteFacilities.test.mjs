import test from 'node:test';
import assert from 'node:assert/strict';

let wasteModule = {};
try {
  wasteModule = await import('./dataVicWasteFacilities.js');
} catch {
  // The first TDD run intentionally exercises the missing implementation.
}

test('builds a fixed DataVic DataStore query without private facility fields', () => {
  assert.equal(typeof wasteModule.dataVicWasteRequest, 'function');
  const url = wasteModule.dataVicWasteRequest({ offset: 100, limit: 200 });
  assert.equal(`${url.origin}${url.pathname}`, 'https://discover.data.vic.gov.au/api/3/action/datastore_search');
  assert.equal(url.searchParams.get('resource_id'), 'e44f5d96-51e8-48ec-b674-299d100a0231');
  assert.equal(url.searchParams.get('offset'), '100');
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(url.searchParams.get('fields'), 'Facility Name,Facility Type,Infrastructure Type,Suburb,LGA,Latitude,Longitude');
  assert.doesNotMatch(url.searchParams.get('fields'), /Facility Owner|Address|_id/i);
  assert.throws(() => wasteModule.dataVicWasteRequest({ offset: -1, limit: 200 }), /invalid DataVic waste page/i);
  assert.throws(() => wasteModule.dataVicWasteRequest({ offset: 0, limit: 501 }), /invalid DataVic waste page/i);
});

test('normalizes waste facilities as bounded reference points without owner or address data', () => {
  assert.equal(typeof wasteModule.normalizeDataVicWastePayload, 'function');
  const result = wasteModule.normalizeDataVicWastePayload({
    success: true,
    result: {
      total: 663,
      records: [{
        _id: 1,
        'Facility Name': 'Grantville <b>Transfer</b> Station',
        'Facility Owner': 'Private owner',
        'Facility Type': 'Landfill',
        'Infrastructure Type': 'Landfill putrescible',
        Address: '1685 Bass Highway',
        Suburb: 'Grantville',
        LGA: 'Bass Coast',
        Latitude: '-38.420836',
        Longitude: '145.5196345',
      }],
    },
  }, { maxFeatures: 100 });

  assert.deepEqual(result.features, [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [145.5196345, -38.420836] },
    properties: {
      sourceId: 'vic-waste-facilities',
      title: 'Grantville Transfer Station',
      facilityType: 'Landfill',
      infrastructureType: 'Landfill putrescible',
      suburb: 'Grantville',
      lga: 'Bass Coast',
      referenceOnly: true,
      caveat: 'October 2025 reference snapshot; inclusion does not imply the facility is currently operating.',
    },
  }]);
  assert.equal(result.total, 663);
  assert.equal(result.invalidRows, 0);
  assert.doesNotMatch(JSON.stringify(result), /Private owner|1685 Bass|_id/);
});

test('resolves official metadata, pages the fixed resource, and reuses one bounded viewport index', async () => {
  assert.equal(typeof wasteModule.createDataVicWasteFacilities, 'function');
  const requests = [];
  const metadata = {
    success: true,
    result: {
      id: '729d86ce-aae3-4f67-992c-3a7f8fa3823a',
      name: 'victoria-s-waste-and-resource-recovery-infrastructure-map-data',
      license_title: 'Creative Commons Attribution 4.0 International',
      metadata_modified: '2026-02-06T21:59:51.870692',
      resources: [{
        id: 'e44f5d96-51e8-48ec-b674-299d100a0231',
        name: 'October 2025',
        format: 'CSV',
        datastore_active: true,
      }],
    },
  };
  const row = (index) => ({
    'Facility Name': `Facility ${index}`,
    'Facility Type': 'Resource recovery centre',
    'Infrastructure Type': 'Transfer station',
    Suburb: index === 662 ? 'Outside' : 'Melbourne',
    LGA: index === 662 ? 'Sydney' : 'Melbourne',
    Latitude: index === 662 ? '-33.86' : String(-37.82 + index / 1_000_000),
    Longitude: index === 662 ? '151.21' : String(144.96 + index / 1_000_000),
  });
  const firstPage = Array.from({ length: 500 }, (_, index) => row(index));
  const secondPage = Array.from({ length: 163 }, (_, index) => row(index + 500));
  const response = (value) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const client = wasteModule.createDataVicWasteFacilities({
    now: () => Date.parse('2026-09-05T12:00:00Z'),
    fetchImpl: async (url) => {
      requests.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/package_show')) return response(metadata);
      const offset = Number(parsed.searchParams.get('offset'));
      return response({ success: true, result: { total: 663, records: offset === 0 ? firstPage : secondPage } });
    },
  });

  const first = await client.load({
    bbox: { west: 144.9, south: -37.9, east: 145.1, north: -37.7 },
    maxFeatures: 100,
  });
  const second = await client.load({
    bbox: { west: 144.95, south: -37.9, east: 145.2, north: -37.7 },
    maxFeatures: 10,
  });

  assert.equal(requests.length, 3);
  assert.match(requests[0], /package_show\?id=victoria-s-waste-and-resource-recovery-infrastructure-map-data$/);
  assert.equal(new URL(requests[1]).searchParams.get('offset'), '0');
  assert.equal(new URL(requests[2]).searchParams.get('offset'), '500');
  assert.equal(first.features.length, 100);
  assert.equal(second.features.length, 10);
  assert.equal(first.sourceStatus.status, 'partial');
  assert.equal(first.sourceStatus.totalRows, 663);
  assert.equal(first.sourceStatus.indexedRows, 663);
  assert.equal(first.sourceStatus.snapshot, 'October 2025');
  assert.equal(first.sourceStatus.metadataModifiedAt, '2026-02-06T21:59:51.870Z');
  assert.equal(first.sourceStatus.capped, true);
  assert.equal(first.sourceStatus.cache, 'miss');
  assert.equal(second.sourceStatus.cache, 'hit');
  assert.ok(first.features.every((feature) => /^vic-waste-facilities-[0-9a-f]{24}$/.test(feature.id)));
  assert.equal(new Set(first.features.map((feature) => feature.id)).size, first.features.length);
  assert.doesNotMatch(JSON.stringify(first), /Facility Owner|Address|private/i);
});

test('coalesces concurrent cold loads into one metadata and page refresh', async () => {
  let releaseMetadata;
  const metadataGate = new Promise((resolve) => { releaseMetadata = resolve; });
  const requests = [];
  const response = (value) => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const metadata = {
    success: true,
    result: {
      id: '729d86ce-aae3-4f67-992c-3a7f8fa3823a',
      name: 'victoria-s-waste-and-resource-recovery-infrastructure-map-data',
      license_title: 'Creative Commons Attribution 4.0 International',
      metadata_modified: '2026-02-06T21:59:51.870692',
      resources: [{
        id: 'e44f5d96-51e8-48ec-b674-299d100a0231',
        name: 'October 2025', format: 'CSV', datastore_active: true,
      }],
    },
  };
  const client = wasteModule.createDataVicWasteFacilities({
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).includes('/package_show')) {
        await metadataGate;
        return response(metadata);
      }
      return response({
        success: true,
        result: {
          total: 1,
          records: [{
            'Facility Name': 'Shared facility', 'Facility Type': 'Reprocessor',
            'Infrastructure Type': 'Organics recycling', Suburb: 'Melbourne', LGA: 'Melbourne',
            Latitude: '-37.81', Longitude: '144.96',
          }],
        },
      });
    },
  });
  const query = { bbox: { west: 144, south: -38, east: 146, north: -37 }, maxFeatures: 10 };
  const first = client.load(query);
  const second = client.load(query);
  await Promise.resolve();
  const metadataRequests = requests.filter((url) => url.includes('/package_show')).length;
  releaseMetadata();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(metadataRequests, 1);
  assert.deepEqual(left.features, right.features);
  assert.equal(requests.length, 2);
});
