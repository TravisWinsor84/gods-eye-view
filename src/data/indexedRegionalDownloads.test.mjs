import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIndexedRegionalDownload,
  createIndexedRegionalDownloads,
} from './indexedRegionalDownloads.js';

const MELBOURNE = { west: 144.8, south: -38, east: 145.1, north: -37.7 };
const ADELAIDE = { west: 138.4, south: -35.1, east: 138.8, north: -34.7 };

function streamedResponse(body, {
  status = 200,
  contentType = 'application/octet-stream',
  headers = {},
  chunkSize = 0,
} = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  if (status === 304) return new Response(null, { status, headers });
  const chunks = [];
  if (chunkSize > 0) {
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      chunks.push(bytes.slice(offset, offset + chunkSize));
    }
  } else chunks.push(bytes);
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { status, headers: { 'Content-Type': contentType, ...headers } });
}

function point(title, longitude, latitude) {
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { title },
  };
}

function genericIndex({ now = () => 1_000, fetchImpl, resolveResource, parse, ...options }) {
  return createIndexedRegionalDownload({
    sourceId: 'fixture-source',
    fetchImpl,
    now,
    resolveResource,
    parse,
    maxBytes: 1_024,
    maxCompressedBytes: 1_024,
    maxRows: 10,
    maxAgeMs: 60_000,
    metadataMaxAgeMs: 30_000,
    maxStaleMs: 120_000,
    acceptedContentTypes: ['application/octet-stream'],
    ...options,
  });
}

test('different bboxes reuse one provider-wide versioned download', async () => {
  let resourceCalls = 0;
  let downloadCalls = 0;
  const index = genericIndex({
    resolveResource: async () => {
      resourceCalls += 1;
      return { id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' };
    },
    fetchImpl: async () => {
      downloadCalls += 1;
      return streamedResponse('fixture');
    },
    parse: async () => ({ features: [
      point('Melbourne', 144.96, -37.81),
      point('Adelaide', 138.6, -34.9),
    ], totalRows: 2, invalidRows: 0 }),
  });

  assert.deepEqual((await index.query(MELBOURNE)).features.map((feature) => feature.properties.title), ['Melbourne']);
  assert.deepEqual((await index.query(ADELAIDE)).features.map((feature) => feature.properties.title), ['Adelaide']);
  assert.equal(resourceCalls, 1);
  assert.equal(downloadCalls, 1);
});

test('same-URL revalidation uses opaque URL-scoped validators and a 304 reuses the parsed index', async () => {
  let clock = 1_000;
  const requests = [];
  const index = genericIndex({
    now: () => clock,
    maxAgeMs: 100,
    metadataMaxAgeMs: 100,
    resolveResource: async () => ({
      id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin',
    }),
    fetchImpl: async (input, options) => {
      requests.push({ url: String(input), headers: { ...options.headers } });
      if (requests.length === 1) return streamedResponse('fixture', {
        headers: { ETag: 'opaque/W/"provider token"', 'Last-Modified': 'Fri, 05 Sep 2026 00:00:00 GMT' },
      });
      return streamedResponse(new Uint8Array(), { status: 304 });
    },
    parse: async () => ({ features: [point('Cached', 144.96, -37.81)], totalRows: 1, invalidRows: 0 }),
  });

  await index.query(MELBOURNE);
  clock += 101;
  const result = await index.query(MELBOURNE);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers['If-None-Match'], 'opaque/W/"provider token"');
  assert.equal(requests[1].headers['If-Modified-Since'], 'Fri, 05 Sep 2026 00:00:00 GMT');
  assert.equal(result.sourceStatus.downloadStatus, 'not-modified');
  assert.deepEqual(result.features.map((feature) => feature.properties.title), ['Cached']);
});

