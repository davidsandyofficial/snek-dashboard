/* Real-time price + trade feeds (keyless, free, public). Fan-made SNEK dashboard. No keys, no wallets, read-only.
   - ADA/USD: Kraken WebSocket v2 (best bid/offer) + Coinbase Exchange WebSocket ticker; Coinbase REST fallback.
   - SNEK/ADA on Cardano DEXes: DexHunter averagePrice (every 4 s); DexScreener fallback; backoff on failure.
   - SNEK on CEXes: Kraken (SNEK/USD), Gate (SNEK/USDT), Bitget (SNEK/USDT) WebSockets: ticker + live trades.
   All feeds pause while the tab is hidden and resume when it is visible again. */
(function () {
  const TOKEN = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b";
  const DH = "https://api-us.dexhunterv3.app/swap/averagePrice/ADA/" + TOKEN;
  const DS = "https://api.dexscreener.com/latest/dex/tokens/" + TOKEN;
  const CB_REST = "https://api.exchange.coinbase.com/products/ADA-USD/ticker";
  const now = () => Date.now();
  const hidden = () => document.visibilityState === "hidden";
  const L = { ada: null, adaSrc: {}, dex: null, cex: {}, trades: [], socks: {}, on: null, errors: [], started: false };
  const ls = {};
  L.on = (ev, f) => { (ls[ev] = ls[ev] || []).push(f); };
  function emit(ev) { (ls[ev] || []).forEach((f) => { try { f(); } catch (e) {} }); }
  function j(url, ms) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000);
    return fetch(url, { signal: c.signal, headers: { Accept: "application/json" } }).then((r) => { clearTimeout(t); if (!r.ok) throw new Error(url.split("/")[2] + " HTTP " + r.status); return r.json(); });
  }
  function note(e) { L.errors.push({ t: now(), m: String(e && e.message || e) }); if (L.errors.length > 30) L.errors.shift(); }

  function setAda(px, src) { if (!(px > 0)) return; L.adaSrc[src] = { px, t: now() }; L.ada = { px, src, t: now() }; emit("price"); }
  function setDex(px, src) { if (!(px > 0)) return; L.dex = { px, src, t: now() }; emit("price"); emit("venue"); }
  function setCex(v, px, extra) { if (!(px > 0)) return; L.cex[v] = Object.assign(L.cex[v] || {}, { px, t: now() }, extra || {}); emit("venue"); }
  function addTrade(t) {
    if (!(t.price > 0) || !(t.qty > 0) || L.trades.some((x) => x.id === t.id)) return;
    t.usd = t.price * t.qty; L.trades.push(t); L.trades.sort((a, b) => b.time - a.time); if (L.trades.length > 80) L.trades.length = 80;
    const c = L.cex[t.venue]; if (!c || t.time >= (c.tradeT || 0)) { L.cex[t.venue] = Object.assign(c || {}, { tradeT: t.time }); }
    emit("trade");
  }

  // ---------- WebSocket manager with exponential reconnect backoff ----------
  function sock(name, url, onopen, onmsg, ping) {
    const s = { name, url, ws: null, retry: 0, up: false, last: 0, msgs: 0, stopped: true };
    s.open = () => {
      if (s.ws || s.stopped || hidden()) return;
      let ws; try { ws = new WebSocket(url); } catch (e) { return s.later(); }
      s.ws = ws;
      ws.onopen = () => { if (s.ws !== ws) { try { ws.close(); } catch (e) {} return; } s.retry = 0; s.up = true; try { onopen(ws); } catch (e) {} if (ping) s.pi = setInterval(() => { try { ws.send(ping()); } catch (e) {} }, 20000); emit("venue"); };
      ws.onmessage = (e) => { if (s.ws !== ws) return; s.last = now(); s.msgs++; let d; try { d = JSON.parse(e.data); } catch (x) { return; } try { onmsg(d); } catch (x) {} };
      ws.onclose = () => { if (s.ws !== ws) return; clearInterval(s.pi); s.ws = null; s.up = false; emit("venue"); if (!s.stopped) s.later(); };
      ws.onerror = () => note(name + " socket error");
    };
    s.later = () => { clearTimeout(s.tm); const d = Math.min(60000, 2000 * Math.pow(2, s.retry++)); s.tm = setTimeout(s.open, d); };
    s.start = () => { s.stopped = false; s.retry = 0; clearTimeout(s.tm); s.open(); };
    s.stop = () => { s.stopped = true; clearTimeout(s.tm); clearInterval(s.pi); if (s.ws) { try { s.ws.close(); } catch (e) {} } s.ws = null; s.up = false; };
    L.socks[name] = s; return s;
  }
  const num = (v) => parseFloat(v);
  sock("Kraken", "wss://ws.kraken.com/v2", (ws) => {
    ws.send(JSON.stringify({ method: "subscribe", params: { channel: "ticker", symbol: ["ADA/USD", "SNEK/USD"], event_trigger: "bbo" } }));
    ws.send(JSON.stringify({ method: "subscribe", params: { channel: "trade", symbol: ["SNEK/USD"], snapshot: true } }));
  }, (d) => {
    if (d.channel === "ticker" && d.data) d.data.forEach((x) => {
      if (x.symbol === "ADA/USD") setAda((num(x.bid) + num(x.ask)) / 2, "Kraken");
      else if (x.symbol === "SNEK/USD") setCex("Kraken", num(x.last), { pair: "SNEK/USD", bid: num(x.bid), ask: num(x.ask) });
    });
    if (d.channel === "trade" && d.data) d.data.forEach((x) => addTrade({ id: "kraken-" + x.trade_id, venue: "Kraken", pair: "SNEK/USD", side: x.side, price: num(x.price), qty: num(x.qty), time: Date.parse(x.timestamp) }));
  });
  sock("Coinbase", "wss://ws-feed.exchange.coinbase.com", (ws) => {
    ws.send(JSON.stringify({ type: "subscribe", product_ids: ["ADA-USD"], channels: ["ticker"] }));
  }, (d) => { if (d.type === "ticker" && d.product_id === "ADA-USD") { const b = num(d.best_bid), a = num(d.best_ask); setAda(b > 0 && a > 0 ? (a + b) / 2 : num(d.price), "Coinbase"); } });
  sock("Gate", "wss://api.gateio.ws/ws/v4/", (ws) => {
    const t = Math.floor(now() / 1000);
    ws.send(JSON.stringify({ time: t, channel: "spot.trades", event: "subscribe", payload: ["SNEK_USDT"] }));
    ws.send(JSON.stringify({ time: t, channel: "spot.tickers", event: "subscribe", payload: ["SNEK_USDT"] }));
  }, (d) => {
    if (d.event !== "update" || !d.result) return;
    if (d.channel === "spot.tickers") setCex("Gate", num(d.result.last), { pair: "SNEK/USDT" });
    if (d.channel === "spot.trades") { const x = d.result; addTrade({ id: "gate-" + x.id, venue: "Gate", pair: "SNEK/USDT", side: x.side, price: num(x.price), qty: num(x.amount), time: Math.round(num(x.create_time_ms)) }); setCex("Gate", num(x.price), { pair: "SNEK/USDT" }); }
  }, () => JSON.stringify({ time: Math.floor(now() / 1000), channel: "spot.ping" }));
  sock("Bitget", "wss://ws.bitget.com/v2/ws/public", (ws) => {
    ws.send(JSON.stringify({ op: "subscribe", args: [{ instType: "SPOT", channel: "trade", instId: "SNEKUSDT" }, { instType: "SPOT", channel: "ticker", instId: "SNEKUSDT" }] }));
  }, (d) => {
    if (!d.arg || !d.data) return;
    if (d.arg.channel === "ticker") d.data.forEach((x) => setCex("Bitget", num(x.lastPr), { pair: "SNEK/USDT" }));
    if (d.arg.channel === "trade") d.data.forEach((x) => addTrade({ id: "bitget-" + x.tradeId, venue: "Bitget", pair: "SNEK/USDT", side: x.side, price: num(x.price), qty: num(x.size), time: +x.ts }));
  }, () => "ping");

  // ---------- REST pollers: on-chain DEX price + ADA fallback ----------
  const back = { dh: { fail: 0, until: 0 }, ds: { fail: 0, until: 0 }, cb: { fail: 0, until: 0 } };
  const fail = (b, e) => { b.fail++; b.until = now() + Math.min(120000, 5000 * Math.pow(2, b.fail)); note(e); };
  let dexTimer = null, adaTimer = null;
  L.polls = { dex: 0, ada: 0 };
  async function pollDex() {
    clearTimeout(dexTimer); if (hidden() || !L.started) return;
    let done = false;
    if (now() >= back.dh.until) {
      try { const r = await j(DH); const px = num(r.price_ba); if (!(px > 0)) throw new Error("DexHunter empty"); back.dh.fail = 0; L.polls.dex++; setDex(px, "DexHunter"); done = true; } catch (e) { fail(back.dh, e); }
    }
    if (!done && now() >= back.ds.until) {
      try {
        const r = await j(DS);
        const p = (r.pairs || []).filter((x) => x.chainId === "cardano" && /ADA/.test(x.quoteToken.symbol)).sort((a, b) => ((b.liquidity || {}).usd || 0) - ((a.liquidity || {}).usd || 0))[0];
        if (!p) throw new Error("DexScreener empty"); back.ds.fail = 0; L.polls.dex++; setDex(num(p.priceNative), "DexScreener");
      } catch (e) { fail(back.ds, e); }
    }
    dexTimer = setTimeout(pollDex, 4000);
  }
  async function pollAda() {
    clearTimeout(adaTimer); if (hidden() || !L.started) return;
    const stale = !L.ada || now() - L.ada.t > 20000;
    if (stale && now() >= back.cb.until) {
      try { const r = await j(CB_REST); back.cb.fail = 0; L.polls.ada++; setAda(num(r.price), "Coinbase REST"); } catch (e) { fail(back.cb, e); }
    }
    adaTimer = setTimeout(pollAda, 10000);
  }

  // ---------- derived prices ----------
  const FRESH = 180000;
  L.usd = () => {
    const t = now();
    if (L.dex && L.ada && t - L.dex.t < FRESH && t - L.ada.t < FRESH) return { px: L.dex.px * L.ada.px, ada: L.dex.px, adaUsd: L.ada.px, src: "Cardano DEXes (" + L.dex.src + ") × ADA/USD (" + L.ada.src + ")", t: Math.max(L.dex.t, L.ada.t) };
    const k = L.cex.Kraken; if (k && t - k.t < FRESH) return { px: k.px, ada: L.ada ? k.px / L.ada.px : null, adaUsd: L.ada ? L.ada.px : null, src: "Kraken SNEK/USD", t: k.t };
    return null;
  };
  L.adaFresh = () => (L.ada && now() - L.ada.t < FRESH ? L.ada : null);

  L.start = () => {
    if (L.started) return; L.started = true;
    Object.values(L.socks).forEach((s) => s.start()); pollDex(); pollAda();
  };
  L.pause = () => { L.started = false; Object.values(L.socks).forEach((s) => s.stop()); clearTimeout(dexTimer); clearTimeout(adaTimer); emit("venue"); };
  document.addEventListener("visibilitychange", () => { if (hidden()) L.pause(); else L.start(); });
  window.SNEKLIVE = L;
})();
