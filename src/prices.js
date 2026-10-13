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
const PRODUCT_LIST_URL = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_1.json';

// Öffentliche Cardmarket-Produktliste (idProduct, Name, idExpansion). Dient dazu, Drucke ohne
// Scryfall-cardmarket_id (z.B. viele "The List"-Karten) trotzdem einem Cardmarket-Produkt zuzuordnen.
async function loadProductList(cfg, opts = {}) {
  const file = path.join(DATA_DIR, 'cardmarket-products.json');
  await download(PRODUCT_LIST_URL, file, { hours: Math.max(cfg.cacheHours, 24), force: opts.force });
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const byId = new Map();
  const byName = new Map();
  for (const p of raw.products) {
    byId.set(p.idProduct, p);
    const k = normName(p.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  log(`Cardmarket Produktliste: ${byId.size} Produkte`);
  return { byId, byName };
}

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
  const products = await loadProductList(cfg, opts);
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
  const pending = [];           // Drucke ohne cardmarket_id, später nachschlagen
  const setExpVotes = {};       // Scryfall-Set -> { idExpansion: Anzahl }
  const add = (c, slim) => {
    const key = `${c.set}|${normName(c.name)}`;
    if (!bySetName.has(key)) bySetName.set(key, []);
    bySetName.get(key).push(slim);
    const nk = normName(c.name);
    if (!byName.has(nk)) byName.set(nk, []);
    byName.get(nk).push(slim);
    if (c.name.includes(' // ')) {
      const k2 = `${c.set}|${normName(c.name.split(' // ')[0])}`;
      if (!bySetName.has(k2)) bySetName.set(k2, []);
      bySetName.get(k2).push(slim);
    }
  };
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()) });
  for await (const line of rl) {
    if (!line) continue;
    let c;
    try { c = JSON.parse(line); } catch { continue; }
    if (c.digital) continue;
    const slim = {
      name: c.name, set: c.set, setName: c.set_name, cn: c.collector_number, cm: c.cardmarket_id,
      promo: !!c.promo, promoTypes: c.promo_types || [], frameEffects: c.frame_effects || [],
      border: c.border_color, fullArt: !!c.full_art, textless: !!c.textless, variation: !!c.variation,
      finishes: c.finishes || [], booster: !!c.booster, lang: c.lang, eur: c.prices && c.prices.eur ? parseFloat(c.prices.eur) : null,
      usd: c.prices && c.prices.usd ? parseFloat(c.prices.usd) : null,
      released: c.released_at, rarity: c.rarity, cmGuessed: false,
    };
    if (!c.cardmarket_id) { pending.push({ c, slim }); continue; }
    const prod = products.byId.get(c.cardmarket_id);
    if (prod) { const v = setExpVotes[c.set] = setExpVotes[c.set] || {}; v[prod.idExpansion] = (v[prod.idExpansion] || 0) + 1; }
    n++;
    add(c, slim);
  }
  // Nachschlagen über die Produktliste: gleicher Name in einer Cardmarket-Expansion, die zu diesem
  // Scryfall-Set gehört (mind. 20 bekannte Karten dort). Bei mehreren Treffern den mit dem zum
  // Erscheinungsdatum passendsten "dateAdded" nehmen. Solche Treffer werden im Report markiert.
  let guessed = 0;
  for (const { c, slim } of pending) {
    const votes = setExpVotes[c.set];
    if (!votes) continue;
    const exps = new Set(Object.entries(votes).filter(([, cnt]) => cnt >= 20).map(([e]) => +e));
    if (!exps.size) continue;
    const cands = (products.byName.get(normName(c.name)) || []).filter(pr => exps.has(pr.idExpansion));
    if (!cands.length) continue;
    const rel = Date.parse(c.released_at || '2000-01-01');
    cands.sort((a, b) => Math.abs(Date.parse(a.dateAdded) - rel) - Math.abs(Date.parse(b.dateAdded) - rel));
    slim.cm = cands[0].idProduct;
    slim.cmGuessed = true;
    guessed++;
    add(c, slim);
  }
  log(`Scryfall: ${n} Drucke mit Cardmarket-ID indiziert, ${guessed} weitere über die Produktliste zugeordnet (${pending.length - guessed} offen)`);
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
