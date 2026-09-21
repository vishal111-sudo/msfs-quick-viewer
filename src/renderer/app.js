// Renderer entry point. Talks to the main process only through `window.api`.

const api = window.api;

const el = {
  search: document.getElementById('search'),
  sort: document.getElementById('sort'),
  grid: document.getElementById('grid'),
  facets: document.getElementById('facets'),
  resultCount: document.getElementById('result-count'),
  clearFilters: document.getElementById('clear-filters'),
  empty: document.getElementById('empty'),
  rescan: document.getElementById('rescan'),
  scrim: document.getElementById('scrim'),
  detail: document.getElementById('detail'),
  detailBody: document.getElementById('detail-body'),
  detailClose: document.getElementById('detail-close'),
  settings: document.getElementById('settings'),
  settingsBody: document.getElementById('settings-body'),
  settingsClose: document.getElementById('settings-close'),
  openSettings: document.getElementById('open-settings'),
  splash: document.getElementById('splash'),
  splashText: document.getElementById('splash-text'),
  splashSub: document.getElementById('splash-sub'),
  toast: document.getElementById('toast'),
  artProgress: document.getElementById('art-progress'),
  artProgressText: document.getElementById('art-progress-text'),
  artProgressBar: document.getElementById('art-progress-bar'),
  sizeButtons: [...document.querySelectorAll('.segmented button')],
};

const state = {
  scan: null,
  settings: null,
  search: '',
  sort: 'aircraft',
  /** facet name -> Set of selected values */
  filters: new Map(),
  /** aircraft id -> art record resolved from cache or the network */
  art: new Map(),
  /** aircraft ids whose art request is already running */
  artInFlight: new Set(),
  /** Bound while the detail drawer is open, so Ctrl+V knows the target. */
  pasteThumbnail: null,
};

/**
 * Background photo lookup for everything the grid cannot fill from disk.
 *
 * Without this the lookups would only fire for cards scrolled into view, and
 * a progress bar would sit at a few percent looking broken. `token` lets a
 * rescan or a source change abandon a sweep already in flight.
 */
const sweep = { token: 0, done: 0, total: 0, running: false };

const FACETS = [
  { key: 'category', label: 'Category', of: (a) => a.category },
  { key: 'source', label: 'Source', of: (a) => a.source },
  { key: 'engineType', label: 'Engine', of: (a) => a.engineType },
  { key: 'size', label: 'Size', of: (a) => (a.size === 'Unknown' ? null : a.size) },
  { key: 'developer', label: 'Developer', of: (a) => a.developer, limit: 14 },
];

/* ---------- small helpers ---------- */

function text(value) {
  return value === undefined || value === null || value === '' ? '—' : String(value);
}

function node(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent !== undefined) element.textContent = textContent;
  return element;
}

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2600);
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/* ---------- theme ---------- */

const systemLight = window.matchMedia('(prefers-color-scheme: light)');

/**
 * Resolve the preference to an actual theme and stamp it on the root element.
 * "System" is worked out here rather than with a CSS media query so the
 * stylesheet declares each palette exactly once.
 */
function applyTheme(preference) {
  const resolved =
    preference === 'system' ? (systemLight.matches ? 'light' : 'dark') : preference || 'dark';
  document.documentElement.dataset.theme = resolved;
}

// Follow the OS live, but only while the user has asked us to.
systemLight.addEventListener('change', () => {
  if (state.settings && state.settings.theme === 'system') applyTheme('system');
});

/* ---------- filtering ---------- */

function selected(facetKey) {
  return state.filters.get(facetKey) || new Set();
}

function matchesFilters(aircraft, { skipFacet } = {}) {
  for (const facet of FACETS) {
    if (facet.key === skipFacet) continue;
    const chosen = selected(facet.key);
    if (!chosen.size) continue;
    if (!chosen.has(facet.of(aircraft))) return false;
  }
  if (state.settings && state.settings.hideDisabled && !aircraft.enabled) return false;
  if (state.search && !aircraft.searchText.includes(state.search)) return false;
  return true;
}

