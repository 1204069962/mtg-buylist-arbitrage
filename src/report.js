'use strict';
const fs = require('fs');
const path = require('path');
const { OUT_DIR, eur, log } = require('./util');

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function writeCsv(deals, file) {
  const cols = ['name', 'set', 'setName', 'cn', 'rarity', 'buyEN', 'buyDE', 'cost', 'trend', 'low', 'avg7', 'avg30', 'margin', 'marginNet', 'marginSolo', 'marginPct', 'maxQty', 'potential', 'variantMatch', 'cardmarketId', 'cardmarketUrl', 'scryfallUrl', 'vendorImage'];
  const lines = [cols.join(';')];
  for (const d of deals) {
    lines.push(cols.map(c => {
      let v = d[c];
      if (typeof v === 'number') v = (c === 'marginPct' ? (v * 100).toFixed(1) : v.toFixed(2)).replace('.', ',');
      return csvEscape(v);
    }).join(';'));
  }
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf8');
}

function writeWants(deals, file) {
  // Format für Cardmarket "Wants" -> Import (Deckliste): "<Anzahl> <Kartenname>"
  // Cardmarket importiert nur den Namen; das Set muss danach in der Wants-Liste geprüft/eingeschränkt werden.
  // Pro Kartenname nur eine Zeile (dieselbe Karte kann aus mehreren Sets als Deal auftauchen)
  const seen = new Set();
  const lines = [];
  for (const d of deals) {
    const n = d.name.split(' // ')[0];
    if (seen.has(n)) continue;
    seen.add(n);
    lines.push(`${d.maxQty} ${n}`);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

function writeHtml(deals, meta, cfg, file) {
  const rows = deals.map((d, i) => `
<tr>
<td>${i + 1}</td>
<td class="name"><a href="${d.cardmarketUrl}" target="_blank" rel="noopener">${esc(d.name)}</a>${d.variantMatch ? ' <span class="warn" title="Keine eindeutige reguläre Version gefunden – bitte Bild vergleichen">&#9888;</span>' : ''}</td>
<td><span class="set" title="${esc(d.setName)}">${d.set}</span> <small>#${esc(d.cn)}</small></td>
<td class="r">${eur(d.buyEN)}</td>
<td class="r">${eur(d.buyDE)}</td>
<td class="r">${eur(d.cost)}</td>
<td class="r muted">${eur(d.low)}</td>
<td class="r muted">${eur(d.avg7)}</td>
<td class="r strong">${eur(d.marginNet)}</td>
<td class="r ${d.marginSolo >= (cfg.minMarginAbs || 0) ? 'ok' : 'muted'}">${eur(d.marginSolo)}</td>
<td class="r">${d.marginPct == null ? '' : (d.marginPct * 100).toFixed(0) + ' %'}</td>
<td class="r">${eur(d.potential)}</td>
<td class="links"><a href="${d.cardmarketUrl}" target="_blank" rel="noopener">CM</a> &middot; <a href="${d.scryfallUrl}" target="_blank" rel="noopener">SF</a>${d.vendorImage ? ` &middot; <a href="${d.vendorImage}" target="_blank" rel="noopener">Bild</a>` : ''}</td>
</tr>`).join('');

  const total = deals.reduce((a, d) => a + d.potential, 0);
  const avg = deals.length ? deals.reduce((a, d) => a + d.marginNet, 0) / deals.length : 0;
  const { shippingShares } = require('./compare');
  const { cmShipFull, cmShip, vendorShip } = shippingShares(cfg);
  const langName = { 1: 'Englisch', 3: 'Deutsch' }[cfg.cardmarketLanguageId] || ('Sprache ' + cfg.cardmarketLanguageId);
  const condName = { 1: 'Mint', 2: 'Near Mint', 3: 'Excellent', 4: 'Good' }[cfg.cardmarketMinCondition] || ('Zustand ' + cfg.cardmarketMinCondition);

  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>Buylist-Arbitrage</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e3e3e3;--acc:#0b6e4f;--warn:#b45309;--head:#f6f6f6}
@media(prefers-color-scheme:dark){:root{--bg:#121212;--fg:#eee;--muted:#9a9a9a;--line:#2a2a2a;--acc:#4ade80;--warn:#fbbf24;--head:#1c1c1c}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}.meta{color:var(--muted);margin-bottom:12px}
.kpi{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0}.kpi div{border:1px solid var(--line);border-radius:8px;padding:8px 12px}.kpi b{display:block;font-size:18px}
input{padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);width:260px;max-width:100%}
table{border-collapse:collapse;width:100%;margin-top:12px}th,td{padding:5px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{background:var(--head);position:sticky;top:0;cursor:pointer;text-align:left}th.r,td.r{text-align:right}
td.name{white-space:normal;min-width:180px}.strong{font-weight:600;color:var(--acc)}.ok{color:var(--acc)}.muted{color:var(--muted)}.warn{color:var(--warn)}
.set{font-family:ui-monospace,monospace;font-size:12px;border:1px solid var(--line);border-radius:4px;padding:0 4px}
a{color:inherit}.links a{color:var(--acc)}.foot{color:var(--muted);margin-top:16px;font-size:12px;white-space:normal}
</style></head><body>
<h1>Buylist-Arbitrage: ${esc(meta.vendorName)} vs. Cardmarket</h1>
<div class="meta">Erstellt ${esc(meta.generatedAt)} &middot; Cardmarket Price Guide vom ${esc(meta.priceGuideDate)} &middot; Einkaufsbasis: <b>${esc(cfg.priceBasis)}</b> &middot; Versand Cardmarket: ${eur(cmShipFull)} je Verkäufer, gebündelt auf ${cfg.assumedCardsPerSeller} Karten = ${eur(cmShip)} je Karte &middot; Versand zum Ankäufer: ${eur(vendorShip)} je Karte &middot; Mindestmarge: ${eur(cfg.minMarginAbs)}</div>
<div class="meta"><b>Cardmarket-Links sind vorgefiltert auf ${esc(langName)}, Zustand mindestens ${esc(condName)}, nicht signiert, nicht verändert.</b> Bitte beim Kauf prüfen, dass der Filter aktiv ist (Cardmarket merkt sich Filter pro Sitzung).</div>
<div class="kpi"><div>Deals<b>${deals.length}</b></div><div>Marge pro Karte (Schnitt)<b>${eur(avg)}</b></div><div>Potenzial (je ${cfg.maxQtyPerCard} Stück)<b>${eur(total)}</b></div><div>Zugeordnet<b>${meta.stats.matched} / ${meta.stats.combos}</b></div></div>
<input id="q" placeholder="Filter: Name oder Set" oninput="flt()">
<table id="t"><thead><tr>
<th>#</th><th>Karte</th><th>Set</th><th class="r">Ankauf EN</th><th class="r">Ankauf DE</th><th class="r">CM ${esc(cfg.priceBasis)}</th><th class="r">CM low</th><th class="r">CM avg7</th><th class="r" title="Ankauf minus Cardmarket-Preis minus Versandanteil, wenn man mehrere Karten beim selben Verkäufer bündelt">Marge gebündelt</th><th class="r" title="Marge, wenn man nur diese eine Karte bei einem Verkäufer kauft (voller Versand)">Marge einzeln</th><th class="r">Marge %</th><th class="r">Potenzial x${cfg.maxQtyPerCard}</th><th>Links</th>
</tr></thead><tbody>${rows}</tbody></table>
<div class="foot">
<p><b>Lesehilfe:</b> "Marge gebündelt" = Ankaufspreis EN minus Cardmarket-${esc(cfg.priceBasis)}-Preis minus anteiliger Versand (${eur(cmShipFull)} je Verkäufer auf ${cfg.assumedCardsPerSeller} Karten verteilt). "Marge einzeln" rechnet den vollen Versand auf diese eine Karte; grün = lohnt sich auch allein. Für die Bündelung: output/wants.txt in eine Cardmarket-Wants-Liste importieren und den Einkaufsassistenten nutzen, der sucht die günstigste Verkäuferkombination inkl. Versand. "CM low" ist das günstigste Angebot überhaupt (beliebiger Zustand und Sprache) und daher nur eine Untergrenze. Beim Kauf auf Cardmarket Filter setzen: Sprache Englisch, Zustand mindestens EX. Das Warnzeichen bedeutet: keine eindeutige reguläre Version gefunden, Bild bei ${esc(meta.vendorName)} vergleichen.</p>
<p>Datenquellen: ${esc(meta.vendorName)} Ankaufsliste (${esc(meta.vendorUrl)}), Cardmarket Price Guide (öffentlich), Scryfall. Keine Gewähr, Preise ändern sich laufend.</p>
</div>
<script>
function flt(){var q=document.getElementById('q').value.toLowerCase();var trs=document.querySelectorAll('#t tbody tr');for(var i=0;i<trs.length;i++){trs[i].style.display=trs[i].textContent.toLowerCase().indexOf(q)>=0?'':'none';}}
function num(s){return parseFloat(s.replace(/\\./g,'').replace(',','.').replace(/[^\\d.-]/g,''));}
var ths=document.querySelectorAll('#t th');
Array.prototype.forEach.call(ths,function(th,i){var asc=false;th.onclick=function(){asc=!asc;var tb=document.querySelector('#t tbody');var rows=Array.prototype.slice.call(tb.rows);rows.sort(function(a,b){var x=a.cells[i].textContent.trim(),y=b.cells[i].textContent.trim();var nx=num(x),ny=num(y);var r=(!isNaN(nx)&&!isNaN(ny))?nx-ny:x.localeCompare(y,'de');return asc?r:-r;});rows.forEach(function(r){tb.appendChild(r);});};});
</script>
</body></html>`;
  fs.writeFileSync(file, html, 'utf8');
}

function writeAll(deals, unmatched, meta, cfg) {
  const csv = path.join(OUT_DIR, 'deals.csv');
  const html = path.join(OUT_DIR, 'report.html');
  const wants = path.join(OUT_DIR, 'wants.txt');
  const um = path.join(OUT_DIR, 'nicht-zugeordnet.csv');
  writeCsv(deals, csv);
  writeHtml(deals, meta, cfg, html);
  writeWants(deals, wants);
  const umLines = unmatched.map(u => [u.name, u.priceEN, u.set && u.set.code, u.reason, u.set && u.set.image].map(csvEscape).join(';'));
  fs.writeFileSync(um, '﻿name;ankaufEN;setCode;grund;bild\r\n' + umLines.join('\r\n'), 'utf8');
  // Verlauf: pro Lauf eine Zeile, um die Entwicklung zu sehen
  const hist = path.join(OUT_DIR, 'verlauf.csv');
  if (!fs.existsSync(hist)) fs.writeFileSync(hist, '﻿zeitpunkt;deals;potenzial\r\n', 'utf8');
  const potential = deals.reduce((a, d) => a + d.potential, 0).toFixed(2).replace('.', ',');
  fs.appendFileSync(hist, `${meta.generatedAt};${deals.length};${potential}\r\n`, 'utf8');
  log(`Report: ${html}`);
  return { csv, html, wants, um };
}

module.exports = { writeAll };
