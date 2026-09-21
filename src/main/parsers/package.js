'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

const { parseCfg, sectionsNamed, get } = require('./cfg');
const { loadStrings, makeResolver } = require('./locpak');
const { baseModelOf, designationOf, roleOf, icaoKeyOf, normalise, chooseGroup } = require('./variants');

/** Pass-through resolver, used when a package ships no localisation table. */
const identity = (value) => value || undefined;

// Reads one unsealed (plain files on disk) package folder. Two aircraft
// layouts exist side by side in a 2024 install:
//
//   FS2024:  SimObjects/Airplanes/<Model>/common/config/aircraft.cfg
//            SimObjects/Airplanes/<Model>/presets/<creator>/<Variant>/config/aircraft.cfg
//            SimObjects/Airplanes/<Model>/liveries/<creator>/<Livery>/livery.cfg
//                                                                    /thumbnail/thumbnail.png
//
//   FS2020:  SimObjects/Airplanes/<Model>/aircraft.cfg          ([FLTSIM.n] blocks)
//            SimObjects/Airplanes/<Model>/texture.<suffix>/thumbnail.jpg
//
// Livery-only add-ons ship just the `liveries/` subtree under a <Model> folder
// whose name matches the base aircraft, which is how they get joined later.

const THUMBNAIL_NAMES = ['thumbnail.png', 'thumbnail.jpg', 'thumbnail.jpeg', 'thumbnail_small.png'];