function visibleAircraft() {
  const list = (state.scan ? state.scan.aircraft : []).filter((a) => matchesFilters(a));
  const collate = { sensitivity: 'base', numeric: true };
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, collate);
  // "Aircraft" groups the same real aeroplane from different developers
  // together; the scanner already ordered the list that way.
  const sorters = {
    aircraft: null,
    name: byName,
    liveries: (a, b) => b.liveryCount - a.liveryCount || byName(a, b),
    category: (a, b) => a.category.localeCompare(b.category, undefined, collate) || byName(a, b),
    developer: (a, b) =>
      String(a.developer || '~').localeCompare(String(b.developer || '~'), undefined, collate) || byName(a, b),
  };

  const sorter = sorters[state.sort];
  return sorter ? list.sort(sorter) : list;
}

/* ---------- sidebar facets ---------- */

function renderFacets() {
  el.facets.replaceChildren();
  if (!state.scan) return;

  for (const facet of FACETS) {
    // Count against everything except this facet's own selection, so picking
    // one value does not zero out its siblings.
    const counts = new Map();
    for (const aircraft of state.scan.aircraft) {
      if (!matchesFilters(aircraft, { skipFacet: facet.key })) continue;
      const value = facet.of(aircraft);
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (facet.limit) entries = entries.slice(0, facet.limit);
    if (!entries.length) continue;

    const group = node('div', 'facet');
    group.append(node('h3', null, facet.label));

    for (const [value, count] of entries) {
      const button = node('button', 'facet-option');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(selected(facet.key).has(value)));
      button.append(node('span', 'label', value), node('span', 'count', String(count)));
      button.addEventListener('click', () => toggleFilter(facet.key, value));
      group.append(button);
    }
    el.facets.append(group);
  }
}

function toggleFilter(facetKey, value) {
  const chosen = new Set(selected(facetKey));
  if (chosen.has(value)) chosen.delete(value);
  else chosen.add(value);

  if (chosen.size) state.filters.set(facetKey, chosen);
  else state.filters.delete(facetKey);

  render();
  persistFilters();
}

function clearFilters() {
  state.filters.clear();
  state.search = '';
  el.search.value = '';
  render();
  persistFilters();
}

function persistFilters() {
  const plain = {};
  for (const [key, values] of state.filters) plain[key] = [...values];
  api.setSettings({ lastFilters: plain }).catch(() => {});
}

function restoreFilters(saved) {
  if (!saved) return;
  for (const [key, values] of Object.entries(saved)) {
    if (Array.isArray(values) && values.length) state.filters.set(key, new Set(values));
  }
}

/* ---------- cards ---------- */

function artPlaceholder(aircraft) {
  const wrap = node('div', 'placeholder');
  wrap.append(node('span', 'glyph'));
  wrap.append(node('div', null, aircraft.sealed ? 'Looking for a photo…' : 'No thumbnail'));
  return wrap;
}

function buildCard(aircraft) {
  // A real <button> is the wrong element here: Chromium's UA stylesheet forces
  // `align-items: center` on button content, which stops the artwork box from
  // stretching to the card width and collapses it to nothing.
  const card = node('div', 'card');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.dataset.id = aircraft.id;

  const art = node('div', 'card-art');
  const cachedArt = state.art.get(aircraft.id);
  const artUrl = aircraft.thumbnailUrl || (cachedArt && cachedArt.url);
  if (artUrl) {
    const img = node('img');
    img.src = artUrl;
    img.alt = '';
    img.loading = 'lazy';
    art.append(img);
  } else {
    art.append(artPlaceholder(aircraft));
    // Only aircraft with nothing cached need a lookup when scrolled into view;
    // one already running will repaint this card itself once it resolves.
    if (!state.art.has(aircraft.id)) card.dataset.needsArt = '1';
    else art.querySelector('.placeholder div').textContent = 'No photo found';
  }

  // Counts read as numerals; words only where a number alone is ambiguous.
  const badges = node('div', 'card-badges');
  if (aircraft.variantCount > 1) badges.append(node('span', 'badge', `${aircraft.variantCount} var`));
  if (aircraft.liveryCount) badges.append(node('span', 'badge', `${aircraft.liveryCount} liv`));
  if (!aircraft.enabled) badges.append(node('span', 'badge quiet', 'disabled'));
  if (badges.childElementCount) art.append(badges);

  const body = node('div', 'card-body');
  body.append(node('div', 'card-title', aircraft.name));

  // Who made it. Extra developers (a livery pack by someone else) are counted
  // rather than listed, so the line stays one row tall on every card.
  const extras = aircraft.developers.length - 1;
  if (aircraft.developer) {
    const developer = node('div', 'card-dev', aircraft.developer);
    if (extras > 0) {
      developer.append(node('span', 'card-dev-more', ` +${extras}`));
      developer.title = aircraft.developers.join(', ');
    }
    body.append(developer);
  }

  const meta = node('div', 'card-meta');
  meta.append(node('span', null, aircraft.category));
  if (aircraft.icaoType) meta.append(node('span', 'mono', aircraft.icaoType));
  else if (aircraft.variant) meta.append(node('span', null, aircraft.variant));
  else if (aircraft.engineLabel && aircraft.engineLabel !== 'Unknown') meta.append(node('span', null, aircraft.engineLabel));
  body.append(meta);

  card.append(art, body);
  card.addEventListener('click', () => openDetail(aircraft.id));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail(aircraft.id);
    }
  });
  return card;
}

