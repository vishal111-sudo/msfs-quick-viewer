'use strict';

// Scenery: reading airports out of BGL files, classifying packages, and
// finding overlaps. The BGLs are built here byte by byte, because real ones
// are developers' copyrighted files. Each case mirrors a real package.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readBgl, decodeIdent } = require('../src/main/parsers/bgl');
const {
  scanSceneryPackage,
  parseStockAirport,
  findConflicts,
  finishPackage,
  unifyDevelopers,
  identsInFolderName,
} = require('../src/main/scenery');

const load = (file) =>
  import(require('node:url').pathToFileURL(path.join(__dirname, '..', 'ui', 'lib', file)));

const MAGIC = 0x19920201;
const HEADER = 0x38;
const SPEC = { source: 'Community', label: 'Community' };

function encodeIdent(ident) {
  let value = 0;
  for (const char of ident) {
    const code = char >= 'A' ? char.charCodeAt(0) - 65 + 12 : char.charCodeAt(0) - 48 + 2;
    value = value * 38 + code;
  }
  return value * 32;
}

/** A BGL holding the given airports, plus any extra (empty) section types. */
function buildBgl(airports, { extraSections = [], recordType = 0x56 } = {}) {
  const sectionCount = (airports.length ? 1 : 0) + extraSections.length;
  const records = Buffer.alloc(airports.length * 0x30);
  airports.forEach((airport, index) => {
    const at = index * 0x30;
    records.writeUInt16LE(recordType, at);
    records.writeUInt32LE(0x30, at + 2);
    records.writeUInt32LE(Math.round(((airport.lon + 180) * 3 * 0x10000000) / 360), at + 0x0c);
    records.writeUInt32LE(Math.round(((90 - airport.lat) * 2 * 0x10000000) / 180), at + 0x10);
    if (airport.ident && recordType === 0x56) records.writeUInt32LE(encodeIdent(airport.ident), at + 0x28);
  });

  const header = Buffer.alloc(HEADER);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(HEADER, 4);
  header.writeUInt32LE(sectionCount, 0x14);

  const table = Buffer.alloc(sectionCount * 20);
  const subsectionAt = HEADER + table.length;
  const recordsAt = subsectionAt + 16;
  let row = 0;
  if (airports.length) {
    table.writeUInt32LE(0x03, 0);
    table.writeUInt32LE(0, 4);
    table.writeUInt32LE(1, 8);
    table.writeUInt32LE(subsectionAt, 12);
    row = 1;
  }
  for (const type of extraSections) {
    table.writeUInt32LE(type, row * 20);
    row += 1;
  }

  const subsection = Buffer.alloc(16);
  subsection.writeUInt32LE(airports.length, 4);
  subsection.writeUInt32LE(recordsAt, 8);
  subsection.writeUInt32LE(records.length, 12);
  return Buffer.concat([header, table, subsection, records]);
}

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msfsqv-scenery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A package folder. `bgls` maps relative path to file contents. */
function makePackage(root, folderName, { manifest = {}, bgls = {} } = {}) {
  const dir = path.join(root, folderName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ content_type: 'SCENERY', title: folderName, creator: 'Studio', ...manifest }),
  );
  fs.writeFileSync(path.join(dir, 'layout.json'), JSON.stringify({ content: Object.keys(bgls).map((p) => ({ path: p })) }));
  for (const [file, contents] of Object.entries(bgls)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), contents);
  }
  return dir;
}

const scan = (root, folderName) => scanSceneryPackage(path.join(root, folderName), folderName, SPEC);

test('idents decode from the base-38 form', () => {
  assert.equal(decodeIdent(encodeIdent('KPWM')), 'KPWM');
  assert.equal(decodeIdent(encodeIdent('1C5')), '1C5');
  assert.equal(decodeIdent(0), null);
});

test('reads ident and location from a classic airport record', async (t) => {
  const root = tempRoot(t);
  const file = path.join(root, 'a.bgl');
  fs.writeFileSync(file, buildBgl([{ ident: 'LPMA', lat: 32.6942, lon: -16.7781 }]));
  const { valid, airports, sections } = await readBgl(file);
  assert.equal(valid, true);
  assert.deepEqual(sections, [3]);
  assert.equal(airports[0].ident, 'LPMA');
  assert.ok(Math.abs(airports[0].lat - 32.6942) < 0.001);
  assert.ok(Math.abs(airports[0].lon + 16.7781) < 0.001);
});

