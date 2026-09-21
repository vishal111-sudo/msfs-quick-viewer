'use strict';

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { JsonStore } = require('./store');
const { getSource, DEFAULT_SOURCE } = require('./art-sources');

// Aircraft that only exist as encrypted StreamedPackages have no thumbnail on
// disk, so the only way to show a picture is to fetch one. Wikipedia is used
// because it has an article for essentially every real aircraft type, a stable
// public API, and freely licensed images with a citable source.
//
// Everything is cached to disk and only fetched once per aircraft; a failed
// lookup is cached too, so a miss does not re-hit the API on every launch.

const USER_AGENT =
  'MSFS-Quick-Viewer/0.1 (local desktop app; https://github.com/; contact: via app repository)';
const THUMB_SIZE = 900;
const REQUEST_TIMEOUT_MS = 12000;
const POLITE_DELAY_MS = 350;
/** Added to the gap after a rate limit, and decayed once traffic is accepted. */
const PENALTY_STEP_MS = 1500;
const MAX_PENALTY_MS = 6000;
/** A genuine "no article has a picture of this" answer is worth remembering. */
const RETRY_MISSING_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A network error or a rate limit is transient — retry it soon. */
const RETRY_ERROR_AFTER_MS = 10 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 5000;
/**
 * Bump when a change invalidates what is already cached.
 *   2 — added the check that a matched article is actually about an aircraft.
 *   3 — aircraft ids gained a preset suffix, so old entries address nothing.
 *   4 — entries are keyed per source, so each source caches independently.
 */
const CACHE_VERSION = 4;

const EXTENSION_BY_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function hashId(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown for failures worth retrying soon rather than caching for a week. */
class TransientError extends Error {}

const MAX_ATTEMPTS = 3;

/**
 * Fetch that retries when the API rate-limits us, and reports the rate limit
 * back so the caller can slow the whole queue down rather than just this one
 * request.
 *
 * @param {(retryAfterMs: number) => void} [onRateLimit]
 */
async function politeFetch(url, accept, onRateLimit) {
  const headers = { 'User-Agent': USER_AGENT };
  if (accept) headers.Accept = accept;

  let lastError = new TransientError('retry exhausted');
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      // Connection resets and timeouts are worth one more try.
      lastError = new TransientError(err.name === 'TimeoutError' ? 'timed out' : 'fetch failed');
      if (attempt === MAX_ATTEMPTS - 1) throw lastError;
      await delay(1000 * (attempt + 1));
      continue;
    }

    if (response.ok) return response;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable) throw new Error(`HTTP ${response.status}`);

    const header = Number(response.headers.get('retry-after'));
    const wait = Number.isFinite(header) && header > 0 ? Math.min(header * 1000, MAX_RETRY_AFTER_MS) : 1500;
    if (onRateLimit) onRateLimit(wait);

    lastError = Object.assign(new TransientError(`HTTP ${response.status}`), { status: response.status });
    if (attempt === MAX_ATTEMPTS - 1) throw lastError;
    await delay(wait * (attempt + 1));
  }
  throw lastError;
}

async function requestJson(url, onRateLimit) {
  const response = await politeFetch(url, 'application/json', onRateLimit);
  return response.json();
}

/** Corporate noise that never appears in an article title. */
const COMPANY_SUFFIX =
  /\b(?:corporation|corp|company|inc|incorporated|ltd|limited|gmbh|simulations|simulation|sims)\b\.?/gi;

/** Variant tags add-on authors append, which only dilute a search. */
const VARIANT_TAG =
  /\s*\((?:reno|enhanced|classic|g1000|as1000|modern|floats|skis|wheels|amphibian|cargo pod|clipped wings|\d+\s*seats?)\)\s*/gi;

/**
 * Build the Wikipedia search phrase for an aircraft. Manufacturer plus model
 * is far more precise than either alone ("340" vs "Saab 340").
 */
