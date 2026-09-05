import * as Cesium from 'cesium';

import { REGIONAL_SOURCES } from './regionalSources.js';

export const REGIONAL_ENTITY_LIMIT = 1_500;
export const REGIONAL_LABEL_LIMIT = 80;
export const REGIONAL_MAX_VIEW_SPAN_DEG = 10;
export const REGIONAL_MAX_CAMERA_HEIGHT_M = 2_000_000;
const CAMERA_REFRESH_DELAY_MS = 75;

function cleanId(value, fallback) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function featureBounds(feature) {
  const coordinates = [];
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
      coordinates.push(value);
      return;
    }
    for (const nested of value) visit(nested);
  };
  visit(feature?.geometry?.coordinates);
  if (!coordinates.length) return null;
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  return {
    west: Math.min(...longitudes),
    south: Math.min(...latitudes),
    east: Math.max(...longitudes),
    north: Math.max(...latitudes),
  };
}

function intersectsBounds(feature, bounds) {
  const featureBox = featureBounds(feature);
  return Boolean(featureBox
    && featureBox.east >= bounds.west
    && featureBox.west <= bounds.east
    && featureBox.north >= bounds.south
    && featureBox.south <= bounds.north);
}

function activeViewport(viewer) {
  const height = Number(viewer?.camera?.positionCartographic?.height);
  if (Number.isFinite(height) && height > REGIONAL_MAX_CAMERA_HEIGHT_M) return null;
  const rectangle = viewer?.camera?.computeViewRectangle?.(
    viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84,
  );
  if (!rectangle) return null;
  const west = Cesium.Math.toDegrees(rectangle.west);
  const south = Cesium.Math.toDegrees(rectangle.south);
  const east = Cesium.Math.toDegrees(rectangle.east);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const width = Cesium.Math.toDegrees(rectangle.width);
  const heightDegrees = north - south;
  if (![west, south, east, north, width, heightDegrees].every(Number.isFinite)
    || east < west
    || width <= 0
    || heightDegrees <= 0
    || width > REGIONAL_MAX_VIEW_SPAN_DEG
    || heightDegrees > REGIONAL_MAX_VIEW_SPAN_DEG) return null;
  return { west, south, east, north };
}

function proxyUrl(sourceId, bounds) {
  const params = new URLSearchParams({
    west: String(Number(bounds.west.toFixed(6))),
    south: String(Number(bounds.south.toFixed(6))),
    east: String(Number(bounds.east.toFixed(6))),
    north: String(Number(bounds.north.toFixed(6))),
  });
  return `/api/regional/${sourceId}?${params}`;
}

function colorWithAlpha(color, alpha) {
  return color.withAlpha(alpha);
}

function polygonHierarchy(rings) {
  if (!Array.isArray(rings?.[0])) return null;
  const positions = Cesium.Cartesian3.fromDegreesArray(rings[0].flatMap((coordinate) => coordinate.slice(0, 2)));
  const holes = rings.slice(1).map((ring) => new Cesium.PolygonHierarchy(
    Cesium.Cartesian3.fromDegreesArray(ring.flatMap((coordinate) => coordinate.slice(0, 2))),
  ));
  return new Cesium.PolygonHierarchy(positions, holes);
}

function addGeometryEntity(dataSource, {
  sourceId,
  feature,
  featureIndex,
  suffix = '',
  geometry = feature.geometry,
  baseColor,
  label,
}) {
  const featureId = cleanId(feature.id ?? feature.properties?.id, `feature-${featureIndex}`);
  const entity = {
    id: `${sourceId}:${featureId}${suffix}`,
    name: String(feature.properties?.title || feature.properties?.name || featureId),
    properties: { ...feature.properties, regionalSourceId: sourceId },
  };
  const coordinates = geometry?.coordinates;
  if (geometry?.type === 'Point') {
    entity.position = Cesium.Cartesian3.fromDegrees(coordinates[0], coordinates[1], Number(coordinates[2]) || 0);
    entity.point = {
      pixelSize: 8,
      color: baseColor,
      outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    };
    if (label) {
      entity.label = {
        text: entity.name,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 120_000),
      };
    }
  } else if (geometry?.type === 'LineString') {
    entity.polyline = {
      positions: Cesium.Cartesian3.fromDegreesArray(coordinates.flatMap((coordinate) => coordinate.slice(0, 2))),
      width: 2,
      material: baseColor,
      clampToGround: true,
    };
  } else if (geometry?.type === 'Polygon') {
    const hierarchy = polygonHierarchy(coordinates);
    if (!hierarchy) return false;
    entity.polygon = {
      hierarchy,
      material: colorWithAlpha(baseColor, 0.22),
      outline: true,
      outlineColor: baseColor,
    };
  } else {
    return false;
  }
  dataSource.entities.add(entity);
  return true;
}

