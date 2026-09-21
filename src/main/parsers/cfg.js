'use strict';

// MSFS .cfg files are INI-ish: `[SECTION]` headers, `key = value` pairs,
// `;` and `//` line comments, and values that are often wrapped in quotes.
// Keys repeat across sections (every `[FLTSIM.n]` has its own `title`), so
// sections are kept as an ordered list rather than collapsed into one object.

const COMMENT = /^\s*(?:;|\/\/)/;
const SECTION = /^\s*\[([^\]]+)\]/;

/** Strip an unquoted trailing `; comment` and surrounding quotes from a value. */
function cleanValue(raw) {
  let value = raw;
  let quoted = false;
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '"') {
      quoted = !quoted;
      out += ch;
      continue;
    }
    if (!quoted && (ch === ';' || (ch === '/' && value[i + 1] === '/'))) break;
    out += ch;
  }
  out = out.trim();
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

/**
 * Parse cfg text into `{ sections: [{ name, keys: Map }] }`.
 * Key lookups are case-insensitive because MSFS cfgs are wildly inconsistent
 * about casing (`Category`, `category`, `ui_typerole`, `ui_typeRole`).
 */
function parseCfg(text) {
  const sections = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || COMMENT.test(line)) continue;

    const header = SECTION.exec(line);
    if (header) {
      current = { name: header[1].trim(), keys: new Map() };
      sections.push(current);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1 || !current) continue;

    const key = line.slice(0, eq).trim().toLowerCase();
    if (!key) continue;
    // First wins: some cfgs re-declare a key later as a commented-out example.
    if (!current.keys.has(key)) current.keys.set(key, cleanValue(line.slice(eq + 1)));
  }

  return { sections };
}

/** All sections whose name matches `pattern` (string = exact, case-insensitive). */
function sectionsNamed(cfg, pattern) {
  if (pattern instanceof RegExp) {
    return cfg.sections.filter((s) => pattern.test(s.name));
  }
  const want = String(pattern).toLowerCase();
  return cfg.sections.filter((s) => s.name.toLowerCase() === want);
}

/** First value for `key` in the first section named `sectionName`. */
function get(cfg, sectionName, key) {
  for (const section of sectionsNamed(cfg, sectionName)) {
    const value = section.keys.get(key.toLowerCase());
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

module.exports = { parseCfg, sectionsNamed, get, cleanValue };
