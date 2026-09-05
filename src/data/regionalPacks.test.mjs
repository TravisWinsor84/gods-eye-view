import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
  REGIONAL_SOURCE_LAYER_TOKENS,
} from './layerState.js';
import { REGIONAL_SOURCES } from './regionalSources.js';
import * as regionalPacksModule from './regionalPacks.js';

const {
  CATEGORY_REGIONAL_PACK_IDS,
  REGIONAL_PACKS,
  createRegionalPackDefinitions,
  regionalDataLayers,
  regionalPackIds,
  REGIONAL_SOURCE_LAYERS,
} = regionalPacksModule;

const EXPECTED_PACK_IDS = [
  'regional-melbourne',
  'regional-victoria',
  'regional-australia',
  'regional-civic',
  'regional-mobility',
  'regional-environment',
  'regional-planning',
];

test('preserves legacy pack exports without registering overlapping runtime packs', () => {
  assert.deepEqual(Object.keys(REGIONAL_PACKS), EXPECTED_PACK_IDS);
  assert.ok(regionalDataLayers.every((layer) => !EXPECTED_PACK_IDS.includes(layer.id)));
  assert.deepEqual(CATEGORY_REGIONAL_PACK_IDS, [
    'regional-civic', 'regional-mobility', 'regional-environment', 'regional-planning',
  ]);
});

test('category packs assign every admitted source once by user-facing meaning', () => {
  assert.deepEqual(regionalPackIds('regional-civic'), [
    'au-emergency-facilities', 'au-health-facilities', 'au-public-toilets',
    'melbourne-places', 'melbourne-drinking-fountains', 'melbourne-barbecues',
    'vic-waste-facilities', 'au-hospital-ed-performance',
  ]);
  assert.deepEqual(regionalPackIds('regional-mobility'), [
    'melbourne-cycling', 'melbourne-parking-live', 'vic-transport-stops', 'vic-ev-chargers',
  ]);
  assert.deepEqual(createRegionalPackDefinitions({ transportVicConfigured: true })['regional-mobility'].sourceIds, [
    'melbourne-cycling', 'melbourne-parking-live', 'vic-transport-stops', 'vic-ev-chargers',
    'ptv-transit', 'vic-road-unplanned', 'vic-lane-signals',
  ]);
  assert.deepEqual(regionalPackIds('regional-environment'), [
    'melbourne-trees', 'melbourne-water-history', 'au-dea-hotspots', 'vic-parks',
    'vic-recreation-tracks', 'vic-renewable-facilities', 'vic-flood-history-2022',
    'vic-epa-priority-sites', 'vic-landfill-register', 'vic-recreation-assets', 'vic-epa-air',
  ]);
  assert.equal(createRegionalPackDefinitions({ wetlandsConfigured: true })['regional-environment'].sourceIds.at(-1), 'vic-wetlands-2025');
  assert.deepEqual(regionalPackIds('regional-planning'), [
    'au-place-names', 'vic-heritage', 'melbourne-development', 'melbourne-culture',
    'vic-property-boundaries',
  ]);
  const categoryIds = CATEGORY_REGIONAL_PACK_IDS.flatMap((packId) => regionalPackIds(packId));
  assert.equal(new Set(categoryIds).size, categoryIds.length);
});

test('Melbourne pack contains exactly the four approved no-account sources', () => {
  assert.deepEqual(regionalPackIds('regional-melbourne'), [
    'melbourne-trees',
    'melbourne-places',
    'melbourne-cycling',
    'melbourne-water-history',
  ]);
});

