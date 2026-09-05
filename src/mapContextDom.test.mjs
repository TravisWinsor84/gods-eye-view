import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMapContextFromUiState, collectRegionalSourceEntries, renderMapContext } from './mapContextDom.js';

function makeElement(tagName = 'div') {
  const element = {
    tagName: tagName.toUpperCase(),
    hidden: false,
    textContent: '',
    title: '',
    attributes: {},
    listeners: {},
    children: [],
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
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    click() { for (const listener of this.listeners.click || []) listener(); },
  };
  Object.defineProperty(element, 'innerHTML', {
    get() { return ''; },
    set() { throw new Error('map context data must not use innerHTML'); },
  });
  return element;
}

function makeRoot() {
  const ownerDocument = { createElement: (tagName) => makeElement(tagName) };
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
    '[data-map-context-sources]': makeElement('ul'),
    '[data-map-context-link]': makeElement(),
  };
  const root = makeElement();
  root.ownerDocument = ownerDocument;
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

test('buildMapContextFromUiState includes the active CCTV camera only while CCTV is enabled', () => {
  const activeCctvCamera = {
    name: 'Collins Street camera',
    headingDeg: 5,
    pitchDeg: -18,
    sourceLabel: 'City of Melbourne traffic cameras',
    sourceStatus: 'ok',
  };

  const enabled = buildMapContextFromUiState({
    enabledLayers: ['cctv'],
    cctvEnabled: true,
    activeCctvCamera,
  });
  assert.match(enabled.explanation, /Camera: Collins Street camera/);
  assert.match(enabled.explanation, /— north,/i);
  assert.match(enabled.sourceSummary, /1 active overlay/);
  assert.match(enabled.sourceSummary, /City of Melbourne traffic cameras · current/);

  const disabled = buildMapContextFromUiState({
    cctvEnabled: false,
    activeCctvCamera,
  });
  assert.equal(disabled.explanation, 'Map orientation context');
  assert.equal(disabled.sourceSummary, 'No active source provenance');
});

test('buildMapContextFromUiState preserves resolved free-text search coordinates', () => {
  const context = buildMapContextFromUiState({
    searchedLabel: 'Melbourne VIC, Australia',
    searchedLatitude: -37.8136,
    searchedLongitude: 144.9631,
  });

  assert.equal(context.accessibleTitle, 'Melbourne VIC, Australia');
  assert.equal(context.coordinates, '-37.8136, 144.9631');
  assert.equal(Object.hasOwn(context, 'heading'), false);
});

test('collectRegionalSourceEntries reads enabled packs and deduplicates compatibility overlap', () => {
  const shared = { sourceId: 'melbourne-places', name: 'Melbourne Public Places', status: 'fresh' };
  const layers = [
    { id: 'regional-melbourne', getStats: () => ({ sources: [shared] }) },
    { id: 'regional-civic', getStats: () => ({ sources: [shared, { sourceId: 'vic-waste-facilities', name: 'Waste facilities', status: 'stale' }] }) },
    { id: 'regional-planning', getStats: () => ({ sources: [{ sourceId: 'vic-property-boundaries', name: 'Property boundaries', status: 'idle' }] }) },
  ];

  assert.deepEqual(
    collectRegionalSourceEntries(layers, new Set(['regional-melbourne', 'regional-civic'])).map((source) => source.sourceId),
    ['melbourne-places', 'vic-waste-facilities'],
  );
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
  for (const officialUrl of [
    'javascript:alert(1)',
    'http://example.com/',
    'https://attacker.example/phish',
    null,
  ]) {
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

test('source details render as semantic rows with wrap-safe names, evidence, links and errors', () => {
  const root = makeRoot();
  renderMapContext(root, {
    ...resolvedContext,
    sources: [{
      sourceId: 'vic-flood-history-2022',
      name: 'Victorian Flood History - October 2022 Event Public',
      status: 'stale',
      freshnessClass: 'historical',
      observedAt: '2022-11-01T00:00:00.000Z',
      ageMs: 121_000,
      caveat: 'Historical mapped evidence only; not a current flood warning.',
      error: 'Historical coverage is incomplete',
      officialUrl: 'https://opendata.maps.vic.gov.au/',
    }],
  });

  const list = root.elements['[data-map-context-sources]'];
  assert.equal(list.tagName, 'UL');
  assert.equal(list.children.length, 1);
  const row = list.children[0];
  assert.equal(row.tagName, 'LI');
  assert.equal(row.children[0].textContent, 'Victorian Flood History - October 2022 Event Public');
  assert.equal(row.children[1].textContent, 'HISTORICAL · STALE');
  assert.equal(row.children[2].tagName, 'TIME');
  assert.equal(row.children[2].getAttribute('datetime'), '2022-11-01T00:00:00.000Z');
  assert.match(row.children[2].getAttribute('aria-label'), /2022-11-01T00:00:00.000Z/);
  assert.equal(row.children[3].tagName, 'A');
  assert.equal(row.children[3].getAttribute('href'), 'https://opendata.maps.vic.gov.au/');
  assert.equal(row.children[4].textContent, 'Historical mapped evidence only; not a current flood warning.');
  assert.equal(row.children[5].textContent, 'Historical coverage is incomplete');
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

test('static markup and CSS preserve a semantic wrap-safe source manifest at 320px', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(html, /<ul[^>]+data-map-context-sources[^>]+aria-label="Active data sources"/);
  assert.match(css, /\.map-context-source-name\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(css, /\.map-context-source-row\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.map-context-source-row\s*\{[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(css, /\.map-context-source-link\s*\{[\s\S]*?min-height:\s*1\.5rem/);
});
