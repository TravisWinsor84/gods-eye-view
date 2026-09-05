import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createVicWetlands2025Server } from './vicWetlands2025Server.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURE_ROOT = path.join(ROOT, 'src/data/fixtures/vic-wetlands-2025');

test('serves only the integrity-checked generated wetlands release', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-server-'));
  const output = path.join(scratch, 'output');
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const built = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts/preprocess-vic-wetlands-2025.mjs'),
    '--release-manifest', path.join(FIXTURE_ROOT, 'release-manifest.json'),
    '--source', path.join(FIXTURE_ROOT, 'source.geojson'),
    '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);

  const server = createVicWetlands2025Server({ dataDir: output });
  const result = await server.load({
    bbox: { west: 144.85, south: -37.95, east: 145.05, north: -37.75 },
    maxFeatures: 10,
  });
  assert.equal(result.sourceId, 'vic-wetlands-2025');
  assert.equal(result.referenceOnly, true);
  assert.equal(result.features.length, 1);
  assert.equal(result.sourceStatus.status, 'current');
  assert.match(result.sourceStatus.caveat, /not live water extent/i);
});

test('fails closed for a missing release directory or escaped cell path', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-server-invalid-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const missing = createVicWetlands2025Server({ dataDir: path.join(scratch, 'missing') });
  await assert.rejects(() => missing.load({
    bbox: { west: 144.8, south: -38, east: 145, north: -37.8 }, maxFeatures: 10,
  }), (error) => error.code === 'ARTIFACT_UNAVAILABLE');
});
