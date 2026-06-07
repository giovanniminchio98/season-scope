# season-scope
SeasonScope — Seasonal Pattern Dashboard

A single-file web app for spotting seasonal patterns in financial markets. Instead of price charts, it gives you raw data laid out so recurring monthly behaviour jumps out.

What it does

-Seasonality matrix — years in rows, months in columns. Each cell shows that month’s % price change (green = gain, red = loss, intensity = magnitude), with an FY column compounding the full year. Toggle to win-rate mode (▲/▼ per year + % of years that month was positive). The bottom row averages across all selected years — that’s where the pattern lives.
-Selectable year range — start and end year dropdowns from 1980 to the current year.
-Month strength bars — average return + win-rate per month, ranked visually.
-Asset rating — an A+ to D composite score from momentum (CAGR), volatility, drawdown control, trend consistency and seasonal reliability. Clearly labelled as SeasonScope’s own metric, not a Morningstar rating.
-Seasonal forecast — current month + the next two: expected (mean) return, win-rate, a ±1σ confidence band and a confidence label, plus a plain-language read of the upcoming month.
-Intra-month detail — average daily % change by day-of-week (Mon–Fri) and by week-of-month (turn-of-the-month effect).
-Per-month confidence — each month shows its standard deviation, sample size and a ⚠ flag when too few years make the signal noisy.
-Detected signals + suggestions — reliable up/down months, half-year skew, current-month context, and plain-language reading of the patterns.
-Famous seasonal patterns reference — Sell in May, Santa Claus rally, January effect, September weakness, turn-of-month, gold/oil/gas seasonality, JPY fiscal year, presidential cycle.

Coverage: ~40 mega-cap US stocks, major indices, major forex pairs, and key commodities/crypto — all editable in one array.

Data: Stooq free daily history (no API key, no server/worker). The app fetches the full daily history once per asset through a small chain of free public CORS proxies, then derives the monthly matrix, per-month stats, forecast and intra-month patterns locally. Fetched data is cached per asset, so changing the year range is instant and doesn't re-hit the network. It rebuilds every time you load and picks up new data automatically.

Note: it must be hosted (GitHub Pages / Netlify Drop / any web server) — opening the file directly with file:// blocks the cross-origin fetch.
