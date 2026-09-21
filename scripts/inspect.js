'use strict';

// Developer probe: boots the app and dumps computed geometry for the first
// card, to debug layout problems that only show up in the real window.

const path = require('node:path');

const { app, BrowserWindow } = require('electron');

app.setName('MSFS Quick Viewer');

const MEASURE = `(() => {
  document.documentElement.dataset.theme = '__THEME__';

  const lum = (hex) => {
    const n = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return Number(((x + 0.05) / (y + 0.05)).toFixed(2));
  };
  const css = getComputedStyle(document.documentElement);
  const tok = (n) => css.getPropertyValue(n).trim();
  const bg = tok('--bg');

  const fails = [];
  const on = {};
  for (const name of ['--text', '--text-dim', '--text-faint', '--accent']) {
    const r = ratio(tok(name), bg);
    on[name] = r;
    if (r < 4.5) fails.push(name + ' ' + r + ':1');
  }
  // Hairlines are non-text: 3:1 is the bar for a meaningful boundary.
  const lineRatio = ratio(tok('--line'), bg);

  // A selected facet paints accent text over an accent-tinted ground, so the
  // real contrast is against that composite, not the page.
  const rgba = tok('--accent-quiet').match(/[\\d.]+/g).map(Number);
  const base = bg.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  const mixed = base
    .map((c, i) => Math.round(c * (1 - rgba[3]) + rgba[i] * rgba[3]))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('');
  const selected = ratio(tok('--accent'), '#' + mixed);
  if (selected < 4.5) fails.push('accent on selected row ' + selected + ':1');

  return {
    ground: bg,
    accent: tok('--accent'),
    textContrast: on,
    lineContrast: lineRatio,
    accentOnSelectedRow: selected,
    failsAA: fails,
  };
})()`;

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));


app.whenReady().then(async () => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const win = BrowserWindow.getAllWindows()[0];

  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const ready = await win.webContents.executeJavaScript(`document.getElementById('splash').hidden`).catch(() => false);
    if (ready) break;
  }

  // Contrast is checked per theme, because a palette that passes on the dark
  // ground can fail on the light one.
  for (const theme of ['dark', 'light']) {
    const report = await win.webContents
      .executeJavaScript(MEASURE.replace('__THEME__', theme))
      .catch((err) => ({ error: err.message }));
    console.log(theme, JSON.stringify(report, null, 2));
  }
  app.exit(0);
});