function addFeature(dataSource, options, maxEntities = Number.POSITIVE_INFINITY) {
  const geometry = options.feature?.geometry;
  if (!geometry || maxEntities <= 0) return 0;
  if (geometry.type === 'MultiPoint') {
    return geometry.coordinates.slice(0, maxEntities).reduce(
      (count, coordinates, index) => count + Number(addGeometryEntity(dataSource, {
        ...options,
        suffix: `:${index}`,
        geometry: { type: 'Point', coordinates },
        label: options.label && index === 0,
      })),
      0,
    );
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.slice(0, maxEntities).reduce((count, coordinates, index) => count + Number(addGeometryEntity(dataSource, {
      ...options,
      suffix: `:${index}`,
      geometry: { type: 'LineString', coordinates },
      label: false,
    })), 0);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.slice(0, maxEntities).reduce((count, coordinates, index) => count + Number(addGeometryEntity(dataSource, {
      ...options,
      suffix: `:${index}`,
      geometry: { type: 'Polygon', coordinates },
      label: false,
    })), 0);
  }
  return Number(addGeometryEntity(dataSource, options));
}

function sourceError(sourceId, error) {
  const source = REGIONAL_SOURCES[sourceId];
  const sourceName = source?.name || sourceId;
  const publisher = source?.source ? `, ${source.source}` : '';
  const detail = String(error?.message || error || 'unavailable').trim();
  return `${sourceName} (${sourceId}${publisher}): ${detail}`;
}

const SANITIZED_REGIONAL_ERRORS = new Set([
  'regional source credentials required',
  'regional source timed out',
  'regional source is temporarily unavailable',
  'regional source response was too large',
  'regional source returned invalid data',
  'regional source is unavailable',
]);

async function regionalResponseError(response) {
  const regionalStatus = String(response?.headers?.get?.('x-regional-status') || '').trim().toLowerCase()
    || 'unavailable';
  let providerMessage = '';
  try {
    const body = await response?.json?.();
    if (SANITIZED_REGIONAL_ERRORS.has(body?.error)) providerMessage = body.error;
  } catch {
    // The server contract is JSON, but client-facing errors remain sanitized
    // when an intermediary returns an empty or non-JSON response.
  }
  const message = response?.status === 424 || regionalStatus === 'credentials-required'
    ? 'regional source credentials required'
    : providerMessage || 'regional source is temporarily unavailable';
  const error = new Error(message);
  error.regionalStatus = regionalStatus;
  return error;
}

function regionalModeIssue(modeStatus) {
  return Object.entries(modeStatus || {})
    .filter(([, detail]) => detail?.status === 'stale' || detail?.status === 'unavailable')
    .map(([mode, detail]) => `${mode} ${detail.status}`)
    .join(', ');
}

