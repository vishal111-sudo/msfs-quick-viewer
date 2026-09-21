'use strict';

// Developer probe: how well the streamed folder-name parser and the stock
// aircraft catalog cover a real StreamedPackages folder.
//
//   node scripts/probe-streamed.js            use the detected install
//   node scripts/probe-streamed.js <path>     point at a folder explicitly

const fs = require('node:fs');

const { parseStreamedName } = require('../src/main/parsers/streamed');
const { detectInstalls, resolvePackageDirs } = require('../src/main/roots');

/** The sealed (StreamedPackages) folder of whichever sim install is found. */
async function findStreamedDir() {
  for (const install of await detectInstalls()) {
    for (const spec of await resolvePackageDirs(install.packagesRoot)) {
      if (spec.sealed) return spec.dir;
    }
  }
  return null;
}

async function main() {
  const root = process.argv[2] || (await findStreamedDir());
  if (!root) {
    console.error('No StreamedPackages folder found. Pass one as an argument.');
    process.exit(1);
  }
  console.log('scanning', root, '\n');

  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  let aircraft = 0;
  let liveries = 0;
  let shared = 0;
  const unknown = new Set();

  for (const name of names) {
    const parsed = parseStreamedName(name);
    if (!parsed) continue;
    if (parsed.isSharedAsset) {
      shared += 1;
      continue;
    }
    if (parsed.isLivery) liveries += 1;
    else aircraft += 1;
    if (!parsed.known) unknown.add(parsed.slug);
  }

  console.log('folders scanned :', names.length);
  console.log('base aircraft   :', aircraft);
  console.log('liveries        :', liveries);
  console.log('shared assets   :', shared);
  console.log(`slugs not in catalog (${unknown.size}):`);
  console.log([...unknown].sort().join(', ') || '  none');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
