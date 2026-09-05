import test from 'node:test';
import assert from 'node:assert/strict';
import { createAihwHospitalEd } from './aihwHospitalEd.js';

function json(value) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}

test('loads only viewport hospitals and fixed historical ED measures', async () => {
  const requests = [];
  const client = createAihwHospitalEd({
    now: () => Date.UTC(2026, 8, 5),
    fetchImpl: async (input) => {
      const url = new URL(input);
      requests.push(url);
      if (url.pathname.endsWith('/reporting-units')) return json({
        result: [
          { reporting_unit_code: 'H-MEL', reporting_unit_type: { reporting_unit_type_code: 'H' }, longitude: 144.96, latitude: -37.81 },
          { reporting_unit_code: 'H-SYD', reporting_unit_type: { reporting_unit_type_code: 'H' }, longitude: 151.2, latitude: -33.8 },
        ],
        version_information: { data_version: 1, date_uploaded: '2026-05-28' },
      });
      return json({
        result: { data: [{ reporting_unit_code: 'H-MEL' }], pagination: { total_results_available: 1 } },
        version_information: { data_version: 1, date_uploaded: '2026-05-28' },
      });
    },
  });
  const result = await client.load({ bbox: { west: 144.9, south: -37.9, east: 145, north: -37.7 }, maxFeatures: 10 });
  assert.deepEqual(result.reportingUnits.result.map((unit) => unit.reporting_unit_code), ['H-MEL']);
  assert.equal(result.extract.result.data.length, 1);
  const extract = requests[1];
  assert.deepEqual(extract.searchParams.getAll('measure_code'), ['MYH0010', 'MYH0011']);
  assert.deepEqual(extract.searchParams.getAll('reporting_unit_code'), ['H-MEL']);
  assert.equal(extract.searchParams.get('start_date'), '2024-01-01');
  assert.equal(extract.searchParams.get('top'), '10');
});

test('caches reporting units across viewport loads', async () => {
  let unitCalls = 0;
  const client = createAihwHospitalEd({ fetchImpl: async (input) => {
    if (String(input).includes('reporting-units')) {
      unitCalls += 1;
      return json({ result: [], version_information: { data_version: 1, date_uploaded: '2026-05-28' } });
    }
    throw new Error('extract should not run for an empty viewport');
  } });
  const bbox = { west: 144.9, south: -37.9, east: 145, north: -37.7 };
  await client.load({ bbox, maxFeatures: 10 });
  await client.load({ bbox, maxFeatures: 10 });
  assert.equal(unitCalls, 1);
});
