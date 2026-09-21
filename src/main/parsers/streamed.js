'use strict';

const catalog = require('../data/aircraft-catalog');

// Streamed packages are encrypted, so everything below comes from the folder
// name. The stock naming convention is:
//
//   fs<20|24>-<developer>-aircraft-<slug>[-livery-<liverySlug>]
//
// with a handful of older packages that skip the `-aircraft-` segment
// (`fs20-aerosoft-crj`). Anything that does not look like an aircraft package
// is rejected so the scanner can skip it.

const NAME = /^(fs2[04])-([a-z0-9]+)-(.+)$/;

const DEVELOPER_NAMES = {
  asobo: 'Asobo Studio',
  microsoft: 'Microsoft',
  fs: 'Microsoft Flight Simulator',
  inibuilds: 'iniBuilds',
  workingtitle: 'Working Title',
  aerosoft: 'Aerosoft',
  flytampa: 'FlyTampa',
  fsdreamteam: 'FSDreamTeam',
  climax: 'Climax Studios',
  awdesigns: 'AW Designs',
  msfsffx: 'MSFS FFX',
};

// Packages that carry `aircraft` in the name but are not flyable aeroplanes:
// shared attachment libraries, tutorial missions, EFB add-ons, AI traffic.
const NON_AIRCRAFT_HINTS = [
  '-efb',
  '-liverypack-common',
  'aircraft-common-',
  'simattachmentlib',
  '-trainings-',
  'passiveaircraft',
];

function developerName(key) {
  return DEVELOPER_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Parse a streamed package folder name.
 * @returns {object|null} null when the folder is not an aircraft package.
 */
function parseStreamedName(folderName) {
  const lower = folderName.toLowerCase();
  const match = NAME.exec(lower);
  if (!match) return null;

  const [, simTag, developerKey, rest] = match;
  if (!/(^|-)aircraft(-|$)/.test(rest) && !/(^|-)livery(-|$)/.test(rest)) {
    // Older packages name the aircraft directly (fs20-aerosoft-crj). Only the
    // catalog can tell us whether that slug is an aircraft.
    if (!catalog.lookup(rest)) return null;
  }
  if (NON_AIRCRAFT_HINTS.some((hint) => lower.includes(hint))) return null;

  // Strip the `aircraft` marker, then split off a trailing `-livery-<name>`.
  let body = rest.replace(/(^|-)aircraft(-|$)/, '$1').replace(/^-|-$/g, '');
  let liverySlug = null;
  const liveryAt = body.indexOf('-livery-');
  if (liveryAt !== -1) {
    liverySlug = body.slice(liveryAt + '-livery-'.length);
    body = body.slice(0, liveryAt);
  } else if (body.endsWith('-livery')) {
    liverySlug = '';
    body = body.slice(0, -'-livery'.length);
  }
  if (!body) return null;

  const entry = catalog.lookup(body);
  const displayName = entry ? entry.name : catalog.prettifySlug(body);

  return {
    sim: simTag === 'fs24' ? 'MSFS 2024' : 'MSFS 2020',
    developerKey,
    developer: developerName(developerKey),
    slug: body,
    isLivery: liverySlug !== null,
    liveryName: liverySlug ? catalog.prettifySlug(liverySlug) : null,
    isSharedAsset: catalog.isSharedAsset(body),
    known: Boolean(entry),
    name: displayName,
    manufacturer: entry ? entry.manufacturer : undefined,
    category: entry ? entry.category : undefined,
    wiki: entry ? entry.wiki : undefined,
    /** Full display title, e.g. "Cessna 172 Skyhawk (G1000)". */
    title: entry && entry.manufacturer ? `${entry.manufacturer} ${entry.name}` : displayName,
  };
}

/**
 * Build the record the scanner stores for one streamed package folder.
 * Shares the shape of `parsers/package.js` output where it matters.
 */
function scanStreamedPackage(pkgDir, folderName, { source, label }) {
  const parsed = parseStreamedName(folderName);
  if (!parsed || parsed.isSharedAsset) return null;

  return {
    folderName,
    dir: pkgDir,
    source,
    sourceLabel: label,
    sealed: true,
    contentType: parsed.isLivery ? 'LIVERY' : 'AIRCRAFT',
    title: parsed.title,
    manufacturer: parsed.manufacturer,
    creator: parsed.developer,
    version: undefined,
    packageThumbnail: null,
    parsed,
    airframes: [],
  };
}

module.exports = { parseStreamedName, scanStreamedPackage };
