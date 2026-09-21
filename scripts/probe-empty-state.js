'use strict';

// Developer probe: what a user whose install is NOT auto-detected actually
// sees. Stubs detection to find nothing, then checks the first-run panel
// explains the situation and offers a way forward.
//
//   npx electron scripts/probe-empty-state.js

const path = require('node:path');

const { app, BrowserWindow } = require('electron');

const { redactForScreenshot } = require('./redact');

app.setName('MSFS Quick Viewer');

// Patch before main.js pulls in the scanner, which destructures this on load.
const roots = require(path.join(__dirname, '..', 'src', 'main', 'roots'));
roots.detectInstalls = async () => [];

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

app.whenReady().then(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const win = BrowserWindow.getAllWindows()[0];

  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (await win.webContents.executeJavaScript("document.getElementById('splash').hidden")) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const state = await win.webContents.executeJavaScript(`(() => {
    const empty = document.getElementById('empty');
    return {
      visible: !empty.hidden,
      heading: (empty.querySelector('.empty-title') || {}).textContent || null,
      body: [...empty.querySelectorAll('p')].map((n) => n.textContent.trim()).slice(0, 2),
      button: (empty.querySelector('button') || {}).textContent || null,
      pathsListed: empty.querySelectorAll('.empty-paths li').length,
      cards: document.querySelectorAll('.card').length,
    };
  })()`);

  console.log(JSON.stringify(state, null, 2));

  await win.webContents.executeJavaScript(
    "document.getElementById('empty').querySelector('details').open = true; true",
  );
  await redactForScreenshot(win);
  const shot = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'smoke-empty.png');
  require('node:fs').writeFileSync(out, shot.toPNG());
  console.log('screenshot:', out);

  const ok = state.visible && state.heading && state.button && state.pathsListed === 4;
  console.log(ok ? 'PASS — explains the problem and offers a fix' : 'FAIL — unhelpful empty state');
  app.exit(ok ? 0 : 1);
});
