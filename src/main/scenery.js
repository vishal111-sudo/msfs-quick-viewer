'use strict';

// Scenery packages: what each one is, where it is, and what it collides with.
//
// Everything here comes from what a package declares or contains, never from
// a list of known developers, so an add-on nobody anticipated is handled the
// same way as a famous one. Where the app has to infer something, the result
// says so (`identSource`).

const fsp = require('node:fs/promises');
const path = require('node:path');

const { readBgl } = require('./parsers/bgl');

// Section types that mean a file puts something visible in the world.
const SECTION_SCENERY_OBJECT = 0x25;
const SECTION_MODEL_DATA = 0x2b;

// Packages that may be scenery. Authors label plenty of airports MISC, so
// those are kept if they turn out to contain one; AIRCRAFT and LIVERY never are.
const SCENERY_TYPE = 'SCENERY';
const POSSIBLE_TYPES = new Set([SCENERY_TYPE, 'MISC', 'UNKNOWN', '']);

// More airports than this with nothing visible is navigation data, not
// scenery: Navigraph's packages hold airport records for the whole world.
const NAV_DATA_AIRPORTS = 20;

/** Airports closer than this, in km, are treated as one place. */
const SAME_PLACE_KM = 3;

const KIND_LABELS = {
  airport: 'Airport',
  objects: 'Landmarks and objects',
  library: 'Library',
  navdata: 'Navigation data',
  other: 'Other',
};

const STATUS_LABELS = { enabled: 'Enabled', disabled: 'Disabled', unknown: 'Not recorded' };

