# season-scope
SeasonScope — Seasonal Pattern Dashboard

A single-file web app for spotting seasonal patterns in financial markets. Instead of price charts, it gives you raw data laid out so recurring monthly behaviour jumps out.

What it does

-Seasonality matrix — years in rows, months in columns. Each cell shows that month’s % price change (green = gain, red = loss, intensity = magnitude), with an FY column compounding the full year. Toggle to win-rate mode (▲/▼ per year + % of years that month was positive). The bottom row averages across all selected years — that’s where the pattern lives.
-Selectable year range — start and end year dropdowns from 1980 to the current year.
-Month strength bars — average return + win-rate per month, ranked visually.
-Asset rating — an A+ to D composite score from momentum (CAGR), volatility, drawdown control, trend consistency and seasonal reliability. Clearly labelled as SeasonScope’s own metric, not a Morningstar rating.
-Three tabs — **Discover** (opens first; auto-ranks a shortlist of stocks to monitor by a computed seasonal + momentum + value/entry score), **Analyze** (the full single-asset deep dive — also reachable by tapping any suggestion), and **Movers** (a curated low-price / speculative watchlist ranked the same way).
-Valuation & entry (price-based) — a technical read of whether a name looks stretched or in a value/entry zone: drawdown from highs, position in the 52-week range, distance from the 200-day trend, RSI and 3/6-month momentum. Clearly labelled as a computed price signal, NOT a fundamental valuation or analyst rating (this build is key-free, so no analyst data is available).
-Seasonal forecast — current month + the next two: expected (mean) return, win-rate, a ±1σ confidence band and a confidence label, plus a plain-language read of the upcoming month.
-Intra-month detail — average daily % change by day-of-week (Mon–Fri) and by week-of-month (turn-of-the-month effect).
-Per-month confidence — each month shows its standard deviation, sample size and a ⚠ flag when too few years make the signal noisy.
-Detected signals + suggestions — reliable up/down months, half-year skew, current-month context, and plain-language reading of the patterns.
-Famous seasonal patterns reference — Sell in May, Santa Claus rally, January effect, September weakness, turn-of-month, gold/oil/gas seasonality, JPY fiscal year, presidential cycle.

Coverage: ~40 mega-cap US stocks, major indices, major forex pairs, and key commodities/crypto — all editable in one array.

Data: Stooq free daily history (no API key, no server/worker). The app fetches the full daily history once per asset through a small chain of free public CORS proxies, then derives the monthly matrix, per-month stats, forecast and intra-month patterns locally. Fetched data is cached per asset, so changing the year range is instant and doesn't re-hit the network. It rebuilds every time you load and picks up new data automatically.

Note: it must be hosted (GitHub Pages / Netlify Drop / any web server) — opening the file directly with file:// blocks the cross-origin fetch.

## Nightly data snapshot (GitHub Actions + Secrets)

A scheduled workflow (`.github/workflows/refresh-data.yml`, nightly 03:25 UTC + manual run) executes `scripts/fetch_data.mjs`, which:

- fetches **daily prices from Stooq** for every asset (no key needed — the Action talks to Stooq directly, no CORS proxy) → `data/prices/<symbol>.csv`
- fetches **fundamentals from Financial Modeling Prep** using the `FMP_KEY` repository secret: FMP rating, DCF fair value (→ over/under-valued), analyst buy/hold/sell consensus, and a penny-stock screener → `data/fundamentals.json`
- writes `data/meta.json` with the last successful run, which the app shows in the Discover tab and footer.

The app loads these static files first (same-origin, or `raw.githubusercontent.com` which sends CORS headers), so normal use needs **no proxies and the API key never reaches the browser**. The public proxy chain remains only as a live fallback for symbols without a snapshot. Files are only overwritten on successful fetches, so a failed night keeps yesterday's data.

**Setup (one time):**
1. Create a free API key at financialmodelingprep.com (Sign up → Dashboard → API key).
2. Repo → Settings → Secrets and variables → Actions → New repository secret → name `FMP_KEY`, paste the key.
3. Actions tab → "Refresh market data" → Run workflow (first snapshot; afterwards it runs nightly on the default branch).

Without the secret, the run still snapshots prices — only the analyst/DCF/screener extras are skipped. The asset list is parsed from `index.html`, so adding a ticker there is enough; the next run picks it up.
