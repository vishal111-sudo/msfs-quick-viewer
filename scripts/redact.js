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
 *
 * It also waits for the redacted text to reach the screen. capturePage() can
 * hand back the last composited frame, and without this wait a capture taken
 * straight after redacting showed the original paths: the DOM had changed,
 * the pixels had not.
 */
async function redactForScreenshot(win) {
  const changed = await win.webContents.executeJavaScript(REDACT_SOURCE);

  // Force a repaint rather than hoping for one. requestAnimationFrame alone is
  // not enough: Chromium pauses it for a window sitting behind others, and an
  // unbounded wait on it hung a whole smoke run. So ask for the repaint
  // directly, give frames a bounded chance to land, and move on.
  win.webContents.invalidate();
  await win.webContents.executeJavaScript(
    `Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ])`,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  return changed;
}

module.exports = { REDACT_SOURCE, redactForScreenshot };
