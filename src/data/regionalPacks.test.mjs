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

test('Task 3 packs contain only runtime no-account sources and exclude optional PTV', () => {
  for (const packId of EXPECTED_PACK_IDS) {
    const sourceIds = regionalPackIds(packId);
    assert.ok(sourceIds.length > 0, `${packId} must not be empty`);
    assert.equal(sourceIds.includes('ptv-transit'), false);
    for (const sourceId of sourceIds) {
      assert.equal(REGIONAL_SOURCES[sourceId].runtimeEligible, true, sourceId);
      assert.equal(REGIONAL_SOURCES[sourceId].credential, 'none', sourceId);
    }
  }
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
