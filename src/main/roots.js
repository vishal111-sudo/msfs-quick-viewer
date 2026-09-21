'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Where each sim edition keeps UserCfg.opt / Content.xml. Steam and MS Store
// installs differ, and MSFS 2020 and 2024 can both be present.
const APP_DATA_CANDIDATES = [
  {
    sim: 'MSFS2024',
    store: 'Steam',
    dir: path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft Flight Simulator 2024'),
  },
  {
    sim: 'MSFS2024',
    store: 'MS Store',
    dir: path.join(
      os.homedir(),
      'AppData',
      'Local',
      'Packages',
      'Microsoft.Limitless_8wekyb3d8bbwe',
      'LocalCache',
    ),
  },
  {
    sim: 'MSFS2020',
    store: 'Steam',
    dir: path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft Flight Simulator'),
  },
  {
    sim: 'MSFS2020',
    store: 'MS Store',
    dir: path.join(
      os.homedir(),
      'AppData',
      'Local',
      'Packages',
      'Microsoft.FlightSimulator_8wekyb3d8bbwe',
      'LocalCache',
    ),
  },
];

// Sub-folders of the packages root, and what kind of content each holds.
// `sealed` means the package contents are encrypted .fsarchive blobs, so only
// the folder name is readable.
const PACKAGE_DIRS = [
  { name: 'Community', source: 'Community', sealed: false },
  { name: 'Community2024', source: 'Community', sealed: false },
  { name: 'StreamedPackages', source: 'Streamed', sealed: true },
  { name: 'Official', source: 'Official', sealed: false, nested: true },
  { name: 'Official2020', source: 'Official', sealed: false, nested: true },
  { name: 'Official2024', source: 'Official', sealed: false, nested: true },
];

async function exists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Read `InstalledPackagesPath "…"` out of a UserCfg.opt. */
async function readInstalledPackagesPath(appDataDir) {
  const file = path.join(appDataDir, 'UserCfg.opt');
  try {
    const text = await fsp.readFile(file, 'utf8');
    const match = /^\s*InstalledPackagesPath\s+"([^"]+)"/m.exec(text);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Find every sim install we can see. Returns one entry per sim edition with a
 * readable packages root.
 */
async function detectInstalls() {
  const installs = [];
  for (const candidate of APP_DATA_CANDIDATES) {
    if (!(await exists(candidate.dir))) continue;
    const packagesRoot = await readInstalledPackagesPath(candidate.dir);
    if (!packagesRoot || !(await exists(packagesRoot))) continue;
    installs.push({
      id: `${candidate.sim}:${candidate.store}`,
      sim: candidate.sim,
      store: candidate.store,
      appDataDir: candidate.dir,
      packagesRoot,
    });
  }
  return installs;
}

/**
 * Expand a packages root into the concrete directories that contain packages.
 * `Official*` nests one level deeper (Official/Steam, Official/OneStore).
 */
async function resolvePackageDirs(packagesRoot) {
  const dirs = [];
  for (const spec of PACKAGE_DIRS) {
    const base = path.join(packagesRoot, spec.name);
    if (!(await exists(base))) continue;

    if (!spec.nested) {
      dirs.push({ dir: base, source: spec.source, sealed: spec.sealed, label: spec.name });
      continue;
    }

    let children = [];
    try {
      children = await fsp.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      dirs.push({
        dir: path.join(base, child.name),
        source: spec.source,
        sealed: spec.sealed,
        label: `${spec.name}/${child.name}`,
      });
    }
  }
  return dirs;
}

/** Synchronous existence check, used by settings validation. */
function isPackagesRoot(dir) {
  if (!dir) return false;
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return PACKAGE_DIRS.some((spec) => fs.existsSync(path.join(dir, spec.name)));
}

/**
 * Turn whatever the user picked into a usable packages root.
 *
 * People think in terms of "my Community folder", so that is what they choose
 * in the folder dialog — but the scanner wants the folder *above* it, the one
 * holding Community, StreamedPackages and Official. Accept either, rather
 * than rejecting the more likely choice.
 *
 * @returns {string|null} the packages root, or null if it is neither
 */
function resolvePackagesRoot(dir) {
  if (!dir) return null;
  if (isPackagesRoot(dir)) return dir;

  // They picked Community (or another package folder) — step up one level.
  const parent = path.dirname(dir);
  if (parent && parent !== dir && isPackagesRoot(parent)) return parent;

  return null;
}

/** The locations probed for an install, for reporting when none is found. */
function candidateLocations() {
  return APP_DATA_CANDIDATES.map((candidate) => ({
    sim: candidate.sim === 'MSFS2024' ? 'MSFS 2024' : 'MSFS 2020',
    store: candidate.store,
    dir: candidate.dir,
  }));
}

module.exports = {
  detectInstalls,
  resolvePackageDirs,
  isPackagesRoot,
  resolvePackagesRoot,
  candidateLocations,
  PACKAGE_DIRS,
};
