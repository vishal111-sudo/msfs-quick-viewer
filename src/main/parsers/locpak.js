'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// Aircraft cfgs often store display strings as localisation tokens rather than
// literal text:
//
//   ui_manufacturer = "TT:AIRCRAFT.UI_MANUFACTURER"
//
// The value lives in a `.locPak` at the package root — a JSON file shaped
// `{ "LocalisationPackage": { "Strings": { "AIRCRAFT.UI_MANUFACTURER": "Beechcraft" } } }`.
// Without resolving these, cards show the raw token instead of a name.

const PREFERRED = ['en-US.locPak', 'en-GB.locPak'];

async function readJson(file) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
}

/**
 * Load a package's English string table.
 * @returns {Promise<Map<string, string>>} empty when the package ships none
 */
async function loadStrings(pkgDir) {
  const strings = new Map();

  let names = [];
  try {
    names = (await fsp.readdir(pkgDir)).filter((name) => name.toLowerCase().endsWith('.locpak'));
  } catch {
    return strings;
  }
  if (!names.length) return strings;

  // Prefer English; otherwise take whatever single language the package ships.
  const chosen =
    PREFERRED.find((preferred) => names.some((name) => name.toLowerCase() === preferred.toLowerCase())) ||
    names[0];
  const actual = names.find((name) => name.toLowerCase() === chosen.toLowerCase()) || chosen;

  const payload = await readJson(path.join(pkgDir, actual));
  const table = payload && payload.LocalisationPackage && payload.LocalisationPackage.Strings;
  if (!table) return strings;

  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') strings.set(key, value);
  }
  return strings;
}

/**
 * Build a resolver for cfg values.
 *
 * Returns the literal string for plain values, the looked-up text for a
 * resolvable `TT:` token, and `undefined` for a token we cannot resolve — so
 * callers fall back to a package title rather than rendering the token.
 */
function makeResolver(strings) {
  return function resolve(value) {
    if (typeof value !== 'string' || !value) return value || undefined;
    if (!value.startsWith('TT:')) return value;

    const key = value.slice(3).trim();
    const found = strings.get(key);
    if (found) return found;

    // Sim-wide tables (ATCCOM.*) live in the base game, not in the package.
    return undefined;
  };
}

module.exports = { loadStrings, makeResolver };
