'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// Content.xml records the enable/disable state the user set in the sim's
// Content Manager. Entries look like:
//   <Package name="communityfs20-a2a-aircraft-pa24" active="Activated"/>
//   <Package name="fs24-asobo-aircraft-c172" active="UserDisabled"/>
// Community folders get a "community" prefix and sometimes a sim prefix
// (fs20-/fs24-) that the folder on disk does not have, so lookups try a few
// spellings of the same package.

const PACKAGE_TAG = /<Package\s+([^>]*?)\/?>/gi;
const ATTR = /(\w+)\s*=\s*"([^"]*)"/g;

function variants(name) {
  const lower = name.toLowerCase();
  const out = new Set([lower]);
  const stripped = lower.replace(/^community/, '');
  out.add(stripped);
  out.add(stripped.replace(/^fs2[04]-/, ''));
  out.add(lower.replace(/^fs2[04]-/, ''));
  return out;
}

/**
 * Parse Content.xml into a lookup of package folder name -> state.
 * @returns {Promise<Map<string, 'enabled'|'disabled'>>}
 */
async function readContentState(appDataDir) {
  const states = new Map();
  let text;
  try {
    text = await fsp.readFile(path.join(appDataDir, 'Content.xml'), 'utf8');
  } catch {
    return states;
  }

  let tag;
  PACKAGE_TAG.lastIndex = 0;
  while ((tag = PACKAGE_TAG.exec(text)) !== null) {
    const attrs = {};
    let attr;
    ATTR.lastIndex = 0;
    while ((attr = ATTR.exec(tag[1])) !== null) attrs[attr[1].toLowerCase()] = attr[2];
    if (!attrs.name) continue;

    const state = /disabled/i.test(attrs.active || '') ? 'disabled' : 'enabled';
    for (const key of variants(attrs.name)) {
      // An explicit disable beats an enable from a differently-prefixed alias.
      if (states.get(key) === 'disabled') continue;
      states.set(key, state);
    }
  }
  return states;
}

/** Look up a package folder name, trying the same prefix variants. */
function stateFor(states, folderName) {
  for (const key of variants(folderName)) {
    const found = states.get(key);
    if (found) return found;
  }
  return 'unknown';
}

module.exports = { readContentState, stateFor };