test('a successful 304 extends the finite last-good window', async () => {
  let clock = 1_000;
  let call = 0;
  const index = genericIndex({
    now: () => clock,
    maxAgeMs: 100,
    metadataMaxAgeMs: 100,
    maxStaleMs: 200,
    resolveResource: async () => ({
      id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin',
    }),
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return streamedResponse('fixture', { headers: { ETag: 'v1' } });
      if (call === 2) return streamedResponse(new Uint8Array(), { status: 304 });
      throw new Error('outage');
    },
    parse: async () => ({ features: [point('Cached', 144.96, -37.81)], totalRows: 1, invalidRows: 0 }),
  });

  await index.query(MELBOURNE);
  clock = 1_101;
  await index.query(MELBOURNE);
  clock = 1_301;
  const stale = await index.query(MELBOURNE);
  assert.equal(stale.sourceStatus.status, 'stale');
});

test('a backward wall-clock step forces revalidation and cannot extend last-good data', async () => {
  let clock = 10_000;
  let fetchCalls = 0;
  const index = genericIndex({
    now: () => clock,
    maxAgeMs: 100,
    metadataMaxAgeMs: 100,
    maxStaleMs: 200,
    resolveResource: async () => ({
      id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin',
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls > 1) throw new Error('outage');
      return streamedResponse('fixture');
    },
    parse: async () => ({ features: [point('Cached', 144.96, -37.81)], totalRows: 1, invalidRows: 0 }),
  });
  await index.query(MELBOURNE);
  clock = 0;
  await assert.rejects(() => index.query(MELBOURNE), /temporarily unavailable/i);
  assert.equal(fetchCalls, 2);
});

test('rotating resource ID or URL invalidates old download validators', async () => {
  let clock = 1_000;
  let revision = 1;
  const requests = [];
  const index = genericIndex({
    now: () => clock,
    maxAgeMs: 100,
    metadataMaxAgeMs: 100,
    resolveResource: async () => revision === 1
      ? { id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }
      : { id: '22222222-2222-4222-8222-222222222222', url: 'https://downloads.example.test/v2.bin' },
    fetchImpl: async (input, options) => {
      requests.push({ url: String(input), headers: { ...options.headers } });
      return streamedResponse(revision === 1 ? 'one' : 'two', { headers: { ETag: `v${revision}` } });
    },
    parse: async (bytes) => ({
      features: [point(new TextDecoder().decode(bytes), 144.96, -37.81)], totalRows: 1, invalidRows: 0,
    }),
  });

  await index.query(MELBOURNE);
  revision = 2;
  clock += 101;
  const result = await index.query(MELBOURNE);
  assert.equal(requests[1].url, 'https://downloads.example.test/v2.bin');
  assert.equal('If-None-Match' in requests[1].headers, false);
  assert.deepEqual(result.features.map((feature) => feature.properties.title), ['two']);
});

test('metadata and download refreshes coalesce and hold the supplied request slot through body consumption', async () => {
  let active = 0;
  let maxActive = 0;
  let resourceCalls = 0;
  let downloadCalls = 0;
  const withRequestSlot = async (operation) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try { return await operation(); } finally { active -= 1; }
  };
  const index = genericIndex({
    withRequestSlot,
    resolveResource: async ({ requestJson }) => {
      resourceCalls += 1;
      const metadata = await requestJson('https://catalogue.example.test/package');
      return metadata.resource;
    },
    fetchImpl: async (input) => {
      if (String(input).includes('catalogue')) {
        return streamedResponse(JSON.stringify({ resource: {
          id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin',
        } }), { contentType: 'application/json', chunkSize: 1 });
      }
      downloadCalls += 1;
      return streamedResponse('fixture', { chunkSize: 1 });
    },
    parse: async () => ({ features: [point('Shared', 144.96, -37.81)], totalRows: 1, invalidRows: 0 }),
  });

  const results = await Promise.all([index.query(MELBOURNE), index.query(MELBOURNE), index.query(ADELAIDE)]);
  assert.deepEqual(results.map((result) => result.features.length), [1, 1, 0]);
  assert.equal(resourceCalls, 1);
  assert.equal(downloadCalls, 1);
  assert.equal(maxActive, 1);
  assert.equal(active, 0);
  assert.equal(results[0].sourceStatus.status, 'current');
});

