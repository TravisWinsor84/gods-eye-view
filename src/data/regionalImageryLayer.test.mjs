import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegionalImageryLayer } from './regionalImageryLayer.js';

const EXPECTED_TEMPLATE = '/api/regional-imagery/au-dea-land-cover?west={westDegrees}&south={southDegrees}&east={eastDegrees}&north={northDegrees}&width={width}&height={height}';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function harness() {
  const providers = [];
  const layers = [];
  const removed = [];
  const credits = [];
  class UrlTemplateImageryProvider {
    constructor(options) {
      this.options = options;
      providers.push(this);
    }
  }
  class Credit {
    constructor(text) {
      this.text = text;
      credits.push(this);
    }
  }
  const viewer = {
    imageryLayers: {
      addImageryProvider(provider) {
        const layer = { imageryProvider: provider, show: true, alpha: 1 };
        layers.push(layer);
        return layer;
      },
      remove(layer, destroy) {
        removed.push({ layer, destroy });
        const index = layers.indexOf(layer);
        if (index >= 0) layers.splice(index, 1);
        return index >= 0;
      },
    },
    scene: { requestRenderCalls: 0, requestRender() { this.requestRenderCalls += 1; } },
  };
  return {
    cesium: { UrlTemplateImageryProvider, Credit },
    viewer,
    providers,
    layers,
    removed,
    credits,
  };
}

function createLayer(overrides = {}) {
  const testHarness = overrides.testHarness || harness();
  const layer = createRegionalImageryLayer({
    id: 'imagery-dea-land-cover',
    sourceId: 'au-dea-land-cover',
    name: 'DEA Land Cover',
    icon: 'L',
    alpha: 0.62,
    cesium: testHarness.cesium,
    ...overrides,
    testHarness: undefined,
  });
  return { layer, ...testHarness };
}

test('imagery provider uses only the fixed local URL template and bounded levels', async () => {
  const { layer, viewer, providers, layers, credits } = createLayer();

  assert.equal(await layer.init(viewer), true);
  assert.equal(layers.length, 0, 'initialization must remain off by default');
  assert.equal(await layer.enable(viewer), true);

  assert.equal(providers.length, 1);
  assert.deepEqual(providers[0].options, {
    url: EXPECTED_TEMPLATE,
    minimumLevel: 6,
    maximumLevel: 14,
    tileWidth: 256,
    tileHeight: 256,
    credit: credits[0],
  });
  assert.match(credits[0].text, /Digital Earth Australia/i);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].alpha, 0.62);
  assert.equal(layers[0].show, true);
});

test('disable hides and re-enable reuses one owned imagery layer', async () => {
  const { layer, viewer, providers, layers, removed } = createLayer();
  await layer.init(viewer);
  await layer.enable(viewer);

  assert.equal(await layer.disable(viewer), true);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].show, false);
  assert.equal(removed.length, 0);
  assert.equal(await layer.enable(viewer), true);
  assert.equal(providers.length, 1);
  assert.equal(layers[0].show, true);
});

test('destroy removes the owned imagery layer exactly once and prevents re-enable', async () => {
  const { layer, viewer, layers, removed } = createLayer();
  await layer.init(viewer);
  await layer.enable(viewer);

  assert.equal(await layer.destroy(viewer), true);
  assert.equal(await layer.destroy(viewer), true);
  assert.equal(layers.length, 0);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].destroy, true);
  assert.equal(await layer.enable(viewer), false);
});

test('destroy invalidates deferred provider completion before it can reach the viewer', async () => {
  const pendingProvider = deferred();
  const testHarness = harness();
  const { layer, viewer, layers } = createLayer({
    testHarness,
    providerFactory: () => pendingProvider.promise,
  });
  await layer.init(viewer);

  const enabling = layer.enable(viewer);
  assert.equal(layer.getStats().status, 'loading');
  await layer.destroy(viewer);
  pendingProvider.resolve({ kind: 'late-provider' });

  assert.equal(await enabling, false);
  assert.equal(layers.length, 0);
  assert.deepEqual(layer.getStats().sources, []);
});

test('disable invalidates deferred provider completion and leaves the layer reusable', async () => {
  const firstProvider = deferred();
  const testHarness = harness();
  let attempts = 0;
  const { layer, viewer, layers } = createLayer({
    testHarness,
    providerFactory: () => {
      attempts += 1;
      return attempts === 1 ? firstProvider.promise : { kind: 'fresh-provider' };
    },
  });
  await layer.init(viewer);

  const enabling = layer.enable(viewer);
  await layer.disable(viewer);
  firstProvider.resolve({ kind: 'stale-provider' });
  assert.equal(await enabling, false);
  assert.equal(layers.length, 0);

  assert.equal(await layer.enable(viewer), true);
  assert.equal(layers.length, 1);
  assert.equal(layers[0].imageryProvider.kind, 'fresh-provider');
});

test('source stats state the annual snapshot caveat without implying live conditions', async () => {
  const { layer, viewer } = createLayer();
  assert.deepEqual(layer.getStats(), {
    count: 0,
    lastUpdate: null,
    error: null,
    status: 'idle',
    sourceStatus: { 'au-dea-land-cover': { status: 'idle' } },
    sources: [{
      sourceId: 'au-dea-land-cover',
      name: 'DEA Land Cover',
      status: 'idle',
      freshnessClass: 'annual',
      observedAt: '2020-01-01T00:00:00.000Z',
      caveat: 'Annual 2020 satellite-derived land-cover classification; not live conditions or emergency advice.',
      credit: 'Digital Earth Australia / Geoscience Australia (CC BY 4.0)',
      officialUrl: 'https://knowledge.dea.ga.gov.au/data/product/dea-land-cover-landsat/',
    }],
  });

  await layer.init(viewer);
  await layer.enable(viewer);
  const stats = layer.getStats();
  assert.equal(stats.status, 'active');
  assert.equal(stats.count, 1);
  assert.equal(stats.sources[0].status, 'active');
  assert.match(stats.sources[0].caveat, /not live conditions/i);
});

test('rejects arbitrary source IDs and clamps alpha to the Cesium range', async () => {
  const testHarness = harness();
  assert.throws(() => createRegionalImageryLayer({
    id: 'imagery-evil',
    sourceId: 'https://attacker.invalid/wms',
    cesium: testHarness.cesium,
  }), /unknown regional imagery source/i);

  const { layer, viewer, layers } = createLayer({ alpha: 4 });
  await layer.init(viewer);
  await layer.enable(viewer);
  assert.equal(layers[0].alpha, 1);
});
