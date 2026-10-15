'use strict';

// The renderer's rules that are not about pixels: filtering, facet counts,
// sorting and the labels shown when there is no picture. These live in
// ui/lib as plain ES modules precisely so they can be tested here.
//
// Several cases pin down bugs the old renderer actually shipped.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = (file) => import(require('node:url').pathToFileURL(require('node:path').join(__dirname, '..', 'ui', 'lib', file)));

function aircraft(overrides) {
  return {
    id: overrides.name,
    name: 'Aircraft',
    category: 'Airliner',
    source: 'Community',
    engineType: 'Jet',
    size: 'Medium',
    developer: 'Studio',
    developers: ['Studio'],
    enabled: true,
    liveryCount: 0,
    sealed: false,
    packages: [{}],
    searchText: '',
    ...overrides,
    searchText: (overrides.searchText || overrides.name || '').toLowerCase(),
  };
}

const LIBRARY = [
  aircraft({ name: 'A320', developer: 'Fenix', liveryCount: 23 }),
  aircraft({ name: 'B738', developer: 'PMDG', liveryCount: 21 }),
  aircraft({ name: 'C172', category: 'Piston', engineType: 'Piston', size: 'Light', developer: 'Asobo', source: 'Streamed' }),
  aircraft({ name: 'Kodiak', category: 'Turboprop', engineType: 'Turboprop', size: 'Light', developer: 'SimWorks', enabled: false }),
];

const view = (overrides = {}) => ({ filters: new Map(), search: '', hideDisabled: false, ...overrides });

test('facet counts ignore their own selection, so siblings never zero out', async () => {
  const { facetGroups } = await load('filters.mjs');
  const groups = facetGroups(LIBRARY, view({ filters: new Map([['category', new Set(['Airliner'])]]) }));
  const category = groups.find((g) => g.key === 'category');
  const piston = category.values.find((v) => v.value === 'Piston');
  assert.equal(piston.count, 1, 'Piston must still show its count while Airliner is ticked');
});

test('a ticked value stays listed even when other filters drive it to 0', async () => {
  // The old renderer dropped it, leaving a filter nobody could see or untick.
  const { facetGroups } = await load('filters.mjs');
  const groups = facetGroups(
    LIBRARY,
    view({ filters: new Map([['developer', new Set(['PMDG'])]]), search: 'c172' }),
  );
  const pmdg = groups.find((g) => g.key === 'developer').values.find((v) => v.value === 'PMDG');
  assert.ok(pmdg, 'PMDG vanished from the Developer list');
  assert.equal(pmdg.count, 0);
  assert.equal(pmdg.selected, true);
});

test('a ticked value past the facet limit stays listed', async () => {
  const { facetGroups, FACETS } = await load('filters.mjs');
  const limit = FACETS.find((f) => f.key === 'developer').limit;
  const many = Array.from({ length: limit + 6 }, (_, i) =>
    aircraft({ name: `Plane ${i}`, developer: `Dev ${String(i).padStart(2, '0')}` }),
  );
  // The busiest developers come first, so make the last one the quietest.
  many.push(...Array.from({ length: 3 }, (_, i) => aircraft({ name: `Extra ${i}`, developer: 'Dev 00' })));
  const last = `Dev ${String(limit + 5).padStart(2, '0')}`;
  const groups = facetGroups(many, view({ filters: new Map([['developer', new Set([last])]]) }));
  const developer = groups.find((g) => g.key === 'developer');
  assert.ok(developer.values.some((v) => v.value === last), `${last} fell outside the top ${limit}`);
});

test('filters combine: AND across facets, OR within one', async () => {
  const { visibleAircraft } = await load('filters.mjs');
  const filters = new Map([
    ['category', new Set(['Airliner', 'Piston'])],
    ['size', new Set(['Light'])],
  ]);
  assert.deepEqual(
    visibleAircraft(LIBRARY, view({ filters }), 'aircraft').map((a) => a.name),
    ['C172'],
  );
});

test('hide-disabled and search both apply', async () => {
  const { visibleAircraft } = await load('filters.mjs');
  assert.ok(!visibleAircraft(LIBRARY, view({ hideDisabled: true }), 'aircraft').some((a) => a.name === 'Kodiak'));
  assert.deepEqual(visibleAircraft(LIBRARY, view({ search: 'b73' }), 'aircraft').map((a) => a.name), ['B738']);
});

test('sorts: scanner order by default, then by liveries or name', async () => {
  const { visibleAircraft } = await load('filters.mjs');
  assert.deepEqual(visibleAircraft(LIBRARY, view(), 'aircraft').map((a) => a.name), ['A320', 'B738', 'C172', 'Kodiak']);
  assert.deepEqual(visibleAircraft(LIBRARY, view(), 'liveries').map((a) => a.name).slice(0, 2), ['A320', 'B738']);
  assert.equal(visibleAircraft([...LIBRARY].reverse(), view(), 'name')[0].name, 'A320');
});

test('toggling and clearing never mutate the previous filters', async () => {
  const { toggleFilter, clearFacet, serialiseFilters, restoreFilters } = await load('filters.mjs');
  const before = new Map([['category', new Set(['Airliner'])]]);
  const after = toggleFilter(before, 'category', 'Piston');
  assert.deepEqual([...before.get('category')], ['Airliner']);
  assert.deepEqual([...after.get('category')].sort(), ['Airliner', 'Piston']);
  assert.equal(toggleFilter(new Map([['size', new Set(['Light'])]]), 'size', 'Light').has('size'), false);
  assert.equal(clearFacet(after, 'category').has('category'), false);
  assert.deepEqual(serialiseFilters(restoreFilters({ category: ['Airliner'], size: [] })), { category: ['Airliner'] });
});

test('a card with no picture says what is actually happening', async () => {
  const { placeholderLabel } = await load('format.mjs');
  const stock = aircraft({ name: 'B787', sealed: true });
  assert.equal(placeholderLabel(aircraft({ name: 'Mod' }), 'wikipedia', false), 'No thumbnail');
  assert.equal(placeholderLabel(stock, 'off', false), 'Photos are off');
  assert.equal(placeholderLabel(stock, 'wikipedia', false), 'Looking for a photo…');
  assert.equal(placeholderLabel(stock, 'wikipedia', true), 'No photo found');
});

test('the photo time estimate waits for real data, then measures', async () => {
  const { sweepEstimate } = await load('format.mjs');
  const now = 1_000_000;
  assert.equal(sweepEstimate({ done: 2, total: 100, startedAt: now - 3000 }, now), null);
  assert.equal(sweepEstimate({ done: 10, total: 136, startedAt: now - 15_000 }, now), 'about 3 min left');
  assert.equal(sweepEstimate({ done: 120, total: 124, startedAt: now - 120_000 }, now), 'under a minute left');
  assert.equal(sweepEstimate({ done: 50, total: 50, startedAt: now - 1000 }, now), null);
});

test('version label names its package only when there is more than one', async () => {
  const { versionLabel } = await load('format.mjs');
  assert.equal(versionLabel({ version: '2.4.0', versionPackage: 'Fenix A320', packages: [{}] }), '2.4.0');
  assert.equal(
    versionLabel({ version: '2.4.0', versionPackage: 'Fenix A320', packages: [{}, {}] }),
    '2.4.0  ·  Fenix A320',
  );
  assert.equal(versionLabel({ sealed: true, packages: [{}] }), 'Updates with the sim');
  assert.equal(versionLabel({ sealed: false, packages: [{}] }), null);
});
