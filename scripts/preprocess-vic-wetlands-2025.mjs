#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  createReadStream, createWriteStream,
} from 'node:fs';
import {
  appendFile, mkdir, open, readFile, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const OFFICIAL_RELEASE = Object.freeze({
  sourceId: 'vic-wetlands-2025',
  edition: '2025',
  datasetId: '514a3b37-6a42-47c5-a159-dab47cbf752a',
  metadataUuid: '1621d8fc-4afa-5d31-a612-f822c88f4891',
  resourceId: 'a7069c00-29e4-407f-89f2-7a9da546b4a1',
  resourceFormat: 'SHP',
  resourceUrl: 'https://discover.data.vic.gov.au/dataset/victorian-wetland-inventory-current/resource/a7069c00-29e4-407f-89f2-7a9da546b4a1',
  periodEnd: '2025-03-19',
  license: 'Creative Commons Attribution 4.0 International',
  attribution: 'Copyright (c) The State of Victoria, Department of Energy, Environment and Climate Action',
});

export const HARD_LIMITS = Object.freeze({
  maxSourceBytes: 2_147_483_648,
  maxFeatures: 450_000,
  maxCoordinatesPerFeature: 250_000,
  maxCoordinatesTotal: 60_000_000,
  maxRingsPerFeature: 2_048,
  maxCellsPerFeature: 256,
  maxCellBytes: 16_777_216,
  maxOutputBytes: 536_870_912,
});

export const PUBLIC_FIELDS = Object.freeze([
  'id', 'wetlandType', 'waterRegime', 'source', 'sourceConfidence', 'edition', 'referenceOnly',
]);

const VICTORIA_BOUNDS = Object.freeze({ west: 140.5, south: -39.5, east: 150.5, north: -33.5 });
const GRID_ORIGIN = Object.freeze({ longitude: 140, latitude: -40 });

function fail(message) {
  throw new Error(`[vic-wetlands-2025] ${message}`);
}

function parseArgs(argv) {
  const values = {};
  const known = new Set(['--release-manifest', '--source', '--download-to', '--out-dir']);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!known.has(key) || !argv[index + 1]) fail(`unknown or incomplete argument: ${key || '(empty)'}`);
    values[key.slice(2)] = argv[index + 1];
  }
  for (const key of ['release-manifest', 'out-dir']) {
    if (!values[key]) fail(`missing --${key}`);
  }
  if (Boolean(values.source) === Boolean(values['download-to'])) {
    fail('provide exactly one of --source or --download-to');
  }
  return values;
}

function assertReleaseManifest(manifest) {
  if (manifest?.schemaVersion !== 1) fail('release manifest schemaVersion must be 1');
  for (const [key, expected] of Object.entries(OFFICIAL_RELEASE)) {
    if (manifest[key] !== expected) fail(`release manifest ${key} does not identify the pinned 2025 SHP resource`);
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sourceArchive?.sha256 || '')) fail('sourceArchive.sha256 must be lowercase SHA-256');
  if (!Number.isSafeInteger(manifest.sourceArchive?.bytes) || manifest.sourceArchive.bytes <= 0) {
    fail('sourceArchive.bytes must be a positive integer');
  }
  if (String(manifest.sourceArchive?.fileName || '').toLowerCase().endsWith('.zip')) {
    const shapefilePath = manifest.sourceArchive?.shapefilePath;
    if (typeof shapefilePath !== 'string' || shapefilePath.length > 512
      || shapefilePath !== path.posix.normalize(shapefilePath)
      || shapefilePath.startsWith('/') || shapefilePath.includes('\\')
      || shapefilePath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
      || path.posix.basename(shapefilePath).toUpperCase() !== 'WETLAND_CURRENT.SHP') {
      fail('sourceArchive.shapefilePath must safely pin WETLAND_CURRENT.shp inside the ZIP');
    }
  }
  for (const [key, ceiling] of Object.entries(HARD_LIMITS)) {
    const value = manifest.limits?.[key];
    if (!Number.isSafeInteger(value) || value <= 0 || value > ceiling) {
      fail(`limits.${key} must be a positive integer no greater than ${ceiling}`);
    }
  }
  const { gridDegrees, simplifyToleranceDegrees, coordinateDecimals } = manifest.transform || {};
  if (typeof gridDegrees !== 'number' || !Number.isFinite(gridDegrees)
    || !(gridDegrees > 0 && gridDegrees <= 0.25)) {
    fail('transform.gridDegrees must be a finite number in (0, 0.25]');
  }
  if (typeof simplifyToleranceDegrees !== 'number' || !Number.isFinite(simplifyToleranceDegrees)
    || !(simplifyToleranceDegrees >= 0 && simplifyToleranceDegrees <= 0.0001)) {
    fail('transform.simplifyToleranceDegrees must be in [0, 0.0001]');
  }
  if (!Number.isInteger(coordinateDecimals) || coordinateDecimals < 5 || coordinateDecimals > 7) {
    fail('transform.coordinateDecimals must be an integer in [5, 7]');
  }
  return manifest;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(sourcePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(sourcePath)) hash.update(chunk);
  return hash.digest('hex');
}

