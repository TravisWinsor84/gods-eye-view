import * as Cesium from 'cesium';
import { REGIONAL_IMAGERY_SOURCES } from './regionalImagery.js';

const MINIMUM_LEVEL = 6;
const MAXIMUM_LEVEL = 14;
const TILE_SIZE = 256;
const SOURCE_ID = 'au-dea-land-cover';
const SOURCE_DATE = '2020-01-01T00:00:00.000Z';
const SOURCE_CAVEAT = 'Annual 2020 satellite-derived land-cover classification; not live conditions or emergency advice.';
const SOURCE_URL = 'https://knowledge.dea.ga.gov.au/data/product/dea-land-cover-landsat/';

function templateUrl(sourceId) {
  return `/api/regional-imagery/${sourceId}?west={westDegrees}&south={southDegrees}&east={eastDegrees}&north={northDegrees}&width={width}&height={height}`;
}

/** Create one manager-compatible Cesium regional imagery layer. */
export function createRegionalImageryLayer({
  id,
  sourceId,
  name = id,
  icon = 'L',
  alpha = 0.62,
  cesium = Cesium,
  providerFactory = null,
} = {}) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('Regional imagery layer requires a stable id');
  const source = REGIONAL_IMAGERY_SOURCES[sourceId];
  if (!source || sourceId !== SOURCE_ID) throw new Error(`unknown regional imagery source: ${sourceId || ''}`);
  const normalizedAlpha = Math.max(0, Math.min(1, Number.isFinite(Number(alpha)) ? Number(alpha) : 0.62));
  const makeProvider = providerFactory || ((options) => new cesium.UrlTemplateImageryProvider(options));

  let viewer = null;
  let imageryLayer = null;
  let enabled = false;
  let destroyed = false;
  let generation = 0;
  let status = 'idle';
  let lastUpdate = null;
  let error = null;

  const requestRender = () => viewer?.scene?.requestRender?.();

  return {
    id,
    name,
    icon,
    source: source.attribution,
    sourceIds: Object.freeze([sourceId]),
    updateInterval: -1,

    async init(nextViewer) {
      if (destroyed) return false;
      if (!nextViewer?.imageryLayers?.addImageryProvider) return false;
      viewer = nextViewer;
      return true;
    },

    async enable(nextViewer) {
      if (destroyed) return false;
      if (nextViewer) viewer = nextViewer;
      if (!viewer?.imageryLayers?.addImageryProvider) return false;
      enabled = true;
      error = null;
      if (imageryLayer) {
        imageryLayer.alpha = normalizedAlpha;
        imageryLayer.show = true;
        status = 'active';
        requestRender();
        return true;
      }

      const enableGeneration = ++generation;
      status = 'loading';
      requestRender();
      try {
        const provider = await makeProvider({
          url: templateUrl(sourceId),
          minimumLevel: MINIMUM_LEVEL,
          maximumLevel: MAXIMUM_LEVEL,
          tileWidth: TILE_SIZE,
          tileHeight: TILE_SIZE,
          credit: new cesium.Credit(source.attribution),
        });
        if (destroyed || !enabled || enableGeneration !== generation) return false;
        const created = viewer.imageryLayers.addImageryProvider(provider);
        created.alpha = normalizedAlpha;
        created.show = true;
        imageryLayer = created;
        status = 'active';
        lastUpdate = Date.now();
        requestRender();
        return true;
      } catch (cause) {
        if (destroyed || !enabled || enableGeneration !== generation) return false;
        enabled = false;
        status = 'unavailable';
        error = new Error('regional imagery is unavailable', { cause });
        requestRender();
        throw error;
      }
    },

    async update(_viewer, { signal = null } = {}) {
      return !destroyed && !signal?.aborted;
    },

    async disable(nextViewer) {
      if (nextViewer) viewer = nextViewer;
      enabled = false;
      generation += 1;
      if (imageryLayer) imageryLayer.show = false;
      status = 'idle';
      requestRender();
      return true;
    },

    async destroy(nextViewer) {
      if (destroyed) return true;
      if (nextViewer) viewer = nextViewer;
      enabled = false;
      destroyed = true;
      generation += 1;
      if (imageryLayer) viewer?.imageryLayers?.remove?.(imageryLayer, true);
      imageryLayer = null;
      status = 'idle';
      lastUpdate = null;
      error = null;
      requestRender();
      viewer = null;
      return true;
    },

    getStats() {
      if (destroyed) {
        return { count: 0, lastUpdate: null, error: null, status: 'idle', sourceStatus: {}, sources: [] };
      }
      const sourceEntry = {
        sourceId,
        name,
        status,
        freshnessClass: source.freshnessClass,
        observedAt: SOURCE_DATE,
        caveat: SOURCE_CAVEAT,
        credit: source.attribution,
        officialUrl: SOURCE_URL,
      };
      return {
        count: enabled && imageryLayer ? 1 : 0,
        lastUpdate,
        error,
        status,
        sourceStatus: { [sourceId]: { status } },
        sources: [sourceEntry],
      };
    },
  };
}

export const regionalImageryLayers = Object.freeze([
  createRegionalImageryLayer({
    id: 'imagery-dea-land-cover',
    sourceId: SOURCE_ID,
    name: 'DEA Land Cover',
    icon: 'L',
    alpha: 0.62,
  }),
]);

export default regionalImageryLayers;
