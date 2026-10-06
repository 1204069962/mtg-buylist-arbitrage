'use strict';
const { normName, log } = require('./util');
const { isRegular } = require('./prices');

// Set-Codes, die bei Keyrune (TrierMTG-Icons) anders heißen als bei Scryfall.
// Wird bei Bedarf ergänzt (siehe output/nicht-zugeordnet.csv).
const SET_ALIASES = {
  mb1: 'plst',   // TrierMTG nutzt das Keyrune-Icon "mb1" (Planeswalker-Symbol) für "The List"
  plist: 'plst',
  med: 'me1',
  ssh: 'sld',
};

// Preis aus dem Price Guide holen; bei Foil-only-Drucken die Foil-Felder nehmen.
function priceFields(pg, foilOnly) {
  if (!pg) return null;
  const f = k => { const v = pg[foilOnly ? k + '-foil' : k]; return Number.isFinite(v) && v > 0 ? v : null; };
  return { trend: f('trend'), low: f('low'), avg1: f('avg1'), avg7: f('avg7'), avg30: f('avg30') };
}

/**
 * Für jede Buylist-Zeile und jedes darin genannte Set: passenden Scryfall-Druck finden,
 * Cardmarket-Preis nachschlagen, Marge berechnen.
 */
function compare(buylist, scry, priceGuide, cfg) {
  const basis = cfg.priceBasis || 'trend';
  const results = [];
  const unmatched = [];
  let combos = 0, matched = 0, matchedByAlias = 0;

  for (const row of buylist.rows) {
    if (row.priceEN == null || row.priceEN <= 0) continue;
    const nk = normName(row.name);
    for (const s of row.sets) {
      combos++;
      if (!s.code) { unmatched.push({ name: row.name, priceEN: row.priceEN, set: s, reason: 'kein Set-Code' }); continue; }
      const code = SET_ALIASES[s.code] || s.code;
      const tryCodes = [];
      if (s.timeshifted && code === 'tsp') tryCodes.push('tsb');
      tryCodes.push(code);
      if (s.imageSet && s.imageSet !== code) tryCodes.push(s.imageSet);
      tryCodes.push('p' + code, code.replace(/^p/, ''));
      let cands = [];
      let how = 'set';
      for (const tc of tryCodes) {
        cands = scry.bySetName.get(`${tc}|${nk}`) || [];
        if (cands.length) { how = tc === code ? 'set' : 'alias'; break; }
      }
      if (!cands.length) { unmatched.push({ name: row.name, priceEN: row.priceEN, set: s, reason: 'nicht bei Scryfall gefunden' }); continue; }

      // Reihenfolge: regulärer Nonfoil-Druck > regulärer Foil-only-Druck > sonstige Nonfoil-Versionen > Rest.
      // Etched-Drucke sind nie gemeint (Trier kauft nur "normale" Versionen).
      const noEtched = cands.filter(c => !c.finishes.includes('etched') || c.finishes.includes('nonfoil'));
      const isRegularAnyFinish = c => isRegular({ ...c, finishes: ['nonfoil'] }) && c.lang === 'en';
      let regular = cands.filter(isRegular);
      let variant = false;
      if (!regular.length) { regular = noEtched.filter(isRegularAnyFinish); variant = true; }
      if (!regular.length) { regular = noEtched.filter(c => c.lang === 'en' && c.finishes.includes('nonfoil')); variant = true; }
      if (!regular.length) { regular = noEtched.length ? noEtched : cands; variant = true; }

      // Für jede Kandidaten-Version Preis holen, die günstigste nehmen (Trier kauft "alle gezeigten Versionen")
      const priced = regular.map(c => {
        const foilOnly = !c.finishes.includes('nonfoil');
        const pf = priceFields(priceGuide.map.get(c.cm), foilOnly) || {};
        let price = pf[basis] ?? pf.trend ?? pf.avg7 ?? c.eur ?? null;
        // Konservativ: nie unter dem aktuell günstigsten Angebot (low) rechnen, wenn low plausibel ist (> 20 % des Trends)
        if (price != null && pf.low != null && pf.low > price && (pf.trend == null || pf.low > 0.2 * pf.trend)) price = pf.low;
        return { c, pf, price, foilOnly };
      }).filter(x => x.price != null);
      if (!priced.length) { unmatched.push({ name: row.name, priceEN: row.priceEN, set: s, reason: 'kein Cardmarket-Preis' }); continue; }
      priced.sort((a, b) => a.price - b.price);
      const best = priced[0];
      matched++; if (how !== 'set') matchedByAlias++;

      const cost = best.price;
      const margin = row.priceEN - cost;
      results.push({
        vendor: buylist.vendor.id,
        name: row.name,
        set: best.c.set.toUpperCase(),
        setName: best.c.setName,
        cn: best.c.cn,
        rarity: best.c.rarity,
        cardmarketId: best.c.cm,
        buyEN: row.priceEN,
        buyDE: row.priceDE,
        cost, // angenommener Einkaufspreis (priceBasis)
        trend: best.pf.trend,
        low: best.pf.low,
        avg1: best.pf.avg1,
        avg7: best.pf.avg7,
        avg30: best.pf.avg30,
        foilOnly: best.foilOnly,
        scryfallEur: best.c.eur,
        margin,
        marginPct: cost > 0 ? margin / cost : null,
        maxQty: Math.min(cfg.maxQtyPerCard || 8, buylist.vendor.maxQty || 8),
        variantMatch: variant || best.foilOnly,
        matchedVia: how,
        vendorImage: s.image,
        vendorProductId: s.vendorProductId,
        cardmarketUrl: `https://www.cardmarket.com/${cfg.language || 'de'}/Magic/Products?idProduct=${best.c.cm}&language=${cfg.cardmarketLanguageId || 1}&minCondition=${cfg.cardmarketMinCondition || 3}&isSigned=N&isAltered=N`,
        scryfallUrl: `https://scryfall.com/card/${best.c.set}/${encodeURIComponent(best.c.cn)}`,
      });
    }
  }
  log(`Vergleich: ${combos} Kombinationen, ${matched} zugeordnet (${matchedByAlias} per Alias), ${unmatched.length} offen`);
  return { results, unmatched, stats: { combos, matched, unmatched: unmatched.length } };
}

