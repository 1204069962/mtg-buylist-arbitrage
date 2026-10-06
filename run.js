'use strict';
// Einstiegspunkt: node run.js [--force] [--no-fetch] [--open]
//   --force     Downloads erzwingen (Cache ignorieren)
//   --no-fetch  nur mit vorhandenen Daten rechnen
//   --open      Report danach im Browser öffnen
const { spawn } = require('child_process');
const { loadConfig, ensureDirs, log } = require('./src/util');
const { loadPriceGuide, loadScryfall } = require('./src/prices');
const { compare, filterDeals } = require('./src/compare');
const { writeAll } = require('./src/report');

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = loadConfig();
  if (args.has('--no-fetch')) cfg.cacheHours = 1e9;
  const force = args.has('--force');
  ensureDirs();

  const [priceGuide, scry] = await Promise.all([loadPriceGuide(cfg, { force }), loadScryfall(cfg, { force })]);

  const allDeals = [];
  const allUnmatched = [];
  const stats = { combos: 0, matched: 0, unmatched: 0 };
  const vendorName = [];
  const vendorUrl = [];
  for (const vid of cfg.vendors) {
    const vendor = require(`./src/vendors/${vid}`);
    const buylist = await vendor.fetchBuylist(cfg, { force });
    const { results, unmatched, stats: s } = compare(buylist, scry, priceGuide, cfg);
    const deals = filterDeals(results, cfg);
    log(`${buylist.vendor.name}: ${deals.length} Deals über Schwelle (Marge >= ${cfg.minMarginAbs} EUR und >= ${(cfg.minMarginPct * 100).toFixed(0)} %)`);
    allDeals.push(...deals);
    allUnmatched.push(...unmatched);
    stats.combos += s.combos; stats.matched += s.matched; stats.unmatched += s.unmatched;
    vendorName.push(buylist.vendor.name); vendorUrl.push(buylist.vendor.url);
  }
  allDeals.sort((a, b) => b.marginNet - a.marginNet);

  const meta = {
    generatedAt: new Date().toLocaleString('de-DE'),
    priceGuideDate: priceGuide.createdAt,
    vendorName: vendorName.join(', '),
    vendorUrl: vendorUrl.join(', '),
    stats,
  };
  const out = writeAll(allDeals, allUnmatched, meta, cfg);

  console.log('\nTop 25 Deals:');
  console.log(allDeals.slice(0, 25).map(d =>
    `  ${d.marginNet.toFixed(2).padStart(6)} EUR  ${d.name} [${d.set}]  Ankauf ${d.buyEN.toFixed(2)} / CM ${d.cost.toFixed(2)}`
  ).join('\n'));
  console.log(`\nDateien:\n  ${out.html}\n  ${out.csv}\n  ${out.wants}`);

  if (args.has('--open')) spawn('cmd', ['/c', 'start', '', out.html], { detached: true, stdio: 'ignore' }).unref();
}

main().catch(e => { console.error('FEHLER:', e); process.exit(1); });