test('official metadata requests bypass stale intermediary cache entries', async () => {
  const { client, calls } = officialDownloads();
  await client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 });
  const metadataCall = calls.find(({ url }) => url.includes('/api/3/action/package_show'));
  assert.equal(metadataCall.options.headers['Cache-Control'], 'no-cache');
});

test('rejects declared compressed size, decoded stream, and row expansion beyond source caps', async (t) => {
  await t.test('compressed content-length', async () => {
    const index = genericIndex({
      maxCompressedBytes: 4,
      resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
      fetchImpl: async () => streamedResponse('x', { headers: { 'Content-Length': '5', 'Content-Encoding': 'gzip' } }),
      parse: async () => ({ features: [], totalRows: 0, invalidRows: 0 }),
    });
    await assert.rejects(() => index.query(MELBOURNE), /source limit/i);
  });

  await t.test('decoded stream', async () => {
    const index = genericIndex({
      maxBytes: 4,
      resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
      fetchImpl: async () => streamedResponse('12345', { headers: { 'Content-Encoding': 'gzip' }, chunkSize: 1 }),
      parse: async () => ({ features: [], totalRows: 0, invalidRows: 0 }),
    });
    await assert.rejects(() => index.query(MELBOURNE), /source limit/i);
  });

  await t.test('parsed rows', async () => {
    const index = genericIndex({
      maxRows: 1,
      resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
      fetchImpl: async () => streamedResponse('fixture'),
      parse: async () => ({ features: [], totalRows: 2, invalidRows: 0 }),
    });
    await assert.rejects(() => index.query(MELBOURNE), /source limit/i);
  });
});

test('rejected bodies are cancelled before their shared request slot is released', async () => {
  let cancelled = 0;
  let active = 0;
  const index = genericIndex({
    maxBytes: 4,
    withRequestSlot: async (operation) => {
      active += 1;
      try { return await operation(); } finally { active -= 1; }
    },
    resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
    fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('12345')); },
      cancel() { cancelled += 1; assert.equal(active, 1); },
    }), { headers: { 'Content-Type': 'application/octet-stream' } }),
    parse: async () => ({ features: [], totalRows: 0, invalidRows: 0 }),
  });
  await assert.rejects(() => index.query(MELBOURNE), /source limit/i);
  assert.equal(cancelled, 1);
  assert.equal(active, 0);
});

test('body-phase aborts retain timeout classification', async () => {
  const index = genericIndex({
    timeoutMs: 5,
    resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
    fetchImpl: async (_input, { signal }) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
      },
    }), { headers: { 'Content-Type': 'application/octet-stream' } }),
    parse: async () => ({ features: [], totalRows: 0, invalidRows: 0 }),
  });
  await assert.rejects(() => index.query(MELBOURNE), (error) => error?.code === 'TIMEOUT');
});

test('missing Content-Length remains unknown rather than reporting zero compressed bytes', async () => {
  const index = genericIndex({
    resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
    fetchImpl: async () => streamedResponse('fixture'),
    parse: async () => ({ features: [point('Chunked', 144.96, -37.81)], totalRows: 1, invalidRows: 0 }),
  });
  const result = await index.query(MELBOURNE);
  assert.equal(result.sourceStatus.compressedBytes, null);
  assert.equal(result.sourceStatus.decodedBytes, 7);
});

