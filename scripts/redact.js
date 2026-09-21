'use strict';

// Screenshots from these dev scripts end up in the README of a public repo,
// and the UI legitimately shows real filesystem paths, which carry the
// author's drive letters and Windows username. Rewriting the rendered text in
// place keeps each panel showing what it is meant to show while making the
// paths belong to nobody in particular.
//
// String.raw so the backslashes survive being embedded in a template literal.
// Without it `\b` becomes a backspace character and the regex is silently
// wrong rather than loudly broken.
const REDACT_SOURCE = String.raw`(() => {
  const swaps = [
    // Any Windows user folder becomes a stand-in name.
    [/([A-Za-z]:\\Users\\)[^\\\s"'<>|]+/g, '$1Pilot'],
    // Every drive letter becomes C:, so the author's layout is not on show.
    [/\b[A-Za-z]:\\/g, 'C:\\'],
  ];

  const changed = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const before = node.nodeValue;
    let after = before;
    for (const [pattern, replacement] of swaps) after = after.replace(pattern, replacement);
    if (after !== before) {
      node.nodeValue = after;
      changed.push(after.trim().slice(0, 80));
    }
  }
  return changed;
})()`;

/**
 * Neutralise machine-specific strings in a window before capturing it.
 *
 * A failure here must not pass silently: a screenshot that was supposed to be
 * redacted and was not is worse than no screenshot at all.
 */
async function redactForScreenshot(win) {
  return win.webContents.executeJavaScript(REDACT_SOURCE);
}

module.exports = { REDACT_SOURCE, redactForScreenshot };
