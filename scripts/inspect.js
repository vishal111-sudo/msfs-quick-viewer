'use strict';

// Developer probe: measures the theme's contrast in the real window, in both
// themes, and exits non-zero if anything falls short of WCAG AA.
//
//   npx electron scripts/inspect.js
//
// Contrast is measured from the computed tokens rather than from theme.css,
// so it checks what ARC actually resolves, overrides and all. Each text
// token is tested against every surface it can sit on and the worst case is
// reported. The accent is also tested over the accent-tinted selected row,
// which is where both previous contrast failures in this app were found.

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { app, BrowserWindow } = require('electron');

app.setName('MSFS Quick Viewer');
// A throwaway profile: the measurement needs the page, not a scan.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'msfsqv-inspect-')));

const MEASURE = `(() => {
  document.documentElement.dataset.theme = '__THEME__';
  const css = getComputedStyle(document.documentElement);
  const tok = (name) => css.getPropertyValue(name).trim();
  // Vite's CSS minifier rewrites rgb() as hex, so read both.
  const unreadable = [];
  const channels = (value, name) => {
    let parts = [];
    if (/^#[0-9a-f]{3,8}$/i.test(value)) {
      let hex = value.slice(1);
      if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
      parts = hex.match(/../g).map((h) => parseInt(h, 16));
      if (parts.length === 4) parts[3] /= 255;
    } else {
      parts = (value.match(/[\\d.]+/g) || []).map(Number);
    }
    if (parts.length < 3 || parts.some(Number.isNaN)) unreadable.push((name || '?') + '=' + JSON.stringify(value));
    return parts;
  };
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return Number(((x + 0.05) / (y + 0.05)).toFixed(2));
  };
  const over = (fg, alpha, bg) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

  const grounds = ['--bg-deep', '--bg-surface', '--bg-card', '--bg-elevated'];
  const texts = ['--text-primary', '--text-secondary', '--text-muted', '--text-ghost', '--accent-primary'];
  const worst = {};
  const fails = [];
  for (const text of texts) {
    let min = Infinity;
    let against = '';
    for (const ground of grounds) {
      const r = ratio(channels(tok(text), text), channels(tok(ground), ground));
      if (r < min) { min = r; against = ground; }
    }
    worst[text] = min + ' on ' + against;
    if (min < 4.5) fails.push(text + ' ' + min + ':1 on ' + against);
  }

  // A selected facet: accent text over the accent tinted at 6% on the sidebar.
  const accent = channels(tok('--accent-primary'), '--accent-primary');
  const subtleAlpha = channels(tok('--accent-primary-subtle'), '--accent-primary-subtle')[3];
  const selectedRow = over(accent, subtleAlpha, channels(tok('--bg-surface'), '--bg-surface'));
  const selected = ratio(accent, selectedRow);
  if (selected < 4.5) fails.push('accent on selected row ' + selected + ':1');

  // A primary button: ARC fills it with --interactive and sets --on-accent text.
  const button = ratio(channels(tok('--on-accent'), '--on-accent'), channels(tok('--interactive'), '--interactive'));
  if (button < 4.5) fails.push('primary button text ' + button + ':1');

  if (unreadable.length) fails.push('could not read ' + [...new Set(unreadable)].join(', '));
  if (!(subtleAlpha > 0)) fails.push('could not read the selected-row tint');

  return {
    worstCase: worst,
    accentOnSelectedRow: selected,
    primaryButtonText: button,
    failsAA: fails,
  };
})()`;

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

app.whenReady().then(async () => {
  let win = null;
  while (!win) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    win = BrowserWindow.getAllWindows()[0];
  }
  // A fresh profile lands on the welcome screen, which is enough: the tokens
  // are on the document either way.
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await win.webContents.executeJavaScript(`!!document.querySelector('#welcome, .app')`).catch(() => false)) break;
  }

  let failed = 0;
  for (const theme of ['dark', 'light']) {
    const report = await win.webContents.executeJavaScript(MEASURE.replace('__THEME__', theme));
    failed += report.failsAA.length;
    console.log(theme, JSON.stringify(report, null, 2));
  }
  console.log(failed ? `CONTRAST: ${failed} below AA` : 'CONTRAST: every pairing passes AA');
  app.exit(failed ? 1 : 0);
}).catch((err) => {
  console.error('INSPECT FAILED:', err);
  app.exit(1);
});
