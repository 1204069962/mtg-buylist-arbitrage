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
    if (buylist.rows.length < (cfg.minBuylistRows || 1000)) {
      throw new Error(`${buylist.vendor.name}: nur ${buylist.rows.length} Zeilen geparst – Seitenaufbau geändert? Lauf abgebrochen, alter Report bleibt stehen.`);
    }
    const { results, unmatched, stats: s } = compare(buylist, scry, priceGuide, cfg);
    if (s.matched / Math.max(1, s.combos) < (cfg.minMatchRate || 0.9)) {
      throw new Error(`${buylist.vendor.name}: nur ${s.matched}/${s.combos} zugeordnet – Datenquelle defekt? Lauf abgebrochen.`);
    }
    const deals = filterDeals(results, cfg);
    log(`${buylist.vendor.name}: ${deals.length} Deals über Schwelle (Marge >= ${cfg.minMarginAbs} EUR und >= ${(cfg.minMarginPct * 100).toFixed(0)} %)`);
    allDeals.push(...deals);
    allUnmatched.push(...unmatched);
    stats.combos += s.combos; stats.matched += s.matched; stats.unmatched += s.unmatched;
    vendorName.push(buylist.vendor.name); vendorUrl.push(buylist.vendor.url);
  }
  allDeals.sort((a, b) => b.marginNet - a.marginNet);

  // Was ist neu bzw. hat sich geändert seit dem letzten Stand? Quelle: lokale deals.csv vom letzten Lauf,
  // sonst die veröffentlichte Version (im GitHub-Lauf gibt es keine lokale).
  const previous = await loadPreviousDeals(cfg);
  let newCount = 0;
  for (const d of allDeals) {
    const prev = previous.get(String(d.cardmarketId));
    d.isNew = !prev;
    d.prevMarginNet = prev ? prev.marginNet : null;
    d.marginDelta = prev ? d.marginNet - prev.marginNet : null;
    if (d.isNew) newCount++;
  }
  log(`Vergleich mit letztem Stand: ${previous.size} alte Deals, ${newCount} neu`);

  const meta = {
    generatedAt: new Date().toLocaleString('de-DE'),
    priceGuideDate: priceGuide.createdAt,
    vendorName: vendorName.join(', '),
    vendorUrl: vendorUrl.join(', '),
    stats,
    newCount,
    previousCount: previous.size,
    liveUrl: cfg.liveUrl || '',
  };
  const out = writeAll(allDeals, allUnmatched, meta, cfg);

  console.log('\nTop 25 Deals:');
  console.log(allDeals.slice(0, 25).map(d =>
    `  ${d.marginNet.toFixed(2).padStart(6)} EUR  ${d.name} [${d.set}]  Ankauf ${d.buyEN.toFixed(2)} / CM ${d.cost.toFixed(2)}`
  ).join('\n'));
  console.log(`\nDateien:\n  ${out.html}\n  ${out.csv}\n  ${out.wants}`);

  if (args.has('--open')) spawn('cmd', ['/c', 'start', '', out.html], { detached: true, stdio: 'ignore' }).unref();
}

async function loadPreviousDeals(cfg) {
  const fs = require('fs');
  const path = require('path');
  const { OUT_DIR } = require('./src/util');
  const local = path.join(OUT_DIR, 'deals.csv');
  let text = null;
  if (fs.existsSync(local)) text = fs.readFileSync(local, 'utf8');
  else if (cfg.liveUrl) {
    try {
      const res = await fetch(cfg.liveUrl.replace(/\/?$/, '/') + 'deals.csv', { headers: { 'User-Agent': 'mtg-buylist-arbitrage' } });
      if (res.ok) text = await res.text();
    } catch (e) { log('Vorheriger Stand nicht ladbar: ' + e.message); }
  }
  const map = new Map();
  if (!text) return map;
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
  const cols = lines[0].split(';');
  const iId = cols.indexOf('cardmarketId');
  const iM = cols.indexOf('marginNet');
  if (iId < 0 || iM < 0) return map;
  for (const l of lines.slice(1)) {
    const f = l.split(';');
    map.set(String(parseInt(f[iId], 10)), { marginNet: parseFloat(String(f[iM]).replace(',', '.')) });
  }
  return map;
}

main().catch(e => { console.error('FEHLER:', e); process.exit(1); });
