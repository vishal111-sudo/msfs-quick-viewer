'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { detectInstalls, resolvePackageDirs } = require('./roots');
const { readContentState, stateFor } = require('./contentxml');
const { scanPackage } = require('./parsers/package');
const { scanStreamedPackage } = require('./parsers/streamed');
const taxonomy = require('./parsers/taxonomy');
const { chooseGroup } = require('./parsers/variants');

const CONCURRENCY = 8;

/** Run `worker` over `items`, at most `limit` at a time, preserving order. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function listDirs(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    // Community folders are very often junctions into a mod library, which
    // readdir reports as symlinks rather than directories.
    return entries.filter((entry) => entry.isDirectory() || entry.isSymbolicLink()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Collect the raw package records under one install. */
async function scanInstall(install, onProgress) {
  const packageDirs = await resolvePackageDirs(install.packagesRoot);
  const contentState = await readContentState(install.appDataDir);

  const jobs = [];
  for (const spec of packageDirs) {
    for (const folderName of await listDirs(spec.dir)) {
      jobs.push({ spec, folderName, dir: path.join(spec.dir, folderName) });
    }
  }

  let done = 0;
  const packages = await mapLimit(jobs, CONCURRENCY, async (job) => {
    const options = { source: job.spec.source, label: job.spec.label };
    let pkg = null;
    try {
      pkg = job.spec.sealed
        ? scanStreamedPackage(job.dir, job.folderName, options)
        : await scanPackage(job.dir, options);
    } catch (err) {
      pkg = null;
      if (process.env.MSFSQV_DEBUG) console.error('scan failed', job.dir, err.message);
    }

    done += 1;
    if (onProgress && done % 25 === 0) onProgress({ done, total: jobs.length });

    if (!pkg) return null;
    pkg.install = install.id;
    pkg.sim = install.sim;
    pkg.enabled = stateFor(contentState, job.folderName);
    return pkg;
  });

  if (onProgress) onProgress({ done: jobs.length, total: jobs.length });
  return { scanned: jobs.length, packages: packages.filter(Boolean) };
}

function liveryId(aircraftId, name, index) {
  return `${aircraftId}::livery:${index}:${name}`;
}

/** Empty aggregate record for one aircraft. */
function newAircraft(id, key) {
  return {
    id,
    key,
    name: null,
    manufacturer: undefined,
    model: undefined,
    icaoType: undefined,
    typeRole: undefined,
    category: 'Other',
    engineType: 'Unknown',
    engineCount: undefined,
    engineLabel: 'Unknown',
    size: 'Unknown',
    sim: undefined,
    source: undefined,
    sealed: false,
    hasBase: false,
    /** Creator of the package that actually ships the aircraft, not a livery. */
    primaryDeveloper: undefined,
    developers: new Set(),
    packages: [],
    liveries: [],
    thumbnail: null,
    /** Package hero image from a package that ships this aircraft alone. */
    exclusiveThumbnail: null,
    /** Package hero image shared with other aircraft in the same package. */
    sharedThumbnail: null,
    artQuery: null,
    wiki: undefined,
  };
}

