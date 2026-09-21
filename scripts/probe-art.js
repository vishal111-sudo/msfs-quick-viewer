'use strict';

// Developer probe: hammers the art cache the way a screenful of cards does,
// to confirm the request queue keeps us under Wikipedia's rate limit.
//   node scripts/probe-art.js [count]

const os = require('node:os');
const path = require('node:path');

const { scanAll } = require('../src/main/scanner');
const { ArtCache } = require('../src/main/art');

async function main() {
  const count = Number(process.argv[2]) || 25;
  const cache = new ArtCache(path.join(os.tmpdir(), 'msfsqv-art-probe'));
  await cache.init();

  const scan = await scanAll();
  const targets = scan.aircraft.filter((a) => !a.thumbnail).slice(0, count);
  console.log(`requesting art for ${targets.length} aircraft, all at once…`);

  const startedAt = Date.now();
  // Fire them in parallel exactly like the grid does; the cache must serialise.
  const results = await Promise.all(targets.map((aircraft) => cache.fetchFor(aircraft)));

  let hits = 0;
  for (const [index, result] of results.entries()) {
    const aircraft = targets[index];
    const entry = cache.entry(aircraft.id);
    if (result) {
      hits += 1;
      console.log('  OK  ', aircraft.name, '->', result.pageTitle);
    } else {
      console.log('  MISS', aircraft.name, '->', (entry && entry.error) || 'no image on any matching article');
    }
  }

  console.log(`\n${hits}/${targets.length} resolved in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  const failures = results.filter((_, i) => {
    const entry = cache.entry(targets[i].id);
    return entry && entry.transient;
  });
  console.log(failures.length ? `TRANSIENT FAILURES: ${failures.length}` : 'no rate-limit or network failures');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
