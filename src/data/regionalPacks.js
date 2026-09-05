import { createRegionalLayer } from './regionalLayer.js';
import { REGIONAL_SOURCES } from './regionalSources.js';
import { REGIONAL_PACKS, createRegionalPackDefinitions } from './layerState.js';

// Historical public contracts remain available to callers and compatibility tests.
export { REGIONAL_PACKS, createRegionalPackDefinitions };

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

// IDs are source-derived, never based on ordering or group membership.
export const REGIONAL_SOURCE_LAYERS = Object.freeze(Object.fromEntries([
  ["melbourne-trees", "Trees", "♣", "#74d680", "Environment", "Street trees in the Melbourne urban forest."],
  ["melbourne-places", "Public places", "◆", "#55d6be", "Civic services", "Public places across the City of Melbourne."],
  ["melbourne-cycling", "Cycling network", "↔", "#ffd166", "Mobility", "Mapped Melbourne cycling routes."],
  ["melbourne-water-history", "Water history", "≈", "#62d9ff", "Environment", "Historical water features in Melbourne."],
  ["vic-fire-context", "Fire history", "△", "#ff9f43", "Environment", "Mapped historical fire extents in Victoria."],
  ["vic-freight-network", "Freight network", "⇄", "#e6b85c", "Mobility", "Mapped Victorian freight routes."],
  ["au-hydrology", "Waterways", "≈", "#4da6ff", "Environment", "Australian mapped rivers and hydrological features."],
  ["au-emergency-facilities", "Emergency facilities", "✚", "#ff7675", "Civic services", "Mapped emergency service facilities."],
  ["au-health-facilities", "Health facilities", "+", "#ff8fab", "Civic services", "Health facility locations, not current availability."],
  ["au-public-toilets", "Public toilets", "WC", "#55d6be", "Civic services", "Locations from the National Public Toilet Map."],
  ["melbourne-drinking-fountains", "Drinking fountains", "◉", "#55cfff", "Civic services", "Public drinking fountains in Melbourne."],
  ["melbourne-barbecues", "Public barbecues", "♨", "#ffb56b", "Civic services", "Public barbecue locations in Melbourne."],
  ["vic-waste-facilities", "Waste facilities", "↻", "#b7c67c", "Civic services", "Waste and resource recovery facilities in Victoria."],
  ["au-hospital-ed-performance", "Historical ED performance", "H", "#db9dc4", "Civic services", "Historical hospital ED statistics, not live wait times."],
  ["melbourne-parking-live", "Parking sensors", "P", "#f6ce60", "Mobility", "Recent on-street parking sensor observations in Melbourne."],
  ["vic-transport-stops", "Public transport stops", "T", "#ffb86c", "Mobility", "Mapped public transport stops in Victoria."],
  ["vic-ev-chargers", "EV chargers", "ϟ", "#a3dc77", "Mobility", "Government-funded public EV charger locations."],
  ["au-dea-hotspots", "Satellite hotspots", "●", "#ff785a", "Environment", "Satellite hotspot detections, not emergency warnings."],
  ["vic-parks", "Parks and reserves", "♣", "#68c979", "Environment", "Mapped parks and reserves in Victoria."],
  ["vic-recreation-tracks", "Recreation tracks", "⌁", "#a8d982", "Environment", "Mapped recreation tracks in Victoria."],
  ["vic-renewable-facilities", "Renewable energy", "ϟ", "#d5dd74", "Environment", "Renewable energy facility locations in Victoria."],
  ["vic-flood-history-2022", "October 2022 floods", "≈", "#809de0", "Environment", "Historical flood mapping for the October 2022 event."],
  ["vic-epa-priority-sites", "EPA priority sites", "!", "#d7a377", "Environment", "Sites listed on the EPA Victoria Priority Sites Register."],
  ["vic-landfill-register", "Landfill register", "▧", "#b9a183", "Environment", "Registered landfill sites in Victoria."],
  ["vic-recreation-assets", "Recreation assets", "⌂", "#86cbb2", "Environment", "Mapped DEECA recreation facilities and assets."],
  ["vic-epa-air", "Air quality", "≋", "#80d5dc", "Environment", "Requires EPA access; provider contract not yet verified."],
  ["au-place-names", "Place names", "Aa", "#b69cff", "Places & planning", "Named Australian places from the national gazetteer."],
  ["vic-heritage", "Heritage places", "⌂", "#dbafe3", "Places & planning", "Places on the Victorian Heritage Register."],
  ["melbourne-development", "Development activity", "▥", "#c8a0ee", "Places & planning", "Recorded development activity in Melbourne."],
  ["melbourne-culture", "Public art and memorials", "✦", "#ef9fce", "Places & planning", "Public art and memorial locations in Melbourne."],
  ["vic-property-boundaries", "Property boundaries", "□", "#aeabff", "Places & planning", "Mapped Victorian property parcels at close zoom."],
  ["ptv-transit", "Realtime transit", "T", "#ffce6e", "Mobility", "Transport Victoria realtime public transport observations."],
  ["vic-road-unplanned", "Road disruptions", "!", "#ff9a69", "Mobility", "Reported unplanned road disruptions in Victoria."],
  ["vic-lane-signals", "Lane-use signals", "↧", "#edcf76", "Mobility", "Reported lane-use signal context; obey signs at the site."],
  ["vic-wetlands-2025", "Wetlands inventory", "≈", "#72c9b9", "Environment", "Mapped 2025 wetland inventory, not current water extent."],
].map(([sourceId, name, icon, color, group, description]) => {
  const source = REGIONAL_SOURCES[sourceId];
  return [
    `regional-source-${sourceId}`,
    Object.freeze({
      name, icon, color, group, description, sourceIds: Object.freeze([sourceId]),
      updateInterval: Number.isFinite(source.refreshMs) && source.refreshMs > 0
        ? source.refreshMs : 300_000,
      ...(source.configuredEnv ? { configuredEnv: source.configuredEnv } : {}),
    }),
  ];
})));

export const REGIONAL_SOURCE_LAYER_IDS = Object.freeze(Object.keys(REGIONAL_SOURCE_LAYERS));

// Register gated sources too: availability is enforced by regionalLayer. This
// keeps saved/share IDs stable across configurations and every selection visible.
// Legacy packs are migrated by layerState, never registered as invisible layers.
export const regionalDataLayers = Object.freeze(Object.entries(REGIONAL_SOURCE_LAYERS).map(([id, metadata]) => (
  Object.assign(createRegionalLayer({ id, ...metadata }), {
    description: metadata.description,
    group: metadata.group,
    color: metadata.color,
    ...(metadata.configuredEnv ? { configuredEnv: metadata.configuredEnv } : {}),
  })
)));

export default regionalDataLayers;