/** Add-on names arrive as folder-ish strings; make them readable. */
function prettify(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Drop a leading developer tag from a model name, so SimWorks Studios'
 * `SWS_Kodiak_Cargo_Amphibian` reads as "Kodiak Cargo Amphibian" once the
 * manufacturer is put in front of it.
 */
function stripLeadingVendorWord(value, manufacturer) {
  const words = value.split(' ');
  if (words.length < 2) return value;

  const first = words[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const manufacturerWord = String(manufacturer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!first || first === manufacturerWord) return value;

  return vendorTokens.has(first) ? words.slice(1).join(' ') : value;
}

/**
 * Split "737-800 | PAX | BW" into the aircraft name and its variant tags.
 * Authors use the pipe to bolt configuration detail onto the model name, which
 * belongs beside the card rather than inside its title.
 */
function splitVariant(value) {
  const parts = prettify(value)
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  return { base: parts[0] || '', variant: parts.slice(1).join(' · ') || null };
}

/**
 * Sort key that puts the same real aircraft together whoever made it, so
 * Asobo's "Boeing 737 MAX" sits next to iFly's "737-MAX8" instead of pages
 * apart under A and I.
 */
function aircraftSortKey(manufacturer, model) {
  return `${manufacturer} ${model}`
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function packageSummary(pkg) {
  return {
    folderName: pkg.folderName,
    dir: pkg.dir,
    title: pkg.title,
    version: pkg.version,
    creator: pkg.creator,
    contentType: pkg.contentType,
    source: pkg.source,
    sourceLabel: pkg.sourceLabel,
    enabled: pkg.enabled,
    sealed: pkg.sealed,
  };
}

/** Source ranking: a Community add-on outranks the stock streamed package. */
const SOURCE_RANK = { Community: 3, Official: 2, Streamed: 1 };

/** `douglas-dc3-livery-bluestripe` is a livery of `douglas-dc3`, not an aircraft. */
function baseAirframeKey(key) {
  return key.replace(/[-_ ]liver(?:y|ies)[-_ ].*$/i, '');
}

/** Append one livery to an aircraft, in the shape the UI expects. */
function addLivery(aircraft, livery, pkg) {
  aircraft.liveries.push({
    id: liveryId(aircraft.id, livery.name, aircraft.liveries.length),
    name: livery.name,
    registration: livery.registration,
    airline: livery.airline,
    creator: livery.creator || pkg.creator,
    thumbnail: livery.thumbnail || null,
    packageFolder: pkg.folderName,
    source: pkg.source,
    enabled: pkg.enabled,
    sealed: false,
    index: aircraft.liveries.length,
  });
}

function notePackage(aircraft, pkg) {
  if (!aircraft.packages.some((entry) => entry.folderName === pkg.folderName)) {
    aircraft.packages.push(packageSummary(pkg));
  }
  if (pkg.creator) aircraft.developers.add(pkg.creator);

  const outranks = (SOURCE_RANK[pkg.source] || 0) >= (SOURCE_RANK[aircraft.source] || 0);
  if (!aircraft.source || outranks) {
    aircraft.source = pkg.source;
    aircraft.sim = pkg.sim;
  }
}

/**
 * @param {Map} byKey            aircraft accumulator
 * @param {object} pkg           scanned package
 * @param {object} pending       frame key -> liveries that still need an owner
 */
function mergeUnsealed(byKey, pkg, pending) {
  // The author said this package only adds paint, so nothing in it may claim
  // to be an aircraft in its own right.
  const liveryOnlyPackage = pkg.contentType === 'LIVERY';

  for (const frame of pkg.airframes) {
    const frameKey = baseAirframeKey(frame.key);
    // `douglas-dc3-livery-bluestripe` names itself a livery of `douglas-dc3`,
    // so whatever its cfg declares, it is paint rather than a new aircraft.
    const liveryFolder = frame.key !== frameKey;
    const groups = liveryOnlyPackage || liveryFolder ? [] : frame.groups || [];

    // Nothing here declares an aircraft, so these liveries belong to whichever
    // aircraft another package declares for the same airframe folder.
    if (!groups.length) {
      if (frame.liveries.length) {
        const queue = pending.get(frameKey) || [];
        for (const livery of frame.liveries) queue.push({ livery, pkg });
        pending.set(frameKey, queue);
      }
      continue;
    }

    for (const group of groups) {
      // Always namespace by group so an aircraft keeps the same id whether it
      // arrived alone or alongside its siblings in one package.
      const id = `sim:${frameKey}::${group.key}`;
      let aircraft = byKey.get(id);
      if (!aircraft) {
        aircraft = newAircraft(id, frameKey);
        aircraft.groupKey = group.key;
        aircraft.frameKey = frameKey;
        byKey.set(id, aircraft);
      }

      notePackage(aircraft, pkg);

      aircraft.hasBase = true;
      // Whoever ships the aircraft owns it, even if a livery pack was scanned
      // first — otherwise PMDG's 737 is credited to a livery author.
      if (!aircraft.primaryDeveloper && pkg.creator) aircraft.primaryDeveloper = pkg.creator;

      const facts = frame.facts || {};
      aircraft.name = aircraft.name || group.modelBase || pkg.title || frame.modelName;
      aircraft.manufacturer =
        aircraft.manufacturer || group.manufacturer || facts.icaoManufacturer || pkg.manufacturer;
      aircraft.model = aircraft.model || group.modelBase || facts.icaoModel;
      aircraft.variantTags = aircraft.variantTags || group.variantTags;
      // The configurations the sim offers inside this one aircraft.
      aircraft.variantNames = aircraft.variantNames || group.variantNames;
      // Prefer the preset's own ICAO type: the airframe-level one describes
      // only the first aircraft in a folder that holds several.
      aircraft.icaoType = aircraft.icaoType || group.icaoType;
      if (groups.length === 1) aircraft.icaoType = aircraft.icaoType || facts.icaoType;
      aircraft.icaoManufacturer = aircraft.icaoManufacturer || facts.icaoManufacturer;
      // The airframe's single ICAO model cannot describe every preset in it,
      // so only trust it when this folder holds one aircraft.
      if (groups.length === 1) aircraft.icaoModel = aircraft.icaoModel || facts.icaoModel;
      aircraft.typeRole = aircraft.typeRole || group.typeRole || frame.typeRole;
      aircraft.rawCategory = aircraft.rawCategory || facts.category;
      if (facts.engineType) aircraft.engineType = taxonomy.normaliseEngineType(facts.engineType);
      if (facts.engineCount) aircraft.engineCount = facts.engineCount;
      if (facts.wtc) aircraft.wtc = facts.wtc;
      aircraft.variants = [...(aircraft.variants || []), ...group.variants];

      if (pkg.packageThumbnail) {
        // A hero image shared by several aircraft — either several airframe
        // folders, or several presets in one — is only right for one of them,
        // so it ranks below this aircraft's own livery art.
        const shared = pkg.airframeCount > 1 || groups.length > 1;
        if (shared) aircraft.sharedThumbnail = aircraft.sharedThumbnail || pkg.packageThumbnail;
        else aircraft.exclusiveThumbnail = aircraft.exclusiveThumbnail || pkg.packageThumbnail;
      }

      for (const livery of group.liveries) addLivery(aircraft, livery, pkg);
    }
  }
}

/**
 * Hand livery-pack paint to the right aircraft. A pack targets an airframe
 * folder, which may now hold several aircraft, so the livery's own tags decide
 * which one — a WestJet 737-800 paint must not land on the BBJ2.
 */
function routePendingLiveries(byKey, pending) {
  for (const [frameKey, queue] of pending) {
    const candidates = [...byKey.values()].filter((aircraft) => aircraft.frameKey === frameKey);

    if (!candidates.length) {
      // No package declared this airframe, so the pack stands on its own.
      const id = `sim:${frameKey}`;
      let aircraft = byKey.get(id);
      if (!aircraft) {
        aircraft = newAircraft(id, frameKey);
        aircraft.frameKey = frameKey;
        byKey.set(id, aircraft);
      }
      for (const { livery, pkg } of queue) {
        notePackage(aircraft, pkg);
        addLivery(aircraft, livery, pkg);
      }
      continue;
    }

    const groups = candidates.map((aircraft) => ({ key: aircraft.groupKey || '' }));
    for (const { livery, pkg } of queue) {
      const index = chooseGroup(groups, { tags: livery.tags, variantModel: livery.variantModel });
      const aircraft = candidates[index === -1 ? 0 : index];
      notePackage(aircraft, pkg);
      addLivery(aircraft, livery, pkg);
    }
  }
}

/**
 * Pick the card image: a hero shot that belongs to this aircraft alone, then
 * one of its own liveries, then a hero shot shared with its packaging siblings.
 */
function resolveThumbnail(aircraft) {
  if (aircraft.exclusiveThumbnail) return aircraft.exclusiveThumbnail;
  const withArt = aircraft.liveries.find((livery) => livery.thumbnail);
  if (withArt) return withArt.thumbnail;
  return aircraft.sharedThumbnail || null;
}

function mergeStreamed(byKey, pkg) {
  const parsed = pkg.parsed;
  const id = `streamed:${parsed.slug}`;
  let aircraft = byKey.get(id);
  if (!aircraft) {
    aircraft = newAircraft(id, parsed.slug);
    byKey.set(id, aircraft);
  }

  aircraft.packages.push(packageSummary(pkg));
  if (pkg.creator) aircraft.developers.add(pkg.creator);

  if (!aircraft.source) {
    aircraft.source = pkg.source;
    aircraft.sim = parsed.sim;
    aircraft.sealed = true;
  }

  if (parsed.isLivery) {
    // A livery pack can arrive before (or without) its base package — seed the
    // identity from the catalog so the card is still named properly.
    if (!aircraft.name) {
      aircraft.name = parsed.name;
      aircraft.manufacturer = parsed.manufacturer;
      aircraft.model = parsed.name;
      aircraft.catalogCategory = parsed.category;
      aircraft.wiki = parsed.wiki;
      aircraft.sim = parsed.sim;
    }
    aircraft.liveries.push({
      id: liveryId(id, parsed.liveryName || pkg.folderName, aircraft.liveries.length),
      name: parsed.liveryName || pkg.folderName,
      creator: pkg.creator,
      thumbnail: null,
      packageFolder: pkg.folderName,
      source: pkg.source,
      enabled: pkg.enabled,
      sealed: true,
      index: aircraft.liveries.length,
    });
    return;
  }

  aircraft.hasBase = true;
  aircraft.name = parsed.name;
  aircraft.manufacturer = parsed.manufacturer;
  aircraft.model = parsed.name;
  aircraft.catalogCategory = parsed.category;
  aircraft.wiki = parsed.wiki;
  aircraft.sim = parsed.sim;
}

// Livery-only add-ons name their SimObjects folder after the base aircraft,
// but rarely identically: Duckworks ships `asobo_h125` for the stock `h125`,
// iniBuilds ships `inibuilds-a380` for the streamed `a380`, and mod authors
// prefix with their own name. Stripping those leading tokens lines them up.
//
// Most of this list is LEARNED from the library being scanned rather than
// written down, because a fixed list is only ever right for one person's
// add-ons — this one was already missing four vendors present on the machine
// it was written on. Packages are named `<vendor>-aircraft-<model>`, so the
// vendor falls out of the folder names for free.
const SEED_VENDOR_TOKENS = [
  // Sim-internal and abbreviation forms that no folder name spells out.
  'asobo', 'microsoft', 'ms', 'msfs', 'fs20', 'fs24', 'ini', 'wt',
  // Authors whose folders do not follow the `-aircraft-` convention.
  'mscarenado', 'duckworks', 'denarq', 'fenix', 'tfdi', 'aerosoft',
];

/** Tokens treated as a developer prefix; grows as a library is scanned. */
let vendorTokens = new Set(SEED_VENDOR_TOKENS);

/** `pmdg-aircraft-738` and `fs24-asobo-aircraft-c172` both name their vendor. */
const VENDOR_FROM_FOLDER = /^(?:fs2[04]-)?([a-z0-9]+)-aircraft-/;

/**
 * Learn the developer prefixes actually present in this install, so the app
 * behaves the same for a library full of add-ons nobody anticipated.
 */
function learnVendorTokens(folderNames) {
  vendorTokens = new Set(SEED_VENDOR_TOKENS);
  for (const name of folderNames) {
    const match = VENDOR_FROM_FOLDER.exec(String(name).toLowerCase());
    if (match) vendorTokens.add(match[1]);
  }
  return vendorTokens;
}

/** Tokens that carry no identity and only add noise to a fuzzy match. */
const NOISE_TOKENS = new Set(['aircraft', 'livery', 'liveries', 'pack', 'the', 'and', 'mod', 'enhancement']);

function stripVendorPrefixes(value) {
  let result = value;
  for (;;) {
    const before = result;
    for (const prefix of vendorTokens) {
      result = result.replace(new RegExp(`^${prefix}[-_ ]+`), '');
    }
    if (result === before) return result;
  }
}

function squash(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Candidate join keys for an aircraft, most specific first. A community mod
 * often spells the aircraft as `<manufacturer>-<model>` where the stock
 * package is just `<model>`, so the manufacturer is tried as a prefix too.
 */
function aliasKeys(aircraft) {
  const base = stripVendorPrefixes(String(aircraft.key).toLowerCase());
  const aliases = new Set([squash(base)]);

  const manufacturer = squash(aircraft.manufacturer || '');
  if (manufacturer) {
    const squashed = squash(base);
    if (squashed.startsWith(manufacturer) && squashed.length > manufacturer.length) {
      aliases.add(squashed.slice(manufacturer.length));
    }
  }
  aliases.delete('');
  return [...aliases];
}

/** Identity-bearing words in a folder key, for the fuzzy orphan match. */
function keyTokens(key) {
  return [
    ...new Set(
      String(key)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1 && !NOISE_TOKENS.has(token) && !vendorTokens.has(token)),
    ),
  ];
}

/**
 * How well a base airframe key is contained in a livery pack's key.
 *
 * Word boundaries differ between the two — iFly's base is `iFly 737-MAX8-166Seats`
 * while its livery pack is `ifly-aircraft-737max8-ICE-TF-ICV-166Seats` — so
 * every identity word of the base must appear *somewhere* in the livery's
 * squashed key. Score is the matched length, which makes the most specific
 * base win: `737max8166seats` (15) beats the plain `737max8` (7).
 *
 * @returns {number} 0 when the base is not fully contained
 */
function containmentScore(baseKey, liverySquashed) {
  const tokens = keyTokens(baseKey);
  if (!tokens.length) return 0;

  let matched = 0;
  for (const token of tokens) {
    if (!liverySquashed.includes(token)) return 0;
    matched += token.length;
  }
  return matched;
}

/** Move one aircraft's packages and liveries onto another, then drop it. */
function foldInto(target, source) {
  target.packages.push(...source.packages);
  for (const developer of source.developers) target.developers.add(developer);

  // A community mod usually wins the display name, but the stock entry it
  // folds into is the one that knows the exact Wikipedia article and the
  // catalog category — keep those.
  if (!target.primaryDeveloper && source.primaryDeveloper) target.primaryDeveloper = source.primaryDeveloper;
  if ((source.variantNames || []).length > (target.variantNames || []).length) {
    target.variantNames = source.variantNames;
  }
  if (!target.wiki && source.wiki) target.wiki = source.wiki;
  if (!target.catalogCategory && source.catalogCategory) target.catalogCategory = source.catalogCategory;
  if (!target.manufacturer && source.manufacturer) target.manufacturer = source.manufacturer;

  for (const livery of source.liveries) {
    livery.id = `${target.id}::merged:${target.liveries.length}:${livery.name}`;
    target.liveries.push(livery);
  }
  if (!target.exclusiveThumbnail) target.exclusiveThumbnail = source.exclusiveThumbnail;
  if (!target.sharedThumbnail) target.sharedThumbnail = source.sharedThumbnail;
}

/** Richest, most authoritative entries become the canonical card. */
function canonicalRank(aircraft) {
  return [
    aircraft.hasBase ? 1 : 0,
    aircraft.liveries.length,
    aircraft.sealed ? 1 : 0, // a stock aircraft is the canonical identity
  ];
}

function betterCanonical(a, b) {
  const left = canonicalRank(a);
  const right = canonicalRank(b);
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? a : b;
  }
  return a;
}

/**
 * Collapse entries that are really the same aircraft: a mod of a stock plane,
 * a livery pack spelled differently from its base, or sibling `-livery-`
 * folders. Runs in two passes — exact alias matches first, then a token
 * overlap fallback for livery-only entries that still have no home.
 */
function reconcileDuplicates(byKey) {
  const ordered = [...byKey.values()].sort((a, b) => (betterCanonical(a, b) === a ? -1 : 1));

  const canonicalByAlias = new Map();
  for (const aircraft of ordered) {
    if (!byKey.has(aircraft.id)) continue;
    const aliases = aliasKeys(aircraft);
    const target = aliases.map((alias) => canonicalByAlias.get(alias)).find(Boolean);

    // Presets from the same airframe folder are deliberately separate aircraft
    // (Fenix's A319/A320/A321 all live in FNX_32X), so they must never fold
    // into each other even though they share a folder name.
    const sibling =
      target &&
      target.frameKey &&
      target.frameKey === aircraft.frameKey &&
      target.groupKey !== aircraft.groupKey;

    if (target && target !== aircraft && !sibling) {
      foldInto(target, aircraft);
      byKey.delete(aircraft.id);
      continue;
    }
    for (const alias of aliases) if (!canonicalByAlias.has(alias)) canonicalByAlias.set(alias, aircraft);
  }

  // Livery packs whose folder name does not reference the base airframe at
  // all (iFly ships `ifly-aircraft-737max8-ICE-TF-ICV-166Seats` against a base
  // called `iFly 737-MAX8-166Seats`). Score the remaining bases by how many
  // identity words they share, and require a clear winner.
  const bases = [...byKey.values()].filter((aircraft) => aircraft.hasBase);
  const MIN_SCORE = 5; // enough characters that the match is not a coincidence

  for (const [id, aircraft] of [...byKey.entries()]) {
    if (aircraft.hasBase || !aircraft.liveries.length) continue;

    const squashed = squash(stripVendorPrefixes(String(aircraft.key).toLowerCase()));
    if (!squashed) continue;

    let best = null;
    let bestScore = 0;
    let runnerUp = 0;
    for (const base of bases) {
      if (base === aircraft) continue;
      const score = containmentScore(base.key, squashed);
      if (score > bestScore) {
        runnerUp = bestScore;
        bestScore = score;
        best = base;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }

    if (best && bestScore >= MIN_SCORE && bestScore > runnerUp) {
      foldInto(best, aircraft);
      byKey.delete(id);
    }
  }
}

/**
 * Default ordering: same real aircraft together, then by who made it, so the
 * stock 737 MAX and the iFly 737 MAX 8 land side by side.
 */
function byAircraftThenDeveloper(a, b) {
  const collate = { sensitivity: 'base', numeric: true };
  return (
    (a.sortKey || a.name).localeCompare(b.sortKey || b.name, undefined, collate) ||
    String(a.developer || '~').localeCompare(String(b.developer || '~'), undefined, collate) ||
    a.name.localeCompare(b.name, undefined, collate)
  );
}

/** Fill in derived fields and flatten sets once merging is done. */
function finalise(aircraft) {
  // A livery-only add-on for an aircraft we never found has no cfg to name it,
  // so fall back to the package title before the raw folder key.
  const fallbackName = aircraft.packages.find((pkg) => pkg.title)?.title;
  const { base, variant } = splitVariant(aircraft.name || fallbackName || aircraft.key);

  const manufacturer = prettify(aircraft.manufacturer);
  const startsWithManufacturer =
    manufacturer && base.toLowerCase().startsWith(manufacturer.toLowerCase().split(' ')[0]);

  const displayName = startsWithManufacturer ? base : stripLeadingVendorWord(base, manufacturer);
  const fullName = startsWithManufacturer || !manufacturer ? displayName : `${manufacturer} ${displayName}`;

  const variantLabel = variant || aircraft.variantTags || null;

  // Group by the real aircraft, preferring the ICAO identity: an add-on's own
  // manufacturer field is often the studio ("iFly Jets"), not Boeing.
  const sortKey = aircraftSortKey(
    aircraft.icaoManufacturer || manufacturer,
    splitVariant(aircraft.model || aircraft.icaoModel || displayName).base,
  );

  const category =
    aircraft.catalogCategory ||
    taxonomy.categorise({
      typeRole: aircraft.typeRole,
      category: aircraft.rawCategory,
      engineType: aircraft.engineType,
      engineCount: aircraft.engineCount,
      wtc: aircraft.wtc,
      name: [fullName, aircraft.model, aircraft.icaoType].filter(Boolean).join(' '),
    });

  const thumbnail = resolveThumbnail(aircraft);
  // The aircraft's own developer leads; livery authors follow.
  const developers = [...aircraft.developers].sort((a, b) => {
    if (a === aircraft.primaryDeveloper) return -1;
    if (b === aircraft.primaryDeveloper) return 1;
    return a.localeCompare(b);
  });
  const liveriesWithArt = aircraft.liveries.filter((livery) => livery.thumbnail).length;
  const anyEnabled = aircraft.packages.some((pkg) => pkg.enabled !== 'disabled');

  return {
    id: aircraft.id,
    key: aircraft.key,
    name: fullName,
    shortName: displayName,
    /** Configuration tags the author bolted onto the model name, e.g. "PAX · BW". */
    variant: variantLabel,
    /** Engine, conversion and cabin options offered inside this one aircraft. */
    variantNames: aircraft.variantNames || [],
    variantCount: (aircraft.variantNames || []).length,
    sortKey,
    manufacturer,
    model: prettify(aircraft.model),
    icaoType: aircraft.icaoType,
    // The ICAO pair names the real-world aircraft, where `name` often names
    // the add-on ("Black Square Baron 58 Professional"). Artwork lookups want
    // the former.
    icaoManufacturer: aircraft.icaoManufacturer,
    icaoModel: aircraft.icaoModel,
    category,
    typeRole: aircraft.typeRole,
    engineType: aircraft.engineType,
    engineCount: aircraft.engineCount,
    engineLabel: taxonomy.engineLabel(aircraft.engineType, aircraft.engineCount),
    size: taxonomy.sizeFromWtc(aircraft.wtc),
    sim: aircraft.sim,
    source: aircraft.source,
    sealed: aircraft.sealed,
    hasBase: aircraft.hasBase,
    enabled: anyEnabled,
    developers,
    developer: aircraft.primaryDeveloper || developers[0],
    packages: aircraft.packages,
    packageCount: aircraft.packages.length,
    liveries: aircraft.liveries,
    liveryCount: aircraft.liveries.length,
    liveriesWithArt,
    thumbnail,
    needsOnlineArt: !thumbnail,
    wiki: aircraft.wiki,
    searchText: [
      fullName,
      variantLabel,
      (aircraft.variantNames || []).join(' '),
      aircraft.icaoManufacturer,
      aircraft.icaoModel,
      aircraft.model,
      aircraft.icaoType,
      category,
      developers.join(' '),
      aircraft.packages.map((pkg) => pkg.folderName).join(' '),
      aircraft.liveries.map((livery) => livery.name).join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

/**
 * Scan every detected install and aggregate the result into aircraft records.
 * @param {object} [options]
 * @param {string[]} [options.extraRoots] additional packages roots to include
 * @param {(progress: object) => void} [options.onProgress]
 */
async function scanAll(options = {}) {
  const startedAt = Date.now();
  const installs = await detectInstalls();

  for (const root of options.extraRoots || []) {
    if (installs.some((install) => install.packagesRoot === root)) continue;
    installs.push({
      id: `Custom:${root}`,
      sim: 'Custom',
      store: 'Manual',
      appDataDir: installs[0] ? installs[0].appDataDir : '',
      packagesRoot: root,
    });
  }

  const byKey = new Map();
  let scanned = 0;
  const allPackages = [];

  for (const install of installs) {
    const result = await scanInstall(install, options.onProgress);
    scanned += result.scanned;
    allPackages.push(...result.packages);
  }

  // Merge unsealed first so a Community base wins the identity fields, then
  // let streamed packages fill in whatever is left.
  learnVendorTokens(allPackages.map((pkg) => pkg.folderName));

  // Aircraft first, so a livery pack can be handed to the aircraft it paints.
  const pendingLiveries = new Map();
  for (const pkg of allPackages) if (!pkg.sealed) mergeUnsealed(byKey, pkg, pendingLiveries);
  for (const pkg of allPackages) if (pkg.sealed) mergeStreamed(byKey, pkg);
  routePendingLiveries(byKey, pendingLiveries);
  reconcileDuplicates(byKey);

  const aircraft = [...byKey.values()]
    .filter((entry) => entry.hasBase || entry.liveries.length)
    .map(finalise)
    .sort(byAircraftThenDeveloper);

  return {
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    installs: installs.map((install) => ({
      id: install.id,
      sim: install.sim,
      store: install.store,
      packagesRoot: install.packagesRoot,
    })),
    // Where the app had to guess. Surfaced in Settings so a library full of
    // add-ons this was never tested against reports its own gaps instead of
    // quietly mislabelling them.
    diagnostics: {
      // Stock aircraft whose package slug is not in the catalog: they show a
      // name derived from the folder, and search for artwork with it.
      unknownStockAircraft: [
        ...new Set(
          allPackages
            .filter((pkg) => pkg.sealed && pkg.parsed && !pkg.parsed.known && !pkg.parsed.isLivery)
            .map((pkg) => pkg.parsed.slug),
        ),
      ].sort(),
      // Aircraft the category heuristics could not place.
      uncategorised: aircraft.filter((entry) => entry.category === 'Other').map((entry) => entry.name),
      vendorTokensLearned: vendorTokens.size,
    },
    stats: {
      foldersScanned: scanned,
      aircraftPackages: allPackages.length,
      aircraft: aircraft.length,
      liveries: aircraft.reduce((sum, entry) => sum + entry.liveryCount, 0),
      withLocalArt: aircraft.filter((entry) => entry.thumbnail).length,
      needingOnlineArt: aircraft.filter((entry) => !entry.thumbnail).length,
    },
    aircraft,
  };
}

module.exports = { scanAll };
