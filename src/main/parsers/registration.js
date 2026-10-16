'use strict';

// Aircraft registrations (tail numbers) found in livery names.
//
// FS2020-style liveries declare one as `atc_id`, but FS2024 livery folders
// usually do not: Synaptic's Delta A220 pack calls its livery "Delta A220-300"
// in livery.cfg, and the tail number N324DU is only in the folder name. For
// airline paint that is often the one thing telling two liveries apart.
//
// The shapes matched are deliberately narrow, because aircraft model names
// look a lot like registrations: PA-28R-201T, A220-300, F-16, MD-11, KC-135
// and C-172 must not match. Two formats cover nearly every civil register:
//
//   N-numbers (USA):        N324DU, N6229P, N822JH
//   prefix, hyphen, mark:   C-FPLS, G-OBAK, HB-PMB, CS-TON, VT-PPM, A7-AHA
//
// and the mark after the hyphen must start with a letter. That is what
// separates a civil registration from a model or military designation:
// "-300", "-135" and "-47D" (CH-47D, AH-64D, KC-135R) all start with a digit.
// It gives up purely numeric marks such as China's B-1234, which are rare in
// livery names; a missed registration costs nothing, a wrong one misleads.

const PATTERNS = [
  // N + a non-zero digit, up to four more digits, up to two letters.
  /(?<![A-Z0-9/-])(N[1-9][0-9]{0,4}[A-Z]{0,2})(?![A-Z0-9-])/,
  // One or two letters, or a letter and a digit, then a hyphen and a
  // 3-5 character mark starting with a letter. Not after a slash: F/A-18E.
  /(?<![A-Z0-9/-])((?:[A-Z]{1,2}|[A-Z][0-9])-[A-Z][A-Z0-9]{2,4})(?![A-Z0-9-])/,
];

/**
 * The first registration-shaped token in any of the given strings, checked in
 * order, so put the most specific source (the folder name) first.
 *
 * @param {...(string|undefined)} sources
 * @returns {string|undefined}
 */
function findRegistration(...sources) {
  for (const source of sources) {
    if (!source) continue;
    const text = String(source).toUpperCase().replace(/_/g, ' ');
    for (const pattern of PATTERNS) {
      const match = pattern.exec(text);
      // An N-number needs at least four characters: "N1" is an engine
      // parameter as often as it is anything else.
      if (match && match[1].length >= 4) return match[1];
    }
  }
  return undefined;
}

// Military serials, which warbird liveries legitimately carry instead of a
// civil registration: BF273, EN479, ML214 (RAF), A58-602 (RAAF).
const SERIAL = [/^[A-Z]{1,3}[0-9]{2,5}[A-Z]?$/, /^[A-Z][0-9]{1,2}-[0-9]{2,4}$/];

/**
 * The registration to show for a livery.
 *
 * A declared `atc_id` cannot be trusted as-is. Across one real library it
 * held the ICAO type (iFly: "B38M"), callsigns ("IRONCAT", "ASXGS"),
 * "Custom", and fragments ("SAB" on a livery named "ZK-SAB"). So a proper
 * registration found anywhere wins, the declared value included; failing
 * that, a declared value is kept only if it has the shape of a military
 * serial and is not simply the aircraft's type designator.
 *
 * @param {string|undefined} declared the livery's atc_id, if any
 * @param {Array<string|undefined>} sources names to search, most specific first
 * @param {string} [icaoType] the aircraft's type designator, to reject
 */
function pickRegistration(declared, sources, icaoType) {
  const found = findRegistration(declared, ...sources);
  if (found) return found;
  const mark = String(declared || '').trim().toUpperCase();
  if (!mark || (icaoType && mark === String(icaoType).trim().toUpperCase())) return undefined;
  return SERIAL.some((pattern) => pattern.test(mark)) ? mark : undefined;
}

module.exports = { findRegistration, pickRegistration };
