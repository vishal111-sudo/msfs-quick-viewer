'use strict';

// Developer probe: full scan summary against the real install.
//   node scripts/probe-scan.js            summary + category breakdown
//   node scripts/probe-scan.js <filter>   list matching aircraft

const { scanAll } = require('../src/main/scanner');

function tally(items, pick) {
  const counts = new Map();
  for (const item of items) {
    const key = pick(item) || '(none)';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const filter = (process.argv[2] || '').toLowerCase();
  const result = await scanAll();

  console.log('installs:', result.installs.map((i) => `${i.id} -> ${i.packagesRoot}`).join(', '));
  console.log('duration:', result.durationMs, 'ms');
  console.log('stats   :', JSON.stringify(result.stats));

  if (filter) {
    const matches = result.aircraft.filter((a) => a.searchText.includes(filter));
    console.log(`\n${matches.length} match "${filter}":`);
    for (const a of matches) {
      console.log(
        ' ', a.name,
        '|', a.category,
        '|', a.source,
        '|', a.engineLabel,
        '| liveries:', a.liveryCount, `(${a.liveriesWithArt} art)`,
        '| art:', a.thumbnail ? 'local' : 'NEEDS ONLINE',
      );
    }
    return;
  }

  console.log('\nby category:');
  for (const [key, count] of tally(result.aircraft, (a) => a.category)) console.log('  ', count, key);
  console.log('\nby source:');
  for (const [key, count] of tally(result.aircraft, (a) => a.source)) console.log('  ', count, key);
  console.log('\ntop developers:');
  for (const [key, count] of tally(result.aircraft, (a) => a.developer).slice(0, 12)) console.log('  ', count, key);

  console.log('\nsample with local art:');
  for (const a of result.aircraft.filter((x) => x.thumbnail).slice(0, 10)) {
    console.log('  ', a.name, '|', a.category, '|', a.liveryCount, 'liveries');
  }
  console.log('\nsample needing online art:');
  for (const a of result.aircraft.filter((x) => !x.thumbnail).slice(0, 10)) {
    console.log('  ', a.name, '|', a.category, '|', a.source, '| wiki:', a.wiki || '(search)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