async function readJson(file) {
  try {
    return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/**
 * A package's thumbnail, found through layout.json. Developers name the folder
 * under ContentInfo as they please (`ContentInfo/tdm-leco/` inside
 * `tdm-airport-leco-a-coruna`), so assuming it matches the package missed
 * nearly two thirds of them.
 */
async function findThumbnail(dir, files) {
  const candidates = files
    .filter((file) => /^contentinfo[\\/]/i.test(file) && /^thumbnail(_small)?\.(jpe?g|png)$/i.test(path.basename(file)))
    .sort((a, b) => /_small/i.test(a) - /_small/i.test(b));
  for (const file of candidates) {
    const candidate = path.join(dir, file);
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      // listed but missing: try the next
    }
  }
  return null;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function tokens(value) {
  return String(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Codes named in a package folder, read from just after the word "airport":
 * `orbx-airport-kdet-detroit`, `aerosoft-airports-vnkl-vnpl-phaplu`.
 *
 * Three-character codes must contain a digit (3U2, D47, 24A). Without that
 * rule `orbx-airports-png-highlands` would claim an airport called PNG.
 */
function identsInFolderName(folderName) {
  const parts = tokens(folderName);
  const start = parts.findIndex((part) => /^(airports?|heliports?)$/.test(part));
  if (start === -1) return [];

  const found = [];
  for (const part of parts.slice(start + 1)) {
    const code = /^[a-z0-9]{4}$/.test(part) || (/^[a-z0-9]{3}$/.test(part) && /\d/.test(part));
    if (!code) break;
    found.push(part.toUpperCase());
  }
  return found;
}

/** A code in a BGL's own file name that the folder name confirms: `kdet.bgl`. */
function identFromFileName(file, folderName) {
  const folderTokens = new Set(tokens(folderName));
  const stem = path.basename(file, path.extname(file));
  const match = tokens(stem).find((token) => /^[a-z][a-z0-9]{3}$/.test(token) && folderTokens.has(token));
  return match ? match.toUpperCase() : null;
}

/**
 * Give an ident to airports whose record has none (see parsers/bgl.js).
 * Leaves it null rather than guess: a wrong code on an airport would create
 * false conflicts, while a missing one still shows its location.
 */
function inferIdents(airports, folderName) {
  const known = new Set(airports.map((airport) => airport.ident).filter(Boolean));

  for (const airport of airports) {
    if (airport.ident) continue;
    const ident = identFromFileName(airport.file, folderName);
    if (ident && !known.has(ident)) {
      airport.ident = ident;
      airport.identSource = 'inferred';
      known.add(ident);
    }
  }

  const open = airports.filter((airport) => !airport.ident);
  const unused = identsInFolderName(folderName).filter((ident) => !known.has(ident));
  if (open.length === 1 && unused.length === 1) {
    open[0].ident = unused[0];
    open[0].identSource = 'inferred';
  }
}

/** One entry per place: the same airport often appears in several BGLs. */
function dedupeAirports(airports) {
  const unique = [];
  for (const airport of airports) {
    const same = unique.find(
      (entry) =>
        (airport.ident && entry.ident === airport.ident) ||
        ((!airport.ident || !entry.ident) && distanceKm(entry, airport) < SAME_PLACE_KM),
    );
    if (!same) unique.push({ ...airport });
    else if (!same.ident && airport.ident) Object.assign(same, { ident: airport.ident, identSource: airport.identSource });
  }
  return unique;
}

function classify({ airports, sections }) {
  const visible = sections.has(SECTION_SCENERY_OBJECT) || sections.has(SECTION_MODEL_DATA);
  if (airports.length > NAV_DATA_AIRPORTS && !sections.has(SECTION_SCENERY_OBJECT)) return 'navdata';
  if (airports.length) return 'airport';
  if (sections.has(SECTION_SCENERY_OBJECT)) return 'objects';
  return visible ? 'library' : 'other';
}

/**
 * @param {string} dir package folder
 * @param {string} folderName
 * @param {{ source: string, label: string }} spec
 * @returns {Promise<object|null>} null when the package is not scenery
 */
async function scanSceneryPackage(dir, folderName, { source, label }) {
  const manifest = await readJson(path.join(dir, 'manifest.json'));
  if (!manifest) return null;

  const contentType = String(manifest.content_type || '').toUpperCase();
  if (!POSSIBLE_TYPES.has(contentType)) return null;

  const layout = await readJson(path.join(dir, 'layout.json'));
  const files = layout && Array.isArray(layout.content) ? layout.content.map((entry) => entry.path).filter(Boolean) : [];
  const bgls = files.filter((file) => /\.bgl$/i.test(file));

  const sections = new Set();
  const found = [];
  for (const file of bgls) {
    const bgl = await readBgl(path.join(dir, file));
    for (const type of bgl.sections) sections.add(type);
    for (const airport of bgl.airports) {
      found.push({ ...airport, file, identSource: airport.ident ? 'read' : null });
    }
    // Plainly nav data, which can run to thousands of files: stop reading.
    if (found.length > NAV_DATA_AIRPORTS * 5 && !sections.has(SECTION_SCENERY_OBJECT)) break;
  }

  // An airport labelled MISC is scenery; a MISC tool or library is not.
  if (contentType !== SCENERY_TYPE && !found.length) return null;

  inferIdents(found, folderName);
  const airports = dedupeAirports(found).map(({ ident, lat, lon, identSource }) => ({ ident, lat, lon, identSource }));
  const kind = classify({ airports, sections });

  const title = manifest.title || folderName;
  const creator = manifest.creator || undefined;
  const thumbnail = await findThumbnail(dir, files);

  return {
    id: `scenery:${dir}`,
    folderName,
    dir,
    title,
    developer: creator,
    version: manifest.package_version ? String(manifest.package_version) : undefined,
    kind,
    kindLabel: KIND_LABELS[kind],
    source,
    sourceLabel: label,
    thumbnail,
    // Nav data lists the whole world; those are not places this package covers.
    airports: kind === 'navdata' ? [] : airports,
    airportRecords: airports.length,
    conflicts: [],
    companions: [],
    stockAirports: [],
  };
}

/** `fs24-asobo-airport-kjfk-new-york` -> a stock airport with its own package. */
function parseStockAirport(folderName) {
  const match = /^fs(20|24)-([a-z0-9]+)-airport-([a-z0-9]{3,5})(?:-(.+))?$/i.exec(folderName);
  if (!match) return null;
  return { ident: match[3].toUpperCase(), publisher: match[2].toLowerCase(), sim: `fs${match[1]}`, folderName };
}

/**
 * Mark packages that overlap. Mutates `conflicts` and `stockAirports`.
 *
 * Only enabled packages can collide: a disabled one is not loaded. Matching
 * is by ICAO; an airport with no known ident falls back to location, which is
 * why two airports with different idents never match, however close.
 *
 * `conflicts` means two developers' add-ons define the same airport. That is
 * only a possible problem: a community patch for someone else's scenery looks
 * identical to a rival version of it, so the app reports it and leaves the
 * call to the person. `companions` is the same overlap from one developer,
 * often a deliberate pair (vbcorp ships a `zzz-` patch named to load last).
 * `stockAirports` means an add-on sits over a stock airport that has its own
 * package, which is normal and only worth knowing.
 *
 * @param {object[]} packages results of scanSceneryPackage
 * @param {object[]} stock results of parseStockAirport
 */
function findConflicts(packages, stock) {
  const active = packages.filter((pkg) => pkg.enabled !== 'disabled' && pkg.airports.length);
  const stockByIdent = new Map(stock.map((entry) => [entry.ident, entry]));

  for (const pkg of active) {
    for (const airport of pkg.airports) {
      if (airport.ident && stockByIdent.has(airport.ident)) {
        pkg.stockAirports.push(airport.ident);
      }

      const others = active.filter(
        (other) =>
          other !== pkg &&
          other.airports.some((candidate) =>
            airport.ident && candidate.ident
              ? candidate.ident === airport.ident
              : distanceKm(candidate, airport) < SAME_PLACE_KM,
          ),
      );
      const entry = (list) => ({
        ident: airport.ident,
        lat: airport.lat,
        lon: airport.lon,
        with: list.map((other) => ({ id: other.id, title: other.title, folderName: other.folderName })),
      });
      const sameDeveloper = (other) => pkg.developer && other.developer === pkg.developer;
      const rivals = others.filter((other) => !sameDeveloper(other));
      const companions = others.filter(sameDeveloper);
      if (rivals.length) pkg.conflicts.push(entry(rivals));
      if (companions.length) pkg.companions.push(entry(companions));
    }
  }
}

/**
 * Merge spellings of one developer, so "inibuilds" and "iniBuilds" are not two
 * sidebar entries. The most common spelling wins, then the one with the most
 * capitals. Mutates `developer`, and runs before conflicts are found so the
 * same-developer check sees one name.
 */
function unifyDevelopers(packages) {
  const spellings = new Map();
  for (const pkg of packages) {
    if (!pkg.developer) continue;
    const key = pkg.developer.trim().toLowerCase();
    if (!spellings.has(key)) spellings.set(key, new Map());
    const counts = spellings.get(key);
    counts.set(pkg.developer, (counts.get(pkg.developer) || 0) + 1);
  }
  const capitals = (value) => value.replace(/[^A-Z]/g, '').length;
  for (const pkg of packages) {
    if (!pkg.developer) continue;
    const counts = spellings.get(pkg.developer.trim().toLowerCase());
    [pkg.developer] = [...counts.entries()].sort((a, b) => b[1] - a[1] || capitals(b[0]) - capitals(a[0]))[0];
  }
}

/** The text search runs against, built once the package is complete. */
function finishPackage(pkg) {
  const idents = pkg.airports.map((airport) => airport.ident).filter(Boolean);
  return {
    ...pkg,
    name: pkg.title,
    // Three states, not two. Content.xml only lists what the sim has recorded,
    // so a package added since then is unknown rather than enabled.
    status: STATUS_LABELS[pkg.enabled] || STATUS_LABELS.unknown,
    searchText: [pkg.title, pkg.developer, pkg.folderName, pkg.kindLabel, ...idents].filter(Boolean).join(' ').toLowerCase(),
  };
}

module.exports = {
  scanSceneryPackage,
  parseStockAirport,
  findConflicts,
  unifyDevelopers,
  finishPackage,
  inferIdents,
  identsInFolderName,
  distanceKm,
  KIND_LABELS,
};
