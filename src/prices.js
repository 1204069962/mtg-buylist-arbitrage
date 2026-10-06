'use strict';
// Lädt den öffentlichen Cardmarket Price Guide (alle Magic-Singles, aggregierte Preise)
// und die Scryfall-Bulk-Daten (liefern pro Druck die cardmarket_id -> Verknüpfung Name+Set -> Cardmarket-Produkt).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { DATA_DIR, UA, download, log, normName } = require('./util');

const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_1.json';
const SCRYFALL_BULK_INDEX = 'https://api.scryfall.com/bulk-data/default_cards';

async function loadPriceGuide(cfg, opts = {}) {
  const file = path.join(DATA_DIR, 'cardmarket-price-guide.json');
  await download(PRICE_GUIDE_URL, file, { hours: cfg.cacheHours, force: opts.force });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = new Map();
  for (const p of raw.priceGuides) map.set(p.idProduct, p);
  log(`Cardmarket Price Guide: ${map.size} Produkte, Stand ${raw.createdAt}`);
  return { createdAt: raw.createdAt, map };
}

async function loadScryfall(cfg, opts = {}) {
  const file = path.join(DATA_DIR, 'scryfall-default-cards.jsonl.gz');
  const { isFresh } = require('./util');
  if (opts.force || !isFresh(file, Math.max(cfg.cacheHours, 24))) {
    const meta = await (await fetch(SCRYFALL_BULK_INDEX, { headers: { 'User-Agent': UA, Accept: 'application/json' } })).json();
    const uri = meta.jsonl_download_uri || meta.download_uri;
    if (!uri) throw new Error('Scryfall bulk-data: keine Download-URI gefunden');
    await download(uri, file, { hours: 0, force: true });
  } else {
    log('cache  scryfall-default-cards.jsonl.gz');
  }
  // Index: "set|name" -> [cards]
  const bySetName = new Map();
  const byName = new Map();
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()) });
  for await (const line of rl) {
    if (!line) continue;
    let c;
    try { c = JSON.parse(line); } catch { continue; }
    if (!c.cardmarket_id || c.digital) continue;
    const slim = {
      name: c.name, set: c.set, setName: c.set_name, cn: c.collector_number, cm: c.cardmarket_id,
      promo: !!c.promo, promoTypes: c.promo_types || [], frameEffects: c.frame_effects || [],
      border: c.border_color, fullArt: !!c.full_art, textless: !!c.textless, variation: !!c.variation,
      finishes: c.finishes || [], booster: !!c.booster, lang: c.lang, eur: c.prices && c.prices.eur ? parseFloat(c.prices.eur) : null,
      released: c.released_at, rarity: c.rarity,
    };
    n++;
    const key = `${c.set}|${normName(c.name)}`;
    if (!bySetName.has(key)) bySetName.set(key, []);
    bySetName.get(key).push(slim);
    const nk = normName(c.name);
    if (!byName.has(nk)) byName.set(nk, []);
    byName.get(nk).push(slim);
    // Doppelseitige Karten: auch unter dem Vorderseiten-Namen eintragen
    if (c.name.includes(' // ')) {
      const front = normName(c.name.split(' // ')[0]);
      const k2 = `${c.set}|${front}`;
      if (!bySetName.has(k2)) bySetName.set(k2, []);
      bySetName.get(k2).push(slim);
    }
  }
  log(`Scryfall: ${n} Drucke mit Cardmarket-ID indiziert`);
  return { bySetName, byName };
}

// "Reguläre" Version = normaler Booster-Druck ohne Promo/Showcase/Extended/Borderless etc.
function isRegular(c) {
  if (c.promo || c.promoTypes.length) return false;
  if (c.fullArt || c.textless || c.border === 'borderless') return false;
  if (c.frameEffects.some(f => ['showcase', 'extendedart', 'etched', 'inverted', 'shatteredglass', 'borderless'].includes(f))) return false;
  if (!c.finishes.includes('nonfoil')) return false;
  if (c.lang !== 'en') return false;
  return true;
}

module.exports = { loadPriceGuide, loadScryfall, isRegular };
