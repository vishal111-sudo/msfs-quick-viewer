'use strict';

// Developer probe: what a user whose install is NOT auto-detected actually
// sees. Stubs detection to find nothing, on a throwaway profile, then checks
// the screen explains the situation and offers a way forward.
//
//   npx electron scripts/probe-empty-state.js            new user: welcome screen
//   npx electron scripts/probe-empty-state.js returning  returning user: empty grid

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { app, BrowserWindow } = require('electron');

const { redactForScreenshot } = require('./redact');

const RETURNING = process.argv.includes('returning');

app.setName('MSFS Quick Viewer');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'msfsqv-empty-'));
app.setPath('userData', profile);
if (RETURNING) fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ welcomed: true }));

// Patch before main.js pulls in the scanner, which destructures this on load.
const roots = require(path.join(__dirname, '..', 'src', 'main', 'roots'));
roots.detectInstalls = async () => [];

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app
  .whenReady()
  .then(async () => {
    let win = null;
    while (!win) {
      await sleep(25);
      win = BrowserWindow.getAllWindows()[0];
    }

    // Wait for whichever screen this case should land on to have content.
    const ready = RETURNING
      ? `!document.getElementById('splash') && document.querySelectorAll('#empty .empty-paths li').length > 0`
      : `!!document.querySelector('#welcome .welcome-foot')`;
    for (let i = 0; i < 120; i += 1) {
      if (await win.webContents.executeJavaScript(ready).catch(() => false)) break;
      await sleep(100);
    }

    const state = await win.webContents.executeJavaScript(
      RETURNING
        ? `(() => {
            const empty = document.getElementById('empty');
            const details = empty.querySelector('details');
            if (details) details.open = true;
            const state = empty.querySelector('arc-empty-state');
            return {
              visible: Boolean(empty),
              heading: state ? state.heading : null,
              button: (empty.querySelector('arc-button') || {}).textContent || null,
              pathsListed: empty.querySelectorAll('.empty-paths li').length,
            };
          })()`
        : `(() => {
            const welcome = document.getElementById('welcome');
            return {
              visible: Boolean(welcome),
              heading: (welcome.querySelector('.welcome-label') || {}).textContent || null,
              button: (welcome.querySelector('.welcome-section arc-button') || {}).textContent || null,
              scanDisabled: welcome.querySelector('.welcome-start').disabled,
            };
          })()`,
    );
    console.log(JSON.stringify(state, null, 2));

    await redactForScreenshot(win);
    const shot = await win.webContents.capturePage();
    const out = path.join(__dirname, '..', RETURNING ? 'smoke-empty-returning.png' : 'smoke-empty.png');
    fs.writeFileSync(out, shot.toPNG());
    console.log('screenshot:', out);

    const ok = RETURNING
      ? state.visible && state.heading && state.button && state.pathsListed === 4
      : state.visible && state.heading === 'No sim found yet' && state.button && state.scanDisabled;
    console.log(ok ? 'PASS: explains the problem and offers a fix' : 'FAIL: unhelpful empty state');

    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // still held open by the app; it is an empty temp folder
    }
    app.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error('EMPTY-STATE PROBE FAILED:', err);
    app.exit(1);
  });
