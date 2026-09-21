'use strict';

// electron-builder writes into `dist/`, which is a fine place for build
// output but a poor place for the one file a new user is looking for. This
// moves the finished portable executable up to the project root, so opening
// the folder shows it immediately.
//
// Run automatically by `npm run dist`.

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const PORTABLE = /^MSFS-Quick-Viewer-.*-portable\.exe$/i;

function bytesToMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

function main() {
  let built = [];
  try {
    built = fs.readdirSync(distDir).filter((name) => PORTABLE.test(name));
  } catch {
    console.error(`place-exe: no dist folder at ${distDir} — run the build first`);
    process.exit(1);
  }

  if (!built.length) {
    console.error('place-exe: no portable .exe found in dist/');
    process.exit(1);
  }

  // Clear out any earlier version so the folder never offers a choice between
  // two executables, only one of which is current.
  for (const name of fs.readdirSync(root)) {
    if (PORTABLE.test(name) && !built.includes(name)) {
      fs.rmSync(path.join(root, name), { force: true });
      console.log(`place-exe: removed previous ${name}`);
    }
  }

  for (const name of built) {
    const from = path.join(distDir, name);
    const to = path.join(root, name);
    fs.rmSync(to, { force: true });
    fs.renameSync(from, to);
    console.log(`place-exe: ${name}  (${bytesToMb(fs.statSync(to).size)})  ->  project root`);
  }
}

main();