function ckanPayload(sourceId, overrides = {}) {
  const isToilet = sourceId === 'au-public-toilets';
  return {
    success: true,
    result: {
      id: isToilet ? '553b3049-2b8b-46a2-95e6-640d7986a8c1' : '6d36dfd9-8693-4552-8a03-05eb29a391fd',
      metadata_modified: isToilet ? '2026-08-31T23:24:56.240805' : '2026-03-05T05:35:25.834801',
      license_id: isToilet ? 'cc-by' : 'CC-BY-4.0',
      license_title: isToilet ? 'Creative Commons Attribution 3.0 Australia' : 'Creative Commons Attribution 4.0',
      notes: isToilet ? 'Terms may be updated; licence is non-transferable and may not be sublicensed.' : '',
      resources: [{
        id: isToilet ? '34076296-6692-4e30-b627-67b7c4eb1027' : 'a2cba0b0-bddc-4b87-b495-2b6b7013af6e',
        name: isToilet ? 'Toiletmap.csv' : 'Public Transport Stops',
        format: isToilet ? 'CSV' : 'GeoJSON',
        mimetype: isToilet ? 'text/csv' : 'application/geo+json',
        url: isToilet
          ? 'https://data.gov.au/data/dataset/553b3049-2b8b-46a2-95e6-640d7986a8c1/resource/34076296-6692-4e30-b627-67b7c4eb1027/download/toiletmap.csv'
          : 'https://opendata.transport.vic.gov.au/dataset/6d36dfd9-8693-4552-8a03-05eb29a391fd/resource/a2cba0b0-bddc-4b87-b495-2b6b7013af6e/download/public_transport_stops.geojson',
        size: isToilet ? 12_057_577 : 8_189_610,
        last_modified: isToilet ? '2026-08-31T23:24:01.608696' : '2026-03-05T05:35:25.824500',
        ...(isToilet ? {} : { dataset_last_updated_date: '2025-07-28T00:00:00' }),
        ...overrides,
      }],
    },
  };
}

const TOILET_CSV = `"FacilityID","Name","FacilityType","Address1","Latitude","Longitude","PaymentRequired","OpeningHours","OpeningHoursNote","Male","Female","Unisex","AllGender","Ambulant","Accessible","ToiletNote"
"provider-secret-1","Quoted, useful toilet","Park or reserve","private address","-37.8100","144.9600","True","OPEN: 24 hours","bounded note","False","False","True","False","True","True","private note"
"provider-secret-2","Bad coordinate","Park","private address","NaN","144.9700","False","","","True","True","False","False","False","False","private note"
`;

const TRANSIT_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [144.96, -37.81] }, properties: { STOP_ID: '7', STOP_NAME: 'Melbourne Stop', MODE: 'TRAM', PRIVATE: 'secret' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [138.6, -34.9] }, properties: { STOP_ID: '7', STOP_NAME: 'Adelaide Coach Stop', MODE: 'COACH', PRIVATE: 'secret' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [145, null] }, properties: { STOP_ID: 'bad', STOP_NAME: 'Bad Stop', MODE: 'BUS' } },
  ],
});

function officialDownloads({ metadataOverride, downloadBody, downloadContentType, now, idHash } = {}) {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    if (url.includes('/api/3/action/package_show')) {
      const sourceId = url.includes('553b3049') ? 'au-public-toilets' : 'vic-transport-stops';
      return streamedResponse(JSON.stringify(metadataOverride || ckanPayload(sourceId)), { contentType: 'application/json' });
    }
    const isToilet = url.includes('toilet');
    return streamedResponse(downloadBody ?? (isToilet ? TOILET_CSV : TRANSIT_GEOJSON), {
      contentType: downloadContentType ?? (isToilet ? 'text/csv' : 'application/geo+json'),
    });
  };
  return { calls, client: createIndexedRegionalDownloads({ fetchImpl, now, idHash }) };
}