test('the newer record type gives a location and no ident', async (t) => {
  const root = tempRoot(t);
  const file = path.join(root, 'a.bgl');
  fs.writeFileSync(file, buildBgl([{ lat: 51.472, lon: -0.455 }], { recordType: 0x113 }));
  const { airports } = await readBgl(file);
  assert.equal(airports[0].ident, null);
  assert.ok(Math.abs(airports[0].lat - 51.472) < 0.001);
});

test('malformed files are ignored, never fatal', async (t) => {
  const root = tempRoot(t);
  const cases = {
    'empty.bgl': Buffer.alloc(0),
    'notbgl.bgl': Buffer.from('this is not a bgl file at all, just some text padding it out past the header'),
    'truncated.bgl': buildBgl([{ ident: 'KJFK', lat: 40, lon: -73 }]).subarray(0, 70),
  };
  for (const [name, contents] of Object.entries(cases)) {
    const file = path.join(root, name);
    fs.writeFileSync(file, contents);
    assert.deepEqual((await readBgl(file)).airports, [], name);
  }
  assert.deepEqual((await readBgl(path.join(root, 'missing.bgl'))).airports, []);

  // A section claiming far more data than exists must stop, not loop.
  const hostile = buildBgl([{ ident: 'KJFK', lat: 40, lon: -73 }]);
  hostile.writeUInt32LE(0xffffffff, 0x14);
  const file = path.join(root, 'hostile.bgl');
  fs.writeFileSync(file, hostile);
  await readBgl(file);
});

test('codes are read from a folder name only when they look like codes', () => {
  assert.deepEqual(identsInFolderName('orbx-airport-kdet-detroit'), ['KDET']);
  assert.deepEqual(identsInFolderName('aerosoft-airports-vnkl-vnpl-phaplu'), ['VNKL', 'VNPL']);
  assert.deepEqual(identsInFolderName('creativemesh-airport-3u2-johnson-creek'), ['3U2']);
  // A region, not an airport: three letters with no digit.
  assert.deepEqual(identsInFolderName('orbx-airports-png-highlands-pack4'), []);
  assert.deepEqual(identsInFolderName('orbx-landmarks-mumbai-city-pack'), []);
});

test('an airport with no stored ident gets one from its file or folder, marked inferred', async (t) => {
  const root = tempRoot(t);
  const place = [{ lat: 42.409, lon: -83.009 }];
  makePackage(root, 'orbx-airport-kdet-detroit', {
    bgls: { 'scenery/kdet.bgl': buildBgl(place, { recordType: 0x113, extraSections: [0x25] }) },
  });
  const pkg = await scan(root, 'orbx-airport-kdet-detroit');
  assert.equal(pkg.airports[0].ident, 'KDET');
  assert.equal(pkg.airports[0].identSource, 'inferred');
});

test('a stored ident is marked read, and never overridden by the folder name', async (t) => {
  const root = tempRoot(t);
  makePackage(root, 'bolingbrook-airport', {
    bgls: { 'scenery/ClowScenery.bgl': buildBgl([{ ident: '1C5', lat: 41.696, lon: -88.129 }], { extraSections: [0x25] }) },
  });
  const pkg = await scan(root, 'bolingbrook-airport');
  assert.equal(pkg.airports[0].ident, '1C5');
  assert.equal(pkg.airports[0].identSource, 'read');
});

test('an unidentifiable airport stays nameless rather than guessed', async (t) => {
  const root = tempRoot(t);
  makePackage(root, 'orbx-airports-png-highlands-pack4', {
    bgls: {
      'scenery/a.bgl': buildBgl([{ lat: -7.021, lon: 145.822 }, { lat: -6.842, lon: 145.872 }], { recordType: 0x113 }),
    },
  });
  const pkg = await scan(root, 'orbx-airports-png-highlands-pack4');
  assert.equal(pkg.kind, 'airport');
  assert.deepEqual(pkg.airports.map((airport) => airport.ident), [null, null]);
});

test('the same airport in several files counts once', async (t) => {
  const root = tempRoot(t);
  const place = { ident: 'EDDF', lat: 50.033, lon: 8.57 };
  makePackage(root, 'aerosoft-airport-eddf-frankfurt', {
    bgls: { 'a.bgl': buildBgl([place]), 'b.bgl': buildBgl([place]), 'c.bgl': buildBgl([{ lat: 50.034, lon: 8.571 }], { recordType: 0x113 }) },
  });
  const pkg = await scan(root, 'aerosoft-airport-eddf-frankfurt');
  assert.equal(pkg.airports.length, 1);
});

