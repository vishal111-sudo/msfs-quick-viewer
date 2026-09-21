'use strict';

// Turns the free-text fields MSFS packages carry (`ui_typerole`, `Category`,
// `icao_engine_type`, folder names) into a small fixed set of facets the UI
// can filter on. Add-on authors type these by hand, so everything here is
// best-effort pattern matching with a sane fallback.

const CATEGORIES = [
  'Airliner',
  'Business Jet',
  'Cargo',
  'Turboprop',
  'Piston',
  'Glider',
  'Helicopter',
  'Military',
  'Vintage',
  'Ultralight',
  'Other',
];

const ENGINE_TYPES = ['Jet', 'Turboprop', 'Piston', 'Turbine', 'Electric', 'None', 'Unknown'];

function normaliseEngineType(raw) {
  const value = String(raw || '').toLowerCase();
  if (!value) return 'Unknown';
  if (value.includes('jet')) return 'Jet';
  if (value.includes('turboprop') || value.includes('turbo prop')) return 'Turboprop';
  if (value.includes('piston')) return 'Piston';
  if (value.includes('turbine') || value.includes('turboshaft')) return 'Turbine';
  if (value.includes('electric')) return 'Electric';
  if (value.includes('none') || value.includes('unpowered') || value.includes('glider')) return 'None';
  return 'Unknown';
}

const MILITARY_HINTS = [
  'f-14', 'f-15', 'f-16', 'f-18', 'f-22', 'f-35', 'f4u', 'f6f', 'p-51', 'p51',
  'spitfire', 'hurricane', 'mustang', 'a-10', 'a10', 'c-17', 'c17', 'c-130',
  'kc-135', 'a400m', 'harrier', 'typhoon', 'rafale', 'mig', 'sukhoi', 'tornado',
  't-6', 't6 texan', 'bf109', 'me262', 'corsair', 'warbird', 'military',
];

const VINTAGE_HINTS = [
  'ju52', 'junkers', 'dc-3', 'dc3', 'c47', 'c-47', 'staggerwing', 'geebee',
  'gee bee', 'd18', 'beech 18', 'ford tri', 'trimotor', 'spirit of st',
  'wright flyer', 'aero 45', 'dox', 'do-x', 'fw200', 'saab 17', 'vintage',
];

const BIZJET_HINTS = [
  'citation', 'learjet', 'gulfstream', 'global 7500', 'challenger 3', 'praetor',
  'phenom', 'legacy 600', 'hondajet', 'vision jet', 'sf50', 'tbm 9', 'pilatus pc-24',
  'bbj', 'acj', 'business jet', 'longitude', 'latitude',
];

const ULTRALIGHT_HINTS = ['ultralight', 'trike', 'paraglider', 'paramotor', 'gyrocopter', 'autogyro'];

function matchesAny(haystack, hints) {
  return hints.some((hint) => haystack.includes(hint));
}

/**
 * Pick one primary category for an aircraft.
 *
 * @param {object} facts
 * @param {string} [facts.typeRole]    raw `ui_typerole`
 * @param {string} [facts.category]    raw `Category` (airplane/helicopter/glider/...)
 * @param {string} [facts.engineType]  normalised engine type
 * @param {number} [facts.engineCount]
 * @param {string} [facts.wtc]         ICAO wake turbulence category L/M/H/J
 * @param {string} [facts.name]        title + manufacturer + model, for keyword hints
 */
function categorise(facts = {}) {
  const role = String(facts.typeRole || '').toLowerCase();
  const simCategory = String(facts.category || '').toLowerCase();
  const engine = facts.engineType || 'Unknown';
  const engineCount = Number(facts.engineCount) || 0;
  const wtc = String(facts.wtc || '').toUpperCase();
  const name = String(facts.name || '').toLowerCase();

  if (simCategory.includes('helicopter') || simCategory.includes('rotor') || role.includes('rotor') || role.includes('helicopter')) {
    return 'Helicopter';
  }
  if (simCategory.includes('glider') || simCategory.includes('sailplane') || role.includes('glider') || role.includes('sailplane') || engine === 'None') {
    return 'Glider';
  }
  if (matchesAny(name, ULTRALIGHT_HINTS)) return 'Ultralight';
  if (matchesAny(name, MILITARY_HINTS)) return 'Military';
  if (matchesAny(name, VINTAGE_HINTS)) return 'Vintage';
  if (role.includes('cargo') || role.includes('freight')) return 'Cargo';
  if (matchesAny(name, BIZJET_HINTS)) return 'Business Jet';
  if (role.includes('airliner')) return 'Airliner';

  if (engine === 'Jet') {
    // Only light-wake jets are small enough to be business jets by default;
    // the named bizjet families above already caught the medium-wake ones
    // (Citation, Gulfstream, Global), so a medium jet here is an airliner.
    return wtc === 'L' ? 'Business Jet' : 'Airliner';
  }
  if (engine === 'Turboprop' || engine === 'Turbine') return 'Turboprop';
  if (engine === 'Piston') return 'Piston';

  if (role.includes('turboprop')) return 'Turboprop';
  if (role.includes('prop')) return 'Piston';
  if (role.includes('jet')) return engineCount >= 2 && wtc === 'H' ? 'Airliner' : 'Business Jet';

  return 'Other';
}

/** Human label for how many engines of what kind, e.g. "Twin Jet". */
function engineLabel(engineType, engineCount) {
  const count = Number(engineCount) || 0;
  const words = { 1: 'Single', 2: 'Twin', 3: 'Tri', 4: 'Quad' };
  const prefix = words[count];
  if (!prefix || engineType === 'Unknown' || engineType === 'None') return engineType;
  return `${prefix} ${engineType}`;
}

const SIZE_BY_WTC = { L: 'Light', M: 'Medium', H: 'Heavy', J: 'Super' };

function sizeFromWtc(wtc) {
  return SIZE_BY_WTC[String(wtc || '').toUpperCase()] || 'Unknown';
}

module.exports = {
  CATEGORIES,
  ENGINE_TYPES,
  normaliseEngineType,
  categorise,
  engineLabel,
  sizeFromWtc,
};