test('toilet CSV parsing is quote-aware and exposes only bounded public fields with exact licence conflict', async () => {
  const { client } = officialDownloads();
  const result = await client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 100 });
  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].properties, {
    title: 'Quoted, useful toilet',
    facilityType: 'Park or reserve',
    accessibility: { accessible: true, ambulant: true },
    paymentRequired: true,
    openingHours: 'OPEN: 24 hours',
    openingHoursCaveat: 'Descriptive source text only; not proof this facility is currently open.',
    freshnessClass: 'reference',
    caveat: 'Reference inventory only; accuracy, completeness and current availability are not guaranteed.',
  });
  assert.doesNotMatch(JSON.stringify(result), /provider-secret|private address|private note|bounded note/);
  assert.equal(result.sourceStatus.status, 'partial');
  assert.equal(result.sourceStatus.metadataModified, '2026-08-31T23:24:56.240805');
  assert.equal(result.sourceStatus.resourceModified, '2026-08-31T23:24:01.608696');
  assert.equal(result.sourceStatus.datasetLastUpdatedDate, null);
  assert.equal(result.sourceStatus.licence, 'Creative Commons Attribution 3.0 Australia');
  assert.equal(result.sourceStatus.legalReview, 'required');
  assert.match(result.sourceStatus.termsConflict, /non-transferable.*sublicens/i);
});

test('transport keeps string/non-unique STOP_ID out of identity and retains interstate coach endpoints', async () => {
  const { client } = officialDownloads();
  const melbourne = await client.load('vic-transport-stops', { bbox: MELBOURNE, maxFeatures: 100 });
  const adelaide = await client.load('vic-transport-stops', { bbox: ADELAIDE, maxFeatures: 100 });
  assert.equal(melbourne.features.length, 1);
  assert.equal(adelaide.features.length, 1);
  assert.notEqual(melbourne.features[0].id, adelaide.features[0].id);
  assert.deepEqual(adelaide.features[0].properties, {
    title: 'Adelaide Coach Stop', mode: 'COACH', freshnessClass: 'reference',
    caveat: 'Reference stop inventory only; not realtime and not evidence that a service is currently running.',
  });
  assert.doesNotMatch(JSON.stringify([melbourne, adelaide]), /STOP_ID|provider-secret|PRIVATE|secret/);
  assert.equal(melbourne.sourceStatus.metadataModified, '2026-03-05T05:35:25.834801');
  assert.equal(melbourne.sourceStatus.resourceModified, '2026-03-05T05:35:25.824500');
  assert.equal(melbourne.sourceStatus.datasetLastUpdatedDate, '2025-07-28T00:00:00');
});

test('public IDs and cap order are deterministic across provider row order and explicit hash collisions', async () => {
  const bodyA = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [145, -37.8] }, properties: { STOP_ID: 'z', STOP_NAME: 'Zulu', MODE: 'BUS' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [144.9, -37.8] }, properties: { STOP_ID: 'a', STOP_NAME: 'Alpha', MODE: 'BUS' } },
  ] });
  const bodyB = JSON.stringify({ type: 'FeatureCollection', features: JSON.parse(bodyA).features.reverse() });
  const first = officialDownloads({ downloadBody: bodyA, idHash: () => 'collision' });
  const second = officialDownloads({ downloadBody: bodyB, idHash: () => 'collision' });
  const left = await first.client.load('vic-transport-stops', { bbox: MELBOURNE, maxFeatures: 1 });
  const right = await second.client.load('vic-transport-stops', { bbox: MELBOURNE, maxFeatures: 1 });
  assert.deepEqual(left.features, right.features);
  assert.equal(left.features[0].properties.title, 'Alpha');
  assert.match(left.features[0].id, /collision-1$/);
});

test('official resolver rejects non-HTTPS, wrong-host, malformed-ID, wrong-type and oversized resources before download', async (t) => {
  const cases = [
    ['non-HTTPS', { url: 'http://data.gov.au/toilet.csv' }],
    ['wrong host', { url: 'https://attacker.invalid/toilet.csv' }],
    ['malformed ID', { id: 'not-a-uuid' }],
    ['wrong media type', { mimetype: 'text/html' }],
    ['declared oversize', { size: 99_000_000 }],
    ['unapproved path prefix', { url: 'https://data.gov.au/unapproved-prefix/dataset/553b3049-2b8b-46a2-95e6-640d7986a8c1/resource/34076296-6692-4e30-b627-67b7c4eb1027/download/toilet.csv' }],
    ['download query', { url: 'https://data.gov.au/data/dataset/553b3049-2b8b-46a2-95e6-640d7986a8c1/resource/34076296-6692-4e30-b627-67b7c4eb1027/download/toilet.csv?next=evil' }],
    ['download fragment', { url: 'https://data.gov.au/data/dataset/553b3049-2b8b-46a2-95e6-640d7986a8c1/resource/34076296-6692-4e30-b627-67b7c4eb1027/download/toilet.csv#evil' }],
  ];
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      const metadataOverride = ckanPayload('au-public-toilets', override);
      const { client, calls } = officialDownloads({ metadataOverride });
      await assert.rejects(() => client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 }), /invalid source metadata|source limit/i);
      assert.equal(calls.filter(({ url }) => !url.includes('/api/3/action/package_show')).length, 0);
    });
  }
});

