# SNEK Dashboard (Fan-made)

> **Fan-made · Unofficial · Not affiliated with SNEK.** Fan-made community dashboard by David Sandy. Not affiliated with or endorsed by SNEK. SNEK brand assets © their owners, used per snek.com terms. Not financial advice.

Live, mobile-first dashboard for SNEK, the Cardano memecoin. Static site, hosted free on GitHub Pages. Non-commercial: no ads, no sales, no donations.

**Live:** https://davidsandyofficial.github.io/snek-dashboard/

## Features
- TradingView-style chart (Lightweight Charts): candles or line, 5m / 15m / 1H / 4H / 1D, USD or ADA, MA20 / MA50, volume histogram, OHLC crosshair legend, pinch-zoom and pan; the last candle refreshes every 60 s.
- Live price in USD and ADA, market stats, liquidity by DEX, pools, 24h volume by venue.
- Recent trades with whale highlighting (adjustable threshold, whales-only filter, whale buy vs sell totals).
- Holders: count, tier donut, concentration by rank, top-10 treemap and table, with "updated X ago".
- Tools: portfolio tracker (saved in your browser, live value and 24h P/L, optional cost basis), read-only balance lookup from a public addr1/stake1 address via Koios, value calculator, browser price alerts, copy policy ID, share button.
- Installable PWA (shell cached; live data never served from cache), light/dark theme, skeleton loaders, 44 px tap targets, bottom tab bar on phones.

## Long candle history

`scripts/update_history.py` (run daily by `.github/workflows/update-history.yml`) grows `assets/history/<interval>/` in 500-candle chunks. It never drops old candles, so the history keeps getting longer than each free API's look-back window.

- On-chain: main Minswap SNEK/ADA pool via GeckoTerminal (the free API serves the last ~180 days).
- Before that: Gate.io SNEK/USDT, keyless, up to 10,000 candles back per interval. The ADA view is SNEK/USDT ÷ ADA/USDT. Chart legends mark these candles "CEX · Gate".
- The chart loads the newest chunk under the live candles and fetches older chunks as you scroll left. Wallet PnL estimates use the same files.

## Chart indicators

Tap **ƒx Indicators** above the chart. Overlays: SMA ×2, EMA ×2 (periods configurable), Bollinger Bands (period, std dev), VWAP (daily reset, anchored on 1D) and a volume MA. Oscillators, each in its own pane: RSI, MACD (fast/slow/signal), Stochastic RSI and ATR. All are computed in the browser (`assets/indicators.js`) from the candles on the chart, and your picks are saved in this browser (`localStorage` key `snek-ind`).

## Customizable layout

