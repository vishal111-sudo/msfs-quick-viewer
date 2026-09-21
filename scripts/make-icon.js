'use strict';

// Renders build/icon.png from an inline SVG. electron-builder converts that
// PNG into the Windows .ico at package time, so no binary asset is checked in.
//   npx electron scripts/make-icon.js

const fsp = require('node:fs/promises');
const path = require('node:path');

const { app, BrowserWindow } = require('electron');

const SIZE = 512;
const OUT = path.join(__dirname, '..', 'build', 'icon.png');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b7fe0"/>
      <stop offset="0.55" stop-color="#4da3ff"/>
      <stop offset="1" stop-color="#7c5cff"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#d7e6fb"/>
    </linearGradient>
  </defs>

  <rect width="512" height="512" rx="108" fill="url(#bg)"/>
  <rect width="512" height="512" rx="108" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="4"/>

  <!-- Top-down airliner silhouette, nose up -->
  <g fill="url(#metal)" transform="translate(256 262) rotate(-18)">
    <path d="M0 -168
             c10 0 18 16 20 36
             l3 44
             l118 62
             c6 3 9 8 9 14 v20 c0 5 -4 8 -9 6
             l-115 -38
             l2 70
             l40 30 c4 3 6 7 6 11 v12 c0 4 -4 6 -8 5
             l-52 -16 l-14 34 l-14 -34 l-52 16 c-4 1 -8 -1 -8 -5
             v-12 c0 -4 2 -8 6 -11 l40 -30 l2 -70
             l-115 38 c-5 2 -9 -1 -9 -6 v-20 c0 -6 3 -11 9 -14
             l118 -62 l3 -44 c2 -20 10 -36 20 -36 z"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });

  const page = `<!doctype html><meta charset="utf-8">
    <style>
      html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
      svg{display:block}
    </style>
    ${SVG}`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
  await new Promise((resolve) => setTimeout(resolve, 600));

  const image = await win.webContents.capturePage();
  await fsp.mkdir(path.dirname(OUT), { recursive: true });
  await fsp.writeFile(OUT, image.toPNG());
  console.log('wrote', OUT, image.getSize());
  app.exit(0);
});