/** Create one independently managed Cesium layer for a regional source pack. */
export function createRegionalLayer({
  id,
  sourceIds,
  name = id,
  icon = '●',
  color = '#62d9ff',
  updateInterval = 300_000,
}) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('Regional layer requires a stable id');
  if (!Array.isArray(sourceIds) || sourceIds.length === 0) throw new Error(`${id} requires source IDs`);
  const sources = Object.freeze([...sourceIds]);
  for (const sourceId of sources) {
    const source = REGIONAL_SOURCES[sourceId];
    if (!source?.runtimeEligible || source.credential !== 'none') {
      throw new Error(`${id} cannot include unavailable or credentialed source: ${sourceId}`);
    }
  }

  let dataSource = null;
  let enabled = false;
  let destroyed = false;
  let moveEndRemover = null;
  let cameraRefreshTimer = null;
  let queuedCameraRefresh = null;
  let activeUpdate = null;
  let activeUpdateGeneration = null;
  let activeUpdateController = null;
  let generation = 0;
  let count = 0;
  let lastUpdate = null;
  let status = 'idle';
  const lastGoodBySource = new Map();
  const errorsBySource = new Map();
  const statusBySource = new Map();

  const render = (viewer) => {
    if (!dataSource) return;
    dataSource.entities.removeAll();
    count = 0;
    const bounds = activeViewport(viewer);
    if (!enabled || !bounds) {
      status = enabled ? 'zoom-in' : 'idle';
      viewer?.scene?.requestRender?.();
      return;
    }
    const baseColor = Cesium.Color.fromCssColorString(color) || Cesium.Color.CYAN;
    let labels = 0;
    outer: for (const sourceId of sources) {
      const features = lastGoodBySource.get(sourceId)?.features || [];
      for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
        if (count >= REGIONAL_ENTITY_LIMIT) break outer;
        const feature = features[featureIndex];
        if (!intersectsBounds(feature, bounds)) continue;
        const wantsLabel = feature.geometry?.type.includes('Point') && labels < REGIONAL_LABEL_LIMIT;
        const added = addFeature(dataSource, {
          sourceId,
          feature,
          featureIndex,
          baseColor,
          label: wantsLabel,
        }, REGIONAL_ENTITY_LIMIT - count);
        count += added;
        if (added && wantsLabel) labels += 1;
      }
    }
    status = errorsBySource.size ? (count ? 'degraded' : 'unavailable') : (count ? 'active' : 'empty');
    viewer?.scene?.requestRender?.();
  };

  const detachCamera = () => {
    moveEndRemover?.();
    moveEndRemover = null;
  };

  const cancelRefreshWork = () => {
    generation += 1;
    if (cameraRefreshTimer !== null) clearTimeout(cameraRefreshTimer);
    cameraRefreshTimer = null;
    queuedCameraRefresh = null;
    activeUpdateController?.abort();
  };

  const runUpdate = (viewer, externalSignal = null) => {
    if (destroyed || !enabled || !dataSource) return Promise.resolve(false);
    if (activeUpdate && activeUpdateGeneration === generation) return activeUpdate;

    const updateGeneration = generation;
    const controller = new AbortController();
    activeUpdateGeneration = updateGeneration;
    activeUpdateController = controller;
    const abortFromExternal = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromExternal();
    else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });

    const updatePromise = (async () => {
      const bounds = activeViewport(viewer);
      if (!bounds) {
        if (updateGeneration !== generation || destroyed || !enabled || !dataSource) return false;
        errorsBySource.clear();
        statusBySource.clear();
        render(viewer);
        return true;
      }

      let results;
      try {
        results = await Promise.all(sources.map(async (sourceId) => {
          try {
            const response = await fetch(proxyUrl(sourceId, bounds), {
              method: 'GET',
              headers: { Accept: 'application/json' },
              signal: controller.signal,
            });
            if (!response?.ok) throw await regionalResponseError(response);
            const body = await response.json();
            if (body?.type !== 'FeatureCollection' || !Array.isArray(body.features)) {
              throw new Error('invalid regional response');
            }
            const regionalStatus = String(response?.headers?.get?.('x-regional-status') || '').trim().toLowerCase()
              || 'fresh';
            return { sourceId, body, regionalStatus };
          } catch (error) {
            if (controller.signal.aborted) throw error;
            return { sourceId, error };
          }
        }));
      } catch (error) {
        if (updateGeneration !== generation || destroyed || !enabled || !dataSource) return false;
        throw error;
      }

      if (updateGeneration !== generation || destroyed || !enabled || !dataSource) return false;
      let successful = 0;
      for (const result of results) {
        if (result.error) {
          errorsBySource.set(result.sourceId, sourceError(result.sourceId, result.error));
          statusBySource.set(result.sourceId, {
            status: result.error.regionalStatus || 'unavailable',
            modes: {},
          });
          continue;
        }
        successful += 1;
        lastGoodBySource.set(result.sourceId, result.body);
        const modes = result.body.modeStatus || {};
        statusBySource.set(result.sourceId, { status: result.regionalStatus, modes });
        const modeIssue = regionalModeIssue(modes);
        if (result.regionalStatus === 'degraded' || modeIssue) {
          errorsBySource.set(result.sourceId, sourceError(
            result.sourceId,
            new Error(modeIssue || 'regional source is degraded'),
          ));
        } else {
          errorsBySource.delete(result.sourceId);
        }
      }
      if (successful > 0) lastUpdate = Date.now();
      render(viewer);
      return successful > 0 || lastGoodBySource.size > 0;
    })();

    activeUpdate = updatePromise.finally(() => {
      externalSignal?.removeEventListener?.('abort', abortFromExternal);
      if (activeUpdate !== wrappedUpdate) return;
      activeUpdate = null;
      activeUpdateGeneration = null;
      activeUpdateController = null;
      const queued = queuedCameraRefresh;
      queuedCameraRefresh = null;
      if (queued && queued.generation === generation && enabled && !destroyed && dataSource) {
        queueMicrotask(() => {
          if (queued.generation === generation && enabled && !destroyed && dataSource) {
            void runUpdate(queued.viewer).catch(() => {});
          }
        });
      }
    });
    const wrappedUpdate = activeUpdate;
    return wrappedUpdate;
  };

  const scheduleCameraRefresh = (viewer) => {
    if (cameraRefreshTimer !== null) clearTimeout(cameraRefreshTimer);
    const scheduledGeneration = generation;
    cameraRefreshTimer = setTimeout(() => {
      cameraRefreshTimer = null;
      if (scheduledGeneration !== generation || destroyed || !enabled || !dataSource) return;
      if (activeUpdate && activeUpdateGeneration === scheduledGeneration) {
        queuedCameraRefresh = { viewer, generation: scheduledGeneration };
        return;
      }
      void runUpdate(viewer).catch(() => {});
    }, CAMERA_REFRESH_DELAY_MS);
  };

  return {
    id,
    name,
    icon,
    color,
    source: sources.map((sourceId) => REGIONAL_SOURCES[sourceId].source).join(' / '),
    sourceIds: sources,
    updateInterval,

    async init(viewer) {
      if (destroyed || dataSource) return !destroyed;
      const created = new Cesium.CustomDataSource(id);
      created.show = false;
      created.clustering.enabled = true;
      created.clustering.pixelRange = 48;
      created.clustering.minimumClusterSize = 3;
      await viewer.dataSources.add(created);
      if (destroyed) {
        viewer.dataSources.remove(created, true);
        return false;
      }
      dataSource = created;
      return true;
    },

    async enable(viewer) {
      if (destroyed || !dataSource) return false;
      enabled = true;
      dataSource.show = true;
      if (!moveEndRemover) {
        moveEndRemover = viewer.camera.moveEnd.addEventListener(() => {
          render(viewer);
          scheduleCameraRefresh(viewer);
        });
      }
      render(viewer);
      return true;
    },

    async update(viewer, { signal = null } = {}) {
      return runUpdate(viewer, signal);
    },

    async disable(viewer) {
      enabled = false;
      cancelRefreshWork();
      detachCamera();
      if (dataSource) dataSource.show = false;
      status = 'idle';
      viewer?.scene?.requestRender?.();
      return true;
    },

    async destroy(viewer) {
      if (destroyed) return true;
      enabled = false;
      destroyed = true;
      cancelRefreshWork();
      detachCamera();
      if (dataSource) viewer?.dataSources?.remove?.(dataSource, true);
      dataSource = null;
      lastGoodBySource.clear();
      errorsBySource.clear();
      statusBySource.clear();
      count = 0;
      lastUpdate = null;
      status = 'idle';
      return true;
    },

    getStats() {
      const sourceErrors = Object.fromEntries(errorsBySource);
      return {
        count,
        lastUpdate,
        error: Object.values(sourceErrors).join('; ') || null,
        status,
        sourceErrors,
        sourceStatus: Object.fromEntries(statusBySource),
      };
    },
  };
}
