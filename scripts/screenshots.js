'use strict';

// Regenerates the README screenshots in docs/ from the real app.
//
//   npm run build:ui && npx electron scripts/screenshots.js
//
// Runs on a copy of the real profile (so the grid has real artwork) past the
// welcome screen, waits for the startup toast to clear, and captures the grid
// in both themes. Every capture goes through the same redaction as the other
// dev scripts, so no real drive letter or Windows username can reach the repo.

const path = require('node:path');
const fs = require('node:fs');

const { app, BrowserWindow } = require('electron');

const { useProfileCopy } = require('./profile');
const { redactForScreenshot } = require('./redact');

app.setName('MSFS Quick Viewer');
useProfileCopy(app, { welcomed: true, lastFilters: {}, theme: 'dark', cardSize: 'medium' });

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

const DOCS = path.join(__dirname, '..', 'docs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app
  .whenReady()
  .then(async () => {
    let win = null;
    while (!win) {
      await sleep(50);
      win = BrowserWindow.getAllWindows()[0];
    }
    win.setSize(1440, 900);
    const js = (code) => win.webContents.executeJavaScript(code);

    for (let i = 0; i < 150; i += 1) {
      if (await js(`!document.getElementById('splash') && document.querySelectorAll('.card').length > 0`).catch(() => false)) break;
      await sleep(200);
    }
    // Let the first screenful of artwork land and the startup toast clear.
    await sleep(6000);

    const capture = async (name) => {
      await redactForScreenshot(win);
      fs.writeFileSync(path.join(DOCS, name), (await win.webContents.capturePage()).toPNG());
      console.log('wrote docs/' + name);
    };

    await capture('screenshot-grid.png');

    await js(`document.documentElement.dataset.theme = 'light'; true`);
    await sleep(800);
    await capture('screenshot-light.png');

    app.exit(0);
  })
  .catch((err) => {
    console.error('SCREENSHOTS FAILED:', err);
    app.exit(1);
  });
