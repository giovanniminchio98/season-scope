#!/usr/bin/env node
/* ============================================================================
   SeasonScope nightly data snapshot — run by GitHub Actions
   (.github/workflows/refresh-data.yml), or manually: node scripts/fetch_data.mjs

   DATA SOURCE: Yahoo Finance, fetched SERVER-SIDE (no browser → no CORS, and
   NO API KEY). Stooq was dropped because it 404s GitHub's runner IPs, and FMP
   was dropped because its free tier 403s the rating/DCF/analyst endpoints.

   - PRICES: /v8/finance/chart (full daily history) -> data/prices/<symbol>.csv
     written as "Date,Open,High,Low,Close,Volume" so the app's CSV parser reads
     it unchanged (Close = adjusted close, so seasonality handles splits/divs).
   - ANALYST DATA: /v10/finance/quoteSummary (mean price target -> over/under
     valued %, analyst buy/hold/sell consensus, rating) -> data/fundamentals.json
     This needs a Yahoo cookie+crumb; if that handshake fails the prices snapshot
     still succeeds and the app falls back to its price-based valuation.
   - data/meta.json records the last successful run, shown in the app.

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
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

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

/* Map our (Stooq-style) tickers to Yahoo symbols. */
function toYahoo(t){
  if(t.endsWith('.us')) return t.slice(0, -3).toUpperCase();                 // aapl.us -> AAPL, brk-b.us -> BRK-B
  if(t.endsWith('.f')){ const m = { 'gc.f':'GC=F','si.f':'SI=F','cl.f':'CL=F','ng.f':'NG=F','hg.f':'HG=F' }; return m[t] || null; }
  if(t.startsWith('^')){ const m = { '^spx':'^GSPC','^ndx':'^NDX','^dji':'^DJI','^vix':'^VIX' }; return m[t] || t.toUpperCase(); }
  if(t === 'btcusd') return 'BTC-USD';
  if(t === 'ethusd') return 'ETH-USD';
  if(/^[a-z]{6}$/.test(t)) return t.toUpperCase() + '=X';                     // eurusd -> EURUSD=X
  return t.toUpperCase();
}

async function fetchText(url, { timeout = 30000, headers = {} } = {}){
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeout);
  try{
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, ...headers } });
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return { text: await r.text(), res: r };
  } finally { clearTimeout(to); }
}

/* Yahoo chart JSON -> CSV string (Date,Open,High,Low,Close,Volume). */
function yahooChartToCsv(json){
  const res = json && json.chart && json.chart.result && json.chart.result[0];
  if(!res || !res.timestamp) return null;
  const ts = res.timestamp;
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const adj = res.indicators && res.indicators.adjclose && res.indicators.adjclose[0] && res.indicators.adjclose[0].adjclose;
  const close = (adj && adj.length === ts.length) ? adj : q.close;
  if(!close) return null;
  const lines = ['Date,Open,High,Low,Close,Volume'];
  for(let i = 0; i < ts.length; i++){
    const c = close[i];
    if(c == null || isNaN(c)) continue;
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    const o = q.open && q.open[i] != null ? q.open[i] : c;
    const hi = q.high && q.high[i] != null ? q.high[i] : c;
    const lo = q.low && q.low[i] != null ? q.low[i] : c;
    const v = q.volume && q.volume[i] != null ? q.volume[i] : 0;
    lines.push(`${d},${o},${hi},${lo},${c},${v}`);
  }
  return lines.length > 24 ? lines.join('\n') + '\n' : null;
}

