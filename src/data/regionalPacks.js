import { createRegionalLayer } from './regionalLayer.js';

export const REGIONAL_PACKS = Object.freeze({
  'regional-melbourne': Object.freeze({
    name: 'Melbourne Data',
    icon: 'M',
    color: '#62d9ff',
    sourceIds: Object.freeze([
      'melbourne-trees',
      'melbourne-places',
      'melbourne-cycling',
      'melbourne-water-history',
    ]),
  }),
  'regional-victoria': Object.freeze({
    name: 'Victoria Data',
    icon: 'V',
    color: '#ff9f43',
    sourceIds: Object.freeze([
      'vic-epa-air',
      'vic-fire-context',
      'vic-freight-network',
      'ptv-transit',
    ]),
  }),
  'regional-australia': Object.freeze({
    name: 'Australia Data',
    icon: 'A',
    color: '#5f8dff',
    sourceIds: Object.freeze(['au-hydrology']),
  }),
});

const EMPTY_PACK = Object.freeze([]);

export function regionalPackIds(packId) {
  return REGIONAL_PACKS[packId]?.sourceIds || EMPTY_PACK;
}

export const regionalDataLayers = Object.freeze(Object.entries(REGIONAL_PACKS).map(([id, pack]) => (
  createRegionalLayer({ id, ...pack })
)));

export default regionalDataLayers;