test('regional packs contain runtime sources and omit registered sources until configured', () => {
  for (const packId of ['regional-melbourne', 'regional-victoria', 'regional-australia']) {
    const sourceIds = regionalPackIds(packId);
    assert.ok(sourceIds.length > 0, `${packId} must not be empty`);
    for (const sourceId of sourceIds) {
      assert.equal(REGIONAL_SOURCES[sourceId].runtimeEligible, true, sourceId);
    }
  }
  assert.deepEqual(regionalPackIds('regional-victoria'), [
    'vic-fire-context',
    'vic-freight-network',
  ]);
  assert.deepEqual(createRegionalPackDefinitions({ transportVicConfigured: true })['regional-victoria'].sourceIds, [
    'vic-fire-context',
    'vic-freight-network',
    'ptv-transit',
    'vic-road-unplanned',
    'vic-lane-signals',
  ]);
  assert.equal(regionalPackIds('regional-victoria').includes('vic-epa-air'), false);
  assert.equal(REGIONAL_SOURCES['ptv-transit'].serverCredential, 'TRANSPORT_VIC_OPEN_DATA_API_KEY');
});

test('legacy pack IDs migrate to the source union and remain off by default', () => {
  const defaults = createDefaultLayerState();
  assert.deepEqual(defaults.enabledLayerIds, []);

  const params = new URLSearchParams([['v', '2']]);
  encodeLayerStateParams(params, { ...defaults, enabledLayerIds: EXPECTED_PACK_IDS });
  const restored = decodeLayerStateParams(params);

  assert.deepEqual(restored.enabledLayerIds, [...new Set(
    Object.values(REGIONAL_PACKS).flatMap((pack) => pack.sourceIds)
      .map((id) => `regional-source-${id}`),
  )].sort());
});

test('each admitted source has exactly one stable module with individual presentation metadata', () => {
  const admitted = [...new Set(Object.values(createRegionalPackDefinitions({
    transportVicConfigured: true, wetlandsConfigured: true,
  })).flatMap((pack) => pack.sourceIds))].sort();
  assert.deepEqual(regionalDataLayers.flatMap((layer) => layer.sourceIds).sort(), admitted);
  assert.deepEqual(Object.keys(REGIONAL_SOURCE_LAYER_TOKENS).sort(),
    regionalDataLayers.map((layer) => layer.id).sort());
  assert.equal(regionalPacksModule.default, regionalDataLayers);
  const groups = new Set(['Civic services', 'Mobility', 'Environment', 'Places & planning']);
  for (const layer of regionalDataLayers) {
    assert.deepEqual(layer.sourceIds, [layer.id.slice('regional-source-'.length)]);
    const source = REGIONAL_SOURCES[layer.sourceIds[0]];
    if (layer.id === 'regional-source-vic-epa-air') {
      assert.equal(source.runtimeEligible, false);
      assert.match(layer.description, /Requires EPA access/);
    } else {
      assert.equal(source.runtimeEligible, true, layer.id);
    }
    assert.equal(layer.updateInterval, source.refreshMs > 0 ? source.refreshMs : 300_000);
    assert.equal(layer.configuredEnv, source.configuredEnv);
    const metadata = REGIONAL_SOURCE_LAYERS[layer.id];
    for (const key of ['name', 'icon', 'color', 'group', 'description']) {
      assert.equal(layer[key], metadata[key], `${layer.id} ${key}`);
      assert.ok(layer[key].length > 0);
    }
    assert.match(layer.color, /^#[a-f0-9]{6}$/i);
    assert.ok(groups.has(layer.group));
    assert.ok(layer.description.length < 140);
    assert.equal(Object.isFrozen(metadata.sourceIds), true);
  }
});

test('every individual source round trips alone without enabling siblings', () => {
  for (const layer of regionalDataLayers) {
    const params = new URLSearchParams('v=2');
    encodeLayerStateParams(params, { enabledLayerIds: [layer.id] });
    assert.deepEqual(decodeLayerStateParams(params).enabledLayerIds, [layer.id]);
  }
});

test('unknown pack IDs resolve to an empty immutable cohort', () => {
  const ids = regionalPackIds('regional-unknown');
  assert.deepEqual(ids, []);
  assert.equal(Object.isFrozen(ids), true);
});
