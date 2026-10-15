'use strict';

// Dev scripts run against a copy of the real profile: they need its settings
// and photo cache to be realistic, but must never change it. Clicking through
// the welcome screen saves `welcomed`, and doing that to the real profile
// means the person running the script never sees the welcome screen again.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Chromium's own caches are locked by any running copy of the app, and are
// not needed; settings and the art cache are.
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'Network']);

/**
 * Point the app at a temporary copy of its real profile. Call after
 * app.setName() and before main.js is required.
 *
 * @param {Electron.App} app
 * @param {object} [settings] overrides merged into the copy's settings.json
 * @returns {string} the copy's path
 */
function useProfileCopy(app, settings) {
  const real = app.getPath('userData');
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'msfsqv-profile-'));
  if (fs.existsSync(real)) {
    fs.cpSync(real, copy, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
  }
  if (settings) {
    const file = path.join(copy, 'settings.json');
    const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    fs.writeFileSync(file, JSON.stringify({ ...current, ...settings }));
  }
  app.setPath('userData', copy);
  return copy;
}

module.exports = { useProfileCopy };
