#!/usr/bin/env node
/* ============================================================================
   SeasonScope nightly data snapshot — run by GitHub Actions
   (.github/workflows/refresh-data.yml), or manually: node scripts/fetch_data.mjs

   - PRICES: Stooq daily CSV per asset (no key needed — the Action talks to
     Stooq directly, so no CORS proxy is involved) -> data/prices/<symbol>.csv
   - FUNDAMENTALS (optional, needs the FMP_KEY repo secret): Financial Modeling
     Prep rating, DCF fair value, analyst recommendations and a penny screener
     -> data/fundamentals.json
   - data/meta.json records the last successful run, which the app displays.

   Files are only overwritten on a successful fetch, so a flaky night degrades
   freshness, never availability. The asset list is parsed from index.html so
   there is a single source of truth — edit tickers there only.

   Self-test (no network): SELFTEST=1 node scripts/fetch_data.mjs
   ============================================================================ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const PRICES = path.join(DATA, 'prices');
const FMP_KEY = process.env.FMP_KEY || '';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Parse the ASSETS array out of index.html (single source of truth). */
function parseAssets(html){
  const block = html.match(/const ASSETS = \[([\s\S]*?)\];/);
  if(!block) throw new Error('ASSETS array not found in index.html');
  const out = [];
  const re = /\{g:'([^']+)',\s*t:'([^']+)',\s*n:(?:'([^']*)'|"([^"]*)")\}/g;
  let m;
  while((m = re.exec(block[1]))) out.push({ g: m[1], t: m[2], n: m[3] ?? m[4] });
  if(!out.length) throw new Error('no assets parsed from index.html');
  return out;
}

function looksLikeStooqCsv(txt){
  if(!txt) return false;
  const head = txt.slice(0, 200).toLowerCase();
  return head.includes('date') && head.includes('close') && txt.trim().split('\n').length > 24;
}

async function fetchText(url, timeoutMs = 30000){
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try{
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'seasonscope-data/1.0' } });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(to); }
}

async function fetchStooq(symbol){
  const d2 = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const q = `/q/d/l/?s=${encodeURIComponent(symbol)}&i=d&d1=19800101&d2=${d2}`;
  for(const host of ['https://stooq.com', 'https://stooq.pl']){
    for(let attempt = 0; attempt < 2; attempt++){
      try{
        const txt = await fetchText(host + q);
        if(/exceeded the daily hits limit/i.test(txt)) throw new Error('stooq hit limit');
        if(looksLikeStooqCsv(txt)) return txt;
        throw new Error('not CSV: ' + txt.slice(0, 60).replace(/\s+/g, ' '));
      }catch(e){
        if(attempt === 1) console.warn(`  ${symbol} via ${host}: ${e.message}`);
        await sleep(800);
      }
    }
  }
  return null;
}

async function fmpJson(p){
  const sep = p.includes('?') ? '&' : '?';
  const txt = await fetchText(`https://financialmodelingprep.com/api/v3/${p}${sep}apikey=${FMP_KEY}`);
  return JSON.parse(txt);
}

/* aapl.us -> AAPL, brk-b.us -> BRK-B (FMP uses uppercase US tickers). */
const toFmpSymbol = t => t.slice(0, -3).toUpperCase();

