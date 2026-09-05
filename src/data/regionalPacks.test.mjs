import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from './layerState.js';
import { REGIONAL_SOURCES } from './regionalSources.js';
import {
  REGIONAL_PACKS,
  createRegionalPackDefinitions,
  regionalDataLayers,
  regionalPackIds,
} from './regionalPacks.js';

const EXPECTED_PACK_IDS = [
  'regional-melbourne',
  'regional-victoria',
  'regional-australia',
];

test('defines exactly the three serializable regional pack IDs', () => {
  assert.deepEqual(Object.keys(REGIONAL_PACKS), EXPECTED_PACK_IDS);
  assert.deepEqual(regionalDataLayers.map((layer) => layer.id), EXPECTED_PACK_IDS);
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
  for (const packId of EXPECTED_PACK_IDS) {
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
  ]);
  assert.equal(regionalPackIds('regional-victoria').includes('vic-epa-air'), false);
  assert.equal(REGIONAL_SOURCES['ptv-transit'].serverCredential, 'TRANSPORT_VIC_OPEN_DATA_API_KEY');
});

test('all regional pack IDs survive the v2 share-state round trip and remain off by default', () => {
  const defaults = createDefaultLayerState();
  assert.deepEqual(defaults.enabledLayerIds, []);

  const params = new URLSearchParams([['v', '2']]);
  encodeLayerStateParams(params, { ...defaults, enabledLayerIds: EXPECTED_PACK_IDS });
  const restored = decodeLayerStateParams(params);

  assert.deepEqual(restored.enabledLayerIds.filter((id) => id.startsWith('regional-')), [
    'regional-australia',
    'regional-melbourne',
    'regional-victoria',
  ]);
});

test('unknown pack IDs resolve to an empty immutable cohort', () => {
  const ids = regionalPackIds('regional-unknown');
  assert.deepEqual(ids, []);
  assert.equal(Object.isFrozen(ids), true);
});