async function fetchYahooPrices(stooqT){
  const ys = toYahoo(stooqT);
  if(!ys) return null;
  // Use explicit period1/period2 with interval=1d to get TRUE DAILY bars.
  // (range=max makes Yahoo ignore the interval and return coarse 3-month bars,
  // which collapsed the monthly matrix to only Mar/Jun/Sep/Dec.) period1 is
  // 1 Jan 1980 — the earliest year the app offers — covering full app range.
  const period1 = Math.floor(Date.UTC(1980, 0, 1) / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  for(const host of ['query1', 'query2']){
    for(let attempt = 0; attempt < 2; attempt++){
      try{
        const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ys)}?period1=${period1}&period2=${period2}&interval=1d`;
        const { text } = await fetchText(url);
        const csv = yahooChartToCsv(JSON.parse(text));
        if(csv) return csv;
        throw new Error('no chart data');
      }catch(e){
        if(attempt === 1) console.warn(`  ${stooqT} (${ys}) via ${host}: ${e.message}`);
        await sleep(700);
      }
    }
  }
  return null;
}

/* Yahoo needs a cookie + crumb for quoteSummary. Returns null if unavailable. */
async function yahooSession(){
  try{
    const r = await fetch('https://fc.yahoo.com/', { headers: { 'user-agent': UA } });
    const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    const { text: crumb } = await fetchText('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { cookie } });
    if(!crumb || /[<>{}]/.test(crumb) || crumb.length > 40) throw new Error('bad crumb');
    return { cookie, crumb };
  }catch(e){ console.warn('  Yahoo session (cookie/crumb) unavailable: ' + e.message); return null; }
}

async function fetchYahooFundamentals(ys, sess){
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ys)}`
    + `?modules=financialData,recommendationTrend,price&crumb=${encodeURIComponent(sess.crumb)}`;
  const { text } = await fetchText(url, { headers: { cookie: sess.cookie } });
  const json = JSON.parse(text);
  const res = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
  if(!res) return null;
  const fd = res.financialData || {};
  const pr = res.price || {};
  const trend = res.recommendationTrend && res.recommendationTrend.trend && res.recommendationTrend.trend[0];
  const price = (fd.currentPrice && fd.currentPrice.raw) ?? (pr.regularMarketPrice && pr.regularMarketPrice.raw);
  const target = fd.targetMeanPrice && fd.targetMeanPrice.raw;
  const out = {};
  if(pr.marketCap && pr.marketCap.raw != null) out.mktCap = pr.marketCap.raw;
  if(pr.longName || pr.shortName) out.name = pr.longName || pr.shortName;
  if(price != null) out.price = +price.toFixed(2);
  if(target != null && price){
    out.fair = +target.toFixed(2);
    out.fairLabel = 'analyst target';
    out.gapPct = +(((target - price) / price) * 100).toFixed(1);   // +ve = upside (under-valued vs target)
  }
  if(fd.recommendationKey && fd.recommendationKey !== 'none') out.ratingLabel = fd.recommendationKey.replace(/_/g, ' ');
  if(trend) out.rec = { buy: (trend.strongBuy || 0) + (trend.buy || 0), hold: trend.hold || 0, sell: (trend.sell || 0) + (trend.strongSell || 0) };
  return Object.keys(out).length ? out : null;
}

/* Candidate pool for the "top N by market cap" Discover universe. These large
   caps are price-snapshotted and market-cap-ranked nightly; the app then takes
   the top 50/100. Edit freely — it just needs to comfortably contain the
   biggest names so the cap is meaningful. (Forex/commodities/indices are not
   ranked here; the app always includes those from its own list.) */
const CANDIDATES_EXTRA = [
  {t:'goog.us',n:'Alphabet C'},{t:'avgo.us',n:'Broadcom'},{t:'lly.us',n:'Eli Lilly'},
  {t:'tsm.us',n:'Taiwan Semi'},{t:'lin.us',n:'Linde'},{t:'tmo.us',n:'Thermo Fisher'},
  {t:'abt.us',n:'Abbott'},{t:'acn.us',n:'Accenture'},{t:'mrk.us',n:'Merck'},
  {t:'dhr.us',n:'Danaher'},{t:'txn.us',n:'Texas Instruments'},{t:'nee.us',n:'NextEra'},
  {t:'pm.us',n:'Philip Morris'},{t:'hon.us',n:'Honeywell'},{t:'unp.us',n:'Union Pacific'},
  {t:'low.us',n:"Lowe's"},{t:'amgn.us',n:'Amgen'},{t:'sbux.us',n:'Starbucks'},
  {t:'intu.us',n:'Intuit'},{t:'gs.us',n:'Goldman Sachs'},{t:'ms.us',n:'Morgan Stanley'},
  {t:'blk.us',n:'BlackRock'},{t:'axp.us',n:'American Express'},{t:'schw.us',n:'Charles Schwab'},
  {t:'c.us',n:'Citigroup'},{t:'bkng.us',n:'Booking'},{t:'isrg.us',n:'Intuitive Surgical'},
  {t:'now.us',n:'ServiceNow'},{t:'adp.us',n:'ADP'},{t:'gild.us',n:'Gilead'},
  {t:'mdt.us',n:'Medtronic'},{t:'cvs.us',n:'CVS Health'},{t:'amt.us',n:'American Tower'},
  {t:'pld.us',n:'Prologis'},{t:'syk.us',n:'Stryker'},{t:'mmm.us',n:'3M'},
  {t:'mo.us',n:'Altria'},{t:'duk.us',n:'Duke Energy'},{t:'so.us',n:'Southern Co'},
  {t:'cb.us',n:'Chubb'},{t:'etn.us',n:'Eaton'},{t:'bsx.us',n:'Boston Scientific'},
  {t:'regn.us',n:'Regeneron'},{t:'vrtx.us',n:'Vertex'},{t:'zts.us',n:'Zoetis'},
  {t:'panw.us',n:'Palo Alto'},{t:'snps.us',n:'Synopsys'},{t:'cdns.us',n:'Cadence'},
  {t:'klac.us',n:'KLA'},{t:'lrcx.us',n:'Lam Research'},{t:'mu.us',n:'Micron'},
  {t:'adi.us',n:'Analog Devices'},{t:'mar.us',n:'Marriott'},{t:'mdlz.us',n:'Mondelez'},
  {t:'cme.us',n:'CME Group'},{t:'usb.us',n:'US Bancorp'},{t:'pnc.us',n:'PNC'},
  {t:'tgt.us',n:'Target'},{t:'fdx.us',n:'FedEx'},{t:'gm.us',n:'General Motors'},
  {t:'de.us',n:'Deere'},{t:'emr.us',n:'Emerson'},{t:'gd.us',n:'General Dynamics'},
  {t:'nsc.us',n:'Norfolk Southern'},{t:'itw.us',n:'Illinois Tool Works'},{t:'apd.us',n:'Air Products'},
  {t:'cop.us',n:'ConocoPhillips'},{t:'slb.us',n:'Schlumberger'},{t:'eog.us',n:'EOG Resources'},
  {t:'spgi.us',n:'S&P Global'},{t:'ice.us',n:'ICE'},{t:'mmc.us',n:'Marsh McLennan'},
  {t:'uber.us',n:'Uber'},{t:'pypl.us',n:'PayPal'},{t:'abnb.us',n:'Airbnb'},
];

async function main(){
  fs.mkdirSync(PRICES, { recursive: true });
  const assets = parseAssets(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  // Build the price-snapshot pool = app assets + extra large-cap candidates (dedup by ticker).
  const pool = []; const seen = new Set();
  for(const a of assets){ if(!seen.has(a.t)){ seen.add(a.t); pool.push({ t: a.t, n: a.n, g: a.g }); } }
  for(const e of CANDIDATES_EXTRA){ if(!seen.has(e.t)){ seen.add(e.t); pool.push({ t: e.t, n: e.n, g: 'Stocks' }); } }
  console.log(`Assets: ${assets.length} · pool (with candidates): ${pool.length}`);

  // ---- prices (Yahoo chart, keyless) — whole pool ----
  const pricesOk = [], pricesFailed = [];
  for(const a of pool){
    const csv = await fetchYahooPrices(a.t);
    if(csv){ fs.writeFileSync(path.join(PRICES, a.t + '.csv'), csv); pricesOk.push(a.t); }
    else pricesFailed.push(a.t);
    await sleep(250);
  }
  console.log(`Prices: ${pricesOk.length} ok, ${pricesFailed.length} failed${pricesFailed.length ? ' (' + pricesFailed.slice(0, 20).join(', ') + (pricesFailed.length > 20 ? '…' : '') + ')' : ''}`);

  // ---- analyst data + market cap (Yahoo quoteSummary, keyless; best-effort) ----
  const bySymbol = {};
  let fundErrors = 0;
  const usStocks = pool.filter(a => a.t.endsWith('.us'));   // every US stock in the pool
  const sess = await yahooSession();
  if(sess){
    for(const a of usStocks){
      try{
        const f = await fetchYahooFundamentals(toYahoo(a.t), sess);
        if(f) bySymbol[a.t] = f;
      }catch(e){ fundErrors++; if(fundErrors <= 6) console.warn(`  fund ${a.t}: ${e.message}`); }
      await sleep(300);
    }
  }
  fs.writeFileSync(path.join(DATA, 'fundamentals.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), source: 'yahoo', bySymbol }, null, 1));
  console.log(`Analyst data: ${Object.keys(bySymbol).length} symbols${sess ? '' : ' (no session — skipped)'}, ${fundErrors} errors`);

  if(pricesOk.length === 0){
    console.error('All price fetches failed — keeping previous snapshot, marking run failed.');
    process.exit(1);
  }

  // ---- universe: rank non-penny US stocks by market cap, take top 100 ----
  const excl = new Set(assets.filter(a => a.g === 'Penny' || a.g === 'ETFs').map(a => a.t));   // not "companies"
  const okSet = new Set(pricesOk);
  const ranked = usStocks
    .filter(a => !excl.has(a.t) && okSet.has(a.t))         // need a price snapshot to be scannable
    .map(a => ({ t: a.t, n: (bySymbol[a.t] && bySymbol[a.t].name) || a.n, mktCap: (bySymbol[a.t] && bySymbol[a.t].mktCap) || 0 }))
    .sort((x, y) => y.mktCap - x.mktCap)
    .slice(0, 100);
  fs.writeFileSync(path.join(DATA, 'universe.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), ranked: ranked.some(r => r.mktCap > 0), stocks: ranked }, null, 1));
  console.log(`Universe: ${ranked.length} stocks ranked by market cap (top: ${ranked.slice(0, 3).map(r => r.t).join(', ')})`);

  fs.writeFileSync(path.join(DATA, 'meta.json'), JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: 'Yahoo Finance',
    prices: { ok: pricesOk.length, failed: pricesFailed },
    analyst: { symbols: Object.keys(bySymbol).length },
    universe: { stocks: ranked.length },
  }, null, 1));
  console.log('Snapshot complete.');
}

if(process.env.SELFTEST === '1'){
  const assets = parseAssets(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  console.log('selftest: assets parsed =', assets.length);
  const fail = msg => { console.error('selftest FAILED:', msg); process.exit(1); };
  const eq = (a, b, m) => { if(a !== b) fail(`${m}: got ${a}, want ${b}`); };
  if(!assets.find(a => a.t === 'aapl.us')) fail('aapl.us missing');
  if(!assets.find(a => a.n === "McDonald's")) fail('double-quoted name not parsed');
  eq(toYahoo('aapl.us'), 'AAPL', 'us stock');
  eq(toYahoo('brk-b.us'), 'BRK-B', 'dash stock');
  eq(toYahoo('^spx'), '^GSPC', 'index');
  eq(toYahoo('eurusd'), 'EURUSD=X', 'forex');
  eq(toYahoo('gc.f'), 'GC=F', 'future');
  eq(toYahoo('btcusd'), 'BTC-USD', 'crypto');
  const csv = yahooChartToCsv({ chart: { result: [{ timestamp: Array.from({ length: 30 }, (_, i) => 1700000000 + i * 86400),
    indicators: { quote: [{ open: [], high: [], low: [], close: Array(30).fill(10), volume: [] }] } }] } });
  if(!csv || !/^Date,Open,High,Low,Close,Volume/.test(csv)) fail('chart->csv header');
  if(csv.trim().split('\n').length !== 31) fail('chart->csv row count');
  if(yahooChartToCsv({ chart: { result: [{}] } }) !== null) fail('chart->csv empty guard');
  console.log('selftest OK');
} else {
  main().catch(e => { console.error(e); process.exit(1); });
}
