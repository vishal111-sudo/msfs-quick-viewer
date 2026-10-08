'use strict';

// Regression tests for how packages become aircraft cards.
//
// Each case is a tiny fake add-on under test/fixtures/library, shaped like a
// real one that once came out wrong. The scan is pointed at that folder only,
// so these run the same on any machine, with or without the sim installed.
//
//   npm test
//
// When a new packaging pattern breaks something, add a fixture that
// reproduces it here before fixing it, so it stays fixed for everyone.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { scanAll } = require('../src/main/scanner');

const LIBRARY = path.join(__dirname, 'fixtures', 'library');

let scan;
async function library() {
  scan = scan || (await scanAll({ roots: [LIBRARY] }));
  return scan;
}

function byName(result, name) {
  const found = result.aircraft.find((aircraft) => aircraft.name === name);
  assert.ok(found, `expected a card named "${name}"; got: ${result.aircraft.map((a) => a.name).join(', ')}`);
  return found;
}

test('scans only the folders it is given', async () => {
  const result = await library();
  assert.deepEqual(
    result.installs.map((install) => install.packagesRoot),
    [LIBRARY],
  );
});

test('one airframe folder holding two models makes two cards', async () => {
  const result = await library();
  byName(result, 'Airbus A319');
  byName(result, 'Airbus A321');
});

test('a [VARIATION] base_container package is paint, never an aircraft of its own', async () => {
  // RE Liveries' Avianca A319: a full aircraft.cfg and a manifest saying
  // AIRCRAFT, but it borrows Fenix's model through base_container.
  const result = await library();
  const names = result.aircraft.map((aircraft) => aircraft.name);
  assert.ok(
    !names.some((name) => /avianca/i.test(name)),
    `the Avianca livery became its own card: ${names.join(', ')}`,
  );
});

test('a variation finds its aircraft when the base folder it names is not installed', async () => {
  // It names FNX_319_CFM (Fenix's MSFS 2020 folder); the installed aircraft
  // lives in FNX_32X. The fnx prefix and the A319 designation still find it.
  const result = await library();
  const a319 = byName(result, 'Airbus A319');
  const a321 = byName(result, 'Airbus A321');
  assert.ok(
    a319.liveries.some((livery) => /avianca/i.test(livery.name)),
    `Avianca not on the A319; A319 has: ${a319.liveries.map((l) => l.name).join(', ')}`,
  );
  assert.ok(!a321.liveries.some((livery) => /avianca/i.test(livery.name)), 'Avianca landed on the A321');
});

test('a variation joins its aircraft directly when the named base is installed', async () => {
  const result = await library();
  const c99 = byName(result, 'Acme C99');
  assert.ok(
    c99.liveries.some((livery) => /sunset/i.test(livery.name)),
    `Sunset not on the C99; it has: ${c99.liveries.map((l) => l.name).join(', ')}`,
  );
});

test('a variation for an aircraft that is not installed is reported, not hidden', async () => {
  const result = await library();
  const orphans = result.diagnostics.liveriesWithoutAircraft;
  assert.ok(
    orphans.some((entry) => /ghost/i.test(entry)),
    `Ghost X1 paint missing from diagnostics: ${JSON.stringify(orphans)}`,
  );
  assert.equal(orphans.length, 1, `only the ghost paint should be unmatched: ${JSON.stringify(orphans)}`);
});

test('an aircraft takes its version from the package that ships it, not a livery pack', async () => {
  // The Avianca pack is 1.0.0 and declares itself AIRCRAFT; the Fenix
  // package that actually ships the A319 is 2.4.0.4720.
  const result = await library();
  assert.equal(byName(result, 'Airbus A319').version, '2.4.0.4720');
  assert.equal(byName(result, 'Acme C99').version, '1.2.3');
});
