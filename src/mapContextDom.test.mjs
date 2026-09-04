import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMapContextFromUiState, renderMapContext } from './mapContextDom.js';

function makeElement() {
  const element = {
    hidden: false,
    textContent: '',
    title: '',
    attributes: {},
    listeners: {},
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) { return this.values.has(name); },
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    click() { for (const listener of this.listeners.click || []) listener(); },
  };
  Object.defineProperty(element, 'innerHTML', {
    get() { return ''; },
    set() { throw new Error('map context data must not use innerHTML'); },
  });
  return element;
}

function makeRoot() {
  const elements = {
    '[data-map-context-title]': makeElement(),
    '[data-map-context-heading]': makeElement(),
    '[data-map-context-hierarchy]': makeElement(),
    '[data-map-context-summary]': makeElement(),
    '[data-map-context-toggle]': makeElement(),
    '[data-map-context-details]': makeElement(),
    '[data-map-context-explanation]': makeElement(),
    '[data-map-context-coordinates]': makeElement(),
    '[data-map-context-source]': makeElement(),
    '[data-map-context-link]': makeElement(),
  };
  const root = makeElement();
  root.querySelector = (selector) => elements[selector] || null;
  root.elements = elements;
  return root;
}

const resolvedContext = {
  title: 'Melbourne CBD',
  accessibleTitle: 'Melbourne CBD',
  hierarchy: 'Melbourne CBD · Victoria · Australia',
  coordinates: '-37.8136, 144.9631',
  explanation: 'Selected landmark: Federation Square',
  sourceSummary: '3 active overlays',
  isStale: false,
  officialUrl: 'https://www.melbourne.vic.gov.au/',
  heading: 184.4,
};

test('buildMapContextFromUiState projects preset, POI, layers, and finite bearing', () => {
  const context = buildMapContextFromUiState({
    city: { name: 'Melbourne' },
    currentPoi: { name: 'Federation Square', lat: -37.8179, lon: 144.9691 },
    cameraHeading: 184.4,
    enabledLayers: ['traffic', 'regional-civic-status'],
  });

  assert.equal(context.accessibleTitle, 'Melbourne');
  assert.equal(context.coordinates, '-37.8179, 144.9691');
  assert.equal(context.explanation, 'Selected landmark: Federation Square');
  assert.equal(context.sourceSummary, '2 active overlays');
  assert.equal(context.heading, 184.4);
});

test('buildMapContextFromUiState uses free-text search labels without inventing coordinates', () => {
  const context = buildMapContextFromUiState({
    searchedLabel: 'Melbourne VIC, Australia',
  });

  assert.equal(context.accessibleTitle, 'Melbourne VIC, Australia');
  assert.equal(context.coordinates, null);
  assert.equal(Object.hasOwn(context, 'heading'), false);
});

test('renderMapContext presents a compact map summary by default', () => {
  const root = makeRoot();
  renderMapContext(root, resolvedContext);

  assert.equal(root.elements['[data-map-context-title]'].textContent, 'Melbourne CBD');
  assert.equal(root.elements['[data-map-context-hierarchy]'].textContent, 'Melbourne CBD · Victoria · Australia');
  assert.equal(root.elements['[data-map-context-summary]'].textContent, '3 active overlays');
  assert.equal(root.elements['[data-map-context-heading]'].textContent, '184°');
  assert.equal(root.elements['[data-map-context-heading]'].getAttribute('aria-label'), 'Heading 184 degrees');
  assert.equal(root.elements['[data-map-context-toggle]'].getAttribute('aria-expanded'), 'false');
  assert.equal(root.elements['[data-map-context-details]'].hidden, true);

  const link = root.elements['[data-map-context-link]'];
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute('href'), 'https://www.melbourne.vic.gov.au/');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
});