/* ---------- lazy artwork ---------- */

const artObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      artObserver.unobserve(entry.target);
      requestArt(entry.target.dataset.id);
    }
  },
  { rootMargin: '300px' },
);

/**
 * Update whichever card currently represents this aircraft.
 *
 * Deliberately looked up by id rather than held as a reference: a lookup takes
 * seconds, and any re-render in the meantime (a search keystroke, a filter, a
 * theme change) replaces every card element. Painting into the captured card
 * would update a detached node and leave the visible one saying "Looking for a
 * photo" forever.
 */
function showArtOnCard(aircraftId, art) {
  const card = el.grid.querySelector(`.card[data-id="${CSS.escape(aircraftId)}"]`);
  if (!card) return;

  if (art) {
    paintArt(card, art);
    return;
  }
  const placeholder = card.querySelector('.placeholder div');
  if (placeholder) placeholder.textContent = 'No photo found';
}

async function requestArt(aircraftId) {
  if (!aircraftId) return;

  const known = state.art.get(aircraftId);
  if (known !== undefined) {
    showArtOnCard(aircraftId, known);
    return;
  }
  // Already running: it will repaint the current card when it resolves.
  if (state.artInFlight.has(aircraftId)) return;

  state.artInFlight.add(aircraftId);
  try {
    const art = await api.getArt(aircraftId);
    state.art.set(aircraftId, art || null);
    showArtOnCard(aircraftId, art || null);
  } catch {
    state.art.set(aircraftId, null);
    showArtOnCard(aircraftId, null);
  } finally {
    state.artInFlight.delete(aircraftId);
  }
}

function paintArt(card, art) {
  if (!card || !card.isConnected) return;
  const holder = card.querySelector('.card-art');
  if (!holder || holder.querySelector('img')) return;

  const img = node('img');
  img.src = art.url;
  img.alt = '';
  holder.prepend(img);
  const placeholder = holder.querySelector('.placeholder');
  if (placeholder) placeholder.remove();
}

/* ---------- background photo sweep ---------- */

function renderArtProgress() {
  const showing = sweep.running && sweep.total > 0;
  el.artProgress.hidden = !showing;
  if (!showing) return;

  const percent = Math.round((sweep.done / sweep.total) * 100);
  el.artProgressText.textContent = `Finding photos ${sweep.done} / ${sweep.total}`;
  el.artProgressBar.style.width = `${percent}%`;
}

/** Everything with no artwork on disk and nothing resolved yet. */
function aircraftNeedingArt() {
  if (!state.scan) return [];
  return state.scan.aircraft.filter((a) => !a.thumbnailUrl && !state.art.has(a.id));
}

async function startArtSweep() {
  sweep.token += 1;
  const token = sweep.token;

  if (!state.settings || state.settings.artSource === 'off') {
    sweep.running = false;
    renderArtProgress();
    return;
  }

  const pending = aircraftNeedingArt();
  sweep.total = pending.length;
  sweep.done = 0;
  sweep.running = pending.length > 0;
  renderArtProgress();
  if (!sweep.running) return;

  for (const aircraft of pending) {
    // A rescan or a source change started a newer sweep; abandon this one.
    if (token !== sweep.token) return;

    // Awaiting one at a time leaves room for a card scrolled into view to be
    // served in between, so browsing stays responsive while this runs.
    if (!state.art.has(aircraft.id)) await requestArt(aircraft.id);

    sweep.done += 1;
    renderArtProgress();
  }

  sweep.running = false;
  renderArtProgress();
  const found = pending.filter((a) => state.art.get(a.id)).length;
  if (found) toast(`Found ${found} photo${found === 1 ? '' : 's'}`);
}