- **Resize with the mouse** (screens at least 900 px wide): drag a card's bottom-right corner, right edge or bottom edge. Width snaps to the 12-column grid (3 = ¼ up to 12 = full) and height moves in 10 px steps (160–1600 px). A dashed outline with a size label such as "8 cols (⅔) × 420px" follows the mouse, and you get an Undo toast afterwards. Double-click a handle, or use ⋯ → Reset size, to reset one card. Presets and Reset clear all custom sizes. On touch tablets a bigger corner handle appears on the card you tapped, and the ⋯ menu still has the width option.
- **The "Built by @DavidSandy" card is pinned at the top** by default and in every preset. Saved layouts from before (v1) get it pinned once. "Not now" shrinks it to a slim bar instead of hiding it.
- **Grab the pill-shaped grip** at the top center of any card (it isn't shown on pinned cards) to drag straight away with mouse or touch. With a mouse you can also grab the card title. While you drag, every valid drop spot gets a dashed outline, the spot you're over glows, and pinned cards are marked "can't drop here".
- **Press and hold any card** (about 0.4 s on touch, 0.3 s with a mouse) on a non-interactive spot such as its title, then drag it to a new place. No edit mode needed. Buttons, inputs, links, tables, lists and the chart canvas are excluded, so scrolling and chart panning work as before. Pinned cards stay put. You get a short vibration where supported, a lifted card, a "Drop here" placeholder and an Undo toast.

Every card is a widget. Tap **▦** in the header (or **Customize layout** at the bottom) to edit:

- Drag the **⠿** handle, or use **↑ ↓** (works well on touch and with a keyboard).
- **Pin** keeps a widget at the top; pinned widgets don't move when you rearrange the rest.
- **✕** hides a widget; hidden widgets are listed in the editor bar to bring back.
- On wide screens (≥900 px) the **⅓ ½ ⅔ Full** button changes a widget's width. Phones always show one full-width column.
- **Reset** restores the default layout. The layout is saved only in this browser (`localStorage` key `snek-layout`).

## Wallet tracker (Wallets tab)

**v3:** a gradient profile card with an avatar (the ADA Handle image when there is one) and the USD value counting up. Tabs for Overview, Holdings (with a donut by value), Activity (a balance chart in SNEK or USD over the loaded window, plus a day-grouped timeline) and Staking (pool margin, cost and pledge, lifetime rewards, and reward bars for the last 12 epochs from Yoroi's public backend). Nicknames, tags and notes are saved in this browser only. Watchlist cards have avatars, tag filters and %-change badges. The whale feed can be filtered by source and by direction. DexHunter prices are only requested for tokens on DexHunter's public token list.
Inspired by community requests for "beautiful wallet tracking tools". Paste an `addr1…` address, a `stake1…` key or a `$handle`:
- SNEK and ADA balance, staking status, ADA Handles held, and "exchange-like" signals (big undelegated ADA, ≥20 handles, ≥100 txs/24 h, legacy Byron address). Signals are hints, not proof of ownership.
- ★ Track up to 12 wallets (saved only in your browser). They are re-checked every 5 minutes while the page is open, with a toast when a balance moves by ≥1M SNEK.
- Top 10 holders, labeled with ADA Handles and a small community label list (`assets/labels.json`, every entry needs a public source; suggest one via GitHub issues).
- Data: Yoroi's public wallet backend (balances, stake state) and Handle.me (handles) in the browser, keyless. Top-holder enrichment (24 h activity, handles, staking) is computed every 30 min by the GitHub Action with Koios, because Koios's keyless tier blocks browser CORS.

## How data updates
| Data | Source | How often |
|---|---|---|
| Headline SNEK price (USD) | On-chain SNEK/ADA from DexHunter's public `averagePrice` API (DexScreener fallback) × live ADA/USD | SNEK/ADA polled every 4 s (moves once per Cardano block, ~20 s); ADA/USD real-time; screen redraws at most once per second |
| ADA/USD | Kraken WebSocket v2 (best bid/offer) and Coinbase Exchange WebSocket ticker; Coinbase REST fallback | real-time (REST fallback every 10 s only when the sockets are quiet for 20 s) |
| SNEK on centralised exchanges | Kraken (SNEK/USD), Gate (SNEK/USDT), Bitget (SNEK/USDT) public WebSockets: ticker + trades | real-time |
| On-chain DEX trades | DexHunter public global-orders feed (all DEXes it indexes) plus GeckoTerminal (main pool) | DexHunter every 5 s; GeckoTerminal every 5 min as a cross-check |
| Market cap, FDV, 24h change | CoinGecko, rescaled by the live price between refreshes | CoinGecko every 60 s |
| Pools, venues | GeckoTerminal / CoinGecko | pools every 5 min; venues every 60 s |
| Candles (last candle) | GeckoTerminal | every 60 s (GeckoTerminal caches responses for 1 min) |

All feeds are keyless and free. They pause while the tab is hidden and resume when you return. Every REST source has exponential backoff, and WebSockets reconnect with backoff (2 s up to 60 s). Requests per visitor stay well under each source's free limit: GeckoTerminal about 1.4/min, spaced at least 4 s apart and hard-capped at 7 per rolling minute (keyless limit ~10/min per IP), CoinGecko 2/min, DexHunter about 27/min, DexScreener 0 (fallback only; limit 300/min), Coinbase REST 0–6/min.
| Address balance lookup | Koios API, in the browser | on demand |
| Holders (count, tiers, top wallets, concentration) | Cardanoscan public page, via GitHub Actions | workflow every 30 min; page re-checks `assets/snapshot.json` every 5 min |
| Offline fallback (`assets/snapshot.js`) | all of the above, via GitHub Actions | every 30 min |

Run the updater manually: Actions → "Update data snapshot" → Run workflow, or `python scripts/update_snapshot.py` locally.

## Credits
- [TradingView Lightweight Charts™](https://github.com/tradingview/lightweight-charts) v5.2.1, Apache-2.0, © TradingView, Inc. Vendored at `assets/vendor/`, license in `assets/vendor/LICENSE-lightweight-charts.txt`. Chart attribution logo kept on.
- [SortableJS](https://github.com/SortableJS/Sortable) v1.15.6, MIT, © All contributors to Sortable. Used for drag-to-rearrange widgets. License in `assets/vendor/LICENSE-sortablejs.txt`.
- [d3-hierarchy](https://github.com/d3/d3-hierarchy) v3.1.2, ISC, © Mike Bostock. Used for the top-holders treemap. License in `assets/vendor/LICENSE-d3-hierarchy.txt`.
- [Koios](https://www.koios.rest/) community Cardano API ([koios-artifacts](https://github.com/cardano-community/koios-artifacts) spec) for read-only address lookups.
- Data: CoinGecko, GeckoTerminal, DexHunter, Yoroi public backend, Handle.me, DexScreener, Kraken, Coinbase Exchange, Gate, Bitget, Koios, Cardanoscan (public, keyless endpoints; no affiliation).
- SNEK logo, mascot and token artwork: official media kit from [snek.com/brand](https://www.snek.com/brand) (`https://www.snek.com/downloads/media-kit.zip`), © SNEK / their owners. Used for personal, non-commercial purposes per the [SNEK Intellectual Property Policy](https://www.snek.com/intellectual-property-policy), which allows this "provided that it does not suggest endorsement or affiliation with SNEK" and does not harm the brand. Details in `assets/brand/SOURCE.md`. Brand colors from the kit: mint `#18f2b2`, off-white `#f4f3ef`, black `#151515`, character palette `#88eaff`, `#5491d9`, `#c684f0`, `#fc4c61`.

Safety: no wallet connection, no seed phrases, nothing is ever signed.

Fan-made community dashboard by David Sandy. Not affiliated with or endorsed by SNEK. SNEK brand assets © their owners, used per snek.com terms. Not financial advice.

## Effects

The hero and wallet search have animated gradient borders. The header and bars use glass blur. With a mouse, cards get a spotlight and a slight 3D tilt (small cards only). Other effects: a scroll-progress bar, a parallax hero glow, a sliding tab indicator, panes that fade in, confetti the first time you track a wallet, and an easter egg: tap the logomark 5 times for a tiny snake game. Under `prefers-reduced-motion` all of these are switched off or made static. Every scroll and pointer handler is passive and throttled with requestAnimationFrame.

## Updates

`sw.js` skips waiting and claims open pages, and it is checked for updates whenever the tab becomes visible and every 15 minutes. When a new version takes over, a "Reload" bar appears. The page also reloads by itself when the tab goes to the background, or after a minute of idle time (it never does this mid-drag, while the layout editor is open, or while you're typing).

## Portfolio history (Wallets tab)

A draggable "Portfolio history" widget shows the wallet you looked up, or one you track, using real data only:
- **Transactions** come from Yoroi's public backend. They are paged backwards in segments between chain anchors (1, 7, 30, 90 and 365 days back, taken from the 30-min snapshot) and finally from the address's first transaction. One load reads up to 40 pages (2,000 txs), and "Load further back" continues from there. The covered window only ever includes complete segments.
- **Balances** (SNEK and ADA) are rebuilt from today's on-chain balance by undoing each transaction's change. They cover this address only. Other tokens and NFTs are not included.
- **Prices** are daily closes in UTC:
  - SNEK from `assets/history/1D` (on-chain DEX, Gate.io before ~180 days, back to Dec 27, 2023).
  - ADA/USD from Kraken's public OHLC (last ~720 days). Older days use the same-day SNEK USD ÷ SNEK ADA ratio.
  - Today uses live prices.
- **Chart and stats:** a USD/ADA toggle, 7D/30D/90D/1Y/All ranges, a SNEK balance line, and tooltips. Also: change in value over the range (includes transfers), price-driven P/L (held balance × daily price moves) and the ATH portfolio value.
- **No interpolation:** days without prices stay empty and are listed as gaps, and the covered date range is always shown.
