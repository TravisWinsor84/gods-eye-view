import { buildMapContext } from './mapContext.js';

const renderState = new WeakMap();

function text(value, fallback = '') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function officialUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'gov.au' && !hostname.endsWith('.gov.au')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function field(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function syncExpanded(root, expanded) {
  const toggle = field(root, '[data-map-context-toggle]');
  const details = field(root, '[data-map-context-details]');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.textContent = expanded ? 'Hide details' : 'Details';
  }
  if (details) details.hidden = !expanded;
}

function ensureToggle(root) {
  let state = renderState.get(root);
  if (state) return state;

  state = { expanded: false };
  const toggle = field(root, '[data-map-context-toggle]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      state.expanded = !state.expanded;
      syncExpanded(root, state.expanded);
    });
  }
  renderState.set(root, state);
  return state;
}

function relativeAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return '';
  if (ageMs < 60_000) return 'less than a minute ago';
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}

function renderSourceRows(root, sources) {
  const list = field(root, '[data-map-context-sources]');
  const documentRef = root?.ownerDocument;
  if (!list?.replaceChildren || !documentRef?.createElement) return false;
  const rows = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const row = documentRef.createElement('li');
    row.className = 'map-context-source-row';
    row.setAttribute('data-status', text(source?.status, 'unknown'));

    const name = documentRef.createElement('strong');
    name.className = 'map-context-source-name';
    name.textContent = text(source?.name, 'Source');
    row.append(name);

    const badge = documentRef.createElement('span');
    badge.className = 'map-context-source-badge';
    badge.textContent = [text(source?.freshnessClass), text(source?.status, 'unknown')]
      .filter(Boolean).join(' · ').toUpperCase();
    row.append(badge);

    if (source?.observedAt) {
      const time = documentRef.createElement('time');
      time.className = 'map-context-source-age';
      time.setAttribute('datetime', text(source.observedAt));
      time.setAttribute('aria-label', `Observed ${text(source.observedAt)}`);
      time.title = text(source.observedAt);
      time.textContent = relativeAge(source.ageMs) || text(source.observedAt);
      row.append(time);
    }

    const href = officialUrl(source?.officialUrl);
    if (href) {
      const link = documentRef.createElement('a');
      link.className = 'map-context-source-link';
      link.textContent = 'Official source';
      link.setAttribute('href', href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      row.append(link);
    }

    if (source?.caveat) {
      const caveat = documentRef.createElement('span');
      caveat.className = 'map-context-source-caveat';
      caveat.textContent = text(source.caveat);
      row.append(caveat);
    }

    if (source?.error) {
      const error = documentRef.createElement('span');
      error.className = 'map-context-source-error';
      error.textContent = text(source.error);
      row.append(error);
    }
    rows.push(row);
  }
  list.replaceChildren(...rows);
  list.hidden = rows.length === 0;
  return rows.length > 0;
}

/** Read source-status rows from enabled regional layer modules without exposing manager internals. */
export function collectRegionalSourceEntries(regionalLayers = [], enabledLayerIds = []) {
  const enabled = enabledLayerIds instanceof Set ? enabledLayerIds : new Set(enabledLayerIds || []);
  const bySource = new Map();
  for (const layer of regionalLayers || []) {
    if (!enabled.has(layer?.id) || typeof layer?.getStats !== 'function') continue;
    let rows = [];
    try {
      rows = layer.getStats()?.sources || [];
    } catch {
      rows = [];
    }
    for (const source of rows) {
      const sourceId = text(source?.sourceId).trim();
      if (sourceId && !bySource.has(sourceId)) bySource.set(sourceId, source);
    }
  }
  return [...bySource.values()];
}

/**
 * Translate the existing location-controller state into the pure context model.
 * @param {object} state Current preset/search/POI, camera, layer, and source state.
 * @returns {object} Display-safe map context with an optional heading field.
 */