test('packages are classified from what they contain, not who made them', async (t) => {
  const root = tempRoot(t);
  const world = Array.from({ length: 40 }, (_, i) => ({ ident: `K${String(i).padStart(3, '0')}`, lat: i, lon: i }));
  makePackage(root, 'some-nav-data', { bgls: { 'nav.bgl': buildBgl(world, { extraSections: [0x13] }) } });
  makePackage(root, 'bush-strips-pack', {
    bgls: { 'a.bgl': buildBgl(world, { extraSections: [0x25] }) },
  });
  makePackage(root, 'some-city-pack', { bgls: { 'a.bgl': buildBgl([], { extraSections: [0x25, 0x2b] }) } });
  makePackage(root, 'some-common-library', { bgls: { 'a.bgl': buildBgl([], { extraSections: [0x2b, 0x30] }) } });
  makePackage(root, 'tool-with-no-bgl', {});

  const nav = await scan(root, 'some-nav-data');
  assert.equal(nav.kind, 'navdata');
  assert.deepEqual(nav.airports, [], 'nav data must not claim airports worldwide');
  assert.equal((await scan(root, 'bush-strips-pack')).kind, 'airport');
  assert.equal((await scan(root, 'some-city-pack')).kind, 'objects');
  assert.equal((await scan(root, 'some-common-library')).kind, 'library');
  assert.equal((await scan(root, 'tool-with-no-bgl')).kind, 'other');
});

test('the thumbnail is found wherever the package keeps it', async (t) => {
  const root = tempRoot(t);
  const dir = makePackage(root, 'tdm-airport-leco-a-coruna', { bgls: { 'a.bgl': buildBgl([{ ident: 'LECO', lat: 43.3, lon: -8.4 }]) } });
  const image = path.join('ContentInfo', 'tdm-leco', 'Thumbnail.jpg');
  fs.mkdirSync(path.join(dir, 'ContentInfo', 'tdm-leco'), { recursive: true });
  fs.writeFileSync(path.join(dir, image), 'jpg');
  fs.writeFileSync(
    path.join(dir, 'layout.json'),
    JSON.stringify({ content: [{ path: 'a.bgl' }, { path: 'ContentInfo/tdm-leco/Thumbnail.jpg' }, { path: 'ContentInfo/tdm-leco/Listed-but-gone/thumbnail.png' }] }),
  );
  const pkg = await scan(root, 'tdm-airport-leco-a-coruna');
  assert.equal(pkg.thumbnail, path.join(dir, image));
});

test('spellings of one developer become one, and count as the same developer', () => {
  const a = entry('a', [WADD], { developer: 'iniBuilds' });
  const b = entry('b', [WADD], { developer: 'inibuilds' });
  const c = entry('c', [], { developer: 'iniBuilds' });
  unifyDevelopers([a, b, c]);
  assert.equal(b.developer, 'iniBuilds');
  findConflicts([a, b], []);
  assert.deepEqual(a.conflicts, []);
  assert.equal(a.companions.length, 1);
});

test('only scenery counts: MISC needs an airport, aircraft never qualify', async (t) => {
  const root = tempRoot(t);
  const airport = { 'a.bgl': buildBgl([{ ident: 'KRON', lat: 44, lon: -114 }]) };
  makePackage(root, 'misc-airport', { manifest: { content_type: 'MISC' }, bgls: airport });
  makePackage(root, 'misc-tool', { manifest: { content_type: 'MISC' } });
  makePackage(root, 'an-aircraft', { manifest: { content_type: 'AIRCRAFT' }, bgls: airport });
  assert.ok(await scan(root, 'misc-airport'));
  assert.equal(await scan(root, 'misc-tool'), null);
  assert.equal(await scan(root, 'an-aircraft'), null);
});

function entry(id, airports, overrides = {}) {
  return {
    id,
    title: id,
    folderName: id,
    developer: id,
    enabled: 'enabled',
    airports,
    conflicts: [],
    companions: [],
    stockAirports: [],
    ...overrides,
  };
}

const WADD = { ident: 'WADD', lat: -8.7448, lon: 115.1654 };

test('two developers on one airport is a conflict, on both sides', () => {
  const a = entry('aerosoft', [WADD]);
  const b = entry('bbrothers', [WADD]);
  findConflicts([a, b], []);
  assert.equal(a.conflicts[0].ident, 'WADD');
  assert.equal(a.conflicts[0].with[0].id, 'bbrothers');
  assert.equal(b.conflicts[0].with[0].id, 'aerosoft');
});

