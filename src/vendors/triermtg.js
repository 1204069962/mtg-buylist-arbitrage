'use strict';
// Vendor-Adapter: TrierMTG (mtgkartenankauf.de)
// Die Ankaufsliste ist komplett als HTML-Tabelle auf buylist.html eingebettet:
//   <tr><td>Name</td><td>€EN</td><td>€DE</td><td> ...pro Set ein <a data-content="..."><i class="ss ss-CODE ss-RARITY"></i></a> ...</td></tr>
const fs = require('fs');
const path = require('path');
const { DATA_DIR, UA, download, log } = require('../util');

const VENDOR = {
  id: 'triermtg',
  name: 'TrierMTG',
  url: 'https://mtgkartenankauf.de/buylist.html',
  sellUrl: 'https://mtgkartenankauf.de/selling.html',
  maxQty: 8,
  minCondition: 'EX',
  note: 'Nur reguläre Versionen (keine Promos / Special Artworks), bis zu 8 Stück pro Karte, Englisch oder Deutsch.',
};

const NON_SET_TOKENS = new Set(['2x', '3x', '4x', '5x', '6x', 'grad', 'fw', 'common', 'uncommon', 'rare', 'mythic', 'special', 'timeshifted', 'bonus', 'foil']);

async function fetchBuylist(cfg, { force = false } = {}) {
  const file = path.join(DATA_DIR, 'triermtg-buylist.html');
  // Der Server leitet ohne Cookie in einer Schleife um; fetch folgt Redirects und übernimmt den PHPSESSID-Cookie nicht automatisch,
  // daher erst eine Anfrage für das Cookie, dann die eigentliche.
  if (force || !require('../util').isFresh(file, cfg.cacheHours)) {
    const first = await fetch(VENDOR.url, { headers: { 'User-Agent': UA }, redirect: 'manual' });
    const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
    await download(VENDOR.url, file, { hours: cfg.cacheHours, force: true, headers: cookie ? { Cookie: cookie } : {} });
  } else {
    log(`cache  triermtg-buylist.html (jünger als ${cfg.cacheHours}h)`);
  }
  return parseBuylist(fs.readFileSync(file, 'utf8'));
}

function decodeEntities(s) {
  return s.replace(/&euro;/g, '€').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
}

function parsePrice(s) {
  const m = decodeEntities(s).replace(/[^\d.,]/g, '').replace(',', '.');
  const v = parseFloat(m);
  return Number.isFinite(v) ? v : null;
}

function parseBuylist(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = trRe.exec(html))) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
    if (tds.length < 4) continue;
    const name = decodeEntities(tds[0].replace(/<[^>]*>/g, '')).trim();
    if (!name) continue;
    const priceEN = parsePrice(tds[1]);
    const priceDE = parsePrice(tds[2]);
    const sets = [];
    for (const a of tds[3].matchAll(/<a\b[^>]*data-content="([\s\S]*?)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const content = a[1];
      const inner = a[2];
      const cls = (inner.match(/class="([^"]*)"/) || [])[1] || '';
      const tokens = cls.split(/\s+/).filter(t => t.startsWith('ss-')).map(t => t.slice(3));
      const code = tokens.find(t => !NON_SET_TOKENS.has(t)) || null;
      const rarity = tokens.find(t => ['common', 'uncommon', 'rare', 'mythic', 'special'].includes(t)) || null;
      const vendorProductId = (content.match(/addOneCopyToCart\((\d+)\)/) || [])[1] || null;
      const vendorCardId = (content.match(/cardpage\.html\?p=c&(?:amp;)?s=(\d+)/) || [])[1] || null;
      const img = (content.match(/<img src='([^']+)'/) || [])[1] || null;
      // Bildpfad enthält das Ursprungs-Set, z.B. //media.wizards.com/2022/clb/... -> hilft bei "The List"-Karten
      const imageSet = img ? ((img.match(/media[.]wizards[.]com[/][0-9]{4}[/]([a-z0-9]+)[/]/) || [])[1] || null) : null;
      const timeshifted = tokens.includes('timeshifted') || (code === 'tsp' && !rarity);
      sets.push({ code, rarity, vendorProductId, vendorCardId, image: img ? 'https:' + img : null, imageSet, timeshifted });
    }
    rows.push({ name, priceEN, priceDE, sets });
  }
  log(`TrierMTG: ${rows.length} Zeilen, ${rows.reduce((a, r) => a + r.sets.length, 0)} Karte/Set-Kombinationen geparst`);
  return { vendor: VENDOR, fetchedAt: new Date().toISOString(), rows };
}

module.exports = { VENDOR, fetchBuylist, parseBuylist };
