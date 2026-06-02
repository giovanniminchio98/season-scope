# season-scope
SeasonScope — Seasonal Pattern Dashboard

A single-file web app for spotting seasonal patterns in financial markets. Instead of price charts, it gives you raw data laid out so recurring monthly behaviour jumps out.

What it does

-Seasonality matrix — years in rows, months in columns. Each cell shows that month’s % price change (green = gain, red = loss, intensity = magnitude), with an FY column compounding the full year. Toggle to win-rate mode (▲/▼ per year + % of years that month was positive). The bottom row averages across all selected years — that’s where the pattern lives.
-Selectable year range — start and end year dropdowns from 1980 to the current year.
-Month strength bars — average return + win-rate per month, ranked visually.
-Asset rating — an A+ to D composite score from momentum (CAGR), volatility, drawdown control, trend consistency and seasonal reliability. Clearly labelled as SeasonScope’s own metric, not a Morningstar rating.
-Detected signals + suggestions — reliable up/down months, half-year skew, current-month context, and plain-language reading of the patterns.
-Famous seasonal patterns reference — Sell in May, Santa Claus rally, January effect, September weakness, turn-of-month, gold/oil/gas seasonality, JPY fiscal year, presidential cycle.

Coverage: ~40 mega-cap US stocks, major indices, major forex pairs, and key commodities/crypto — all editable in one array.

Data: Stooq free monthly history (no API key), fetched live through a CORS proxy chain, so it rebuilds every time you load and picks up new data automatically.