/* ---------- empty states ---------- */

/**
 * Three different nothings, which need three different answers: the filters
 * exclude everything, the sim was found but holds no aircraft, or no sim was
 * found at all. The last one is the first-run failure case, and it has to
 * offer a way forward rather than a shrug.
 */
async function renderEmptyState(visibleCount) {
  el.empty.replaceChildren();
  const installs = state.scan ? state.scan.installs : [];
  const total = state.scan ? state.scan.aircraft.length : 0;

  el.empty.hidden = visibleCount > 0;
  if (visibleCount > 0) return;

  if (total > 0) {
    el.empty.append(node('p', null, 'No aircraft match these filters.'));
    const clear = node('button', 'button', 'Clear filters');
    clear.type = 'button';
    clear.addEventListener('click', clearFilters);
    el.empty.append(clear);
    return;
  }

  if (installs.length) {
    el.empty.append(node('p', null, 'That install has no aircraft packages in it.'));
    el.empty.append(node('p', 'empty-note', installs.map((i) => i.packagesRoot).join('  ·  ')));
    return;
  }

  // Nothing detected at all.
  el.empty.append(node('h2', 'empty-title', 'No Flight Simulator install found'));
  el.empty.append(
    node(
      'p',
      null,
      'Both the Steam and Microsoft Store editions are checked automatically, ' +
        'for MSFS 2024 and 2020. Point the app at your Community folder and it will take it from there.',
    ),
  );

  const choose = node('button', 'button', 'Choose your Community folder…');
  choose.type = 'button';
  choose.addEventListener('click', async () => {
    const result = await api.addRoot();
    if (result.added) {
      await rescan();
    } else if (result.reason === 'not-a-packages-root') {
      toast('That folder has no Community or StreamedPackages inside it');
    }
  });
  el.empty.append(choose);

  const candidates = await api.rootCandidates().catch(() => []);
  if (candidates.length) {
    const details = node('details', 'empty-detail');
    details.append(node('summary', null, 'Where it looked'));
    const list = node('ul', 'empty-paths');
    for (const candidate of candidates) {
      list.append(node('li', 'mono', `${candidate.sim} · ${candidate.store} — ${candidate.dir}`));
    }
    details.append(list);
    details.append(
      node(
        'p',
        'empty-note',
        "Each of those holds a UserCfg.opt naming where packages actually live, so a Community folder moved to another drive is still found.",
      ),
    );
    el.empty.append(details);
  }
}

function render() {
  const list = visibleAircraft();

  el.grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const aircraft of list) fragment.append(buildCard(aircraft));
  el.grid.append(fragment);

  for (const card of el.grid.querySelectorAll('.card[data-needs-art]')) artObserver.observe(card);

  const total = state.scan ? state.scan.aircraft.length : 0;
  const liveries = list.reduce((sum, a) => sum + a.liveryCount, 0);
  el.resultCount.replaceChildren();
  const shown = list.length === total ? String(total) : `${list.length} / ${total}`;
  el.resultCount.append(node('strong', null, shown), document.createTextNode(' aircraft'));
  el.resultCount.append(document.createTextNode('  ·  '));
  el.resultCount.append(node('strong', null, String(liveries)), document.createTextNode(' liveries'));

  renderEmptyState(list.length);
  el.clearFilters.hidden = !state.filters.size && !state.search;
  renderFacets();
}

/* ---------- detail drawer ---------- */

function openDrawer(drawer) {
  el.scrim.hidden = false;
  drawer.hidden = false;
}

function closeDrawers() {
  state.pasteThumbnail = null;
  el.scrim.hidden = true;
  el.detail.hidden = true;
  el.settings.hidden = true;
}

function detailRow(list, label, value) {
  list.append(node('dt', null, label), node('dd', null, text(value)));
}