test('one developer on one airport is a companion, not a conflict', () => {
  // vbcorp ships a zzz- patch named to load last.
  const a = entry('vbcorp-airport-kpga-page', [{ ident: 'KPGA', lat: 36.9, lon: -111.4 }], { developer: 'Vincent' });
  const b = entry('zzz-vbcorp-airport-kpga-page', [{ ident: 'KPGA', lat: 36.9, lon: -111.4 }], { developer: 'Vincent' });
  findConflicts([a, b], []);
  assert.deepEqual(a.conflicts, []);
  assert.equal(a.companions[0].with[0].id, b.id);
});

test('a disabled package conflicts with nothing, an unrecorded one still does', () => {
  const a = entry('a', [WADD]);
  const off = entry('off', [WADD], { enabled: 'disabled' });
  findConflicts([a, off], []);
  assert.deepEqual(a.conflicts, []);

  const c = entry('c', [WADD]);
  const unknown = entry('unknown', [WADD], { enabled: 'unknown' });
  findConflicts([c, unknown], []);
  assert.equal(c.conflicts.length, 1, 'the sim loads what is in Community');
});

test('location only decides when an ident is missing', () => {
  // Different idents a kilometre apart are different airports.
  const a = entry('a', [{ ident: 'OMDB', lat: 25.25, lon: 55.36 }]);
  const b = entry('b', [{ ident: 'OMDW', lat: 25.255, lon: 55.365 }]);
  findConflicts([a, b], []);
  assert.deepEqual(a.conflicts, []);

  const c = entry('c', [{ ident: 'EGLL', lat: 51.47, lon: -0.45 }]);
  const d = entry('d', [{ ident: null, lat: 51.472, lon: -0.455 }]);
  findConflicts([c, d], []);
  assert.equal(c.conflicts.length, 1);
});

test('sitting over a stock airport is noted, not treated as a conflict', () => {
  const a = entry('a', [{ ident: 'KJFK', lat: 40.6, lon: -73.8 }]);
  const stock = [parseStockAirport('fs24-asobo-airport-kjfk-new-york')];
  findConflicts([a], stock);
  assert.deepEqual(a.stockAirports, ['KJFK']);
  assert.deepEqual(a.conflicts, []);
});

test('stock airports are recognised from folder names only', () => {
  assert.equal(parseStockAirport('fs24-microsoft-airport-lppi-pico').ident, 'LPPI');
  assert.equal(parseStockAirport('fs24-asobo-airport-keb-nanwalek').ident, 'KEB');
  assert.equal(parseStockAirport('fs24-asobo-aircraft-c172'), null);
  assert.equal(parseStockAirport('fs20-flytampa-lasvegas-airport'), null);
});

test('an unrecorded package says so rather than claiming to be enabled', () => {
  assert.equal(finishPackage(entry('a', [], { enabled: 'unknown' })).status, 'Not recorded');
  assert.equal(finishPackage(entry('a', [], { enabled: 'enabled' })).status, 'Enabled');
  assert.equal(finishPackage(entry('a', [], { enabled: 'disabled' })).status, 'Disabled');
});

test('scenery filters use their own facets, and search finds ICAO codes', async () => {
  const { facetGroups, visibleAircraft, SCENERY_FACETS } = await load('filters.mjs');
  const library = [
    finishPackage(entry('Aerosoft Bali', [WADD], { kindLabel: 'Airport', conflicts: [{}], source: 'Community' })),
    finishPackage(entry('Mumbai Landmarks', [], { kindLabel: 'Landmarks and objects', source: 'Community' })),
  ];
  const view = { filters: new Map(), search: '', hideDisabled: false };
  const overlaps = facetGroups(library, view, SCENERY_FACETS).find((group) => group.key === 'overlap');
  assert.deepEqual(overlaps.values.map((value) => value.value), ['Possible conflict']);

  const searched = visibleAircraft(library, { ...view, search: 'wadd' }, 'name', SCENERY_FACETS);
  assert.deepEqual(searched.map((pkg) => pkg.title), ['Aerosoft Bali']);
});

test('coordinates and codes read naturally', async () => {
  const { formatCoordinates, airportCodes, statusNote } = await load('format.mjs');
  assert.equal(formatCoordinates({ lat: -8.7448, lon: 115.1654 }), '8.745° S, 115.165° E');
  const pkg = { airports: ['A', 'B', 'C', 'D', 'E'].map((ident) => ({ ident })) };
  assert.equal(airportCodes(pkg), 'A B C +2');
  assert.equal(airportCodes({ airports: [{ ident: null }] }), '');
  assert.ok(statusNote('Not recorded'));
  assert.equal(statusNote('Enabled'), null);
});
