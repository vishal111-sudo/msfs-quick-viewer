'use strict';

// Developer probe: what a brand-new user sees, second by second.
//
// Points userData at an empty temp folder, so there are no saved settings and
// no photo cache. Screenshots the welcome screen, clicks its button the way a
// user would, then screenshots the scan and the grid on a timeline. Paths are
// redacted the same way the README screenshots are.
//
//   npx electron scripts/probe-first-run.js [light]

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { app, BrowserWindow } = require('electron');

const { redactForScreenshot } = require('./redact');

app.setName('MSFS Quick Viewer');

// Before main.js reads it: a fresh profile every run.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'msfsqv-first-run-'));
app.setPath('userData', profile);
if (process.argv.includes('light')) {
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ theme: 'light' }));
}

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

const OUT_DIR = path.join(__dirname, '..');
const THEME = process.argv.includes('light') ? '-light' : '';
// Seconds after clicking "Scan my aircraft".
const MOMENTS = [0.05, 0.3, 0.9, 2.5, 8];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function snapshot(win, label) {
  const state = await win.webContents
    .executeJavaScript(
      // Screens and notices are only in the page while they are showing.
      `(() => {
        const text = (id) => (document.getElementById(id) || {}).textContent || null;
        return {
          welcome: Boolean(document.getElementById('welcome')),
          splash: Boolean(document.getElementById('splash')),
          stages: [...document.querySelectorAll('.stage')].map((s) => s.dataset.stage + ':' + (s.dataset.state || '-')).join(' '),
          stageCount: text('stage-count'),
          install: text('splash-install') ? '(set)' : '',
          cards: document.querySelectorAll('.card').length,
          notice: text('photo-notice-text'),
          progress: text('art-progress-text'),
        };
      })()`,
    )
    .catch((err) => ({ error: err.message }));
  console.log(label.padEnd(14), JSON.stringify(state));

  // No catch: an unredacted screenshot is worse than a failed run.
  await redactForScreenshot(win);
  const shot = await win.webContents.capturePage();
  const name = `smoke-first-run${THEME}-${label.replace(/[^a-z0-9]+/gi, '_')}.png`;
  fs.writeFileSync(path.join(OUT_DIR, name), shot.toPNG());
  return state;
}

app
  .whenReady()
  .then(async () => {
    let win = null;
    while (!win) {
      await sleep(25);
      win = BrowserWindow.getAllWindows()[0];
    }
    while (!win.isVisible()) await sleep(25);

    // Wait for the welcome screen to have its content.
    for (let i = 0; i < 80; i += 1) {
      const ready = await win.webContents
        .executeJavaScript(`!!document.querySelector('#welcome .welcome-start:not([disabled])')`)
        .catch(() => false);
      if (ready) break;
      await sleep(50);
    }
    const welcome = await snapshot(win, 'welcome');
    if (!welcome.welcome) throw new Error('welcome screen did not appear on a fresh profile');

    const clicked = Date.now();
    await win.webContents.executeJavaScript(`document.querySelector('#welcome .welcome-start').click(); true`);

    for (const seconds of MOMENTS) {
      const wait = clicked + seconds * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      await snapshot(win, `after_${seconds}s`);
    }

    // The app still holds files in the profile, so Windows refuses the delete
    // until it exits. It is an empty temp folder either way.
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // left for the OS temp cleanup
    }
    app.exit(0);
  })
  .catch((err) => {
    console.error('FIRST-RUN PROBE FAILED:', err);
    app.exit(1);
  });