async function openDetail(aircraftId) {
  const aircraft = state.scan.aircraft.find((a) => a.id === aircraftId);
  if (!aircraft) return;

  el.detailBody.replaceChildren();

  const hero = node('div', 'detail-hero');
  const art = state.art.get(aircraftId);
  const heroSrc = aircraft.thumbnailUrl || (art && art.url);
  if (heroSrc) {
    const img = node('img');
    img.src = heroSrc;
    img.alt = '';
    hero.append(img);
  }
  el.detailBody.append(hero);

  if (art && art.origin === 'online') {
    const credit = node('p', 'art-credit');
    // CC BY-SA requires the photographer to be named wherever the photo shows.
    const parts = [art.attribution, art.license].filter(Boolean).join(' · ');
    credit.append(document.createTextNode(parts ? `Photo: ${parts} · ` : 'Photo: '));

    const link = node('button', 'link', art.pageTitle || 'source');
    link.type = 'button';
    link.addEventListener('click', () => api.openExternal(art.pageUrl || art.filePageUrl));
    credit.append(link);
    el.detailBody.append(credit);
  }

  const main = node('div', 'detail-main');
  main.append(node('h2', null, aircraft.name));
  main.append(node('p', 'detail-sub', [aircraft.developer, aircraft.sim].filter(Boolean).join(' · ')));

  const chips = node('div', 'chips');
  const chipValues = [
    aircraft.category,
    aircraft.variant,
    aircraft.engineLabel !== 'Unknown' ? aircraft.engineLabel : null,
    aircraft.size !== 'Unknown' ? aircraft.size : null,
    aircraft.icaoType,
    aircraft.source,
    aircraft.enabled ? null : 'Disabled in sim',
  ].filter(Boolean);
  for (const value of chipValues) {
    const isCode = value === aircraft.icaoType;
    chips.append(node('span', isCode ? 'chip code' : 'chip', value));
  }
  main.append(chips);
  el.detailBody.append(main);

  const actions = node('div', 'detail-actions');

  async function pasteThumbnail() {
    const pasted = await api.pasteArtOverride(aircraftId).catch(() => null);
    if (!pasted) {
      toast('No image on the clipboard');
      return;
    }
    state.art.set(aircraftId, pasted);
    toast('Thumbnail set from clipboard');
    render();
    openDetail(aircraftId);
  }
  state.pasteThumbnail = pasteThumbnail;

  const setArt = node('button', 'button', 'Set thumbnail…');
  setArt.type = 'button';
  setArt.addEventListener('click', async () => {
    const result = await api.setArtOverride(aircraftId);
    if (!result) return;
    state.art.set(aircraftId, result);
    toast('Thumbnail updated');
    render();
    openDetail(aircraftId);
  });
  actions.append(setArt);

  const pasteArt = node('button', 'button', 'Paste image');
  pasteArt.type = 'button';
  pasteArt.title = 'Copy any picture, then paste it here (Ctrl+V)';
  pasteArt.addEventListener('click', pasteThumbnail);
  actions.append(pasteArt);

  if (!aircraft.thumbnailUrl) {
    const refetch = node('button', 'button ghost', 'Find a different photo');
    refetch.type = 'button';
    refetch.addEventListener('click', async () => {
      refetch.disabled = true;
      refetch.textContent = 'Searching…';
      const found = await api.getArt(aircraftId, { force: true }).catch(() => null);
      if (found) {
        state.art.set(aircraftId, found);
        toast(`Photo from ${found.pageTitle || 'Wikipedia'}`);
      } else {
        state.art.set(aircraftId, null);
        toast('No other photo found');
      }
      render();
      openDetail(aircraftId);
    });
    actions.append(refetch);
  }

  if (art && art.origin === 'override') {
    const reset = node('button', 'button ghost', 'Remove custom thumbnail');
    reset.type = 'button';
    reset.addEventListener('click', async () => {
      await api.clearArtOverride(aircraftId);
      state.art.delete(aircraftId);
      toast('Custom thumbnail removed');
      render();
      openDetail(aircraftId);
    });
    actions.append(reset);
  }
  el.detailBody.append(actions);

  const details = node('section', 'section');
  details.append(node('h3', null, 'Details'));
  const list = node('dl', 'kv');
  detailRow(list, 'Manufacturer', aircraft.manufacturer);
  detailRow(list, 'Model', aircraft.model);
  detailRow(list, 'Variant', aircraft.variant);
  detailRow(list, 'ICAO type', aircraft.icaoType);
  detailRow(list, 'Type role', aircraft.typeRole);
  detailRow(list, 'Engines', aircraft.engineCount ? `${aircraft.engineCount} × ${aircraft.engineType}` : aircraft.engineType);
  detailRow(list, 'Wake category', aircraft.size);
  detailRow(list, 'Developers', aircraft.developers.join(', '));
  details.append(list);
  el.detailBody.append(details);

  const packages = node('section', 'section');
  packages.append(node('h3', null, `Packages (${aircraft.packages.length})`));
  for (const pkg of aircraft.packages) {
    const row = node('div', 'package');
    const head = node('div', 'package-head');
    head.append(node('strong', null, pkg.folderName));
    head.append(node('span', 'chip', pkg.sourceLabel || pkg.source));
    if (pkg.version) head.append(node('span', 'chip code', `v${pkg.version}`));
    if (pkg.enabled === 'disabled') head.append(node('span', 'chip', 'disabled'));
    row.append(head);

    if (pkg.sealed) {
      row.append(node('div', 'package-path', 'Streamed package — contents are encrypted by the sim'));
    } else {
      row.append(node('div', 'package-path', pkg.dir));
      const open = node('button', 'link', 'Open folder');
      open.type = 'button';
      open.addEventListener('click', async () => {
        const ok = await api.openPath(pkg.dir);
        if (!ok) toast('Could not open that folder');
      });
      row.append(open);
    }
    packages.append(row);
  }
  el.detailBody.append(packages);

  if (aircraft.variantNames && aircraft.variantNames.length > 1) {
    const variants = node('section', 'section');
    variants.append(node('h3', null, `Variants (${aircraft.variantNames.length})`));
    const chipRow = node('div', 'chips');
    for (const name of aircraft.variantNames) chipRow.append(node('span', 'chip', name));
    variants.append(chipRow);
    el.detailBody.append(variants);
  }

  if (aircraft.liveries.length) {
    const liveries = node('section', 'section');
    liveries.append(node('h3', null, `Liveries (${aircraft.liveries.length})`));
    const grid = node('div', 'livery-grid');
    for (const livery of aircraft.liveries) {
      const item = node('div', 'livery');
      const artBox = node('div', 'livery-art');
      if (livery.thumbnailUrl) {
        const img = node('img');
        img.src = livery.thumbnailUrl;
        img.alt = '';
        img.loading = 'lazy';
        artBox.append(img);
      } else {
        artBox.append(node('div', 'placeholder', livery.sealed ? 'encrypted' : 'no art'));
      }
      item.append(artBox, node('div', 'livery-name', livery.name));
      grid.append(item);
    }
    liveries.append(grid);
    el.detailBody.append(liveries);
  }

  openDrawer(el.detail);

  // The card may not have been scrolled into view yet, so make sure the hero
  // image gets filled in for sealed aircraft.
  if (!heroSrc) {
    const fetched = await api.getArt(aircraftId).catch(() => null);
    if (fetched) {
      state.art.set(aircraftId, fetched);
      if (!el.detail.hidden) openDetail(aircraftId);
      render();
    }
  }
}

