import { readInspectorFields, readMapContextClick, readRegionalContextSelection } from './mapContextLocation.js';
import { isOwnedByOtherLayer, resolvePickId } from './data/pickRegistry.js';

export async function fetchMapFeature(latitude, longitude, { signal } = {}) {
  const params = new URLSearchParams({ latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) });
  const response = await fetch(`/api/map-feature?${params}`, { signal });
  if (!response.ok) throw new Error('Place details unavailable');
  return response.json();
}

export function featureInspectorModel(point, payload) {
  return {
    kind: 'surface', point,
    label: typeof payload?.name === 'string' && payload.name.trim() ? payload.name : 'Clicked location',
    status: 'ready',
    fields: [...readInspectorFields({ Address: payload?.address, Category: payload?.category }),
      ...(Array.isArray(payload?.details) ? payload.details.slice(0, 24).flatMap((row) =>
        typeof row?.label === 'string' && ['string', 'number', 'boolean'].includes(typeof row?.value)
          ? [{ label: row.label.slice(0, 80), value: String(row.value).slice(0, 300) }] : []) : [])],
    source: payload?.source,
    sourceUrl: payload?.sourceUrl,
    caveat: payload?.caveat,
  };
}

/** One owned click handler; no camera/per-frame lookups or replacement of existing handlers. */
export function createMapFeatureInspector({ viewer, Cesium, onChange, fetchFeature = fetchMapFeature,
  timeoutMs = 12_000, schedule = setTimeout, cancel = clearTimeout, documentRef = globalThis.document }) {
  let generation = 0;
  let controller = null;
  let timer = null;
  let disposed = false;
  let selected = null;
  let marker = null;
  const removeMarker = () => { if (marker) viewer.entities?.remove(marker); marker = null; };
  const mark = (point, entity) => {
    removeMarker();
    let position;
    try { position = entity?.position?.getValue(viewer.clock?.currentTime); } catch { /* Use click. */ }
    if (!position && point) position = Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.height || 0);
    if (!position || !viewer.entities?.add) return;
    marker = viewer.entities.add({ position, point: { pixelSize: 24,
      color: Cesium.Color.TRANSPARENT, outlineColor: Cesium.Color.WHITE, outlineWidth: 3,
      disableDepthTestDistance: Number.POSITIVE_INFINITY } });
  };
  const invalidate = () => {
    generation += 1;
    controller?.abort();
    controller = null;
    cancel(timer);
    timer = null;
  };
  const clear = () => { invalidate(); selected = null; removeMarker(); if (!disposed) onChange(null); };
  const selectRegional = (entity, point) => {
    if (entity?.isShowing === false || entity?.show === false) return false;
    const model = readRegionalContextSelection(entity, viewer.clock?.currentTime);
    if (!model) return false;
    invalidate();
    selected = entity;
    mark(point, entity);
    onChange({ ...model, point, kind: 'regional', status: 'ready' });
    return true;
  };
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction(async ({ position }) => {
    if (disposed) return;
    let picked;
    let picks;
    try {
      picked = viewer.scene.pick(position);
      picks = viewer.scene.drillPick?.(position, 16) || [picked];
      picks = picks.filter((hit) => hit?.id !== marker && hit?.primitive?.id !== marker);
      if (picked?.id === marker || picked?.primitive?.id === marker) picked = picks[0];
    } catch { clear(); return; }
    if (isOwnedByOtherLayer('map-feature-inspector', resolvePickId(picked))) { clear(); return; }
    for (const hit of picks) {
      const entity = hit?.id || hit?.primitive?.id;
      if (readRegionalContextSelection(entity, viewer.clock?.currentTime)
        && selectRegional(entity, readMapContextClick(viewer, Cesium, position, hit))) {
        // Keep the original Cesium entity identity, including polygon boundary picks.
        viewer.selectedEntity = entity;
        return;
      }
    }
    if (isOwnedByOtherLayer('map-feature-inspector', resolvePickId(picked))
      || picked?.id != null || picked?.primitive?.id != null) { clear(); return; }
    clear();
    const point = readMapContextClick(viewer, Cesium, position, picked);
    if (!point) return;
    mark(point);
    const base = { kind: 'surface', point, label: 'Clicked location', fields: [], tags: [] };
    onChange({ ...base, status: 'loading' });
    // Bare terrain/globe gets accurate coordinates; only a picked surface requests place details.
    if (!picked) { onChange({ ...base, status: 'coordinates' }); return; }
    const token = generation;
    const request = new AbortController();
    controller = request;
    timer = schedule(() => {
      if (disposed || generation !== token) return;
      invalidate();
      onChange({ ...base, status: 'error' });
    }, timeoutMs);
    try {
      const payload = await fetchFeature(point.latitude, point.longitude, { signal: request.signal });
      if (disposed || token !== generation || request.signal.aborted) return;
      onChange(featureInspectorModel(point, payload));
    } catch {
      if (!disposed && token === generation && !request.signal.aborted) onChange({ ...base, status: 'error' });
    } finally {
      if (token === generation) { cancel(timer); timer = null; controller = null; }
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  const removeSelection = viewer.selectedEntityChanged?.addEventListener((entity) => {
    if (disposed) return;
    if (entity === marker) return;
    if (entity === selected) return;
    if (entity && selectRegional(entity)) return;
    if (entity || selected) clear();
  });
  const keydown = (event) => { if (event.key === 'Escape') clear(); };
  documentRef?.addEventListener('keydown', keydown);
  return {
    clear,
    sync() {
      if (selected && (selected.isShowing === false || selected.show === false
        || (selected.entityCollection && !selected.entityCollection.contains(selected)))) clear();
    },
    dispose() {
      if (disposed) return;
      clear();
      disposed = true;
      removeSelection?.();
      documentRef?.removeEventListener('keydown', keydown);
      handler.destroy();
    },
  };
}
