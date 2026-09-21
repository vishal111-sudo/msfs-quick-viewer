'use strict';

// Developer probe: runs the scanner against the real install and prints a
// summary. Not shipped in the packaged app.
//   node scripts/probe.js            full scan summary
//   node scripts/probe.js <pkgName>  detail for one Community package

const path = require('node:path');

const { scanPackage } = require('../src/main/parsers/package');
const { detectInstalls, resolvePackageDirs } = require('../src/main/roots');

/** The first Community folder of whichever sim install is detected. */
async function findCommunityDir() {
  for (const install of await detectInstalls()) {
    for (const spec of await resolvePackageDirs(install.packagesRoot)) {
      if (spec.source === 'Community') return spec.dir;
    }
  }
  return null;
}

async function detail(name, communityDir) {
  const dir = path.join(communityDir, name);
  const pkg = await scanPackage(dir, { source: 'Community', label: 'Community' });
  if (!pkg) {
    console.log(name, '-> not aircraft content');
    return;
  }
  console.log('package :', pkg.title, '|', pkg.contentType, '| thumb:', Boolean(pkg.packageThumbnail));
  console.log('creator :', pkg.creator, '| version:', pkg.version);
  for (const frame of pkg.airframes) {
    const withThumb = frame.liveries.filter((l) => l.thumbnail).length;
    console.log(
      '  frame :', frame.modelName,
      '| base:', frame.hasBase,
      '| variants:', frame.variants.length,
      '| liveries:', frame.liveries.length, `(${withThumb} with art)`,
    );
    console.log('    facts:', JSON.stringify(frame.facts));
    for (const livery of frame.liveries.slice(0, 3)) {
      console.log('    livery:', livery.name, '->', livery.thumbnail || '(no art)');
    }
  }
}

async function main() {
  const communityDir = process.env.MSFSQV_COMMUNITY || (await findCommunityDir());
  if (!communityDir) {
    console.error('No Community folder found. Set MSFSQV_COMMUNITY to one.');
    process.exit(1);
  }

  const arg = process.argv[2];
  if (arg) {
    await detail(arg, communityDir);
    return;
  }
  for (const name of [
    'a2a-aircraft-pa24',
    'pmdg-aircraft-738',
    'bksq-aircraft-baronpro',
    'PMDG 737-800 WestJet C-FPLS',
    'inibuilds-aircraft-a350',
    'fnx-aircraft-320',
  ]) {
    console.log('===', name);
    await detail(name, communityDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
