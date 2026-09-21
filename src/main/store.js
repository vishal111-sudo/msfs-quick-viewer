'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * A tiny JSON file store. Writes go through a temp file + rename so a crash
 * mid-write cannot leave a truncated settings file behind.
 */
class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.data = { ...defaults };
    this.writeQueue = Promise.resolve();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.defaults, ...parsed };
    } catch {
      this.data = { ...this.defaults };
    }
    return this.data;
  }

  get(key) {
    return this.data[key];
  }

  set(patch) {
    this.data = { ...this.data, ...patch };
    return this.save();
  }

  /** Serialise writes so concurrent callers cannot interleave renames. */
  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      await fsp.writeFile(temp, snapshot, 'utf8');
      await fsp.rename(temp, this.file);
    }).catch((err) => {
      console.error('failed to write', this.file, err.message);
    });
    return this.writeQueue;
  }
}

const DEFAULT_SETTINGS = {
  /** Extra packages roots the user added by hand. */
  extraRoots: [],
  /**
   * Where to fetch a photo for aircraft with no thumbnail on disk:
   * 'wikipedia', 'commons', or 'off' to stay entirely offline.
   */
  artSource: 'wikipedia',
  /** Interface theme: 'dark', 'light', or 'system' to follow the OS. */
  theme: 'dark',
  /** Card size in the grid: 'small' | 'medium' | 'large'. */
  cardSize: 'medium',
  /** Last used filters, restored on launch. */
  lastFilters: null,
  /** Hide aircraft the sim's Content Manager has disabled. */
  hideDisabled: false,
};

module.exports = { JsonStore, DEFAULT_SETTINGS };
