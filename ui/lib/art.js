// Artwork state shared by the grid, the detail panel and the photo sweep.
//
// A tiny external store rather than React state: a photo landing should
// re-render the one card showing it, not the whole grid, so each card
// subscribes to its own aircraft through useArt().

import { useSyncExternalStore } from 'react';

const api = window.api;

/** aircraft id -> art record, or null once a lookup came back empty */
const art = new Map();
/**
 * aircraft id -> promise of the lookup already running. A promise rather than
 * a flag so a second caller waits for the first instead of assuming it: the
 * old renderer returned early here, which let the sweep declare itself done
 * while lookups were still outstanding.
 */
const inFlight = new Map();
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

export const artStore = {
  get: (id) => art.get(id),
  has: (id) => art.has(id),
  set(id, value) {
    art.set(id, value);
    emit();
  },
  delete(id) {
    art.delete(id);
    emit();
  },
  /** Start again from what the scan already resolved from the cache. */
  reset(aircraft) {
    art.clear();
    for (const a of aircraft || []) if (a.art) art.set(a.id, a.art);
    emit();
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The current art for one aircraft; re-renders only when that changes. */
export function useArt(aircraftId) {
  return useSyncExternalStore(artStore.subscribe, () => art.get(aircraftId));
}

/** Whether a lookup for this aircraft has finished, found or not. */
export function useLookedUp(aircraftId) {
  return useSyncExternalStore(artStore.subscribe, () => art.has(aircraftId));
}

export async function requestArt(aircraftId, { force = false } = {}) {
  if (!aircraftId) return null;
  if (!force && art.has(aircraftId)) return art.get(aircraftId);

  const running = inFlight.get(aircraftId);
  if (running && !force) return running;

  const lookup = (async () => {
    try {
      const found = await api.getArt(aircraftId, force ? { force: true } : undefined);
      artStore.set(aircraftId, found || null);
      return found || null;
    } catch {
      artStore.set(aircraftId, null);
      return null;
    } finally {
      inFlight.delete(aircraftId);
    }
  })();
  inFlight.set(aircraftId, lookup);
  return lookup;
}

/* ---------- background sweep ---------- */

/**
 * Looks up a photo for everything the grid cannot fill from disk, one at a
 * time, so a card scrolled into view can be served in between. `token` lets a
 * rescan or a source change abandon a sweep already in flight.
 */
const sweep = { token: 0, ids: [], total: 0, running: false, startedAt: 0 };
let sweepSnapshot = { running: false, total: 0, done: 0, startedAt: 0 };
const sweepListeners = new Set();

function publishSweep() {
  // Counted from what has resolved, not from how far the loop has got: cards
  // scrolled into view are served ahead of the sweep, and counting the loop
  // left the old progress bar at 0 while photos visibly arrived.
  const done = sweep.ids.filter((id) => art.has(id)).length;
  sweepSnapshot = { running: sweep.running, total: sweep.total, done, startedAt: sweep.startedAt };
  for (const listener of sweepListeners) listener();
}

artStore.subscribe(() => {
  if (sweep.running) publishSweep();
});

export function useSweep() {
  return useSyncExternalStore(
    (listener) => {
      sweepListeners.add(listener);
      return () => sweepListeners.delete(listener);
    },
    () => sweepSnapshot,
  );
}

export function stopSweep() {
  sweep.token += 1;
  sweep.running = false;
  publishSweep();
}

/**
 * @param {object[]} aircraft every aircraft in the scan
 * @param {string} artSource
 * @returns {Promise<number|null>} photos found, or null if abandoned
 */
export async function startSweep(aircraft, artSource) {
  sweep.token += 1;
  const token = sweep.token;

  if (artSource === 'off') {
    sweep.running = false;
    publishSweep();
    return null;
  }

  const pending = aircraft.filter((a) => !a.thumbnailUrl && !art.has(a.id));
  sweep.ids = pending.map((a) => a.id);
  sweep.total = pending.length;
  sweep.startedAt = Date.now();
  sweep.running = pending.length > 0;
  publishSweep();
  if (!sweep.running) return 0;

  for (const a of pending) {
    if (token !== sweep.token) return null;
    if (!art.has(a.id)) await requestArt(a.id);
  }
  if (token !== sweep.token) return null;

  sweep.running = false;
  publishSweep();
  return pending.filter((a) => art.get(a.id)).length;
}
