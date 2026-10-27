# SNEK Dashboard (Fan-made)

> **Fan-made · Unofficial · Not affiliated with SNEK.** Fan-made community dashboard by David Sandy. Not affiliated with or endorsed by SNEK. SNEK brand assets © their owners, used per snek.com terms. Not financial advice.

Live, mobile-first dashboard for SNEK, the Cardano memecoin. Static site, hosted free on GitHub Pages. Non-commercial: no ads, no sales, no donations.

**Live:** https://davidsandyofficial.github.io/snek-dashboard/

## Features
- TradingView-style chart (Lightweight Charts): candles or line, 5m / 15m / 1H / 4H / 1D, USD or ADA, MA20 / MA50, volume histogram, OHLC crosshair legend, pinch-zoom and pan; the last candle updates every 10 s.
- Live price in USD and ADA, market stats, liquidity by DEX, pools, 24h volume by venue.
- Recent trades with whale highlighting (adjustable threshold, whales-only filter, whale buy vs sell totals).
- Holders: count, tier donut, concentration by rank, top-10 treemap and table, with "updated X ago".
- Tools: portfolio tracker (saved in your browser, live value and 24h P/L, optional cost basis), read-only balance lookup from a public addr1/stake1 address via Koios, value calculator, browser price alerts, copy policy ID, share button.
- Installable PWA (shell cached; live data never served from cache), light/dark theme, skeleton loaders, 44 px tap targets, bottom tab bar on phones.

## How data updates
| Data | Source | How often |
|---|---|---|
| Price, market stats, venues | CoinGecko API, in the browser | every 30 s |
| Pools, trades, candles | GeckoTerminal API, in the browser | every 10 s |
| Address balance lookup | Koios API, in the browser | on demand |
| Holders (count, tiers, top wallets, concentration) | Cardanoscan public page, via GitHub Actions | workflow every 30 min; page re-checks `assets/snapshot.json` every 5 min |
| Offline fallback (`assets/snapshot.js`) | all of the above, via GitHub Actions | every 30 min |

Run the updater manually: Actions → "Update data snapshot" → Run workflow, or `python scripts/update_snapshot.py` locally.

## Credits
- [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) v5.2.1, Apache-2.0, © TradingView, Inc. Vendored at `assets/vendor/`, license in `assets/vendor/LICENSE-lightweight-charts.txt`. Chart attribution logo kept on.
- [d3-hierarchy](https://github.com/d3/d3-hierarchy) v3.1.2, ISC, © Mike Bostock. Used for the top-holders treemap. License in `assets/vendor/LICENSE-d3-hierarchy.txt`.
- [Koios](https://www.koios.rest/) community Cardano API ([koios-artifacts](https://github.com/cardano-community/koios-artifacts) spec) for read-only address lookups.
- Data: CoinGecko, GeckoTerminal, Cardanoscan.
- SNEK logo, mascot and token artwork: official media kit from [snek.com/brand](https://www.snek.com/brand) (`https://www.snek.com/downloads/media-kit.zip`), © SNEK / their owners. Used for personal, non-commercial purposes per the [SNEK Intellectual Property Policy](https://www.snek.com/intellectual-property-policy), which allows this "provided that it does not suggest endorsement or affiliation with SNEK" and does not harm the brand. Details in `assets/brand/SOURCE.md`. Brand colors from the kit: mint `#18f2b2`, off-white `#f4f3ef`, black `#151515`, character palette `#88eaff`, `#5491d9`, `#c684f0`, `#fc4c61`.

Safety: no wallet connection, no seed phrases, nothing is ever signed.

Fan-made community dashboard by David Sandy. Not affiliated with or endorsed by SNEK. SNEK brand assets © their owners, used per snek.com terms. Not financial advice.
