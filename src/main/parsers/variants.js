'use strict';

// Several add-ons ship more than one aircraft inside a single
// `SimObjects/Airplanes/<Model>` folder, as sibling presets:
//
//   Fenix    FNX_32X       -> "A319 | CFM | SL", "A320 | IAE | WF", "A321 | ..."
//   PMDG     PMDG 737-800  -> "737-800 | PAX | BW", "737-800BCF | BW", "737-800 BBJ2 | SSW"
//   iniBuilds A350         -> "A350-1000", "A350-900", "A350-900 ULR (No Cabin)"
//
// Those are separate aircraft in the sim's aircraft selector, so they need to
// be separate cards. This module decides where a preset splits (the base model
// name) and which of the resulting groups a livery belongs to.

// Equipment choices: the same aeroplane fitted differently. These collapse
// into one card, because a 777-200ER with RR engines is a 777-200ER.
const EQUIPMENT_WORDS = new Set([
  // engines
  'ge', 'pw', 'rr', 'cfm', 'iae', 'genx', 'trent', 'psc', 'pwc',
  // wingtips
  'wl', 'sl', 'wf', 'ssw', 'bw', 'winglets', 'sharklets',
  // range and interior detail levels
  'ulr', 'lr', 'hgw', 'cabin', 'hd', 'sd', 'sc', 'tc',
  // undercarriage and fittings — SimWorks' Kodiak ships every combination of
  // these as its own preset folder
  'amphibian', 'amphib', 'floats', 'float', 'skis', 'ski', 'wheels', 'wheel',
  'tundra', 'normal', 'standard', 'cp', 'nocp', 'pod', 'cargopod',
]);

// Roles: what the aircraft is for. A freighter is not a passenger aircraft
// even when it shares an airframe and an ICAO type, so these always split.
const ROLE_WORDS = new Set([
  'freighter', 'cargo', 'combi', 'tanker', 'passenger', 'pax',
  'vip', 'executive', 'bbj', 'bbj1', 'bbj2', 'bbj3', 'acj',
  'bcf', 'bdsf', 'p2f', 'sf',
]);

/** Role codes authors glue onto the designation: `737-800BCF`. */
const ATTACHED_ROLE = /^(.*\d)(bcf|bdsf|p2f|sf)$/i;

function normaliseWord(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The aircraft's role, when its name declares one. Used to keep a freighter
 * apart from the passenger aircraft it was converted from — iniBuilds gives
 * the A340-300, its Freighter and its VIP all the same `A343` ICAO type, so
 * the type designator alone would merge them.
 *
 * @returns {string} '' when the name states no role
 */
function roleOf(model) {
  const words = String(model || '').split(/\s+/).filter(Boolean);
  if (!words.length) return '';

  const last = normaliseWord(words[words.length - 1]);
  if (ROLE_WORDS.has(last)) return last;

  const attached = ATTACHED_ROLE.exec(last);
  return attached ? attached[2].toLowerCase() : '';
}

/**
 * The aircraft's designation, with equipment choices removed but its role
 * kept:
 *
 *   "777-200ER GE"       -> "777-200ER"            "A350-900 ULR" -> "A350-900"
 *   "A340-300 Freighter" -> "A340-300 Freighter"   "737-800BCF"   -> "737-800BCF"
 *   "A319"               -> "A319"                 "737 MAX"      -> "737 MAX"
 *
 * Only the curated equipment list is ever stripped, so a name like "737 MAX"
 * is untouched — "MAX" is part of the designation, not a fitting.
 */
function designationOf(model) {
  let words = String(model || '').split(/\s+/).filter(Boolean);

  while (words.length > 1 && EQUIPMENT_WORDS.has(normaliseWord(words[words.length - 1]))) {
    words = words.slice(0, -1);
  }
  return words.join(' ').trim();
}

/** ICAO designators sometimes carry a suffix of the author's own ("A359 ULR"). */
function icaoKeyOf(icaoType) {
  const first = String(icaoType || '').trim().split(/\s+/)[0];
  return first ? first.toUpperCase() : '';
}

/** Everything after a `|` or inside trailing brackets is configuration detail. */
function baseModelOf(model) {
  return String(model || '')
    .replace(/_/g, ' ')
    .split('|')[0]
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Configuration tags a preset carries beyond its base model, e.g. "CFM · SL". */
function variantTagsOf(model) {
  const parts = String(model || '')
    .split('|')
    .slice(1)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(' · ') || null;
}

function longestCommonPrefix(values) {
  if (!values.length) return '';
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * What distinguishes each group from its siblings, used to read developer
 * specific livery tags. PMDG's groups normalise to `737800`, `737800bcf`,
 * `737800bdsf`, `737800bbj2`, giving discriminators ``, `bcf`, `bdsf`, `bbj2`
 * — which is exactly what its `b738bcf_ext` style tags contain.
 */
function discriminators(groupKeys) {
  const prefix = groupKeys.length > 1 ? longestCommonPrefix(groupKeys) : '';
  return groupKeys.map((key) => key.slice(prefix.length));
}

/**
 * Pick which group a livery belongs to.
 *
 * @param {{key: string, matchKey?: string}[]} groups
 * @param {object} hints
 * @param {string[]} [hints.tags]         `[Selection] required_tags` entries
 * @param {string}   [hints.variantModel] the `ui_type` of an FS2020 livery
 * @returns {number} index into `groups`, or -1 when nothing matches
 */
function chooseGroup(groups, hints = {}) {
  if (groups.length === 0) return -1;
  if (groups.length === 1) return 0;

  // The identity key carries a role marker; matching against livery tags uses
  // the plain normalised name instead.
  const keyOf = (group) => group.matchKey || group.key;

  // An FS2020 `[FLTSIM.n]` livery names its own aircraft outright.
  if (hints.variantModel) {
    const wanted = normalise(baseModelOf(hints.variantModel));
    const exact = groups.findIndex((group) => keyOf(group) === wanted);
    if (exact !== -1) return exact;
  }

  const tags = (hints.tags || []).map(normalise).filter(Boolean);
  if (!tags.length) return -1;

  // Fenix tags the model outright: "A319,CFM,SL".
  const exact = groups.findIndex((group) => tags.includes(keyOf(group)));
  if (exact !== -1) return exact;

  // Otherwise look for the part that distinguishes the groups from each other,
  // longest first so `bdsf` cannot be beaten by a shorter partial match.
  const marks = discriminators(groups.map(keyOf));
  const joined = tags.join(' ');
  const ranked = marks
    .map((mark, index) => ({ mark, index }))
    .filter((entry) => entry.mark)
    .sort((a, b) => b.mark.length - a.mark.length);

  for (const entry of ranked) {
    if (joined.includes(entry.mark)) return entry.index;
  }

  // A tag set that matches no discriminator belongs to the plain variant, if
  // there is one (PMDG's `b738_ext` against 737-800 / BCF / BDSF / BBJ2).
  const plain = marks.findIndex((mark) => !mark);
  return plain;
}

module.exports = {
  baseModelOf,
  designationOf,
  roleOf,
  icaoKeyOf,
  variantTagsOf,
  normalise,
  chooseGroup,
  discriminators,
};
