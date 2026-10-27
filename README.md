# SNEK Analytics

A free, static dashboard for SNEK, the Cardano memecoin: live price (USD and ADA), chart with timeframe toggles, ADA/USD value calculator, holder distribution, liquidity by DEX, volume by venue, recent trades and official links.

- No build step: plain `index.html` + `assets/`.
- Live data is fetched in the browser from the public CoinGecko and GeckoTerminal APIs and refreshed every 10 seconds (market stats every 30 seconds).
- If an API is unreachable, the page falls back to the saved snapshot in `assets/snapshot.js` and says so in the header.
- Holder data is a Cardanoscan snapshot (no public CORS API).

Fan-made, not affiliated with SNEK. Not financial advice.
