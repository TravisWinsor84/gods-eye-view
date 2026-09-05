import { createRegionalLayer } from './regionalLayer.js';

export function createRegionalPackDefinitions({ transportVicConfigured = false, wetlandsConfigured = false } = {}) {
  return Object.freeze({
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
      'vic-fire-context',
      'vic-freight-network',
      ...(transportVicConfigured ? ['ptv-transit', 'vic-road-unplanned', 'vic-lane-signals'] : []),
    ]),
  }),
  'regional-australia': Object.freeze({
    name: 'Australia Data',
    icon: 'A',
    color: '#5f8dff',
    sourceIds: Object.freeze(['au-hydrology']),
  }),
  'regional-civic': Object.freeze({
    name: 'Civic Services',
    icon: 'C',
    color: '#55d6be',
    sourceIds: Object.freeze([
      'au-emergency-facilities',
      'au-health-facilities',
      'au-public-toilets',
      'melbourne-places',
      'melbourne-drinking-fountains',
      'melbourne-barbecues',
      'vic-waste-facilities',
      'au-hospital-ed-performance',
    ]),
  }),
  'regional-mobility': Object.freeze({
    name: 'Mobility',
    icon: 'T',
    color: '#ffd166',
    sourceIds: Object.freeze([
      'melbourne-cycling',
      'melbourne-parking-live',
      'vic-transport-stops',
      'vic-ev-chargers',
      ...(transportVicConfigured ? ['ptv-transit', 'vic-road-unplanned', 'vic-lane-signals'] : []),
    ]),
  }),
  'regional-environment': Object.freeze({
    name: 'Environment',
    icon: 'E',
    color: '#74d680',
    sourceIds: Object.freeze([
      'melbourne-trees',
      'melbourne-water-history',
      'au-dea-hotspots',
      'vic-parks',
      'vic-recreation-tracks',
      'vic-renewable-facilities',
      'vic-flood-history-2022',
      'vic-epa-priority-sites',
      'vic-landfill-register',
      'vic-recreation-assets',
      'vic-epa-air',
      ...(wetlandsConfigured ? ['vic-wetlands-2025'] : []),
    ]),
  }),
  'regional-planning': Object.freeze({
    name: 'Places & Planning',
    icon: 'P',
    color: '#b69cff',
    sourceIds: Object.freeze([
      'au-place-names',
      'vic-heritage',
      'melbourne-development',
      'melbourne-culture',
      'vic-property-boundaries',
    ]),
  }),
  });
}

const transportVicConfigured = import.meta.env?.VITE_TRANSPORT_VIC_OPEN_DATA_CONFIGURED === 'true';
const wetlandsConfigured = import.meta.env?.VITE_VIC_WETLANDS_2025_CONFIGURED === 'true';
export const REGIONAL_PACKS = createRegionalPackDefinitions({ transportVicConfigured, wetlandsConfigured });

export const CATEGORY_REGIONAL_PACK_IDS = Object.freeze([
  'regional-civic',
  'regional-mobility',
  'regional-environment',
  'regional-planning',
]);

const EMPTY_PACK = Object.freeze([]);

export function regionalPackIds(packId) {
  return REGIONAL_PACKS[packId]?.sourceIds || EMPTY_PACK;
}

export const regionalDataLayers = Object.freeze(Object.entries(REGIONAL_PACKS).map(([id, pack]) => (
  createRegionalLayer({ id, ...pack })
)));

export default regionalDataLayers;