function buildQuery(aircraft) {
  if (aircraft.wiki) return aircraft.wiki;

  // An add-on's own name is a product name, not an aircraft name. When the
  // cfg declared ICAO fields, they identify the real aircraft far better.
  const useIcao = Boolean(aircraft.icaoManufacturer && aircraft.icaoModel);
  const name = String((useIcao ? aircraft.icaoModel : aircraft.shortName || aircraft.name) || '').trim();
  const manufacturer = String((useIcao ? aircraft.icaoManufacturer : aircraft.manufacturer) || '').trim();

  // Only prepend the manufacturer when the name does not already start with
  // it, or the query becomes "Beechcraft Corporation Beechcraft Corporation
  // D18S Twin Beech" — which matched a chemistry article.
  const firstWord = manufacturer.split(/\s+/)[0].toLowerCase();
  const alreadyPrefixed = firstWord && name.toLowerCase().startsWith(firstWord);
  const query = alreadyPrefixed ? name : [manufacturer, name].filter(Boolean).join(' ');

  return query
    .replace(VARIANT_TAG, ' ')
    .replace(COMPANY_SUFFIX, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Manages the on-disk artwork cache and the user's manual overrides. */
class ArtCache {
  constructor(userDataDir, sourceId = DEFAULT_SOURCE) {
    this.sourceId = sourceId;
    this.dir = path.join(userDataDir, 'art-cache');
    this.overridesDir = path.join(userDataDir, 'art-overrides');
    this.index = new JsonStore(path.join(this.dir, 'index.json'), { version: CACHE_VERSION, entries: {} });
    // Every outbound request runs through this chain, one at a time with a
    // gap between them. Without it, a screenful of cards fires dozens of
    // parallel requests and the API answers 429 for most of them.
    this.queue = Promise.resolve();
    /** Extra delay currently applied after a rate limit; decays on success. */
    this.penaltyMs = 0;
  }

  async init() {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.mkdir(this.overridesDir, { recursive: true });
    this.index.load();

    if (this.index.get('version') !== CACHE_VERSION) {
      // Manual overrides live in a separate folder and are never discarded.
      await this.clear();
      await this.index.set({ version: CACHE_VERSION });
    }

    await this.pruneOrphans();
  }

  /**
   * Delete cached images the index no longer points at. A crash between
   * writing an image and recording it leaves the file behind, and it would
   * otherwise sit there forever taking up space nothing can find.
   */
  async pruneOrphans() {
    const referenced = new Set(
      Object.values(this.index.get('entries'))
        .map((entry) => entry && entry.file)
        .filter(Boolean),
    );

    let removed = 0;
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name === 'index.json' || referenced.has(name)) continue;
      await fsp.rm(path.join(this.dir, name), { force: true });
      removed += 1;
    }
    return removed;
  }

  /** Which photo source new lookups should use. */
  setSource(sourceId) {
    this.sourceId = sourceId || DEFAULT_SOURCE;
  }

  /** Cache entries are namespaced per source so switching never loses either. */
  entryKey(aircraftId) {
    return `${this.sourceId}::${aircraftId}`;
  }

  entry(aircraftId) {
    return this.index.get('entries')[this.entryKey(aircraftId)] || null;
  }

  /**
   * Record one result.
   *
   * The entries map is mutated in place rather than copied. Many art lookups
   * are in flight at once, and a copy-then-write loses every entry another
   * lookup added in between — which silently emptied the cache, so the grid
   * refetched every photo on every launch.
   */
  async putEntry(aircraftId, value) {
    const entries = this.index.get('entries');
    entries[this.entryKey(aircraftId)] = value;
    await this.index.set({ entries });
  }

  /** A user-supplied image always wins over anything fetched. */
  async findOverride(aircraftId) {
    const base = hashId(aircraftId);
    for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
      const file = path.join(this.overridesDir, base + extension);
      try {
        await fsp.access(file);
        return file;
      } catch {
        /* try the next extension */
      }
    }
    return null;
  }

  /** Copy `sourceFile` in as the override image for this aircraft. */
  async setOverride(aircraftId, sourceFile) {
    const existing = await this.findOverride(aircraftId);
    if (existing) await fsp.rm(existing, { force: true });

    const extension = path.extname(sourceFile).toLowerCase() || '.png';
    const target = path.join(this.overridesDir, hashId(aircraftId) + extension);
    await fsp.copyFile(sourceFile, target);
    return target;
  }

  /** Store raw image bytes as the override, e.g. an image off the clipboard. */
  async setOverrideFromBuffer(aircraftId, buffer, extension = '.png') {
    const existing = await this.findOverride(aircraftId);
    if (existing) await fsp.rm(existing, { force: true });

    const target = path.join(this.overridesDir, hashId(aircraftId) + extension);
    await fsp.writeFile(target, buffer);
    return target;
  }

  async clearOverride(aircraftId) {
    const existing = await this.findOverride(aircraftId);
    if (existing) await fsp.rm(existing, { force: true });
    return Boolean(existing);
  }

  /** Cached result for an aircraft, without touching the network. */
  async lookupCached(aircraftId) {
    const override = await this.findOverride(aircraftId);
    if (override) return { file: override, origin: 'override' };

    const entry = this.entry(aircraftId);
    if (!entry || !entry.file) return null;

    const file = path.join(this.dir, entry.file);
    try {
      await fsp.access(file);
    } catch {
      return null;
    }
    return { ...entry, file, origin: 'online' };
  }

  /** True when we already tried and failed recently enough to not retry. */
  isNegativeCached(aircraftId) {
    const entry = this.entry(aircraftId);
    if (!entry || entry.file) return false;
    const window = entry.transient ? RETRY_ERROR_AFTER_MS : RETRY_MISSING_AFTER_MS;
    return Date.now() - (entry.fetchedAt || 0) < window;
  }

  /** Back the whole queue off after the API says we are going too fast. */
  noteRateLimit(retryAfterMs) {
    this.penaltyMs = Math.min(this.penaltyMs + Math.max(PENALTY_STEP_MS, retryAfterMs || 0), MAX_PENALTY_MS);
  }

  /** Ease back towards full speed once requests are being accepted again. */
  noteSuccess() {
    this.penaltyMs = Math.max(0, this.penaltyMs - PENALTY_STEP_MS / 4);
  }

  /** Run `task` after every already-queued request, then pause politely. */
  enqueue(task) {
    const result = this.queue.then(async () => {
      if (this.penaltyMs) await delay(this.penaltyMs);
      const value = await task();
      this.noteSuccess();
      return value;
    });
    const pause = () => delay(POLITE_DELAY_MS);
    this.queue = result.then(pause, pause);
    return result;
  }

  /**
   * Fetch artwork for one aircraft, using the cache when possible.
   * @param {object} aircraft record from the scanner
   * @param {object} [options]
   * @param {boolean} [options.force] ignore the cache and re-fetch
   */
  async fetchFor(aircraft, options = {}) {
    const cached = await this.lookupCached(aircraft.id);
    if (cached && !options.force) return cached;
    if (!options.force && this.isNegativeCached(aircraft.id)) return null;

    const query = buildQuery(aircraft);
    if (!query) return null;

    try {
      const onRateLimit = (wait) => this.noteRateLimit(wait);
      const source = getSource(this.sourceId);
      const context = {
        thumbSize: THUMB_SIZE,
        requestJson: (url) => requestJson(url, onRateLimit),
      };

      // The catalog knows the exact article for stock aircraft, which beats
      // any search — but only Wikipedia can be addressed by title.
      let found =
        aircraft.wiki && source.supportsExactTitle
          ? await this.enqueue(() => source.find(query, { ...context, exactTitle: true }))
          : null;
      if (!found) found = await this.enqueue(() => source.find(query, context));
      if (!found) {
        await this.putEntry(aircraft.id, { file: null, query, fetchedAt: Date.now() });
        return null;
      }

      const response = await this.enqueue(() => politeFetch(found.imageUrl, undefined, onRateLimit));

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();
      const extension = EXTENSION_BY_TYPE[contentType] || path.extname(new URL(found.imageUrl).pathname) || '.jpg';
      const fileName = hashId(this.entryKey(aircraft.id)) + extension;
      const buffer = Buffer.from(await response.arrayBuffer());
      await fsp.writeFile(path.join(this.dir, fileName), buffer);

      const entry = {
        file: fileName,
        query,
        source: this.sourceId,
        pageTitle: found.pageTitle,
        description: found.description,
        attribution: found.attribution,
        license: found.license,
        pageUrl: found.pageUrl,
        filePageUrl: found.filePageUrl || null,
        fetchedAt: Date.now(),
      };
      await this.putEntry(aircraft.id, entry);
      return { ...entry, file: path.join(this.dir, fileName), origin: 'online' };
    } catch (err) {
      await this.putEntry(aircraft.id, {
        file: null,
        query,
        error: err.message,
        // Rate limits, timeouts and offline launches must not poison the
        // cache for a week the way a genuine miss does.
        transient: err instanceof TransientError || err.name === 'TimeoutError' || /fetch failed/i.test(err.message),
        fetchedAt: Date.now(),
      });
      return null;
    }
  }

  /** Total bytes held in the fetched-art cache. */
  async size() {
    let bytes = 0;
    let files = 0;
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name === 'index.json') continue;
      const stat = await fsp.stat(path.join(this.dir, name)).catch(() => null);
      if (stat && stat.isFile()) {
        bytes += stat.size;
        files += 1;
      }
    }
    return { bytes, files };
  }

  async clear() {
    for (const name of await fsp.readdir(this.dir).catch(() => [])) {
      if (name === 'index.json') continue;
      await fsp.rm(path.join(this.dir, name), { force: true });
    }
    await this.index.set({ version: CACHE_VERSION, entries: {} });
  }
}

module.exports = { ArtCache, buildQuery };
