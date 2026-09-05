import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransportVicFreight } from './transportVicFreight.js';

const PACKAGE_ID = '088b0dcd-935d-42f8-9b60-8d24eaabe92c';
function json(value, type = 'application/json') { return new Response(JSON.stringify(value), { headers: { 'Content-Type': type } }); }

test('downloads only the fixed road and rail resources, then filters them by viewport', async () => {
  const calls = [];
  const resources = [
    ['11111111-1111-4111-8111-111111111111', 'Principal Freight Network - Road Network', 'road.geojson'],
    ['22222222-2222-4222-8222-222222222222', 'Principal Freight Network - Rail Network', 'rail.geojson'],
  ];
  const client = createTransportVicFreight({ fetchImpl: async (input) => {
    const url = new URL(input); calls.push(url);
    if (url.pathname.includes('/api/3/action/')) return json({ success: true, result: { id: PACKAGE_ID, resources: resources.map(([id, name, file]) => ({
      id, name, format: 'GeoJSON', mimetype: 'application/geo+json', size: 1_000,
      url: `https://opendata.transport.vic.gov.au/dataset/${PACKAGE_ID}/resource/${id}/download/${file}`,
    })) } });
    const road = url.pathname.endsWith('road.geojson');
    return json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: road
      ? [[144.95, -37.82], [144.97, -37.80]] : [[143, -37], [143.1, -37.1]] }, properties: road
      ? { NAME_LABEL: 'City Road', STATUS: 'PFN Road' } : { LINE_NAME: 'Remote rail', STATUS: 'PFN Rail' } }] }, 'application/geo+json');
  } });
  const result = await client.load({ bbox: { west: 144.9, south: -37.9, east: 145, north: -37.7 }, maxFeatures: 10 });
  assert.equal(calls.length, 3);
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].properties, { title: 'City Road', type: 'Road', status: 'PFN Road' });
});
