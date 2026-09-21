'use strict';

// Developer probe: boots the app and watches the background photo sweep
// through to completion, so a progress bar that stalls or never finishes is
// caught here rather than by the user.
//   npx electron scripts/probe-sweep.js

const path = require('node:path');

const { app, BrowserWindow } = require('electron');

app.setName('MSFS Quick Viewer');

require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

const READ = `(() => {
  const box = document.getElementById('art-progress');
  return {
    visible: !box.hidden,
    text: document.getElementById('art-progress-text').textContent,
    width: document.getElementById('art-progress-bar').style.width,
    cardsWithArt: document.querySelectorAll('.card-art img').length,
    stillLooking: [...document.querySelectorAll('.card-art .placeholder div')]
      .filter((n) => n.textContent.startsWith('Looking')).length,
  };
})()`;

app.whenReady().then(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const win = BrowserWindow.getAllWindows()[0];

  // Wait for the scan to finish.
  for (let i = 0; i < 60; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (await win.webContents.executeJavaScript("document.getElementById('splash').hidden")) break;
  }

  const startedAt = Date.now();
  const deadline = startedAt + 8 * 60 * 1000;
  let last = '';
  let stalledSince = Date.now();

  for (;;) {
    const state = await win.webContents.executeJavaScript(READ).catch(() => null);
    if (!state) break;

    if (state.text !== last) {
      last = state.text;
      stalledSince = Date.now();
      process.stdout.write(`\r${state.text.padEnd(30)} ${state.width.padStart(5)}  cards with art: ${state.cardsWithArt}   `);
    }

    if (!state.visible) {
      const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`\nsweep finished in ${mins} min`);
      console.log('cards with artwork :', state.cardsWithArt);
      console.log('still "Looking…"   :', state.stillLooking);
      console.log(state.stillLooking === 0 ? 'PASS — nothing left waiting' : 'FAIL — cards still pending');
      app.exit(state.stillLooking === 0 ? 0 : 1);
      return;
    }

    if (Date.now() - stalledSince > 90000) {
      console.log(`\nFAIL — no progress for 90s at "${state.text}"`);
      app.exit(1);
      return;
    }
    if (Date.now() > deadline) {
      console.log(`\nFAIL — sweep did not finish within 8 min (at "${state.text}")`);
      app.exit(1);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  app.exit(1);
});
