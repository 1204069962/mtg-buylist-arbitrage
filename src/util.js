'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_DIR = path.join(__dirname, '..', 'output');
const UA = 'Mozilla/5.0 (compatible; mtg-buylist-arbitrage/1.0; privater Preisvergleich)';

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
  return cfg;
}

function ensureDirs() {
  for (const d of [DATA_DIR, OUT_DIR]) fs.mkdirSync(d, { recursive: true });
}

function isFresh(file, hours) {
  try {
    const st = fs.statSync(file);
    return (Date.now() - st.mtimeMs) < hours * 3600 * 1000 && st.size > 0;
  } catch { return false; }
}

async function download(url, file, { hours = 12, force = false, headers = {} } = {}) {
  if (!force && isFresh(file, hours)) {
    log(`cache  ${path.basename(file)} (jünger als ${hours}h)`);
    return file;
  }
  log(`lade   ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file + '.tmp', buf);
  fs.renameSync(file + '.tmp', file);
  log(`fertig ${path.basename(file)} (${(buf.length / 1e6).toFixed(1)} MB)`);
  return file;
}

function gunzipFile(file) {
  return zlib.gunzipSync(fs.readFileSync(file));
}

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${msg}`);
}

function normName(s) {
  return s
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
}

function eur(n) {
  return n == null || Number.isNaN(n) ? '' : n.toFixed(2).replace('.', ',') + ' €';
}

module.exports = { DATA_DIR, OUT_DIR, UA, loadConfig, ensureDirs, isFresh, download, gunzipFile, log, normName, eur };
