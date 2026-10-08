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
/** Everything one install will need reading, listed before any of it is read. */
async function planInstall(install) {
  const packageDirs = await resolvePackageDirs(install.packagesRoot);
  const contentState = await readContentState(install.appDataDir);

  const jobs = [];
  for (const spec of packageDirs) {
    for (const folderName of await listDirs(spec.dir)) {
      jobs.push({ spec, folderName, dir: path.join(spec.dir, folderName) });
    }
  }
  return { install, contentState, jobs };
}

async function scanInstall({ install, contentState, jobs }, onJobDone) {
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

    onJobDone(job);

    if (!pkg) return null;
    pkg.install = install.id;
    pkg.sim = install.sim;
    pkg.enabled = stateFor(contentState, job.folderName);
    return pkg;
  });

  return { scanned: jobs.length, packages: packages.filter(Boolean) };
}

/**
 * Rate-limit progress messages by time rather than by count.
 *
 * Counting was the old approach (one message every 25 packages) and it hid
 * the slow part entirely: streamed stock packages finish in microseconds
 * while a handful of large add-ons take seconds each, so the count reached
 * 1475 of 1494 almost at once and then said nothing until the end. Timed
 * messages report each slow add-on as it lands, and a stage change is always
 * sent at once.
 */
function progressReporter(onProgress, intervalMs = 80) {
  if (!onProgress) return () => {};
  let last = 0;
  return (progress, force = false) => {
    const now = Date.now();
    if (!force && now - last < intervalMs) return;
    last = now;
    onProgress(progress);
  };
}

/**
 * Detected installs plus any packages roots the user added by hand. Exposed on
 * its own so the welcome screen can say what was found before scanning it.
 */
async function listInstalls(extraRoots = []) {
  const installs = await detectInstalls();
  for (const root of extraRoots || []) {
    if (installs.some((install) => install.packagesRoot === root)) continue;
    installs.push(customInstall(root, installs[0] ? installs[0].appDataDir : ''));
  }
  return installs;
}

