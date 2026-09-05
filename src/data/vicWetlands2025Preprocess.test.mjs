import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/preprocess-vic-wetlands-2025.mjs');
const FIXTURE_ROOT = path.join(ROOT, 'src/data/fixtures/vic-wetlands-2025');

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('builds the pinned fixture into deterministic bounded cells with public reference fields only', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-'));
  const output = path.join(scratch, 'output');
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--release-manifest', path.join(FIXTURE_ROOT, 'release-manifest.json'),
    '--source', path.join(FIXTURE_ROOT, 'source.geojson'),
    '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'));
  assert.equal(index.sourceId, 'vic-wetlands-2025');
  assert.equal(index.edition, '2025');
  assert.equal(index.featureCount, 3);
  assert.deepEqual(index.publicFields, [
    'id', 'wetlandType', 'waterRegime', 'source', 'sourceConfidence', 'edition', 'referenceOnly',
  ]);

  const cellFiles = (await readdir(path.join(output, 'cells'))).sort();
  assert.deepEqual(cellFiles, [
    '008-016.geojson', '019-008.geojson', '020-007.geojson',
    '020-008.geojson', '021-007.geojson', '021-008.geojson',
  ]);
  const melbourneCell = JSON.parse(await readFile(path.join(output, 'cells/019-008.geojson'), 'utf8'));
  assert.deepEqual(melbourneCell.features[0].properties, {
    id: 'vic-wetlands-2025:W-002',
    wetlandType: 'Permanent open water',
    waterRegime: 'Permanent',
    source: 'Vicmap Hydro',
    sourceConfidence: 'High',
    edition: '2025',
    referenceOnly: true,
  });
  assert.equal(JSON.stringify(melbourneCell).includes('PRIVATE_NOTE'), false);
  assert.deepEqual(melbourneCell.features[0].geometry.coordinates[0], [
    [144.9, -37.9], [145, -37.9], [145, -37.8], [144.9, -37.8], [144.9, -37.9],
  ]);
});