test('toilet legal warning reflects rotated licence metadata without a hard-coded contradiction', async () => {
  const metadataOverride = ckanPayload('au-public-toilets');
  metadataOverride.result.license_title = 'Other provider licence';
  const { client } = officialDownloads({ metadataOverride });
  const result = await client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 });
  assert.equal(result.sourceStatus.licence, 'Other provider licence');
  assert.match(result.sourceStatus.termsConflict, /Other provider licence/);
  assert.doesNotMatch(result.sourceStatus.termsConflict, /catalogue licence says CC BY 3\.0 AU/i);
});

test('official resolver rejects metadata/download media mismatches and redirects without following them', async (t) => {
  await t.test('metadata media type', async () => {
    const client = createIndexedRegionalDownloads({
      fetchImpl: async () => streamedResponse('<html>bad</html>', { contentType: 'text/html' }),
    });
    await assert.rejects(() => client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 }), /invalid source metadata/i);
  });

  await t.test('GeoJSON is not accepted as CKAN metadata', async () => {
    const client = createIndexedRegionalDownloads({
      fetchImpl: async () => streamedResponse(JSON.stringify(ckanPayload('au-public-toilets')), { contentType: 'application/geo+json' }),
    });
    await assert.rejects(() => client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 }), /invalid source metadata/i);
  });

  await t.test('download media type', async () => {
    const { client } = officialDownloads({ downloadContentType: 'text/html' });
    await assert.rejects(() => client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 }), /invalid source data/i);
  });

  await t.test('redirect', async () => {
    const calls = [];
    const client = createIndexedRegionalDownloads({
      fetchImpl: async (input, options) => {
        calls.push({ input: String(input), options });
        return new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid/' } });
      },
    });
    await assert.rejects(() => client.load('au-public-toilets', { bbox: MELBOURNE, maxFeatures: 10 }), /temporarily unavailable/i);
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls.length, 1);
  });
});

test('last-good is explicit and finite after a failed revalidation', async () => {
  let clock = 1_000;
  let fail = false;
  const index = genericIndex({
    now: () => clock,
    maxAgeMs: 100,
    metadataMaxAgeMs: 100,
    maxStaleMs: 200,
    resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
    fetchImpl: async () => {
      if (fail) throw new Error('private upstream detail');
      return streamedResponse('fixture');
    },
    parse: async () => ({ features: [point('Cached', 144.96, -37.81)], totalRows: 1, invalidRows: 0 }),
  });
  await index.query(MELBOURNE);
  fail = true;
  clock += 101;
  const stale = await index.query(MELBOURNE);
  assert.equal(stale.sourceStatus.status, 'stale');
  assert.equal(stale.sourceStatus.cache, 'stale');
  clock += 100;
  await assert.rejects(() => index.query(MELBOURNE), /temporarily unavailable/i);
});

test('a nonempty source with no valid indexed features fails closed', async () => {
  const index = genericIndex({
    resolveResource: async () => ({ id: '11111111-1111-4111-8111-111111111111', url: 'https://downloads.example.test/v1.bin' }),
    fetchImpl: async () => streamedResponse('fixture'),
    parse: async () => ({ features: [], totalRows: 2, invalidRows: 2 }),
  });
  await assert.rejects(() => index.query(MELBOURNE), /invalid source data/i);
});