/* ---------- settings drawer ---------- */

async function openSettings() {
  el.settingsBody.replaceChildren();

  const head = node('div', 'detail-main');
  head.append(node('h2', null, 'Settings'));
  head.append(node('p', 'detail-sub', 'Stored locally in your user profile.'));
  el.settingsBody.append(head);

  const general = node('section', 'section');

  const themeSetting = node('div', 'setting');
  const themeText = node('span', 'setting-text');
  themeText.append(node('strong', null, 'Theme'));

  const themeSelect = document.createElement('select');
  for (const [value, label] of [
    ['dark', 'Dark'],
    ['light', 'Light'],
    ['system', 'Match Windows'],
  ]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    themeSelect.append(option);
  }
  themeSelect.value = state.settings.theme || 'dark';
  themeSelect.addEventListener('change', async () => {
    applyTheme(themeSelect.value);
    state.settings = await api.setSettings({ theme: themeSelect.value });
  });

  themeText.append(themeSelect);
  themeSetting.append(themeText);
  general.append(themeSetting);

  const { sources, current } = await api.artSources();

  const artSetting = node('div', 'setting');
  const artText = node('span', 'setting-text');
  artText.append(node('strong', null, 'Photos for aircraft with no thumbnail'));
  artText.append(
    node(
      'span',
      null,
      'Aircraft that only exist as encrypted streamed packages have no thumbnail on disk. ' +
        "An add-on's own artwork is always used first — this only fills the gaps, and is cached locally.",
    ),
  );

  const sourceSelect = document.createElement('select');
  for (const source of sources) {
    const option = document.createElement('option');
    option.value = source.id;
    option.textContent = source.label;
    sourceSelect.append(option);
  }
  const offOption = document.createElement('option');
  offOption.value = 'off';
  offOption.textContent = 'Off — never use the network';
  sourceSelect.append(offOption);
  sourceSelect.value = current;

  const sourceNote = node('span', 'setting-note');
  const describe = (id) => {
    const found = sources.find((source) => source.id === id);
    sourceNote.textContent = found ? found.note : 'The app makes no network requests at all.';
  };
  describe(current);

  sourceSelect.addEventListener('change', async () => {
    state.settings = await api.setSettings({ artSource: sourceSelect.value });
    describe(sourceSelect.value);
    // Each source caches separately, so switching back is instant.
    state.art.clear();
    for (const aircraft of state.scan.aircraft) if (aircraft.art) state.art.set(aircraft.id, aircraft.art);
    render();
    startArtSweep();
    toast(sourceSelect.value === 'off' ? 'Online photos off' : 'Photo source changed');
  });

  artText.append(sourceSelect, sourceNote);
  artSetting.append(artText);
  general.append(artSetting);

  const hideDisabled = node('label', 'setting');
  const hideDisabledInput = document.createElement('input');
  hideDisabledInput.type = 'checkbox';
  hideDisabledInput.checked = Boolean(state.settings.hideDisabled);
  hideDisabledInput.addEventListener('change', async () => {
    state.settings = await api.setSettings({ hideDisabled: hideDisabledInput.checked });
    render();
  });
  const hideDisabledText = node('span', 'setting-text');
  hideDisabledText.append(node('strong', null, 'Hide aircraft disabled in the sim'));
  hideDisabledText.append(node('span', null, 'Uses the state recorded in the sim’s Content.xml.'));
  hideDisabled.append(hideDisabledInput, hideDisabledText);
  general.append(hideDisabled);

  el.settingsBody.append(general);

  const roots = node('section', 'section');
  roots.append(node('h3', null, 'Packages folders'));
  for (const install of state.scan ? state.scan.installs : []) {
    const row = node('div', 'root-row');
    row.append(node('code', null, install.packagesRoot));
    if (install.store !== 'Manual') {
      const sim = install.sim === 'MSFS2024' ? 'MSFS 2024' : install.sim === 'MSFS2020' ? 'MSFS 2020' : install.sim;
      row.append(node('span', 'chip', `${sim} · ${install.store}`));
    }
    row.append(node('span', 'chip', install.store === 'Manual' ? 'added' : 'detected'));
    if (install.store === 'Manual') {
      const remove = node('button', 'link', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        await api.removeRoot(install.packagesRoot);
        await rescan();
        openSettings();
      });
      row.append(remove);
    }
    roots.append(row);
  }

  const addRoot = node('button', 'button', 'Add a packages folder…');
  addRoot.type = 'button';
  addRoot.style.marginTop = '10px';
  addRoot.addEventListener('click', async () => {
    const result = await api.addRoot();
    if (result.added) {
      await rescan();
      openSettings();
    } else if (result.reason === 'not-a-packages-root') {
      toast('That folder has no Community or StreamedPackages inside it');
    }
  });
  roots.append(addRoot);
  el.settingsBody.append(roots);

  // The app guesses in a few places — naming, categorising, matching stock
  // aircraft. Show where, so a library it was never tested against reports
  // its own gaps rather than quietly mislabelling things.
  const diag = state.scan && state.scan.diagnostics;
  if (diag) {
    const section = node('section', 'section');
    section.append(node('h3', null, 'Scan diagnostics'));

    const list = node('dl', 'kv');
    detailRow(list, 'Developer tags learned', diag.vendorTokensLearned);
    detailRow(
      list,
      'Stock aircraft not in catalog',
      diag.unknownStockAircraft.length
        ? `${diag.unknownStockAircraft.length} — named from their folder`
        : 'none',
    );
    detailRow(
      list,
      'Uncategorised',
      diag.uncategorised.length ? `${diag.uncategorised.length} listed under "Other"` : 'none',
    );
    section.append(list);

    for (const [label, items] of [
      ['Not in catalog', diag.unknownStockAircraft],
      ['Uncategorised', diag.uncategorised],
    ]) {
      if (!items.length) continue;
      const chips = node('div', 'chips');
      chips.style.marginTop = '8px';
      for (const item of items.slice(0, 24)) chips.append(node('span', 'chip', item));
      if (items.length > 24) chips.append(node('span', 'chip', `+${items.length - 24} more`));
      section.append(node('p', 'setting-note', label), chips);
    }
    el.settingsBody.append(section);
  }

  const cache = node('section', 'section');
  cache.append(node('h3', null, 'Artwork cache'));
  const info = await api.artCacheInfo();
  cache.append(
    node('p', 'package-path', `${plural(info.files, 'image', 'images')} · ${(info.bytes / 1024 / 1024).toFixed(1)} MB`),
  );
  const clear = node('button', 'button', 'Clear cached artwork');
  clear.type = 'button';
  clear.addEventListener('click', async () => {
    await api.clearArtCache();
    state.art.clear();
    toast('Artwork cache cleared');
    render();
    openSettings();
  });
  cache.append(clear);
  el.settingsBody.append(cache);

  openDrawer(el.settings);
}