// Versandanteile je Karte:
//  - Cardmarket: Versand je Verkäufer, verteilt auf die Karten, die man bei ihm bündelt
//  - zum Ankäufer: Versand je Sendung, verteilt auf die Karten der Sendung (TrierMTG übernimmt ihn ab 50 EUR)
function shippingShares(cfg) {
  const cmShipFull = cfg.cardmarketShippingPerSeller || 0;
  const cmShip = cmShipFull / Math.max(1, cfg.assumedCardsPerSeller || 1);
  const vendorShip = (cfg.shippingToVendor || 0) / Math.max(1, cfg.assumedCardsPerVendorBatch || 1);
  return { cmShipFull, cmShip, vendorShip };
}

function filterDeals(results, cfg) {
  const { cmShipFull, cmShip, vendorShip } = shippingShares(cfg);
  const deals = results
    .filter(r => r.buyEN >= (cfg.minBuyPrice || 0))
    .map(r => ({
      ...r,
      marginNet: r.margin - cmShip - vendorShip,            // gebündelt: mehrere Karten beim selben Verkäufer
      marginSolo: r.margin - cmShipFull - vendorShip,       // einzeln: nur diese eine Karte bei einem Verkäufer
      potential: (r.margin - cmShip - vendorShip) * r.maxQty,
    }))
    .filter(r => r.marginNet >= (cfg.minMarginAbs || 0) && (r.marginPct == null || r.marginPct >= (cfg.minMarginPct || 0)))
    .sort((a, b) => b.marginNet - a.marginNet);
  // Pro Cardmarket-Produkt nur ein Eintrag (Trier kann denselben Namen in mehreren Zeilen führen)
  const seen = new Set();
  return deals.filter(d => { const k = d.cardmarketId; if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { compare, filterDeals, shippingShares };
