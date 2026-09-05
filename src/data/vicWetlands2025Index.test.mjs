import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURE_ROOT = path.join(ROOT, 'src/data/fixtures/vic-wetlands-2025');

async function builtFixture(t) {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-index-'));
  const output = path.join(scratch, 'output');
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/preprocess-vic-wetlands-2025.mjs'),
    '--release-manifest', path.join(FIXTURE_ROOT, 'release-manifest.json'),
    '--source', path.join(FIXTURE_ROOT, 'source.geojson'),
    '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return {
    output,
    index: JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8')),
  };
}

test('queries only integrity-checked viewport cells and fails closed at strict request limits', async (t) => {
  const module = await import('./vicWetlands2025Index.js').catch(() => ({}));
  assert.equal(typeof module.queryVicWetlands2025Index, 'function');
  const { output, index } = await builtFixture(t);
  const loaded = [];
  const loadCell = async (cell) => {
    loaded.push(cell.id);
    return readFile(path.join(output, cell.path));
  };
  const result = await module.queryVicWetlands2025Index({
    index,
    bbox: { west: 144.85, south: -37.95, east: 145.05, north: -37.75 },
    maxFeatures: 10,
    loadCell,
  });

  assert.deepEqual(loaded.sort(), ['019-008', '020-008']);
  assert.deepEqual(result.features.map((feature) => feature.properties.id), ['vic-wetlands-2025:W-002']);
  assert.equal(result.referenceOnly, true);
  await assert.rejects(() => module.queryVicWetlands2025Index({
    index,
    bbox: { west: 140.5, south: -39.5, east: 150.5, north: -33.5 },
    maxFeatures: 10,
    loadCell,
  }), /viewport limit/i);
  await assert.rejects(() => module.queryVicWetlands2025Index({
    index,
    bbox: { west: 144.85, south: -37.95, east: 145.05, north: -37.75 },
    maxFeatures: 501,
    loadCell,
  }), /feature limit/i);
  await assert.rejects(() => module.queryVicWetlands2025Index({
    index,
    bbox: { west: 144.85, south: -37.95, east: 145.05, north: -37.75 },
    maxFeatures: 10,
    loadCell: async (cell) => {
      const bytes = await readFile(path.join(output, cell.path));
      bytes[10] ^= 1;
      return bytes;
    },
  }), /SHA-256/i);
});

test('charges geometry once after cross-cell deduplication', async () => {
  const module = await import('./vicWetlands2025Index.js');
  const ring = Array.from({ length: 260_000 }, () => [144.99, -37.9]);
  ring.push(ring[0]);
  const feature = {
    type: 'Feature',
    properties: {
      id: 'vic-wetlands-2025:large', wetlandType: 'Lake', waterRegime: 'Permanent',
      source: null, sourceConfidence: null, edition: '2025', referenceOnly: true,
    },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
  const bytes = Buffer.from(`${JSON.stringify({ type: 'FeatureCollection', features: [feature] })}\n`);
  const cellHash = createHash('sha256').update(bytes).digest('hex');
  const cells = [
    { id: 'a', bbox: { west: 144.8, south: -38, east: 145, north: -37.75 } },
    { id: 'b', bbox: { west: 144.9, south: -38, east: 145.1, north: -37.75 } },
    { id: 'c', bbox: { west: 144.8, south: -37.95, east: 145, north: -37.7 } },
    { id: 'd', bbox: { west: 144.9, south: -37.95, east: 145.1, north: -37.7 } },
  ].map((cell) => ({ ...cell, path: `${cell.id}.geojson`, featureCount: 1, bytes: bytes.length, sha256: cellHash }));
  const index = {
    schemaVersion: 1,
    sourceId: 'vic-wetlands-2025',
    edition: '2025',
    resourceId: 'a7069c00-29e4-407f-89f2-7a9da546b4a1',
    referenceOnly: true,
    cells,
  };

  const result = await module.queryVicWetlands2025Index({
    index,
    bbox: { west: 144.85, south: -37.95, east: 145.05, north: -37.75 },
    maxFeatures: 1,
    loadCell: async () => bytes,
  });
  assert.equal(result.features.length, 1);
});
