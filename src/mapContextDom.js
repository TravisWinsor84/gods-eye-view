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

/**
 * Translate the existing location-controller state into the pure context model.
 * @param {object} state Current preset/search/POI, camera, layer, and source state.
 * @returns {object} Display-safe map context with an optional heading field.
 */
export function buildMapContextFromUiState({
  city = null,
  currentPoi = null,
  searchedLabel = null,
  cameraHeading = null,
  enabledLayers = [],
  sources = [],
} = {}) {
  const location = city
    ? {
      ...city,
      name: city.name,
      latitude: currentPoi?.lat,
      longitude: currentPoi?.lon ?? currentPoi?.lng,
    }
    : { name: searchedLabel };
  const selection = currentPoi
    ? {
      label: currentPoi.name,
      type: currentPoi.type ?? currentPoi.kind ?? 'landmark',
      source: currentPoi.source,
      publisher: currentPoi.publisher,
      officialUrl: currentPoi.officialUrl,
    }
    : null;
  const hasHeading = Number.isFinite(cameraHeading);
  const heading = hasHeading ? cameraHeading : null;
  const context = buildMapContext({
    location,
    selection,
    camera: hasHeading ? { headingDegrees: heading } : null,
    enabledLayers: Array.isArray(enabledLayers) ? enabledLayers : [...enabledLayers],
    sources,
  });
  return hasHeading ? { ...context, heading } : context;
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
  if (source) source.textContent = sourceSummary;

  const link = field(root, '[data-map-context-link]');
  const href = officialUrl(context.officialUrl);
  if (link) {
    link.hidden = !href;
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
  syncExpanded(root, state.expanded);
}