async function readJson(file) {
  try {
    const text = await fsp.readFile(file, 'utf8');
    // Some third-party manifests ship a UTF-8 BOM, which JSON.parse rejects.
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
}

async function readDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function firstExisting(dir, names) {
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      await fsp.access(file);
      return file;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function readCfgFile(file) {
  try {
    return parseCfg(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** `thumbnail/thumbnail.png` inside a livery folder, or a bare `thumbnail.png`. */
async function findThumbnail(dir) {
  return (
    (await firstExisting(path.join(dir, 'thumbnail'), THUMBNAIL_NAMES)) ||
    (await firstExisting(dir, THUMBNAIL_NAMES))
  );
}

/** Pull the shared aircraft facts out of a `[GENERAL]` section. */
function generalFacts(cfg, resolve = identity) {
  if (!cfg) return {};
  const facts = {
    category: get(cfg, 'GENERAL', 'Category'),
    icaoType: get(cfg, 'GENERAL', 'icao_type_designator'),
    icaoManufacturer: resolve(get(cfg, 'GENERAL', 'icao_manufacturer')),
    icaoModel: resolve(get(cfg, 'GENERAL', 'icao_model')),
    engineType: get(cfg, 'GENERAL', 'icao_engine_type'),
    engineCount: Number(get(cfg, 'GENERAL', 'icao_engine_count')) || undefined,
    wtc: get(cfg, 'GENERAL', 'icao_WTC'),
  };
  // Drop empty keys so callers can merge fact objects with spread.
  for (const key of Object.keys(facts)) {
    if (facts[key] === undefined || facts[key] === '') delete facts[key];
  }
  return facts;
}

/** Variants + liveries declared as `[FLTSIM.n]` blocks (FS2020 layout). */
async function readFltsimEntries(cfg, modelDir, resolve = identity) {
  const blocks = sectionsNamed(cfg, /^FLTSIM\.\d+$/i);
  if (!blocks.length) return { variants: [], liveries: [], blockCount: 0, userSelectable: 0 };

  // Map the on-disk `texture.<suffix>` folders once, case-insensitively.
  const textureDirs = new Map();
  for (const entry of await readDir(modelDir)) {
    if (!entry.isDirectory()) continue;
    const match = /^texture\.(.+)$/i.exec(entry.name);
    if (match) textureDirs.set(match[1].toLowerCase(), path.join(modelDir, entry.name));
    else if (entry.name.toLowerCase() === 'texture') textureDirs.set('', path.join(modelDir, entry.name));
  }

  const liveries = [];
  const variants = new Map();
  let userSelectable = 0;

  for (const block of blocks) {
    const keys = block.keys;
    // AI traffic packages (FSLTL and the stock generic airliners) declare
    // hundreds of variations that never appear in the aircraft selector.
    if (keys.get('isuserselectable') === '0' || keys.get('isairtraffic') === '1') continue;
    userSelectable += 1;

    const uiType = resolve(keys.get('ui_type')) || '';
    const uiManufacturer = resolve(keys.get('ui_manufacturer')) || '';
    const uiVariation = resolve(keys.get('ui_variation')) || '';
    const title = resolve(keys.get('title')) || [uiManufacturer, uiType, uiVariation].filter(Boolean).join(' ');

    const variantKey = (uiManufacturer + '|' + uiType).toLowerCase();
    if (!variants.has(variantKey)) {
      variants.set(variantKey, {
        name: [uiManufacturer, uiType].filter(Boolean).join(' ') || title,
        manufacturer: uiManufacturer || undefined,
        model: uiType || undefined,
        declared: Boolean(uiType),
        typeRole: keys.get('ui_typerole'),
        createdBy: resolve(keys.get('ui_createdby')),
      });
    }

    const textureDir = textureDirs.get(String(keys.get('texture') || '').toLowerCase());
    liveries.push({
      name: uiVariation || title,
      title,
      // The block that declares the livery also declares which aircraft it is
      // for, so no tag guessing is needed for this layout.
      variantModel: uiType || undefined,
      registration: keys.get('atc_id') || undefined,
      airline: keys.get('atc_airline') || undefined,
      thumbnail: textureDir ? await findThumbnail(textureDir) : null,
      dir: textureDir || undefined,
    });
  }

  return { variants: [...variants.values()], liveries, blockCount: blocks.length, userSelectable };
}

/** Liveries declared as `liveries/<creator>/<name>/livery.cfg` (FS2024 layout). */
async function readLiveryFolders(modelDir, resolve = identity) {
  const liveriesRoot = path.join(modelDir, 'liveries');
  const found = [];

  for (const creator of await readDir(liveriesRoot)) {
    if (!creator.isDirectory()) continue;
    const creatorDir = path.join(liveriesRoot, creator.name);

    for (const livery of await readDir(creatorDir)) {
      if (!livery.isDirectory()) continue;
      const dir = path.join(creatorDir, livery.name);
      const cfg = await readCfgFile(path.join(dir, 'livery.cfg'));
      const required = cfg ? get(cfg, 'Selection', 'required_tags') : undefined;
      // Authors ship placeholder paints tagged "Disabled" that the sim never
      // offers; Fenix has four of them.
      if (String(required || '').trim().toLowerCase() === 'disabled') continue;

      found.push({
        name: (cfg && resolve(get(cfg, 'GENERAL', 'name'))) || livery.name,
        title: livery.name,
        creator: creator.name,
        // e.g. "A319,CFM,SL" — says which preset this paint belongs to.
        tags: required ? required.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        thumbnail: await findThumbnail(dir),
        dir,
      });
    }
  }
  return found;
}

/**
 * Variants declared as `presets/<creator>/<name>/config/aircraft.cfg`
 * (FS2024 layout). A preset cfg carries either a `[GENERAL]` block, a
 * `[fltsim.n]` block with the `ui_*` display fields, or both — PMDG for
 * instance puts everything in `[fltsim.0]` and leaves `[GENERAL]` out.
 */
async function readPresetVariants(modelDir, resolve = identity) {
  const presetsRoot = path.join(modelDir, 'presets');
  const found = [];

  for (const creator of await readDir(presetsRoot)) {
    if (!creator.isDirectory()) continue;
    const creatorDir = path.join(presetsRoot, creator.name);

    for (const preset of await readDir(creatorDir)) {
      if (!preset.isDirectory()) continue;
      const dir = path.join(creatorDir, preset.name);
      const cfg = await readCfgFile(path.join(dir, 'config', 'aircraft.cfg'));
      if (!cfg) continue;

      const facts = generalFacts(cfg, resolve);
      const ui = sectionsNamed(cfg, /^FLTSIM\.\d+$/i)[0];
      const uiManufacturer = ui ? resolve(ui.keys.get('ui_manufacturer')) : undefined;
      const uiType = ui ? resolve(ui.keys.get('ui_type')) : undefined;

      const manufacturer = uiManufacturer || facts.icaoManufacturer;
      const model = uiType || facts.icaoModel;
      const label = model ? [manufacturer, model].filter(Boolean).join(' ') : preset.name;

      found.push({
        name: label,
        manufacturer,
        model,
        // Did the author actually name this preset, or is `label` just the
        // folder it lives in? SimWorks ships 24 Kodiak presets that declare
        // neither a ui_type nor an ICAO type.
        declared: Boolean(uiType || facts.icaoModel || facts.icaoType),
        icaoType: facts.icaoType,
        typeRole: ui ? ui.keys.get('ui_typerole') : undefined,
        createdBy: ui ? resolve(ui.keys.get('ui_createdby')) : undefined,
        facts,
        dir,
      });
    }
  }
  return found;
}

/**
 * Last-resort `[GENERAL]` facts from `attachments/<creator>/<part>/config/aircraft.cfg`.
 * Some airliners (PMDG) only declare ICAO fields on the fuselage attachment.
 * Only read when the model itself declared nothing.
 */
async function readAttachmentFacts(modelDir, resolve = identity) {
  const attachmentsRoot = path.join(modelDir, 'attachments');
  const merged = {};

  for (const creator of await readDir(attachmentsRoot)) {
    if (!creator.isDirectory()) continue;
    const creatorDir = path.join(attachmentsRoot, creator.name);

    for (const part of await readDir(creatorDir)) {
      if (!part.isDirectory()) continue;
      const cfg = await readCfgFile(path.join(creatorDir, part.name, 'config', 'aircraft.cfg'));
      if (!cfg) continue;
      for (const [key, value] of Object.entries(generalFacts(cfg, resolve))) {
        if (merged[key] === undefined) merged[key] = value;
      }
    }
  }
  return merged;
}

/** Readable label for one preset, e.g. "A319 · CFM · SL" or "Cargo Amphibian". */
function prettyVariantLabel(variant) {
  return String(variant.model || variant.name || '')
    .replace(/_/g, ' ')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ');
}

/**
 * Split an airframe's presets into the distinct aircraft they represent, and
 * hand each livery to the one it belongs to.
 */
function groupVariants(variants, liveries, facts = {}) {
  const byKey = new Map();
  // Where a preset names no model of its own, it falls back to the airframe's
  // identity so every such preset lands in one group.
  const airframeKey = normalise(facts.icaoType || facts.icaoModel || 'airframe');

  for (const variant of variants) {
    const model = baseModelOf(variant.model || variant.name);
    // The ICAO designator is the most reliable statement that two presets are
    // the same aeroplane; where an author leaves it out (PMDG, Fenix), fall
    // back to the model name with configuration words stripped.
    const designation = designationOf(model);

    // A preset earns a card of its own only if it names a model. Aircraft
    // variants are identified by numbers — A300-600, 737-800, A319 — so a
    // preset named purely in words is describing a fit, not a model.
    // SimWorks' Kodiak presets are "Cargo Amphibian", "Summit Tundra NoCP"
    // and so on: one aeroplane in 24 configurations, which is also what 36 of
    // its 38 liveries say by carrying no variant tag at all.
    const namesAModel = /\d/.test(designation);

    // iniBuilds gives the A340-300, its Freighter and its VIP the same A343
    // designator, so the role has to be part of the key.
    const role = namesAModel ? roleOf(designation) : '';
    const typeKey =
      icaoKeyOf(variant.icaoType) || (namesAModel ? normalise(designation) : airframeKey);
    const key = role ? `${typeKey}::${role}` : typeKey;
    if (!typeKey) continue;

    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        // Livery tags are matched against the plain name, without the role
        // marker the identity key carries.
        matchKey: normalise(namesAModel ? designation : facts.icaoModel || ''),
        modelBase: (namesAModel ? designation : facts.icaoModel) || model,
        manufacturer: variant.manufacturer,
        icaoType: variant.icaoType,
        typeRole: variant.typeRole,
        createdBy: variant.createdBy,
        variants: [],
        liveries: [],
      });
    }
    const group = byKey.get(key);
    group.variants.push(variant);
    // Remember what the presets called themselves, so a group that never had
    // to merge differing names can keep the specific one.
    (group.designations || (group.designations = new Set())).add(designation);
    // The same, but keeping a trailing parenthetical — it is sometimes the
    // only thing telling two presets apart ("… (Clipped Wings)").
    (group.fullNames || (group.fullNames = new Set())).add(
      String(variant.model || variant.name || '')
        .replace(/_/g, ' ')
        .split('|')[0]
        .replace(/\s+/g, ' ')
        .trim(),
    );
    group.typeRole = group.typeRole || variant.typeRole;
    group.manufacturer = group.manufacturer || variant.manufacturer;
    group.icaoType = group.icaoType || variant.icaoType;
    // Prefer the shortest designation as the label: "A340-300", not
    // "A340-300 Freighter" just because it was seen first.
    if (namesAModel && designation && designation.length < group.modelBase.length) {
      group.modelBase = designation;
    }
  }

  const groups = [...byKey.values()];
  if (!groups.length) return [];

  for (const group of groups) {
    // Falling back to the airframe's ICAO model loses detail when the presets
    // all agreed on a name anyway: FlyingIron's two Spitfire folders would
    // both read "Spitfire" rather than "Spitfire Mk IXc" and its clipped-wing
    // sibling. Only keep the generic name where the specific ones disagreed.
    const named = [...(group.designations || [])].filter(Boolean);
    if (named.length === 1) {
      const full = [...(group.fullNames || [])].filter(Boolean);
      group.modelBase = full.length === 1 ? full[0] : named[0];
    }

    // What the sim actually offers inside this aircraft: engine choices,
    // freighter and VIP conversions, winglet and cabin options.
    const labels = new Set();
    for (const variant of group.variants) {
      const label = prettyVariantLabel(variant);
      if (label) labels.add(label);
    }
    group.variantNames = [...labels];
    group.variantCount = labels.size;
  }

  const unassigned = [];
  for (const livery of liveries) {
    const index = chooseGroup(groups, { tags: livery.tags, variantModel: livery.variantModel });
    if (index === -1) unassigned.push(livery);
    else groups[index].liveries.push(livery);
  }

  // A livery we cannot place (Fenix's "Disabled" placeholders) goes on the
  // first group rather than vanishing from the app entirely.
  if (unassigned.length) groups[0].liveries.push(...unassigned);

  return groups;
}

/** Scan one `SimObjects/Airplanes/<Model>` folder. */
async function readAirframe(modelDir, modelName, resolve = identity) {
  const commonCfg = await readCfgFile(path.join(modelDir, 'common', 'config', 'aircraft.cfg'));
  const rootCfg = await readCfgFile(path.join(modelDir, 'aircraft.cfg'));

  const presetVariants = await readPresetVariants(modelDir, resolve);
  const folderLiveries = await readLiveryFolders(modelDir, resolve);

  const fltsim = rootCfg
    ? await readFltsimEntries(rootCfg, modelDir, resolve)
    : { variants: [], liveries: [], blockCount: 0, userSelectable: 0 };

  // `common/config` is authoritative; fall back to the root cfg, then to
  // whatever the first preset declared.
  const facts = {
    ...(presetVariants[0] ? presetVariants[0].facts : {}),
    ...generalFacts(rootCfg, resolve),
    ...generalFacts(commonCfg, resolve),
  };
  if (!facts.icaoType && !facts.icaoModel) {
    Object.assign(facts, await readAttachmentFacts(modelDir, resolve), facts);
  }

  const variants = [...presetVariants, ...fltsim.variants].map((variant) => ({
    name: variant.name,
    manufacturer: variant.manufacturer,
    model: variant.model,
    // Each preset may declare its own ICAO type, which is the surest signal
    // that two presets are or are not the same aeroplane.
    icaoType: variant.icaoType,
    declared: variant.declared,
    typeRole: variant.typeRole,
    createdBy: variant.createdBy,
  }));

  const roleVariant = variants.find((variant) => variant.typeRole);
  const liveries = [...folderLiveries, ...fltsim.liveries];
  const groups = groupVariants(variants, liveries, facts);

  // Every declared variation was AI-only, so nothing here is flyable.
  const aiOnly = fltsim.blockCount > 0 && fltsim.userSelectable === 0 && presetVariants.length === 0;

  return {
    key: modelName.toLowerCase(),
    modelName,
    dir: modelDir,
    hasBase: Boolean(commonCfg || rootCfg || presetVariants.length),
    aiOnly,
    facts,
    typeRole: roleVariant ? roleVariant.typeRole : undefined,
    variants,
    liveries,
    /**
     * One entry per distinct aircraft declared in this folder. Usually one,
     * but Fenix ships A319/A320/A321 together and PMDG ships the 737-800
     * alongside its BCF, BDSF and BBJ2 conversions.
     */
    groups,
  };
}

/**
 * Scan an unsealed package folder.
 * @returns {Promise<object|null>} null when the folder holds no aircraft content.
 */
async function scanPackage(pkgDir, { source, label }) {
  const folderName = path.basename(pkgDir);
  const manifest = await readJson(path.join(pkgDir, 'manifest.json'));

  // One string table per package, shared by every airframe inside it.
  const resolve = makeResolver(await loadStrings(pkgDir));

  const airplanesRoot = path.join(pkgDir, 'SimObjects', 'Airplanes');
  const airframes = [];
  for (const entry of await readDir(airplanesRoot)) {
    if (!entry.isDirectory()) continue;
    const frame = await readAirframe(path.join(airplanesRoot, entry.name), entry.name, resolve);
    // Skip AI-traffic-only airframes and shared model/sound folders that
    // declare neither an aircraft nor a livery.
    if (frame.aiOnly) continue;
    if (!frame.hasBase && !frame.liveries.length) continue;
    airframes.push(frame);
  }

  const contentType = String((manifest && manifest.content_type) || '').toUpperCase();
  const isAircraftLike = airframes.length > 0 || contentType === 'AIRCRAFT' || contentType === 'LIVERY';
  if (!isAircraftLike) return null;

  const packageThumbnail = await firstExisting(path.join(pkgDir, 'ContentInfo', folderName), [
    'Thumbnail.jpg',
    'Thumbnail.png',
    'thumbnail.jpg',
    'thumbnail.png',
  ]);

  return {
    folderName,
    dir: pkgDir,
    source,
    sourceLabel: label,
    sealed: false,
    contentType: contentType || 'UNKNOWN',
    title: (manifest && manifest.title) || folderName,
    manufacturer: (manifest && manifest.manufacturer) || undefined,
    creator: (manifest && manifest.creator) || undefined,
    version: (manifest && manifest.package_version) || undefined,
    packageThumbnail,
    // A package that ships several aircraft has one shared ContentInfo image,
    // which is wrong for all but one of them (Just Flight's PA28 pack shows
    // the Turbo Arrow III for both the III and the IV).
    airframeCount: airframes.length,
    airframes,
  };
}

module.exports = { scanPackage, readAirframe };
