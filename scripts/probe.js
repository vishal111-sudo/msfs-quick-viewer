'use strict';

// Developer probe: runs the scanner against the real install and prints a
// summary. Not shipped in the packaged app.
//   node scripts/probe.js            full scan summary
//   node scripts/probe.js <pkgName>  detail for one Community package

const path = require('node:path');
const fsp = require('node:fs/promises');

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

const SAMPLE_SIZE = 6;

/**
 * Package folders spread evenly across the directory listing.
 *
 * Evenly spaced rather than the first N, because add-on folders sort by
 * vendor prefix and the first N would all come from whichever vendor happens
 * to sort first.
 */
async function samplePackages(communityDir, count) {
  const entries = await fsp.readdir(communityDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (dirs.length <= count) return dirs;
  const step = dirs.length / count;
  return Array.from({ length: count }, (_, i) => dirs[Math.floor(i * step)]);
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

  // No argument: sample whatever is actually installed. This used to be a
  // fixed list of the packages each parsing bug was found in, which meant the
  // probe printed nothing at all for anyone who did not own those same
  // add-ons.
  const names = await samplePackages(communityDir, SAMPLE_SIZE);
  if (!names.length) {
    console.error('No packages in', communityDir);
    process.exit(1);
  }
  console.log(`Sampling ${names.length} of the packages in ${communityDir}`);
  console.log('Pass a package name as an argument to probe one in particular.\n');
  for (const name of names) {
    console.log('===', name);
    await detail(name, communityDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
