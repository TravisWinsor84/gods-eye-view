import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapContext, clampContextLabel } from './mapContext.js';

test('buildMapContext presents a resolved Melbourne hierarchy', () => {
  const context = buildMapContext({
    location: {
      name: ' Melbourne ',
      suburb: ' Melbourne ',
      state: ' Victoria ',
      country: ' Australia ',
      latitude: -37.8136,
      longitude: 144.9631,
    },
  });

  assert.equal(context.title, 'Melbourne');
  assert.equal(context.accessibleTitle, 'Melbourne');
  assert.equal(context.hierarchy, 'Melbourne · Victoria · Australia');
  assert.equal(context.coordinates, '-37.8136, 144.9631');
});

test('buildMapContext falls back to readable coordinates for an unresolved location', () => {
  const context = buildMapContext({ location: { longitude: 144.9631, latitude: -37.8136 } });

  assert.equal(context.title, '-37.8136, 144.9631');
  assert.equal(context.hierarchy, 'Location not resolved');
  assert.equal(context.coordinates, '-37.8136, 144.9631');
});

test('buildMapContext rejects non-finite and out-of-range coordinates as unresolved', () => {
  for (const location of [
    { latitude: Number.NaN, longitude: 144.9631 },
    { latitude: -37.8136, longitude: Number.POSITIVE_INFINITY },
    { latitude: 90.0001, longitude: 144.9631 },
    { latitude: -90.0001, longitude: 144.9631 },
    { latitude: -37.8136, longitude: 180.0001 },
    { latitude: -37.8136, longitude: -180.0001 },
  ]) {
    const context = buildMapContext({ location });
    assert.equal(context.title, 'Location not resolved');
    assert.equal(context.hierarchy, 'Location not resolved');
    assert.equal(context.coordinates, null);
  }
});

test('clampContextLabel normalizes whitespace and bounds a very long label while preserving it accessibly', () => {
  const fullLabel = '   Central    Melbourne   '.repeat(20);
  const label = clampContextLabel(fullLabel);
  const context = buildMapContext({ location: { name: fullLabel } });

  assert.equal(label.length, 120);
  assert.match(label, /…$/);
  assert.equal(context.title, label);
  assert.equal(context.accessibleTitle, 'Central Melbourne '.repeat(20).trim());
});

test('buildMapContext rejects an unsafe official URL', () => {
  const context = buildMapContext({
    sources: [{ name: 'EPA Victoria', officialUrl: 'javascript:alert(1)', observedAt: '2026-09-05T10:00:00Z' }],
  });

  assert.equal(context.officialUrl, null);
  assert.match(context.sourceSummary, /EPA Victoria/);
  assert.match(context.sourceSummary, /official link unavailable/i);
});

test('buildMapContext explains selected camera orientation', () => {
  const context = buildMapContext({
    camera: { label: 'Yarra River view', heading: 90, pitch: -35 },
  });

  assert.match(context.explanation, /Yarra River view/);
  assert.match(context.explanation, /east/i);
  assert.match(context.explanation, /35° down/i);
});

test('buildMapContext counts active overlays', () => {
  const context = buildMapContext({
    enabledLayers: [
      { id: 'roads', enabled: true },
      { id: 'cameras', enabled: false },
      'regional-civic-status',
    ],
  });

  assert.match(context.sourceSummary, /2 active overlays/);
});

test('buildMapContext uses selected official feature provenance', () => {
  const context = buildMapContext({
    selection: {
      label: ' Royal Melbourne Hospital ',
      type: 'hospital system pressure',
      source: ' Victorian Department of Health ',
      officialUrl: 'https://www.health.vic.gov.au/',
    },
  });

  assert.equal(context.explanation, 'Selected hospital system pressure: Royal Melbourne Hospital');
  assert.equal(context.officialUrl, 'https://www.health.vic.gov.au/');
  assert.match(context.sourceSummary, /Victorian Department of Health/);
});

test('buildMapContext marks stale source data while retaining last-good provenance', () => {
  const context = buildMapContext({
    sources: [{
      name: 'EPA Victoria',
      observedAt: '2026-09-05T10:00:00Z',
      stale: true,
      officialUrl: 'https://epa.vic.gov.au/',
    }],
    now: '2026-09-05T11:00:00Z',
  });

  assert.equal(context.isStale, true);
  assert.equal(context.officialUrl, 'https://epa.vic.gov.au/');
  assert.match(context.sourceSummary, /EPA Victoria.*stale.*2026-09-05T10:00:00Z/i);
});

test('buildMapContext makes error and unavailable sources explicit', () => {
  const context = buildMapContext({
    sources: [
      { name: 'VicRoads', status: 'error', reason: 'Timed out' },
      { name: 'City cameras', available: false, reason: 'Display terms not validated' },
    ],
  });

  assert.match(context.sourceSummary, /VicRoads unavailable: Timed out/);
  assert.match(context.sourceSummary, /City cameras unavailable: Display terms not validated/);
  assert.equal(context.officialUrl, null);
});

test('context preserves evidenced freshness classes, exact time, age and sanitized errors per source', () => {
  const now = Date.parse('2026-09-05T12:00:00Z');
  const context = buildMapContext({
    now,
    sources: [
      { sourceId: 'live', name: 'Live vehicles', status: 'current', freshnessClass: 'live', observedAt: '2026-09-05T11:59:00Z', officialUrl: 'https://transport.vic.gov.au/' },
      { sourceId: 'recent', name: 'Recent facilities', status: 'partial', freshnessClass: 'recent', observedAt: '2026-09-05T10:00:00Z' },
      { sourceId: 'reference', name: 'Reference boundaries', status: 'zoom-required', freshnessClass: 'reference' },
      { sourceId: 'historical', name: 'Historical flood', status: 'stale', freshnessClass: 'historical', observedAt: '2022-11-01T00:00:00Z' },
      { sourceId: 'modelled', name: 'Modelled layer', status: 'credentials-required', freshnessClass: 'modelled', error: '  API\u0000 key   required  ' },
    ],
  });

  assert.deepEqual(context.sources.map((source) => source.freshnessClass), [
    'live', 'recent', 'reference', 'historical', 'modelled',
  ]);
  assert.equal(context.sources[0].observedAt, '2026-09-05T11:59:00.000Z');
  assert.equal(context.sources[0].ageMs, 60_000);
  assert.equal(context.sources[2].ageMs, null);
  assert.equal(context.sources[4].error, 'API key required');
  assert.equal(context.sources[0].officialUrl, 'https://transport.vic.gov.au/');
});

test('context never invents a freshness class without timestamp or cadence evidence', () => {
  const context = buildMapContext({ sources: [{ sourceId: 'unknown', name: 'Unknown source', status: 'current' }] });
  assert.equal(context.sources[0].freshnessClass, null);
  assert.equal(context.sources[0].ageMs, null);
});