export function buildMapContextFromUiState({
  city = null,
  currentPoi = null,
  searchedLabel = null,
  searchedLatitude = null,
  searchedLongitude = null,
  centreLocation = null,
  useDestination = true,
  regionalSelection = null,
  cameraHeading = null,
  enabledLayers = [],
  sources = [],
  cctvEnabled = false,
  activeCctvCamera = null,
} = {}) {
  const cctvHeadingDegrees = activeCctvCamera?.headingDeg ?? activeCctvCamera?.headingDegrees;
  const cctvPitchDegrees = activeCctvCamera?.pitchDeg ?? activeCctvCamera?.pitchDegrees;
  const camera = cctvEnabled && activeCctvCamera
    ? {
      label: activeCctvCamera.name ?? activeCctvCamera.label ?? activeCctvCamera.id,
      heading: Number.isFinite(cctvHeadingDegrees) ? cctvHeadingDegrees * Math.PI / 180 : null,
      pitch: Number.isFinite(cctvPitchDegrees) ? cctvPitchDegrees * Math.PI / 180 : null,
    }
    : null;
  const location = !useDestination ? (centreLocation || {}) : city
    ? {
      ...city,
      name: city.name,
      latitude: currentPoi?.lat,
      longitude: currentPoi?.lon ?? currentPoi?.lng,
    }
    : {
      name: searchedLabel,
      latitude: searchedLatitude,
      longitude: searchedLongitude,
    };
  const selection = regionalSelection || (useDestination && currentPoi && !camera
    ? {
      label: currentPoi.name,
      type: currentPoi.type ?? currentPoi.kind ?? 'landmark',
      source: currentPoi.source,
      publisher: currentPoi.publisher,
      officialUrl: currentPoi.officialUrl,
    }
    : null);
  const hasHeading = Number.isFinite(cameraHeading);
  const heading = hasHeading ? cameraHeading : null;
  const sourceList = Array.isArray(sources) ? sources : [];
  const cameraSource = camera
    ? [{
      name: activeCctvCamera.sourceLabel ?? activeCctvCamera.provider ?? 'Configured CCTV source',
      status: activeCctvCamera.sourceStatus,
      reason: activeCctvCamera.sourceMessage,
      officialUrl: activeCctvCamera.officialUrl,
    }]
    : [];
  const context = buildMapContext({
    location,
    selection: regionalSelection ? { ...regionalSelection, source: null } : selection,
    camera: camera ?? (hasHeading ? { headingDegrees: heading } : null),
    enabledLayers: Array.isArray(enabledLayers) ? enabledLayers : [...enabledLayers],
    sources: [...sourceList, ...cameraSource],
  });
  return {
    ...context,
    ...(regionalSelection ? { explanation: `${context.explanation} · ${text(regionalSelection.source)}` } : {}),
    ...(hasHeading ? { heading } : {}),
    selectionKey: regionalSelection ? `${regionalSelection.sourceId}:${regionalSelection.label}` : null,
  };
}

/**
 * Paint a pre-built map Context card without interpreting any context value as HTML.
 * @param {Element} root Static #map-context-card element.
 * @param {object} context Output from buildMapContext, optionally with heading degrees.
 * @returns {void}
 */
export function renderMapContext(root, context = {}) {
  if (!root?.querySelector) return;

  const title = field(root, '[data-map-context-title]');
  const accessibleTitle = text(context.accessibleTitle, 'Location not resolved');
  if (title) {
    title.textContent = text(context.title, accessibleTitle);
    title.title = accessibleTitle;
    title.setAttribute('aria-label', accessibleTitle);
  }

  const heading = field(root, '[data-map-context-heading]');
  if (heading) {
    const degrees = context.heading;
    const hasHeading = Number.isFinite(degrees);
    const roundedHeading = hasHeading
      ? Math.round(((degrees % 360) + 360) % 360)
      : null;
    heading.hidden = !hasHeading;
    heading.textContent = hasHeading ? `${roundedHeading}°` : '';
    if (hasHeading) heading.setAttribute('aria-label', `Heading ${roundedHeading} degrees`);
    else heading.removeAttribute('aria-label');
  }

  const hierarchy = field(root, '[data-map-context-hierarchy]');
  if (hierarchy) {
    const hierarchyText = text(context.hierarchy, 'Location not resolved');
    hierarchy.textContent = hierarchyText;
    hierarchy.hidden = hierarchyText === accessibleTitle;
  }

  const summary = field(root, '[data-map-context-summary]');
  if (summary) summary.textContent = text(context.sourceSummary, 'No active source provenance');

  const explanation = field(root, '[data-map-context-explanation]');
  if (explanation) explanation.textContent = text(context.explanation, 'Map orientation context');

  const coordinates = field(root, '[data-map-context-coordinates]');
  if (coordinates) {
    const coordinateText = text(context.coordinates);
    coordinates.hidden = !coordinateText;
    coordinates.textContent = coordinateText;
  }

  const source = field(root, '[data-map-context-source]');
  const sourceSummary = text(context.sourceSummary, 'No active source provenance');
  const hasSourceRows = renderSourceRows(root, context.sources);
  if (source) {
    source.textContent = sourceSummary;
    source.hidden = hasSourceRows;
  }

  const link = field(root, '[data-map-context-link]');
  const href = officialUrl(context.officialUrl);
  if (link) {
    link.hidden = !href || hasSourceRows;
    if (href) {
      link.setAttribute('href', href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    } else {
      link.removeAttribute('href');
      link.removeAttribute('target');
    }
  }

  root.classList?.toggle('is-stale', context.isStale === true);
  root.classList?.toggle('is-unavailable', /\bunavailable\b|\berror\b/i.test(sourceSummary));

  const state = ensureToggle(root);
  if (context.selectionKey && context.selectionKey !== state.selectionKey) state.expanded = true;
  state.selectionKey = context.selectionKey || null;
  syncExpanded(root, state.expanded);
}