function customInstall(root, appDataDir = '') {
  return { id: `Custom:${root}`, sim: 'Custom', store: 'Manual', appDataDir, packagesRoot: root };
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
    /**
     * Packages that supplied the airframe itself, as opposed to paint. The
     * aircraft's version is one of these: the Fenix A320's livery packs are
     * at 3.0 while the aircraft is 2.4.0.4720, and some livery packs even
     * declare `content_type: AIRCRAFT`, so "any package with a version"
     * reports the wrong number.
     */
    basePackages: [],
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

/**
 * The installed version of an aircraft: `package_version` from the manifest
 * of the package that ships the airframe, never from a livery pack.
 *
 * Stock aircraft streamed by the sim have no manifest to read (only an
 * encrypted `content` folder), so they have no version here; they update with
 * the sim. Should several packages supply the same airframe, an add-on beats
 * a marketplace package beats the stock one, and a package declaring itself
 * an aircraft beats one that does not.
 */
function versionOf(aircraft) {
  const candidates = aircraft.basePackages.filter((pkg) => pkg.version);
  if (!candidates.length) return { version: undefined, versionPackage: undefined };
  const rank = (pkg) => [SOURCE_RANK[pkg.source] || 0, pkg.contentType === 'AIRCRAFT' ? 1 : 0];
  candidates.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return y[0] - x[0] || y[1] - x[1];
  });
  const chosen = candidates[0];
  return { version: String(chosen.version), versionPackage: chosen.title || chosen.folderName };
}

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
    const groups = liveryOnlyPackage || liveryFolder || frame.baseContainer ? [] : frame.groups || [];

    // Nothing here declares an aircraft, so these liveries belong to whichever
    // aircraft another package declares for the same airframe folder, or for
    // the one a variation names as its base.
    if (!groups.length) {
      if (frame.liveries.length) {
        const routeKey = frame.baseContainer ? baseAirframeKey(frame.baseContainer.toLowerCase()) : frameKey;
        const queue = pending.get(routeKey) || [];
        for (const livery of frame.liveries) queue.push({ livery, pkg, declaredBase: frame.baseContainer });
        pending.set(routeKey, queue);
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
      if (!aircraft.basePackages.some((entry) => entry.folderName === pkg.folderName)) {
        aircraft.basePackages.push(packageSummary(pkg));
      }
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
/** Model designations an aircraft is known by, squashed: `a319`, `737800`. */
function designationsOf(aircraft) {
  return [aircraft.icaoType, aircraft.model]
    .map((value) => squash(value || ''))
    .filter((value) => value.length >= 3 && /\d/.test(value));
}

/** Whether an aircraft comes from the developer whose prefix is `vendor`. */
function sharesVendor(aircraft, vendor) {
  const names = [aircraft.frameKey || aircraft.key || '', ...aircraft.packages.map((pkg) => pkg.folderName)];
  return names.some((name) => {
    const bare = String(name).toLowerCase().replace(/^fs2[04]-/, '');
    return bare === vendor || bare.startsWith(`${vendor}-`) || bare.startsWith(`${vendor}_`);
  });
}

/**
 * The installed aircraft a variation belongs to, when the airframe folder it
 * names is not installed under that name.
 *
 * Variations often point at an older folder: RE Liveries' Avianca A319 names
 * `FNX_319_CFM`, Fenix's MSFS 2020 folder, while the installed aircraft lives
 * in `FNX_32X`. Two things still identify it: the developer prefix (`fnx`,
 * learned at scan time) narrows the field to Fenix aircraft, and the model
 * designation (`A319`) appears in the variation's own name and titles.
 *
 * Returns null rather than guessing when two aircraft match equally well; the
 * livery then gets a card of its own and shows up in Scan diagnostics.
 */
function findVariationBase(routeKey, queue, byKey) {
  const text = squash(
    [routeKey, ...queue.map(({ livery, pkg }) => `${livery.name} ${livery.title || ''} ${pkg.title || ''}`)].join(' '),
  );
  const segments = routeKey.split(/[^a-z0-9]+/).filter(Boolean);
  const vendor = segments.length > 1 && vendorTokens.has(segments[0]) ? segments[0] : null;

  let best = null;
  let bestLength = 0;
  let tied = false;
  for (const aircraft of byKey.values()) {
    if (!aircraft.hasBase) continue;
    if (vendor && !sharesVendor(aircraft, vendor)) continue;
    for (const designation of designationsOf(aircraft)) {
      if (!text.includes(designation)) continue;
      if (designation.length > bestLength) {
        best = aircraft;
        bestLength = designation.length;
        tied = false;
      } else if (designation.length === bestLength && aircraft !== best) {
        tied = true;
      }
    }
  }
  return tied ? null : best;
}

function routePendingLiveries(byKey, pending) {
  for (const [frameKey, queue] of pending) {
    const candidates = [...byKey.values()].filter((aircraft) => aircraft.frameKey === frameKey);

    // A variation whose named base is not installed under that name.
    if (!candidates.length && queue.some((entry) => entry.declaredBase)) {
      const base = findVariationBase(frameKey, queue, byKey);
      if (base) {
        for (const { livery, pkg } of queue) {
          notePackage(base, pkg);
          addLivery(base, livery, pkg);
        }
        continue;
      }
    }

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
// This list is LEARNED from the library being scanned rather than written
// down, because a written list is only ever right for the library it was
// written against: the first version of it was already missing four vendors
// present on the machine it was written on, and no list can anticipate a
// developer who ships their first aircraft tomorrow.
//
// Only sim-internal forms are seeded. These are not studios with a manifest
// to read, so there is nothing to learn them from.
const SEED_VENDOR_TOKENS = ['asobo', 'microsoft', 'ms', 'msfs', 'fs20', 'fs24', 'ini', 'wt'];

/** Tokens treated as a developer prefix; learned afresh on every scan. */
let vendorTokens = new Set(SEED_VENDOR_TOKENS);

/** `pmdg-aircraft-738` and `fs24-asobo-aircraft-c172` both name their vendor. */
const VENDOR_FROM_FOLDER = /^(?:fs2[04]-)?([a-z0-9]+)-aircraft-/;

/** Any leading folder segment, for packages ignoring the convention above. */
const LEADING_SEGMENT = /^(?:fs2[04]-)?([a-z]{2,})[-_]/;

// Words that pad out a studio name without identifying the studio. Dropping
// these is what lets "Just Flight" match a `justflight-` folder while
// "Fenix Simulations" does not go looking for `simulations-`.
const CREATOR_NOISE = new Set([
  'simulations', 'simulation', 'sims', 'sim', 'studio', 'studios', 'design',
  'designs', 'software', 'interactive', 'entertainment', 'group', 'team',
  'development', 'developments', 'productions', 'aircraft', 'aviation',
  'digital', 'works', 'project', 'projects', 'inc', 'llc', 'ltd', 'limited',
  'gmbh', 'co', 'the', 'and', 'livery', 'liveries', 'repaint', 'repaints',
]);

/** Identifying words from a declared `creator`, plus their joined form. */
function creatorTokens(creator) {
  const words = String(creator || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !CREATOR_NOISE.has(word));
  const tokens = new Set(words);
  if (words.length > 1) tokens.add(words.join(''));
  return tokens;
}

/** Whether a folder segment is recognisably the same studio as `creator`. */
function segmentEchoesCreator(segment, creator) {
  for (const token of creatorTokens(creator)) {
    if (token === segment) return true;
    // Substring either way, so `mscarenado-` matches Carenado and
    // `justflight-` matches Just Flight. Guarded on length because a
    // two-letter token matches almost anything.
    if (token.length >= 4 && segment.includes(token)) return true;
    if (segment.length >= 4 && token.includes(segment)) return true;
  }
  return false;
}

/**
 * Learn the developer prefixes actually present in this install, so the app
 * behaves the same for a library full of add-ons nobody anticipated.
 *
 * Three signals, strongest first:
 *   1. the `<vendor>-aircraft-<model>` convention, which names the vendor;
 *   2. a leading segment that echoes the package's declared `creator`, which
 *      catches abbreviations the convention would miss (`mscarenado-c337`);
 *   3. a leading segment one creator uses across several packages, which
 *      catches abbreviations that resemble nothing in the studio's name
 *      (`fnx-` for Fenix, `bksq-` for Black Square).
 */
function learnVendorTokens(packages) {
  vendorTokens = new Set(SEED_VENDOR_TOKENS);
  const segmentsByCreator = new Map();

  for (const pkg of packages) {
    const folder = String(pkg.folderName || '').toLowerCase();

    const declared = VENDOR_FROM_FOLDER.exec(folder);
    if (declared) vendorTokens.add(declared[1]);

    const creator = String(pkg.creator || '').trim();
    const leading = LEADING_SEGMENT.exec(folder);
    if (!creator || !leading) continue;
    const segment = leading[1];
    if (NOISE_TOKENS.has(segment)) continue;

    if (segmentEchoesCreator(segment, creator)) {
      vendorTokens.add(segment);
      continue;
    }

    const key = creator.toLowerCase();
    if (!segmentsByCreator.has(key)) segmentsByCreator.set(key, new Map());
    const counts = segmentsByCreator.get(key);
    counts.set(segment, (counts.get(segment) || 0) + 1);
  }

  // Rule 3. One package is not evidence: a studio shipping a single
  // `douglas-dc3` would teach us to strip "douglas" from every key. Two
  // packages sharing a segment under one creator is a house prefix.
  //
  // Three characters minimum, because this is the weakest of the rules: it
  // infers a prefix from repetition alone, with nothing the author declared
  // to confirm it, and a two-letter token strips too much. Rules 1 and 2 have
  // that confirmation, so they accept shorter tokens.
  for (const counts of segmentsByCreator.values()) {
    for (const [segment, count] of counts) {
      if (count > 1 && segment.length >= 3) vendorTokens.add(segment);
    }
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

  // Last resort, and the only rule here that needs no vocabulary at all: drop
  // the leading segment of the airframe folder. Authors prefix those with a
  // studio tag the package folder never mentions — `MSCarenado_D18S`,
  // `JF_PA28_TurboArrow_IV` — so no amount of learning from package names or
  // declared creators can recover it. Stripping the segment positionally
  // works for a studio nobody has heard of yet.
  //
  // Guarded so it cannot eat an identity: the dropped segment must be a word
  // rather than a model number, and what remains must still carry a digit and
  // enough length to be a specific aircraft. That keeps `737-800` intact and
  // stops `FNX_32X` collapsing to a bare `32x`.
  const segments = String(aircraft.key).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (segments.length > 1 && /^[a-z]+$/.test(segments[0])) {
    const remainder = squash(segments.slice(1).join(''));
    if (remainder.length >= 4 && /\d/.test(remainder)) aliases.add(remainder);
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
  target.basePackages.push(...source.basePackages);
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
    ...versionOf(aircraft),
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
 * @param {string[]} [options.roots] scan only these packages roots, skipping detection
 * @param {(progress: object) => void} [options.onProgress]
 */
async function scanAll(options = {}) {
  const startedAt = Date.now();
  const report = progressReporter(options.onProgress);

  report({ stage: 'detect' }, true);
  // `roots` scans exactly those folders and nothing detected on this machine,
  // which is what lets the tests run identically anywhere.
  const installs = options.roots
    ? options.roots.map((root) => customInstall(root))
    : await listInstalls(options.extraRoots);

  // Plan every install before reading any of them, so progress covers the
  // whole scan rather than restarting per install.
  const plans = [];
  for (const install of installs) plans.push(await planInstall(install));

  // Add-ons and stock packages are counted apart because they cost wildly
  // different amounts: a streamed stock package is a folder name, an add-on
  // is a tree of cfg files. Only the add-on count tracks elapsed time.
  const progress = {
    stage: 'read',
    installs: installs.map((install) => ({ sim: install.sim, store: install.store })),
    addonsDone: 0,
    addonsTotal: 0,
    stockDone: 0,
    stockTotal: 0,
  };
  for (const plan of plans) {
    for (const job of plan.jobs) {
      if (job.spec.sealed) progress.stockTotal += 1;
      else progress.addonsTotal += 1;
    }
  }
  report(progress, true);

  const onJobDone = (job) => {
    if (job.spec.sealed) progress.stockDone += 1;
    else progress.addonsDone += 1;
    report(progress);
  };

  const byKey = new Map();
  let scanned = 0;
  const allPackages = [];

  for (const plan of plans) {
    const result = await scanInstall(plan, onJobDone);
    scanned += result.scanned;
    allPackages.push(...result.packages);
  }

  report({ ...progress, stage: 'match' }, true);

  // Merge unsealed first so a Community base wins the identity fields, then
  // let streamed packages fill in whatever is left.
  learnVendorTokens(allPackages);

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
      // Cards made entirely of paint: a livery whose aircraft was not found.
      // Either that aircraft is not installed, or this is a packaging pattern
      // the matching does not know yet. Zero on a clean library, which is
      // what makes it worth listing.
      liveriesWithoutAircraft: aircraft
        .filter((entry) => !entry.hasBase)
        .map((entry) => entry.packages.map((pkg) => pkg.title || pkg.folderName).join(', ') || entry.name),
      vendorTokensLearned: vendorTokens.size,
      // The tokens themselves, not just how many: if a developer's liveries
      // land on the wrong aircraft, whether their prefix was learned is the
      // first thing worth knowing.
      vendorTokens: [...vendorTokens].sort(),
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

module.exports = { scanAll, listInstalls };