test('converts a hash-pinned SHP ZIP through GDAL before applying the same bounded transform', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-zip-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const archive = path.join(scratch, 'WETLANDCURRENT_SHP.zip');
  const archiveBytes = Buffer.from('PK\u0003\u0004fixture archive');
  await writeFile(archive, archiveBytes);
  const manifest = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  manifest.sourceArchive = {
    fileName: path.basename(archive),
    bytes: archiveBytes.length,
    sha256: digest(archiveBytes),
    shapefilePath: 'nested/export/WETLAND_CURRENT.shp',
  };
  const manifestPath = path.join(scratch, 'release-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

  const fakeGdal = path.join(scratch, 'ogr2ogr');
  await writeFile(fakeGdal, `#!/usr/bin/env node
const fs = require('node:fs');
const expected = ['-f', 'GeoJSONSeq', '/vsistdout/', '/vsizip/' + process.env.VIC_WETLANDS_TEST_ARCHIVE + '/nested/export/WETLAND_CURRENT.shp', '-t_srs', 'EPSG:4326', '-lco', 'RS=YES'];
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(expected)) process.exit(64);
const input = JSON.parse(fs.readFileSync(process.env.VIC_WETLANDS_TEST_FIXTURE, 'utf8'));
for (const feature of input.features) process.stdout.write(String.fromCharCode(30) + JSON.stringify(feature) + '\\n');
`);
  await chmod(fakeGdal, 0o755);
  const output = path.join(scratch, 'output');
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--release-manifest', manifestPath,
    '--source', archive,
    '--out-dir', output,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${scratch}${path.delimiter}${process.env.PATH}`,
      VIC_WETLANDS_TEST_ARCHIVE: archive,
      VIC_WETLANDS_TEST_FIXTURE: path.join(FIXTURE_ROOT, 'source.geojson'),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'));
  assert.equal(index.featureCount, 3);
  assert.equal(index.sourceArchive.sha256, digest(archiveBytes));
});

test('downloads only the manifest-pinned DataShare archive and publishes it after hash verification', async (t) => {
  const module = await import('../../scripts/preprocess-vic-wetlands-2025.mjs');
  assert.equal(typeof module.downloadPinnedArchive, 'function');
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-download-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const bytes = Buffer.from('PK\u0003\u0004verified download');
  const manifest = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  manifest.sourceArchive = {
    fileName: 'WETLANDCURRENT_SHP.zip',
    bytes: bytes.length,
    sha256: digest(bytes),
    shapefilePath: 'nested/WETLAND_CURRENT.shp',
    downloadUrl: 'https://datashare.maps.vic.gov.au/downloads/pinned/WETLANDCURRENT_SHP.zip',
  };
  const requests = [];
  const destination = path.join(scratch, manifest.sourceArchive.fileName);
  await module.downloadPinnedArchive({
    manifest,
    destinationPath: destination,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 5));
          controller.enqueue(bytes.subarray(5));
          controller.close();
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      });
    },
  });

  assert.deepEqual(requests, [{
    url: manifest.sourceArchive.downloadUrl,
    options: { headers: { Accept: 'application/zip' }, redirect: 'error' },
  }]);
  assert.deepEqual(await readFile(destination), bytes);
});

test('does not publish the pinned DataShare download URL in the public index', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-public-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  manifest.sourceArchive.downloadUrl = 'https://datashare.maps.vic.gov.au/downloads/pinned/private-token.zip';
  const manifestPath = path.join(scratch, 'release-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const output = path.join(scratch, 'output');
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--release-manifest', manifestPath,
    '--source', path.join(FIXTURE_ROOT, 'source.geojson'),
    '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'));
  assert.deepEqual(index.sourceArchive, {
    fileName: manifest.sourceArchive.fileName,
    bytes: manifest.sourceArchive.bytes,
    sha256: manifest.sourceArchive.sha256,
  });
});

test('uses the pinned archive for edition proof and retains optional source confidence as null', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-optional-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'source.geojson'), 'utf8'));
  fixture.features = [structuredClone(fixture.features[1])];
  fixture.features[0].properties.VERS_DATE = '2021-09-21';
  delete fixture.features[0].properties.EX_DATASET;
  delete fixture.features[0].properties.WTRREG_CON;
  const source = path.join(scratch, 'optional.geojson');
  const sourceBytes = Buffer.from(`${JSON.stringify(fixture)}\n`);
  await writeFile(source, sourceBytes);
  const manifest = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  manifest.sourceArchive = {
    fileName: path.basename(source),
    bytes: sourceBytes.length,
    sha256: digest(sourceBytes),
  };
  const manifestPath = path.join(scratch, 'release-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const output = path.join(scratch, 'output');
  const result = spawnSync(process.execPath, [
    SCRIPT, '--release-manifest', manifestPath, '--source', source, '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const cell = JSON.parse(await readFile(path.join(output, 'cells/008-016.geojson'), 'utf8'));
  assert.equal(cell.features[0].properties.edition, '2025');
  assert.equal(cell.features[0].properties.source, null);
  assert.equal(cell.features[0].properties.sourceConfidence, null);
});

test('keeps distinct features when the official wetland number is reused', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-duplicate-number-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'source.geojson'), 'utf8'));
  fixture.features = fixture.features.slice(0, 2);
  fixture.features[0].properties.WETLAND_NO = 7;
  fixture.features[1].properties.WETLAND_NO = 7;
  const source = path.join(scratch, 'duplicate-number.geojson');
  const sourceBytes = Buffer.from(`${JSON.stringify(fixture)}\n`);
  await writeFile(source, sourceBytes);
  const manifest = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  manifest.sourceArchive = {
    fileName: path.basename(source),
    bytes: sourceBytes.length,
    sha256: digest(sourceBytes),
  };
  const manifestPath = path.join(scratch, 'release-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const output = path.join(scratch, 'output');
  const result = spawnSync(process.execPath, [
    SCRIPT, '--release-manifest', manifestPath, '--source', source, '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'));
  assert.equal(index.featureCount, 2);
  const ids = new Set();
  for (const cellEntry of index.cells) {
    const cell = JSON.parse(await readFile(path.join(output, cellEntry.path), 'utf8'));
    for (const feature of cell.features) ids.add(feature.properties.id);
  }
  assert.equal(ids.size, 2);
  assert.equal([...ids].every((id) => id.startsWith('vic-wetlands-2025:7')), true);
});

test('retains a valid tiny official polygon when simplification would collapse its ring', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-tiny-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const fixture = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'source.geojson'), 'utf8'));
  fixture.features = [structuredClone(fixture.features[0])];
  fixture.features[0].properties.WTLND_TYPE = fixture.features[0].properties.WETLANDTYP;
  fixture.features[0].properties.WAT_REGIME = fixture.features[0].properties.WTRREG;
  fixture.features[0].properties.SRCDATANAM = fixture.features[0].properties.EX_DATASET;
  fixture.features[0].properties.WATREGCONF = fixture.features[0].properties.WTRREG_CON;
  delete fixture.features[0].properties.WETLANDTYP;
  delete fixture.features[0].properties.WTRREG;
  delete fixture.features[0].properties.EX_DATASET;
  delete fixture.features[0].properties.WTRREG_CON;
  fixture.features[0].geometry.coordinates = [[
    [145, -37], [145.00001, -37], [145.00001, -36.99999],
    [145, -36.99999], [145, -37],
  ], [
    [145.000004, -36.999996], [145.0000041, -36.999996],
    [145.0000041, -36.9999959], [145.000004, -36.999996],
  ]];
  const source = path.join(scratch, 'tiny.geojson');
  const sourceBytes = Buffer.from(`${JSON.stringify(fixture)}\n`);
  await writeFile(source, sourceBytes);
  const manifest = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  manifest.sourceArchive = {
    fileName: path.basename(source),
    bytes: sourceBytes.length,
    sha256: digest(sourceBytes),
  };
  const manifestPath = path.join(scratch, 'release-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  const output = path.join(scratch, 'output');
  const result = spawnSync(process.execPath, [
    SCRIPT, '--release-manifest', manifestPath, '--source', source, '--out-dir', output,
  ], { cwd: ROOT, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const index = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'));
  const cell = JSON.parse(await readFile(path.join(output, index.cells[0].path), 'utf8'));
  assert.equal(cell.features[0].geometry.coordinates.length, 1);
  assert.equal(cell.features[0].geometry.coordinates[0].length, 5);
});

test('fails closed on release identity, source hash, feature, and geometry limit drift', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'vic-wetlands-2025-limits-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const original = JSON.parse(await readFile(path.join(FIXTURE_ROOT, 'release-manifest.json'), 'utf8'));
  const cases = [
    {
      name: 'resource identity',
      mutate: (manifest) => { manifest.resourceId = '00000000-0000-4000-8000-000000000000'; },
      error: /pinned 2025 SHP resource/i,
    },
    {
      name: 'source hash',
      mutate: (manifest) => { manifest.sourceArchive.sha256 = '0'.repeat(64); },
      error: /SHA-256 does not match/i,
    },
    {
      name: 'feature cap',
      mutate: (manifest) => { manifest.limits.maxFeatures = 2; },
      error: /feature limit/i,
    },
    {
      name: 'geometry cap',
      mutate: (manifest) => { manifest.limits.maxCoordinatesPerFeature = 4; },
      error: /geometry limits/i,
    },
    {
      name: 'official attribution',
      mutate: (manifest) => { manifest.attribution = 'State of Victoria'; },
      error: /attribution.*pinned/i,
    },
    {
      name: 'numeric transform',
      mutate: (manifest) => { manifest.transform.gridDegrees = '0.25'; },
      error: /gridDegrees.*number/i,
    },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const manifest = structuredClone(original);
      entry.mutate(manifest);
      const manifestPath = path.join(scratch, `${entry.name.replace(' ', '-')}.json`);
      const output = path.join(scratch, `${entry.name.replace(' ', '-')}-output`);
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
      const result = spawnSync(process.execPath, [
        SCRIPT,
        '--release-manifest', manifestPath,
        '--source', path.join(FIXTURE_ROOT, 'source.geojson'),
        '--out-dir', output,
      ], { cwd: ROOT, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, entry.error);
      await assert.rejects(() => stat(output), { code: 'ENOENT' });
    });
  }
});
