'use strict';

// Developer smoke test: boots the real app, waits for the first scan to
// finish, reports any renderer console errors, and writes a screenshot.
//   npx electron scripts/smoke.js [outputPng]

const path = require('node:path');
const fsp = require('node:fs/promises');

const { app, BrowserWindow } = require('electron');

const { redactForScreenshot } = require('./redact');

const OUT = process.argv[2] || path.join(__dirname, '..', 'smoke.png');
const problems = [];

// Launched as `electron scripts/smoke.js`, Electron names the app "Electron"
// and picks a different userData folder than the packaged app. Pin the name so
// the smoke run exercises the same settings and art cache as the real thing.
app.setName('MSFS Quick Viewer');

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

app.whenReady().then(async () => {
  // Give main.js a tick to create its window.
  await new Promise((resolve) => setTimeout(resolve, 800));
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.error('SMOKE: no window created');
    app.exit(1);
    return;
  }

  win.webContents.on('console-message', (_event, level, message, line, source) => {
    const tag = ['verbose', 'info', 'warning', 'error'][level] || level;
    console.log(`  [renderer:${tag}] ${message}${source ? ` (${source}:${line})` : ''}`);
    if (level >= 2) problems.push(message);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    problems.push(`renderer gone: ${details.reason}`);
  });

  // An async handler that throws produces an unhandled rejection, which never
  // reaches console-message — so surface those explicitly.
  await win.webContents.executeJavaScript(`
    window.__rejections = [];
    addEventListener('unhandledrejection', (event) => {
      window.__rejections.push(String((event.reason && event.reason.stack) || event.reason));
    });
    addEventListener('error', (event) => {
      window.__rejections.push('error: ' + String(event.message));
    });
    true
  `);

  // Poll the page until the splash is gone or we run out of patience.
  const deadline = Date.now() + 60000;
  let summary = null;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    summary = await win.webContents
      .executeJavaScript(
        `(() => ({
           splash: document.getElementById('splash').hidden,
           count: document.getElementById('result-count').textContent,
           cards: document.querySelectorAll('.card').length,
           withImg: document.querySelectorAll('.card-art img').length,
           facets: document.querySelectorAll('.facet').length,
           firstCards: [...document.querySelectorAll('.card-title')].slice(0, 6).map(n => n.textContent),
        }))()`,
      )
      .catch((err) => ({ error: err.message }));
    if (summary && (summary.splash || summary.error)) break;
    if (Date.now() > deadline) break;
  }

  console.log('SMOKE summary:', JSON.stringify(summary, null, 2));

  // Let the lazy artwork requests for the first screenful land.
  await new Promise((resolve) => setTimeout(resolve, 25000));
  const redacted = await redactForScreenshot(win);
  console.log('SMOKE redacted', redacted.length, 'text nodes:', JSON.stringify(redacted));
  const shot = await win.webContents.capturePage();
  await fsp.writeFile(OUT, shot.toPNG());
  console.log('SMOKE screenshot:', OUT);

  // The background photo sweep should be reporting real progress by now.
  const progress = await win.webContents.executeJavaScript(`(() => {
    const box = document.getElementById('art-progress');
    return {
      visible: !box.hidden,
      text: document.getElementById('art-progress-text').textContent,
      width: document.getElementById('art-progress-bar').style.width,
    };
  })()`);
  console.log('SMOKE art progress:', JSON.stringify(progress));

  // Open the detail drawer for the aircraft with the most liveries, so the
  // screenshot exercises the metadata table and the livery gallery too.
  // Read the count off the badge rather than matching literal totals: the old
  // version looked for "55 liveries" from one particular library, which no
  // card has ever said (the badge reads "55 liv"), so it always fell through
  // to an arbitrary card.
  const opened = await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('.card')];
    const liveryCount = (card) => {
      const badge = [...card.querySelectorAll('.badge')]
        .map((node) => /^(\\d+) liv$/.exec(node.textContent.trim()))
        .find(Boolean);
      return badge ? Number(badge[1]) : 0;
    };
    const target = cards.reduce(
      (best, card) => (liveryCount(card) > liveryCount(best) ? card : best),
      cards[0],
    );
    if (!target) return null;
    target.scrollIntoView();
    target.click();
    return target.querySelector('.card-title').textContent + ' (' + liveryCount(target) + ' liveries)';
  })()`);
  // capturePage can hand back the previous composited frame, so wait for the
  // drawer to be painted rather than merely present in the DOM.
  await win.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
  );
  await new Promise((resolve) => setTimeout(resolve, 3500));
  await redactForScreenshot(win);
  const detailShot = await win.webContents.capturePage();
  const detailOut = OUT.replace(/.png$/, '-detail.png');
  await fsp.writeFile(detailOut, detailShot.toPNG());
  const drawerOpen = await win.webContents.executeJavaScript(
    "!document.getElementById('detail').hidden",
  );
  console.log('SMOKE detail drawer:', opened, '| open:', drawerOpen, '->', detailOut);
  if (!drawerOpen) problems.push('detail drawer did not open');

  // Settings builds asynchronously now (it asks main for the photo sources),
  // so prove it actually renders.
  await win.webContents.executeJavaScript(
    "document.getElementById('detail-close').click(); document.getElementById('open-settings').click(); true",
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const settingsState = await win.webContents.executeJavaScript(`(() => {
    const drawer = document.getElementById('settings');
    const select = drawer.querySelector('select');
    return {
      open: !drawer.hidden,
      sources: select ? [...select.options].map((o) => o.value) : [],
      chosen: select ? select.value : null,
      sections: drawer.querySelectorAll('.section').length,
    };
  })()`);
  console.log('SMOKE settings:', JSON.stringify(settingsState));
  if (!settingsState.open || settingsState.sources.length < 3) problems.push('settings drawer incomplete');

  await redactForScreenshot(win);
  const settingsShot = await win.webContents.capturePage();
  await fsp.writeFile(OUT.replace(/.png$/, '-settings.png'), settingsShot.toPNG());

  const after = await win.webContents
    .executeJavaScript(`document.querySelectorAll('.card-art img').length`)
    .catch(() => -1);
  console.log('SMOKE cards with artwork after wait:', after);

  // Light theme gets its own capture: a dark-only palette hides plenty.
  await win.webContents.executeJavaScript(
    "document.getElementById('settings-close').click(); document.documentElement.dataset.theme = 'light'; true",
  );
  await win.webContents.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))',
  );
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await redactForScreenshot(win);
  const lightShot = await win.webContents.capturePage();
  await fsp.writeFile(OUT.replace(/.png$/, '-light.png'), lightShot.toPNG());
  console.log('SMOKE light theme:', OUT.replace(/.png$/, '-light.png'));
  await win.webContents.executeJavaScript("document.documentElement.dataset.theme = 'dark'; true");

  const rejections = await win.webContents.executeJavaScript('window.__rejections').catch(() => []);
  for (const rejection of rejections || []) {
    console.log('  [unhandled]', rejection);
    problems.push(rejection);
  }

  console.log(problems.length ? `SMOKE PROBLEMS (${problems.length})` : 'SMOKE OK: no renderer errors');
  app.exit(problems.length ? 1 : 0);
}).catch((err) => {
  // Without this the run hangs: a rejection here is unhandled, Electron keeps
  // the window open, and the script neither writes a screenshot nor exits.
  console.error('SMOKE FAILED:', err && err.stack ? err.stack : err);
  app.exit(1);
});
