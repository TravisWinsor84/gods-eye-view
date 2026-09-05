import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIONAL_IMAGERY_SOURCES,
  buildRegionalImageryUrl,
} from './regionalImagery.js';

const REQUEST = Object.freeze({
  west: 144,
  south: -39,
  east: 146,
  north: -37,
  width: 512,
  height: 256,
});

test('registry exposes only the imagery contract verified against current official metadata', () => {
  assert.deepEqual(Object.keys(REGIONAL_IMAGERY_SOURCES), ['au-dea-land-cover']);
  assert.equal(Object.isFrozen(REGIONAL_IMAGERY_SOURCES), true);
  assert.equal(Object.isFrozen(REGIONAL_IMAGERY_SOURCES['au-dea-land-cover']), true);

  // Verified 2026-09-05: water_observations is a style rather than a layer;
  // the relief WMS returns 403; seismic show:0 is only coast/state borders.
  for (const rejectedId of ['au-dea-water-history', 'au-ga-relief', 'au-seismic-hazard']) {
    assert.equal(REGIONAL_IMAGERY_SOURCES[rejectedId], undefined);
  }
});

test('DEA land cover URL pins host, layer, style, annual time, CRS and PNG output', () => {
  const url = buildRegionalImageryUrl('au-dea-land-cover', REQUEST);

  assert.equal(url.origin, 'https://ows.dea.ga.gov.au');
  assert.equal(url.pathname, '/');
  assert.equal(url.searchParams.get('service'), 'WMS');
  assert.equal(url.searchParams.get('request'), 'GetMap');
  assert.equal(url.searchParams.get('version'), '1.3.0');
  assert.equal(url.searchParams.get('layers'), 'ga_ls_landcover');
  assert.equal(url.searchParams.get('styles'), 'level3');
  assert.equal(url.searchParams.get('time'), '2020-01-01');
  assert.equal(url.searchParams.get('crs'), 'EPSG:3857');
  assert.equal(url.searchParams.get('format'), 'image/png');
  assert.equal(url.searchParams.get('transparent'), 'true');
  assert.equal(url.searchParams.get('width'), '512');
  assert.equal(url.searchParams.get('height'), '256');
  assert.equal(
    url.searchParams.get('bbox'),
    '16030006.674231393,-4721671.57258011,16252645.655817943,-4439106.787250587',
  );
});

test('URL builder rejects unregistered IDs instead of accepting an upstream URL', () => {
  assert.throws(
    () => buildRegionalImageryUrl('https://attacker.invalid/wms', REQUEST),
    /unknown regional imagery source/i,
  );
  assert.throws(
    () => buildRegionalImageryUrl('au-seismic-hazard', REQUEST),
    /unknown regional imagery source/i,
  );
});
