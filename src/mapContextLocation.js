import { regionalDistanceM } from './data/regionalBrief.js';
import { REGIONAL_SOURCES } from './data/regionalSources.js';

/** Fetch only the viewed place; automatic map navigation never needs weather/news. */
export async function fetchMapContextPlace(latitude, longitude, { signal } = {}) {
  const params = new URLSearchParams({ latitude: latitude.toFixed(5), longitude: longitude.toFixed(5) });
  const response = await fetch(`/api/regional-place?${params}`, { signal });
  if (!response.ok) throw new Error('Place unavailable');
  return response.json();
}

/** Read only small, plain selection fields; never consume entity description HTML. */
export function readRegionalContextSelection(entity, time) {
  const value = (property) => {
    try {
      const result = typeof property?.getValue === 'function' ? property.getValue(time) : property;
      return typeof result === 'string' || typeof result === 'number'
        ? String(result).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180) : '';
    } catch { return ''; }
  };
  const sourceId = value(entity?.properties?.regionalSourceId);
  if (!Object.hasOwn(REGIONAL_SOURCES, sourceId)) return null;
  const source = REGIONAL_SOURCES[sourceId];
  return {
    sourceId,
    label: value(entity?.name) || 'Regional feature',
    type: value(entity?.properties?.type) || value(entity?.properties?.category) || 'regional feature',
    source: source.name,
  };
}

/** Pick the viewed surface, not the camera's (potentially distant) nadir. */
export function readMapContextCentre(viewer, Cesium) {
  try {
    const canvas = viewer?.scene?.canvas;
    if (!canvas?.clientWidth || !canvas?.clientHeight) return null;
    const pixel = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const ray = viewer.camera.getPickRay(pixel);
    const surface = (ray && viewer.scene.globe?.pick(ray, viewer.scene))
      || viewer.camera.pickEllipsoid(pixel, viewer.scene.globe?.ellipsoid);
    if (!surface) return null;
    const point = Cesium.Cartographic.fromCartesian(surface);
    const centre = {
      latitude: Cesium.Math.toDegrees(point.latitude),
      longitude: Cesium.Math.toDegrees(point.longitude),
    };
    return validPoint(centre) ? centre : null;
  } catch {
    return null;
  }
}

function validPoint(point) {
  return Number.isFinite(point?.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point?.longitude) && Math.abs(point.longitude) <= 180;
}

/** Keep destination labels only while the viewed centre is near that destination. */
export function mapContextDestinationMatches(centre, { city, currentPoi, searchedLatitude, searchedLongitude }) {
  if (!validPoint(centre)) return false;
  const poi = currentPoi || city?.pois?.[0];
  const destination = city
    ? { latitude: poi?.lat, longitude: poi?.lon ?? poi?.lng }
    : { latitude: searchedLatitude, longitude: searchedLongitude };
  return regionalDistanceM(centre, destination) <= 2_000;
}

/** Settled-view lookup with bounded caching and immediate invalidation on motion. */
export function createMapContextLocation({
  onChange,
  fetchBrief = fetchMapContextPlace,
  debounceMs = 600,
  cacheMs = 300_000,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  const cache = new Map();
  let generation = 0;
  let timer = null;
  let controller = null;
  let disposed = false;
  const invalidate = () => {
    generation += 1;
    cancel(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  return {
    moving() {
      invalidate();
      if (!disposed) onChange(null);
    },
    settle(point, { resolve = true } = {}) {
      invalidate();
      if (disposed) return;
      if (!validPoint(point)) { onChange(null); return; }
      const coordinates = { latitude: point.latitude, longitude: point.longitude };
      const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
      const cached = cache.get(key);
      const publish = (place) => onChange({
        ...coordinates,
        name: typeof place?.locality === 'string' && place.locality.trim()
          ? place.locality : typeof place?.label === 'string' ? place.label : null,
        region: typeof place?.region === 'string' ? place.region : null,
        country: typeof place?.country === 'string' ? place.country : null,
      });
      publish(resolve && cached && now() - cached.at < cacheMs ? cached.place : null);
      if (!resolve || (cached && now() - cached.at < cacheMs)) return;
      const token = generation;
      timer = schedule(async () => {
        timer = null;
        const request = new AbortController();
        controller = request;
        try {
          const payload = await fetchBrief(point.latitude, point.longitude, { signal: request.signal });
          if (disposed || token !== generation || request.signal.aborted) return;
          cache.delete(key);
          cache.set(key, { place: payload?.place ?? null, at: now() });
          if (cache.size > 64) cache.delete(cache.keys().next().value);
          publish(payload?.place);
        } catch {
          if (!disposed && token === generation && !request.signal.aborted) {
            // Brief outages also get a short cooldown; coordinates remain useful.
            cache.set(key, { place: null, at: now() - cacheMs + 30_000 });
            if (cache.size > 64) cache.delete(cache.keys().next().value);
            publish(null);
          }
        } finally {
          if (controller === request) controller = null;
        }
      }, debounceMs);
    },
    dispose() { disposed = true; invalidate(); cache.clear(); },
  };
}