async function main(){
  fs.mkdirSync(PRICES, { recursive: true });
  const assets = parseAssets(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  console.log(`Assets: ${assets.length}`);

  // ---- prices (Stooq, keyless) ----
  const pricesOk = [], pricesFailed = [];
  for(const a of assets){
    const csv = await fetchStooq(a.t);
    if(csv){ fs.writeFileSync(path.join(PRICES, a.t + '.csv'), csv); pricesOk.push(a.t); }
    else pricesFailed.push(a.t);
    await sleep(350);                            // be polite to Stooq
  }
  console.log(`Prices: ${pricesOk.length} ok, ${pricesFailed.length} failed${pricesFailed.length ? ' (' + pricesFailed.join(', ') + ')' : ''}`);

  // ---- fundamentals (FMP, optional — skipped cleanly when no key) ----
  const fmpErrors = [];
  if(FMP_KEY){
    const bySymbol = {};
    const usStocks = assets.filter(a => (a.g === 'Stocks' || a.g === 'Penny') && a.t.endsWith('.us'));
    for(const a of usStocks){
      const sym = toFmpSymbol(a.t);
      const entry = { fmp: sym };
      try{
        const r = await fmpJson(`rating/${sym}`);
        if(Array.isArray(r) && r[0]){ entry.rating = r[0].rating; entry.ratingScore = r[0].ratingScore; entry.ratingRecommendation = r[0].ratingRecommendation; }
      }catch(e){ fmpErrors.push(`rating ${sym}: ${e.message}`); }
      try{
        const r = await fmpJson(`discounted-cash-flow/${sym}`);
        const row = Array.isArray(r) ? r[0] : r;
        if(row && row.dcf){
          entry.dcf = +(+row.dcf).toFixed(2);
          const price = +(row['Stock Price'] ?? row.price);
          if(price){ entry.price = price; entry.dcfGapPct = +(((entry.dcf - price) / price) * 100).toFixed(1); }
        }
      }catch(e){ fmpErrors.push(`dcf ${sym}: ${e.message}`); }
      try{
        const r = await fmpJson(`analyst-stock-recommendations/${sym}`);
        if(Array.isArray(r) && r[0]){
          const x = r[0];
          entry.rec = {
            period: x.date,
            buy: (x.analystRatingsbuy || 0) + (x.analystRatingsStrongBuy || 0),
            hold: x.analystRatingsHold || 0,
            sell: (x.analystRatingsSell || 0) + (x.analystRatingsStrongSell || 0),
          };
        }
      }catch(e){ fmpErrors.push(`recs ${sym}: ${e.message}`); }
      if(Object.keys(entry).length > 1) bySymbol[a.t] = entry;
      await sleep(250);                          // stay well inside FMP free-tier rate limits
    }

    let pennyScreen = null;
    try{
      const r = await fmpJson('stock-screener?priceLowerThan=5&priceMoreThan=0.5&volumeMoreThan=500000&marketCapMoreThan=50000000&isActivelyTrading=true&exchange=NASDAQ,NYSE&limit=15');
      if(Array.isArray(r) && r.length) pennyScreen = r.map(x => ({ symbol: x.symbol, name: x.companyName, price: x.price, marketCap: x.marketCap, volume: x.volume, sector: x.sector || null }));
    }catch(e){ fmpErrors.push('screener: ' + e.message); }

    fs.writeFileSync(path.join(DATA, 'fundamentals.json'),
      JSON.stringify({ updatedAt: new Date().toISOString(), bySymbol, pennyScreen }, null, 1));
    console.log(`Fundamentals: ${Object.keys(bySymbol).length} symbols, screener ${pennyScreen ? pennyScreen.length : 'n/a'}, ${fmpErrors.length} endpoint errors`);
    if(fmpErrors.length) console.log('  ' + fmpErrors.slice(0, 12).join('\n  '));
  } else {
    console.log('FMP_KEY not set — skipping fundamentals (prices snapshot still updated).');
  }

  if(pricesOk.length === 0){
    console.error('All price fetches failed — keeping previous snapshot, marking run failed.');
    process.exit(1);                             // job fails -> nothing committed
  }

  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    prices: { ok: pricesOk.length, failed: pricesFailed },
    fundamentals: FMP_KEY ? { errors: fmpErrors.length } : null,
  }, null, 1));
  console.log('Snapshot complete.');
}

if(process.env.SELFTEST === '1'){
  // No-network checks of the pure helpers, against the real index.html.
  const assets = parseAssets(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  console.log('selftest: assets parsed =', assets.length);
  const fail = msg => { console.error('selftest FAILED:', msg); process.exit(1); };
  if(!assets.find(a => a.t === 'aapl.us')) fail('aapl.us missing');
  if(!assets.find(a => a.n === "McDonald's")) fail('double-quoted name (McDonald\'s) not parsed');
  if(!assets.find(a => a.t === 'brk-b.us')) fail('brk-b.us missing');
  if(toFmpSymbol('brk-b.us') !== 'BRK-B') fail('FMP symbol mapping');
  if(!looksLikeStooqCsv('Date,Open,High,Low,Close\n' + '2024-01-02,1,1,1,1\n'.repeat(30))) fail('csv positive check');
  if(looksLikeStooqCsv('<html>nope</html>')) fail('csv negative check');
  console.log('selftest OK');
} else {
  main().catch(e => { console.error(e); process.exit(1); });
}
