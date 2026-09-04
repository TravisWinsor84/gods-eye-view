const LABEL_CHARS_PER_LINE = 60;

function normalizeText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeOfficialUrl(value) {
  const text = normalizeText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function coordinate(value) {
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  return Number.isFinite(number) ? number : null;
}

function coordinateText(location = {}) {
  const latitude = coordinate(location.latitude ?? location.lat);
  const longitude = coordinate(location.longitude ?? location.lon ?? location.lng);
  if (latitude === null || longitude === null) return null;
  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function activeOverlayCount(enabledLayers) {
  if (!Array.isArray(enabledLayers)) return 0;
  return enabledLayers.filter((layer) => (
    typeof layer === 'string' ? normalizeText(layer) : layer?.enabled === true
  )).length;
}

function sourceName(source) {
  return normalizeText(source?.name ?? source?.source ?? source?.publisher);
}

function sourceStatus(source) {
  if (source?.stale === true) return 'stale';
  if (source?.available === false || normalizeText(source?.status).toLowerCase() === 'error') return 'unavailable';
  return 'current';
}

function describeSource(source) {
  const name = sourceName(source) || 'Source';
  const status = sourceStatus(source);
  const reason = normalizeText(source?.reason ?? source?.error);
  const observedAt = normalizeText(source?.observedAt);
  const parts = [status === 'unavailable' && reason ? `${name} unavailable: ${reason}` : `${name} · ${status}`];
  if (observedAt) parts.push(observedAt);
  if (!safeOfficialUrl(source?.officialUrl)) parts.push('official link unavailable');
  return parts.join(' · ');
}

function cameraExplanation(camera) {
  if (!camera || typeof camera !== 'object') return '';
  const label = normalizeText(camera.label ?? camera.name ?? camera.id);
  const heading = coordinate(camera.heading ?? camera.headingDegrees);
  const pitch = coordinate(camera.pitch ?? camera.pitchDegrees);
  if (!label && heading === null && pitch === null) return '';

  const directions = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const headingDegrees = heading !== null && Math.abs(heading) <= (Math.PI * 2)
    ? (heading * 180) / Math.PI
    : heading;
  const direction = headingDegrees === null
    ? ''
    : directions[Math.round((((headingDegrees % 360) + 360) % 360) / 45) % directions.length];
  const pitchDegrees = pitch !== null && Math.abs(pitch) <= (Math.PI * 2)
    ? (pitch * 180) / Math.PI
    : pitch;
  const down = pitchDegrees === null ? '' : `${Math.abs(Math.round(pitchDegrees))}° ${pitchDegrees <= 0 ? 'down' : 'up'}`;
  const orientation = [direction, down].filter(Boolean).join(', ');
  return [label ? `Camera: ${label}` : 'Camera orientation', orientation].filter(Boolean).join(' — ');
}

/**
 * Produces a bounded, display-safe label. The unabridged label belongs in the
 * context's accessibleTitle field so a visual clamp never hides information.
 */
export function clampContextLabel(value, maxLines = 2) {
  const text = normalizeText(value);
  const lines = Number.isFinite(maxLines) ? Math.max(1, Math.floor(maxLines)) : 2;
  const limit = lines * LABEL_CHARS_PER_LINE;
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

/**
 * Builds plain map-orientation data without reading the DOM or external state.
 */
export function buildMapContext({
  location = {},
  selection = null,
  camera = null,
  enabledLayers = [],
  sources = [],
  now: _now = Date.now(),
} = {}) {
  const place = normalizeText(location?.name ?? location?.label ?? location?.suburb ?? location?.city);
  const suburb = normalizeText(location?.suburb ?? location?.city ?? place);
  const state = normalizeText(location?.state ?? location?.region);
  const country = normalizeText(location?.country);
  const coordinates = coordinateText(location);
  const accessibleTitle = place || coordinates || 'Location not resolved';
  const hierarchyParts = [suburb, state, country].filter(Boolean);
  const hierarchy = hierarchyParts.length ? hierarchyParts.join(' · ') : 'Location not resolved';
  const sourceList = Array.isArray(sources) ? sources.filter((source) => source && typeof source === 'object') : [];
  const selectedSource = selection && typeof selection === 'object' && sourceName(selection)
    ? [{ name: sourceName(selection), officialUrl: selection.officialUrl }]
    : [];
  const provenance = [...selectedSource, ...sourceList];
  const officialUrl = provenance.map((source) => safeOfficialUrl(source.officialUrl)).find(Boolean) ?? null;
  const isStale = sourceList.some((source) => sourceStatus(source) === 'stale');
  const overlays = activeOverlayCount(enabledLayers);
  const sourceDescriptions = provenance.map(describeSource);
  const summaryParts = [];
  if (overlays) summaryParts.push(`${overlays} active overlay${overlays === 1 ? '' : 's'}`);
  if (sourceDescriptions.length) summaryParts.push(sourceDescriptions.join('; '));
  const sourceSummary = summaryParts.join(' · ') || 'No active source provenance';

  const selectionLabel = normalizeText(selection?.label ?? selection?.name ?? selection?.title);
  const selectionType = normalizeText(selection?.type ?? selection?.kind);
  const explanation = selectionLabel
    ? `Selected ${selectionType || 'feature'}: ${selectionLabel}`
    : cameraExplanation(camera) || (coordinates && !place ? 'Location not resolved' : 'Map orientation context');

  return {
    title: clampContextLabel(accessibleTitle),
    accessibleTitle,
    hierarchy,
    coordinates,
    explanation,
    sourceSummary,
    isStale,
    officialUrl,
  };
}