function pinnedDownloadUrl(manifest) {
  let url;
  try {
    url = new URL(manifest.sourceArchive?.downloadUrl);
  } catch {
    fail('sourceArchive.downloadUrl must be pinned before downloading');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'datashare.maps.vic.gov.au'
    || url.username || url.password || url.hash || url.pathname === '/') {
    fail('sourceArchive.downloadUrl must be a direct HTTPS DataShare archive URL');
  }
  return url.href;
}

export async function downloadPinnedArchive({ manifest: inputManifest, destinationPath, fetchImpl = fetch }) {
  const manifest = assertReleaseManifest(inputManifest);
  const url = pinnedDownloadUrl(manifest);
  if (path.basename(destinationPath) !== manifest.sourceArchive.fileName) {
    fail('download destination file name does not match release manifest');
  }
  if (await stat(destinationPath).then(() => true, () => false)) {
    fail(`download destination already exists: ${destinationPath}`);
  }
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/zip' },
    redirect: 'error',
  });
  if (!response.ok || !response.body) fail(`download failed with HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!['application/zip', 'application/octet-stream'].includes(contentType)) {
    fail(`download returned unexpected content type ${contentType || '(missing)'}`);
  }
  const contentLength = response.headers.get('content-length');
  const declaredBytes = contentLength === null ? null : Number(contentLength);
  if (declaredBytes !== null && (!Number.isFinite(declaredBytes) || declaredBytes !== manifest.sourceArchive.bytes)) {
    fail('download Content-Length does not match release manifest');
  }
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const partialPath = `${destinationPath}.partial-${process.pid}`;
  const handle = await open(partialPath, 'wx');
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > manifest.sourceArchive.bytes || bytes > manifest.limits.maxSourceBytes) {
        fail('download exceeds pinned source byte limit');
      }
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset, null);
        if (bytesWritten <= 0) fail('download write made no progress');
        offset += bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    if (bytes !== manifest.sourceArchive.bytes) fail('download byte length does not match release manifest');
    if (hash.digest('hex') !== manifest.sourceArchive.sha256) fail('download SHA-256 does not match release manifest');
    await rename(partialPath, destinationPath);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(partialPath, { force: true });
    throw error;
  }
  return destinationPath;
}

async function* sourceFeatures(sourcePath, manifest) {
  if (path.extname(sourcePath).toLowerCase() === '.geojson') {
    const collection = JSON.parse(await readFile(sourcePath, 'utf8'));
    if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      fail('GeoJSON source must be a FeatureCollection');
    }
    yield* collection.features;
    return;
  }
  if (path.extname(sourcePath).toLowerCase() !== '.zip') {
    fail('source must be the pinned .zip archive or a deterministic .geojson fixture');
  }
  const header = Buffer.alloc(4);
  const handle = await open(sourcePath, 'r');
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (header[0] !== 0x50 || header[1] !== 0x4b) fail('pinned SHP archive is not a ZIP file');
  const child = spawn('ogr2ogr', [
    '-f', 'GeoJSONSeq', '/vsistdout/', `/vsizip/${sourcePath}/${manifest.sourceArchive.shapefilePath}`,
    '-t_srs', 'EPSG:4326', '-lco', 'RS=YES',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-65_536); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`ogr2ogr failed (${signal || code}): ${stderr.trim()}`));
    });
  });
  try {
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    for await (const rawLine of lines) {
      const line = rawLine.startsWith('\u001e') ? rawLine.slice(1) : rawLine;
      if (line.trim()) yield JSON.parse(line);
    }
    await closed;
  } catch (error) {
    child.kill('SIGTERM');
    await closed.catch(() => {});
    throw error;
  }
}

function segmentDistance(point, start, end) {
  let [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx || dy) {
    const fraction = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    if (fraction > 1) return Math.hypot(x - x2, y - y2);
    if (fraction > 0) {
      x -= x1 + dx * fraction;
      y -= y1 + dy * fraction;
      return Math.hypot(x, y);
    }
  }
  return Math.hypot(x - x1, y - y1);
}

function simplifyOpenRing(points, tolerance) {
  if (points.length <= 2 || tolerance === 0) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let furthest = -1;
    let distance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const candidate = segmentDistance(points[index], points[first], points[last]);
      if (candidate > distance) {
        distance = candidate;
        furthest = index;
      }
    }
    if (furthest !== -1) {
      keep[furthest] = 1;
      stack.push([first, furthest], [furthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

function samePoint(left, right) {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1];
}

function processRing(ring, transform, featureId = '', allowCollapse = false) {
  if (!Array.isArray(ring) || ring.length < 4) fail('polygon ring must contain at least four positions');
  const rounded = ring.map((position) => {
    if (!Array.isArray(position) || position.length < 2
      || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) {
      fail('polygon contains a non-finite coordinate');
    }
    const longitude = Number(position[0].toFixed(transform.coordinateDecimals));
    const latitude = Number(position[1].toFixed(transform.coordinateDecimals));
    if (longitude < VICTORIA_BOUNDS.west || longitude > VICTORIA_BOUNDS.east
      || latitude < VICTORIA_BOUNDS.south || latitude > VICTORIA_BOUNDS.north) {
      fail(`coordinate ${longitude},${latitude} falls outside the bounded Victoria envelope`);
    }
    return [longitude, latitude];
  });
  const open = samePoint(rounded[0], rounded.at(-1)) ? rounded.slice(0, -1) : rounded;
  const simplified = simplifyOpenRing(open, transform.simplifyToleranceDegrees);
  let deduplicated = simplified.filter((position, index) => index === 0 || !samePoint(position, simplified[index - 1]));
  if (deduplicated.length < 3) {
    deduplicated = open.filter((position, index) => index === 0 || !samePoint(position, open[index - 1]));
  }
  if (deduplicated.length < 3) {
    if (allowCollapse) return null;
    fail(`${featureId ? `${featureId} ` : ''}simplification collapsed a polygon ring`);
  }
  return [...deduplicated, [...deduplicated[0]]];
}

function geometryParts(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  fail(`unsupported geometry type: ${geometry?.type || '(missing)'}`);
}

function featureIdentity(properties) {
  return String(properties?.WETLAND_NO ?? properties?.wetland_no ?? '').trim();
}

function requiredText(properties, names, label) {
  for (const name of names) {
    const value = properties?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim().slice(0, 160);
  }
  fail(`feature is missing ${label}`);
}

function optionalText(properties, names) {
  for (const name of names) {
    const value = properties?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim().slice(0, 160);
  }
  return null;
}

function processFeature(feature, manifest, counters) {
  const sourceId = featureIdentity(feature?.properties);
  if (!sourceId) fail('feature is missing WETLAND_NO');

  const polygons = geometryParts(feature.geometry);
  let rings = 0;
  let inputCoordinates = 0;
  let outputCoordinates = 0;
  const processed = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) fail(`${sourceId} has an empty polygon`);
    const outputRings = [];
    for (const [ringIndex, ring] of polygon.entries()) {
      rings += 1;
      inputCoordinates += Array.isArray(ring) ? ring.length : 0;
      if (rings > manifest.limits.maxRingsPerFeature
        || inputCoordinates > manifest.limits.maxCoordinatesPerFeature) {
        fail(`${sourceId} exceeds per-feature geometry limits`);
      }
      const outputRing = processRing(ring, manifest.transform, sourceId, ringIndex > 0);
      if (outputRing === null) continue;
      outputCoordinates += outputRing.length;
      outputRings.push(outputRing);
    }
    processed.push(outputRings);
  }
  counters.inputCoordinates += inputCoordinates;
  counters.outputCoordinates += outputCoordinates;
  if (counters.inputCoordinates > manifest.limits.maxCoordinatesTotal) fail('source exceeds total coordinate limit');

  const properties = {
    id: null,
    wetlandType: requiredText(feature.properties, ['WTLND_TYPE', 'WETLANDTYP', 'WETLAND_TYPE'], 'WTLND_TYPE'),
    waterRegime: requiredText(feature.properties, ['WAT_REGIME', 'WTRREG', 'WATER_REGIME'], 'WAT_REGIME'),
    source: optionalText(feature.properties, ['SRCDATANAM', 'EX_DATASET', 'SOURCE_DATASET']),
    sourceConfidence: optionalText(feature.properties, ['WATREGCONF', 'WTRREG_CON', 'WATER_REGIME_CONFIDENCE']),
    edition: manifest.edition,
    referenceOnly: true,
  };
  const baseId = `${manifest.sourceId}:${sourceId}`;
  properties.id = baseId;
  if (counters.ids.has(properties.id)) {
    const discriminator = sha256(JSON.stringify({ sourceId, properties, geometry: processed })).slice(0, 12);
    properties.id = `${baseId}:${discriminator}`;
  }
  if (counters.ids.has(properties.id)) fail(`duplicate wetland feature identity: ${properties.id}`);
  counters.ids.add(properties.id);
  return {
    type: 'Feature',
    properties,
    geometry: processed.length === 1
      ? { type: 'Polygon', coordinates: processed[0] }
      : { type: 'MultiPolygon', coordinates: processed },
  };
}

function geometryBounds(geometry) {
  const bounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      bounds.west = Math.min(bounds.west, value[0]);
      bounds.south = Math.min(bounds.south, value[1]);
      bounds.east = Math.max(bounds.east, value[0]);
      bounds.north = Math.max(bounds.north, value[1]);
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  return bounds;
}

function cellIdsForBounds(bounds, manifest) {
  const size = manifest.transform.gridDegrees;
  const minX = Math.floor((bounds.west - GRID_ORIGIN.longitude) / size);
  const maxX = Math.floor((bounds.east - GRID_ORIGIN.longitude) / size);
  const minY = Math.floor((bounds.south - GRID_ORIGIN.latitude) / size);
  const maxY = Math.floor((bounds.north - GRID_ORIGIN.latitude) / size);
  const ids = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) ids.push(`${String(x).padStart(3, '0')}-${String(y).padStart(3, '0')}`);
  }
  if (ids.length > manifest.limits.maxCellsPerFeature) fail('feature exceeds maximum index-cell coverage');
  return ids;
}

function cellBounds(id, gridDegrees) {
  const [x, y] = id.split('-').map(Number);
  const west = GRID_ORIGIN.longitude + x * gridDegrees;
  const south = GRID_ORIGIN.latitude + y * gridDegrees;
  return { west, south, east: west + gridDegrees, north: south + gridDegrees };
}

async function pathExists(targetPath) {
  return stat(targetPath).then(() => true, () => false);
}

async function sortStageFile(stagePath, sortedPath) {
  const child = spawn('sort', [stagePath], {
    env: { ...process.env, LC_ALL: 'C' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-65_536); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`sort failed (${signal || code}): ${stderr.trim()}`));
    });
  });
  try {
    await Promise.all([
      pipeline(child.stdout, createWriteStream(sortedPath, { flags: 'wx' })),
      closed,
    ]);
  } catch (error) {
    child.kill('SIGTERM');
    await closed.catch(() => {});
    throw error;
  }
}

async function writeExact(handle, value, state, maxBytes) {
  const buffer = Buffer.from(value);
  state.bytes += buffer.byteLength;
  if (state.bytes > maxBytes) fail('generated cell exceeds output byte limit');
  state.hash.update(buffer);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.byteLength - offset, null);
    if (bytesWritten <= 0) fail('generated cell write made no progress');
    offset += bytesWritten;
  }
}

async function writeCellFromStage({ stagePath, cellPath, maxBytes }) {
  const sortedPath = `${stagePath}.sorted`;
  await sortStageFile(stagePath, sortedPath);
  const handle = await open(cellPath, 'wx');
  const state = { bytes: 0, hash: createHash('sha256') };
  let featureCount = 0;
  try {
    await writeExact(handle, '{"type":"FeatureCollection","features":[', state, maxBytes);
    const lines = readline.createInterface({ input: createReadStream(sortedPath), crlfDelay: Infinity });
    for await (const line of lines) {
      const separator = line.indexOf('\t');
      if (separator < 1 || separator === line.length - 1) fail('invalid staged feature record');
      await writeExact(handle, `${featureCount ? ',' : ''}${line.slice(separator + 1)}`, state, maxBytes);
      featureCount += 1;
    }
    await writeExact(handle, ']}\n', state, maxBytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { featureCount, bytes: state.bytes, sha256: state.hash.digest('hex') };
}

export async function buildVicWetlands2025({ releaseManifestPath, sourcePath, outputPath }) {
  const manifest = assertReleaseManifest(JSON.parse(await readFile(releaseManifestPath, 'utf8')));
  const sourceStats = await stat(sourcePath);
  if (sourceStats.size > manifest.limits.maxSourceBytes) fail('source exceeds byte limit');
  if (sourceStats.size !== manifest.sourceArchive.bytes) fail('source byte length does not match release manifest');
  if (path.basename(sourcePath) !== manifest.sourceArchive.fileName) fail('source file name does not match release manifest');
  if (await sha256File(sourcePath) !== manifest.sourceArchive.sha256) fail('source SHA-256 does not match release manifest');
  if (await pathExists(outputPath)) fail(`output path already exists: ${outputPath}`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const buildPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.partial-${process.pid}`);
  if (await pathExists(buildPath)) fail(`temporary output path already exists: ${buildPath}`);
  const cellsPath = path.join(buildPath, 'cells');
  const stagingPath = path.join(buildPath, '.staging');
  await mkdir(cellsPath, { recursive: true });
  await mkdir(stagingPath);
  try {
    const counters = {
      ids: new Set(), inputCoordinates: 0, outputCoordinates: 0, projectedOutputBytes: 0,
    };
    const cellIdsSeen = new Set();
    const cellBuffers = new Map();
    const flushCell = async (cellId) => {
      const buffered = cellBuffers.get(cellId);
      if (!buffered) return;
      await appendFile(path.join(stagingPath, `${cellId}.ndjson`), buffered);
      cellBuffers.set(cellId, '');
    };
    for await (const feature of sourceFeatures(sourcePath, manifest)) {
      if (counters.ids.size >= manifest.limits.maxFeatures) fail('source exceeds feature limit');
      const processed = processFeature(feature, manifest, counters);
      const cellIds = cellIdsForBounds(geometryBounds(processed.geometry), manifest);
      const serialized = JSON.stringify(processed);
      counters.projectedOutputBytes += Buffer.byteLength(serialized) * cellIds.length;
      if (counters.projectedOutputBytes > manifest.limits.maxOutputBytes) {
        fail('generated artifacts exceed output byte limit');
      }
      const stagedLine = `${processed.properties.id}\t${serialized}\n`;
      for (const cellId of cellIds) {
        cellIdsSeen.add(cellId);
        const buffered = `${cellBuffers.get(cellId) || ''}${stagedLine}`;
        cellBuffers.set(cellId, buffered);
        if (Buffer.byteLength(buffered) >= 65_536) await flushCell(cellId);
      }
    }
    for (const cellId of [...cellIdsSeen].sort()) await flushCell(cellId);

    const cells = [];
    let outputBytes = 0;
    for (const cellId of [...cellIdsSeen].sort()) {
      const result = await writeCellFromStage({
        stagePath: path.join(stagingPath, `${cellId}.ndjson`),
        cellPath: path.join(cellsPath, `${cellId}.geojson`),
        maxBytes: manifest.limits.maxCellBytes,
      });
      outputBytes += result.bytes;
      if (outputBytes > manifest.limits.maxOutputBytes) fail('generated artifacts exceed output byte limit');
      cells.push({
        id: cellId,
        path: `cells/${cellId}.geojson`,
        bbox: cellBounds(cellId, manifest.transform.gridDegrees),
        featureCount: result.featureCount,
        bytes: result.bytes,
        sha256: result.sha256,
      });
    }
    await rm(stagingPath, { recursive: true });
    const index = {
    schemaVersion: 1,
    sourceId: manifest.sourceId,
    edition: manifest.edition,
    referenceOnly: true,
    referenceNotice: 'Mapped wetland inventory reference only; not live water extent, access, safety, or legal-boundary advice.',
    datasetId: manifest.datasetId,
    metadataUuid: manifest.metadataUuid,
    resourceId: manifest.resourceId,
    resourceFormat: manifest.resourceFormat,
    resourceUrl: manifest.resourceUrl,
    periodEnd: manifest.periodEnd,
    license: manifest.license,
    attribution: manifest.attribution,
    sourceArchive: {
      fileName: manifest.sourceArchive.fileName,
      bytes: manifest.sourceArchive.bytes,
      sha256: manifest.sourceArchive.sha256,
    },
    limits: manifest.limits,
    transform: manifest.transform,
    publicFields: [...PUBLIC_FIELDS],
    featureCount: counters.ids.size,
    inputCoordinateCount: counters.inputCoordinates,
    outputCoordinateCount: counters.outputCoordinates,
    cells,
    };
    const indexBody = `${JSON.stringify(index, null, 2)}\n`;
    outputBytes += Buffer.byteLength(indexBody);
    if (outputBytes > manifest.limits.maxOutputBytes) fail('generated artifacts exceed output byte limit');
    await writeFile(path.join(buildPath, 'index.json'), indexBody, { flag: 'wx' });
    await rename(buildPath, outputPath);
    return index;
  } catch (error) {
    await rm(buildPath, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseManifestPath = path.resolve(args['release-manifest']);
  let sourcePath = args.source ? path.resolve(args.source) : path.resolve(args['download-to']);
  if (args['download-to']) {
    const manifest = JSON.parse(await readFile(releaseManifestPath, 'utf8'));
    sourcePath = await downloadPinnedArchive({ manifest, destinationPath: sourcePath });
  }
  const index = await buildVicWetlands2025({
    releaseManifestPath,
    sourcePath,
    outputPath: path.resolve(args['out-dir']),
  });
  console.log(`built ${index.sourceId}: ${index.featureCount} features in ${index.cells.length} bounded cells`);
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false;
if (invokedPath) main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
