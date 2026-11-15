// Display strings. Plain functions so they can be tested without a browser.

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A value for a details table, with a dash for anything missing. */
export function orDash(value) {
  return value === undefined || value === null || value === '' ? '—' : String(value);
}

export function installLabel(install) {
  if (install.sim === 'Custom') return 'Your folder';
  return `${String(install.sim).replace('MSFS', 'MSFS ')} · ${install.store}`;
}

/**
 * What a card with no picture says. "Looking" while photos are switched off
 * would be a lie, and "looking" after a lookup came back empty is another.
 *
 * @param {object} aircraft
 * @param {string} artSource
 * @param {boolean} lookedUp a lookup for this aircraft has finished
 */
export function placeholderLabel(aircraft, artSource, lookedUp) {
  if (!aircraft.sealed) return 'No thumbnail';
  if (artSource === 'off') return 'Photos are off';
  return lookedUp ? 'No photo found' : 'Looking for a photo…';
}

/**
 * "about 3 min left", measured from the sweep so far; null until there is
 * enough data for the average to mean anything.
 */
export function sweepEstimate({ done, total, startedAt }, now = Date.now()) {
  if (done < 4 || done >= total) return null;
  const perItem = (now - startedAt) / done;
  const remainingMs = perItem * (total - done);
  if (remainingMs < 45_000) return 'under a minute left';
  return `about ${Math.round(remainingMs / 60_000)} min left`;
}

/**
 * The version line for the details table. Names the package it came from
 * when there is more than one, since livery packs carry versions of their own.
 */
export function versionLabel(aircraft) {
  if (aircraft.version) {
    return aircraft.packages.length > 1 ? `${aircraft.version}  ·  ${aircraft.versionPackage}` : aircraft.version;
  }
  return aircraft.sealed ? 'Updates with the sim' : null;
}

/** The first few airport codes for a card; the panel lists them all. */
export function airportCodes(pkg, limit = 3) {
  const codes = pkg.airports.map((airport) => airport.ident).filter(Boolean);
  if (codes.length <= limit) return codes.join(' ');
  return `${codes.slice(0, limit).join(' ')} +${codes.length - limit}`;
}

export function formatCoordinates({ lat, lon }) {
  const part = (value, positive, negative) => `${Math.abs(value).toFixed(3)}° ${value >= 0 ? positive : negative}`;
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`;
}

/** Why a status reads as it does, when that is not obvious. */
export function statusNote(status) {
  if (status !== 'Not recorded') return null;
  return "The sim's Content.xml has no entry for this package, so its state is unknown. Packages added since that file was last saved look like this. The sim loads what is in Community, so it is treated as active.";
}