test('the native details button expands and collapses the controlled region', () => {
  const root = makeRoot();
  renderMapContext(root, resolvedContext);
  const toggle = root.elements['[data-map-context-toggle]'];
  const details = root.elements['[data-map-context-details]'];

  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(details.hidden, false);
  assert.equal(toggle.textContent, 'Hide details');

  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(details.hidden, true);
  assert.equal(toggle.textContent, 'Details');
});

test('a clamped long label retains its full title and accessible name', () => {
  const root = makeRoot();
  renderMapContext(root, {
    ...resolvedContext,
    title: 'A very long place name…',
    accessibleTitle: 'A very long place name with the complete municipal and regional description',
  });
  const title = root.elements['[data-map-context-title]'];

  assert.equal(title.textContent, 'A very long place name…');
  assert.equal(title.title, 'A very long place name with the complete municipal and regional description');
  assert.equal(title.getAttribute('aria-label'), 'A very long place name with the complete municipal and regional description');
});

test('an unresolved context remains visible and explicit', () => {
  const root = makeRoot();
  renderMapContext(root, {
    title: 'Location not resolved',
    accessibleTitle: 'Location not resolved',
    hierarchy: 'Location not resolved',
    coordinates: null,
    explanation: 'Map orientation context',
    sourceSummary: 'No active source provenance',
    isStale: false,
    officialUrl: null,
  });

  assert.equal(root.elements['[data-map-context-title]'].textContent, 'Location not resolved');
  assert.equal(root.elements['[data-map-context-hierarchy]'].textContent, 'Location not resolved');
  assert.equal(root.elements['[data-map-context-coordinates]'].hidden, true);
});

test('a hierarchy row is omitted when it only repeats the title', () => {
  const root = makeRoot();
  renderMapContext(root, {
    ...resolvedContext,
    title: 'Austin',
    accessibleTitle: 'Austin',
    hierarchy: 'Austin',
  });

  assert.equal(root.elements['[data-map-context-hierarchy]'].hidden, true);
});

test('unsafe or absent official links are removed from the card', () => {
  for (const officialUrl of ['javascript:alert(1)', 'http://example.com/', null]) {
    const root = makeRoot();
    root.elements['[data-map-context-link]'].setAttribute('href', 'https://old.example/');
    renderMapContext(root, { ...resolvedContext, officialUrl });
    const link = root.elements['[data-map-context-link]'];

    assert.equal(link.hidden, true);
    assert.equal(link.getAttribute('href'), null);
  }
});

test('stale and unavailable source copy stays explicit in expanded details', () => {
  const root = makeRoot();
  renderMapContext(root, {
    ...resolvedContext,
    sourceSummary: 'VicRoads unavailable: Timed out · EPA Victoria · stale · 2026-09-05T10:00:00Z',
    isStale: true,
  });

  assert.match(root.elements['[data-map-context-source]'].textContent, /unavailable: Timed out/);
  assert.match(root.elements['[data-map-context-source]'].textContent, /stale/);
  assert.equal(root.classList.contains('is-stale'), true);
});

test('bearing is shown only for a finite heading', () => {
  const root = makeRoot();
  for (const heading of [Number.NaN, null, undefined, '15']) {
    renderMapContext(root, { ...resolvedContext, heading });
    assert.equal(root.elements['[data-map-context-heading]'].hidden, true);
  }

  renderMapContext(root, { ...resolvedContext, heading: -1 });
  assert.equal(root.elements['[data-map-context-heading]'].hidden, false);
  assert.equal(root.elements['[data-map-context-heading]'].textContent, '359°');
});

test('context data is assigned as text without parsing markup', () => {
  const root = makeRoot();
  renderMapContext(root, {
    ...resolvedContext,
    title: '<img src=x onerror=alert(1)>',
    accessibleTitle: '<img src=x onerror=alert(1)>',
    explanation: '<script>alert(1)</script>',
  });

  assert.equal(root.elements['[data-map-context-title]'].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(root.elements['[data-map-context-explanation]'].textContent, '<script>alert(1)</script>');
});
