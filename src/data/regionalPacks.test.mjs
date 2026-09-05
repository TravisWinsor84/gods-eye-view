import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultLayerState,
  decodeLayerStateParams,
  encodeLayerStateParams,
} from './layerState.js';
import { REGIONAL_SOURCES } from './regionalSources.js';
import * as regionalPacksModule from './regionalPacks.js';

const {
  CATEGORY_REGIONAL_PACK_IDS,
  REGIONAL_PACKS,
  createRegionalPackDefinitions,
  regionalDataLayers,
  regionalPackIds,
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

test('defines the three compatibility packs followed by four category packs', () => {
  assert.deepEqual(Object.keys(REGIONAL_PACKS), EXPECTED_PACK_IDS);
  assert.deepEqual(regionalDataLayers.map((layer) => layer.id), EXPECTED_PACK_IDS);
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
    'ptv-transit',
  ]);
  assert.deepEqual(regionalPackIds('regional-environment'), [
    'melbourne-trees', 'melbourne-water-history', 'au-dea-hotspots', 'vic-parks',
    'vic-recreation-tracks', 'vic-renewable-facilities', 'vic-flood-history-2022',
    'vic-epa-priority-sites', 'vic-landfill-register', 'vic-recreation-assets', 'vic-epa-air',
  ]);
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
    'regional-civic',
    'regional-environment',
    'regional-melbourne',
    'regional-mobility',
    'regional-planning',
    'regional-victoria',
  ]);
});

test('unknown pack IDs resolve to an empty immutable cohort', () => {
  const ids = regionalPackIds('regional-unknown');
  assert.deepEqual(ids, []);
  assert.equal(Object.isFrozen(ids), true);
});
