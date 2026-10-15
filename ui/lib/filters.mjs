// Filtering, facet counting and sorting for the aircraft grid.
//
// Plain functions over plain data, kept out of the components so the rules
// can be tested without a browser (test/ui-logic.test.js).

export const FACETS = [
  { key: 'category', label: 'Category', of: (a) => a.category },
  { key: 'source', label: 'Source', of: (a) => a.source },
  { key: 'engineType', label: 'Engine', of: (a) => a.engineType },
  { key: 'size', label: 'Size', of: (a) => (a.size === 'Unknown' ? null : a.size) },
  { key: 'developer', label: 'Developer', of: (a) => a.developer, limit: 14 },
];

export const SORTS = [
  { value: 'aircraft', label: 'Aircraft' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'liveries', label: 'Most liveries' },
  { value: 'category', label: 'Category' },
  { value: 'developer', label: 'Developer' },
];

/** The ticked values for one facet. `filters` maps facet key -> Set. */
export function selected(filters, facetKey) {
  return filters.get(facetKey) || new Set();
}

/** How many facet values are ticked, across every group. */
export function selectedCount(filters) {
  let total = 0;
  for (const values of filters.values()) total += values.size;
  return total;
}

/**
 * @param {object} aircraft
 * @param {{ filters: Map, search: string, hideDisabled: boolean }} view
 * @param {string} [skipFacet] leave this facet's own selection out
 */
export function matches(aircraft, view, skipFacet) {
  for (const facet of FACETS) {
    if (facet.key === skipFacet) continue;
    const chosen = selected(view.filters, facet.key);
    if (chosen.size && !chosen.has(facet.of(aircraft))) return false;
  }
  if (view.hideDisabled && !aircraft.enabled) return false;
  if (view.search && !aircraft.searchText.includes(view.search)) return false;
  return true;
}

const COLLATE = { sensitivity: 'base', numeric: true };
const byName = (a, b) => a.name.localeCompare(b.name, undefined, COLLATE);

const SORTERS = {
  // The scanner already orders the list so the same real aeroplane from
  // different developers sits together; keep that order.
  aircraft: null,
  name: byName,
  liveries: (a, b) => b.liveryCount - a.liveryCount || byName(a, b),
  category: (a, b) => a.category.localeCompare(b.category, undefined, COLLATE) || byName(a, b),
  developer: (a, b) =>
    String(a.developer || '~').localeCompare(String(b.developer || '~'), undefined, COLLATE) || byName(a, b),
};

export function visibleAircraft(aircraft, view, sort) {
  const list = aircraft.filter((a) => matches(a, view));
  const sorter = SORTERS[sort];
  return sorter ? list.sort(sorter) : list;
}

/**
 * Each facet's values with counts, for the sidebar.
 *
 * A facet counts against every filter except its own, so ticking one value
 * does not zero out its siblings. A ticked value is always listed, even at a
 * count of 0 or past the facet's limit: otherwise it becomes a filter nobody
 * can see or untick.
 */
export function facetGroups(aircraft, view) {
  const groups = [];
  for (const facet of FACETS) {
    const counts = new Map();
    for (const a of aircraft) {
      if (!matches(a, view, facet.key)) continue;
      const value = facet.of(a);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (facet.limit) entries = entries.slice(0, facet.limit);

    const chosen = selected(view.filters, facet.key);
    for (const value of chosen) {
      if (!entries.some(([shown]) => shown === value)) entries.push([value, counts.get(value) || 0]);
    }
    if (!entries.length) continue;
    groups.push({
      key: facet.key,
      label: facet.label,
      selectedCount: chosen.size,
      values: entries.map(([value, count]) => ({ value, count, selected: chosen.has(value) })),
    });
  }
  return groups;
}

/** A new filters map with one value toggled. Never mutates the input. */
export function toggleFilter(filters, facetKey, value) {
  const next = new Map(filters);
  const chosen = new Set(selected(filters, facetKey));
  if (chosen.has(value)) chosen.delete(value);
  else chosen.add(value);
  if (chosen.size) next.set(facetKey, chosen);
  else next.delete(facetKey);
  return next;
}

export function clearFacet(filters, facetKey) {
  const next = new Map(filters);
  next.delete(facetKey);
  return next;
}

/** Filters as plain arrays, for saving in settings. */
export function serialiseFilters(filters) {
  const plain = {};
  for (const [key, values] of filters) plain[key] = [...values];
  return plain;
}

export function restoreFilters(saved) {
  const filters = new Map();
  if (!saved) return filters;
  for (const [key, values] of Object.entries(saved)) {
    if (Array.isArray(values) && values.length) filters.set(key, new Set(values));
  }
  return filters;
}