/* ---------- scanning ---------- */

async function rescan() {
  el.splash.hidden = false;
  el.splashText.textContent = 'Scanning your MSFS packages…';
  el.splashSub.textContent = '';
  state.art.clear();

  try {
    state.scan = await api.scan();
    // The main process already resolved everything in the artwork cache, so
    // relaunches paint immediately instead of re-asking card by card.
    for (const aircraft of state.scan.aircraft) {
      if (aircraft.art) state.art.set(aircraft.id, aircraft.art);
    }
    render();
    const { stats } = state.scan;
    if (stats.aircraft > 0) {
      toast(`Found ${plural(stats.aircraft, 'aircraft', 'aircraft')} in ${(state.scan.durationMs / 1000).toFixed(1)}s`);
    }
    startArtSweep();
  } catch (err) {
    el.resultCount.textContent = 'Scan failed';
    toast(`Scan failed: ${err.message}`);
  } finally {
    el.splash.hidden = true;
  }
}

/* ---------- wiring ---------- */

function setCardSize(size) {
  el.grid.dataset.size = size;
  for (const button of el.sizeButtons) button.setAttribute('aria-pressed', String(button.dataset.size === size));
  api.setSettings({ cardSize: size }).catch(() => {});
}

let searchTimer = null;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = el.search.value.trim().toLowerCase();
    render();
  }, 130);
});

el.sort.addEventListener('change', () => {
  state.sort = el.sort.value;
  render();
});

for (const button of el.sizeButtons) {
  button.addEventListener('click', () => setCardSize(button.dataset.size));
}

el.rescan.addEventListener('click', rescan);
el.clearFilters.addEventListener('click', clearFilters);
el.openSettings.addEventListener('click', openSettings);
el.detailClose.addEventListener('click', closeDrawers);
el.settingsClose.addEventListener('click', closeDrawers);
el.scrim.addEventListener('click', closeDrawers);

document.addEventListener('paste', () => {
  // The clipboard is read in the main process; this just triggers it.
  if (!el.detail.hidden && state.pasteThumbnail) state.pasteThumbnail();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawers();
  if (event.key === '/' && document.activeElement !== el.search) {
    event.preventDefault();
    el.search.focus();
    el.search.select();
  }
});

api.onScanProgress(({ done, total }) => {
  el.splashSub.textContent = `${done} / ${total} packages`;
});

(async function start() {
  state.settings = await api.getSettings();
  applyTheme(state.settings.theme);
  setCardSize(state.settings.cardSize || 'medium');
  restoreFilters(state.settings.lastFilters);
  await rescan();
})();
