(function () {
  "use strict";
  let SNAP = window.SNEK_SNAPSHOT || null;
  const POLICY = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f";
  const TOKEN = POLICY + "534e454b";
  const CG = "https://api.coingecko.com/api/v3";
  const GT = "https://api.geckoterminal.com/api/v2/networks/cardano";
  const DHAPI = "https://api-us.dexhunterv3.app";
  const LOVELACE = "000000000000000000000000000000000000000000000000000000006c6f76656c616365";
  const DH_DEX = { MINSWAP: "Minswap", MINSWAPV2: "Minswap V2", WINGRIDER: "WingRiders", WINGRIDERV2: "WingRiders V2", VYFI: "VyFi", SUNDAESWAP: "SundaeSwap", SUNDAESWAPV3: "SundaeSwap V3", SPLASH: "Splash", SPECTRUM: "Splash", CSWAP: "CSWAP", MUESLISWAP: "MuesliSwap", CERRA: "Cerra", SATURNSWAP: "SaturnSwap", GENIUS: "Genius Yield", CHADSWAP: "ChadSwap", SNEKFUN: "Snek.fun" };
  const KOIOS = "https://api.koios.rest/api/v1";
  const DEFAULT_POOL = "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c2ffadbb87144e875749122e0bbb9f535eeaa7f5660c6c4a91bcc4121e477f08d";
  const TZ = "America/Chicago";
  const IVS = { "5m": ["minute", 5], "15m": ["minute", 15], "1H": ["hour", 1], "4H": ["hour", 4], "1D": ["day", 1] };
  const DEX_NAMES = { "minswap-cardano": "Minswap", "minswap-v2": "Minswap V2", saturnswap: "SaturnSwap", wingriders: "WingRiders", sundaeswap: "SundaeSwap", splash: "Splash", cswap: "CSWAP" };
  const HTTP = /^https?:/.test(location.protocol);

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  const state = {
    market: null, live: { market: false, pools: false, trades: false, candles: false }, pools: [], trades: [], tickers: [], asOf: null,
    mainPool: DEFAULT_POOL, tick: 0, dhTrades: [], tradeLive: { gt: false, dh: false },
    chart: { iv: store.get("snek-iv", "1H"), type: store.get("snek-type", "candle"), cur: store.get("snek-cur", "usd"), ma: store.get("snek-ma", ["20"]), bars: [], live: false }
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const na = () => '<span class="na">unavailable</span>';
  const ok = (v) => v !== null && v !== undefined && v !== "" && isFinite(v);
  // money/number formats follow the Settings panel (currency from free FX rates, number format, locale) via SNEKFMT
  const F = () => window.SNEKFMT;
  const usd = (v) => !ok(v) ? na() : F() ? F().money(v) : Math.abs(v) >= 1 ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "$" + Number(Number(v).toPrecision(4));
  const big = (v) => !ok(v) ? na() : F() ? F().money(v, "big") : "$" + Math.round(v).toLocaleString("en-US");
  const compact = (v) => !ok(v) ? na() : F() ? F().money(v, "compact") : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
  const num = (v, d) => !ok(v) ? na() : Number(v).toLocaleString(F() ? F().locale() : "en-US", { maximumFractionDigits: d || 0 });
  const pct = (v) => !ok(v) ? na() : '<span class="chg ' + (v >= 0 ? "up" : "down") + '">' + (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%</span>";
  const fmtTime = (d, o) => new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, o)).format(d);
  const stamp = (d) => fmtTime(d, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
  const ago = (d) => { const s = Math.round((Date.now() - d.getTime()) / 1000); if (s < 90) return s + " s ago"; if (s < 5400) return Math.round(s / 60) + " min ago"; if (s < 172800) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago"; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const FX = window.SNEKFX || null;
  const LIVE = window.SNEKLIVE || null;
  const STATS = window.SNEKSTATS = { priceShown: [], priceData: [], tradeNew: [], gtCalls: 0, cgCalls: 0 };
  function toast(msg, type) { if (FX) { FX.toast(msg, type || (/^🔔/.test(msg) ? "alert" : /copied|added|updated/i.test(msg) ? "ok" : /busy|unavailable|failed|blocked/i.test(msg) ? "warn" : "info")); return; } const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
  function empty(msg) { return '<div class="empty"><img src="assets/brand/snek-face-sad.webp" alt="" width="96" height="65" loading="lazy"><div>' + esc(msg) + '</div><span class="fan">Fan-made dashboard · not affiliated with SNEK</span></div>'; }
  function hideSplash() { const s = $("splash"); if (s && !s.classList.contains("hide")) { s.classList.add("hide"); setTimeout(() => s.remove(), 400); } }
  function unskel(el) { if (el) el.classList.remove("skel", "w80", "w120", "w160"); }

  function getJSON(url, opts, ms) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms || 12000);
    return fetch(url, Object.assign({ signal: ctl.signal, headers: { Accept: "application/json" } }, opts || {}))
      .then((r) => { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  // GeckoTerminal's free API allows ~30 calls/min per visitor; back off briefly after a failure (429s arrive without CORS headers).
  // Calls are queued at least 1.5 s apart and back off for 30 s after a failure (429s arrive without CORS headers).
  // Hard client-side ceiling: at most 7 GeckoTerminal calls in any rolling 60 s (keyless limit is ~10/min per IP).
  let gtPauseUntil = 0, gtChain = Promise.resolve(), gtLast = 0; const gtWin = (store.get("snek-gtwin", []) || []).filter((t) => Date.now() - t < 60000); // shared across reloads/tabs
  function gt(path) {
    const run = () => {
      if (Date.now() < gtPauseUntil) return Promise.reject(new Error("rate limited, retrying shortly"));
      if (document.visibilityState === "hidden") return Promise.reject(new Error("paused while hidden"));
      while (gtWin.length && Date.now() - gtWin[0] > 60000) gtWin.shift();
      const wait = Math.max(0, gtLast + 4000 - Date.now(), gtWin.length >= 7 ? gtWin[0] + 60000 - Date.now() : 0);
      if (wait > 20000) return Promise.reject(new Error("GeckoTerminal budget used, skipping"));
      return new Promise((r) => setTimeout(r, wait)).then(() => { gtLast = Date.now(); gtWin.push(gtLast); store.set("snek-gtwin", gtWin); STATS.gtCalls++; return getJSON(GT + path); })
        .catch((e) => { gtPauseUntil = Date.now() + 60000; throw e; });
    };
    const p = gtChain.then(run, run); gtChain = p.catch(() => {}); return p;
  }

  // ---------------- market ----------------
  function marketFromCG(d) {
    const m = d.market_data || {}; const g = (o) => (o && ok(o.usd) ? o.usd : null);
    return { price: g(m.current_price), ch24: m.price_change_percentage_24h, ch7: m.price_change_percentage_7d, ch30: m.price_change_percentage_30d, ch1y: m.price_change_percentage_1y,
      mcap: g(m.market_cap), vol: g(m.total_volume), fdv: g(m.fully_diluted_valuation), high24: g(m.high_24h), low24: g(m.low_24h),
      ath: g(m.ath), athDate: m.ath_date && m.ath_date.usd, atl: g(m.atl), atlDate: m.atl_date && m.atl_date.usd,
      circ: m.circulating_supply, total: m.total_supply, max: m.max_supply, rank: m.market_cap_rank };
  }
  const tickersFromCG = (d) => (d.tickers || []).map((t) => ({ market: t.market.name, vol: (t.converted_volume && t.converted_volume.usd) || 0 }));
  const priceAda = () => { const m = state.market; return m && ok(m.price) && ok(m.adaUsd) ? m.price / m.adaUsd : null; };

  // Live overlay: USD price = on-chain SNEK/ADA (DexHunter) x real-time ADA/USD (Kraken/Coinbase WebSockets).
  // Market cap, FDV and 24h change are rescaled from CoinGecko's last values by the live/CoinGecko price ratio.
  function applyLive(m) {
    if (!LIVE) return; const v = LIVE.usd(); if (!v || !ok(m.cgPrice)) return;
    const r = v.px / m.cgPrice; m.price = v.px; if (ok(v.adaUsd)) m.adaUsd = v.adaUsd;
    m.mcap = ok(m.cgMcap) ? m.cgMcap * r : m.mcap; m.fdv = ok(m.cgFdv) ? m.cgFdv * r : m.fdv;
    m.ch24 = ok(m.cgCh24) ? ((1 + m.cgCh24 / 100) * r - 1) * 100 : m.ch24; m.priceSrc = v.src; m.priceT = v.t;
  }
  function baseline(m) { m.cgPrice = m.price; m.cgMcap = m.mcap; m.cgFdv = m.fdv; m.cgCh24 = m.ch24; return m; }
  function renderPriceSrc() {
    const m = state.market, el = $("priceSrc"); if (!el || !m) return;
    el.textContent = m.priceSrc ? "Live: " + m.priceSrc + " · " + Math.max(0, Math.round((Date.now() - m.priceT) / 1000)) + " s ago" : "Price: CoinGecko (refreshes every 60 s)";
  }
  let liveTimer = null, liveLast = 0;
  function scheduleLive() {
    STATS.priceData.push(Date.now()); if (STATS.priceData.length > 2000) STATS.priceData.shift();
    if (liveTimer) return; const wait = Math.max(0, liveLast + 1000 - Date.now());
    liveTimer = setTimeout(() => { liveTimer = null; liveLast = Date.now(); renderMarket(); }, wait);
  }
  let tradeTimer = null;
  function scheduleTrades() { if (!tradeTimer) tradeTimer = setTimeout(() => { tradeTimer = null; renderTrades(); }, 800); }
  const VENUE_URL = { Kraken: "https://pro.kraken.com/app/trade/snek-usd", Gate: "https://www.gate.io/trade/SNEK_USDT", Bitget: "https://www.bitget.com/spot/SNEKUSDT" };
  function renderLiveVenues() {
    const el = $("liveVenues"); if (!el) return;
    const t = Date.now(), age = (x) => (x ? Math.max(0, Math.round((t - x) / 1000)) + " s ago" : na());
    const sk = (n) => (LIVE && LIVE.socks[n] && LIVE.socks[n].up ? '<span class="wsdot on" title="WebSocket connected"></span>WebSocket' : '<span class="wsdot" title="Not connected"></span>' + (LIVE && LIVE.started ? "connecting" : "paused"));
    const ada = LIVE && LIVE.ada, dex = LIVE && LIVE.dex;
    const rows = [];
    rows.push(["Cardano DEXes · SNEK/ADA", dex && ok(dex.px) ? dex.px.toPrecision(5) + " ADA" + (ada && ok(ada.px) ? '<div class="small muted">≈ $' + Number((dex.px * ada.px).toPrecision(5)) + "</div>" : "") : na(), dex ? esc(dex.src) + " · REST 4 s" : "DexHunter · REST 4 s", age(dex && dex.t)]);
    ["Kraken", "Gate", "Bitget"].forEach((v) => { const c = LIVE && LIVE.cex[v]; rows.push([v + " · " + (c && c.pair ? c.pair : v === "Kraken" ? "SNEK/USD" : "SNEK/USDT"), c && ok(c.px) ? "$" + Number(c.px.toPrecision(5)) : na(), sk(v), age(c && c.t)]); });
    rows.push(["ADA/USD", ada ? "$" + ada.px.toFixed(5) : na(), ada ? esc(ada.src) + (/REST/.test(ada.src) ? "" : " · WebSocket") : sk("Kraken"), age(ada && ada.t)]);
    el.innerHTML = "<tr><th>Venue · feed · updated</th><th>Last</th></tr>" + rows.map((r) => "<tr><td>" + r[0] + '<div class="small muted">' + r[2] + " · " + r[3] + "</div></td><td>" + r[1] + "</td></tr>").join("");
  }
  function renderMarket() {
    const m = state.market; if (!m) return;
    applyLive(m);
    const pa = priceAda();
    const pc = ok(m.price) && F() && F().cur() !== "USD" ? F().conv(m.price) : null;
    const ptxt = !ok(m.price) ? null : pc ? (pc.suffix ? Number(pc.v.toPrecision(5)).toLocaleString(F().locale(), { maximumSignificantDigits: 5 }) + " " + pc.sym : pc.sym + Number(pc.v.toPrecision(5)).toLocaleString(F().locale(), { maximumSignificantDigits: 5 })) : "$" + Number(Number(m.price).toPrecision(5));
    const pl = $("pairLbl"); if (pl) pl.textContent = "SNEK / " + (pc ? F().cur() : "USD");
    if (ptxt && ptxt !== renderMarket._last) { renderMarket._last = ptxt; STATS.priceShown.push(Date.now()); if (STATS.priceShown.length > 500) STATS.priceShown.shift(); }
    if (FX && ptxt) FX.price($("price"), ptxt, m.price); else $("price").innerHTML = usd(m.price);
    unskel($("priceAda")); $("priceAda").innerHTML = ok(pa) ? pa.toPrecision(5) + " ADA" : na();
    renderPriceSrc();
    $("ch24").innerHTML = pct(m.ch24);
    unskel($("tPrice")); if (FX && ptxt) FX.price($("tPrice"), ptxt, m.price); else $("tPrice").innerHTML = usd(m.price); $("tChg").innerHTML = pct(m.ch24);
    pushSpark(m.price);
    document.title = (ok(m.price) ? "$" + Number(m.price.toPrecision(4)) + " · " : "") + ((window.SNEKSET && SNEKSET.get().name) ? SNEKSET.get().name + " · " : "") + "SNEK Dashboard (Fan-made)";
    const k = [["Market cap", compact(m.mcap)], ["24h volume", compact(m.vol)], ["FDV", compact(m.fdv)], ["7d change", pct(m.ch7)], ["30d change", pct(m.ch30)], ["ADA price", F() && F().cur() === "ADA" ? (ok(m.adaUsd) ? "$" + Number(m.adaUsd.toPrecision(4)) : na()) : usd(m.adaUsd)], ["CoinGecko rank", ok(m.rank) ? "#" + m.rank : na()]];
    const kEl = $("kpis");
    if (!kEl.dataset.built) { kEl.innerHTML = k.map((x, i) => '<div class="kpi"><div class="l">' + x[0] + '</div><div class="v" id="kpi' + i + '"></div></div>').join(""); kEl.dataset.built = "1"; }
    const nums = [m.mcap, m.vol, m.fdv];
    k.forEach((x, i) => { const el = $("kpi" + i); if (FX && i < 3 && ok(nums[i])) FX.countUp(el, nums[i], compact); else el.innerHTML = x[1]; });
    const d = (s) => (s ? fmtTime(new Date(s), { month: "short", day: "numeric", year: "numeric" }) : "");
    const h = SNAP && SNAP.holders;
    const st = [
      ["Circulating supply", ok(m.circ) ? num(m.circ) + " SNEK" : na()], ["Total supply", ok(m.total) ? num(m.total) + " SNEK" : na()], ["Max supply", ok(m.max) ? num(m.max) + " SNEK" : na()],
      ["24h high / low", ok(m.high24) ? usd(m.high24) + " / " + usd(m.low24) : na()], ["1y change", pct(m.ch1y)],
      ["All-time high", ok(m.ath) ? usd(m.ath) + ' <span class="muted small">' + d(m.athDate) + "</span>" : na()],
      ["All-time low", ok(m.atl) ? usd(m.atl) + ' <span class="muted small">' + d(m.atlDate) + "</span>" : na()],
      ["On-chain transactions", h && ok(h.transactions) ? num(h.transactions) : na()]
    ];
    $("stats").innerHTML = st.map((x) => "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>").join("");
    renderCalc(); renderPortfolio(); checkAlerts();
  }

  // ---------------- chart (TradingView Lightweight Charts) ----------------
  let chart = null, sMain = null, sVol = null, sMA = {};
  const MA_COLORS = { 20: "#c684f0", 50: "#88eaff" };
  function chartColors() { return { bg: css("--card"), text: css("--muted"), grid: css("--line"), up: css("--snek"), down: css("--red") }; }
  function tickFmt(time, type) {
    const d = new Date(time * 1000);
    if (type === 0) return fmtTime(d, { year: "numeric" });
    if (type === 1) return fmtTime(d, { month: "short" });
    if (type === 2) return fmtTime(d, { month: "short", day: "numeric" });
    return fmtTime(d, { hour: "numeric", minute: "2-digit" });
  }
  function initChart() {
    const el = $("tvchart");
    if (!window.LightweightCharts) { el.innerHTML = '<p class="na">Chart library failed to load.</p>'; return; }
    el.innerHTML = "";
    const c = chartColors(); const LW = window.LightweightCharts;
    chart = LW.createChart(el, {
      autoSize: true,
      layout: { background: { type: "solid", color: c.bg }, textColor: c.text, fontFamily: "Inter, system-ui, sans-serif", attributionLogo: true },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.grid, scaleMargins: { top: 0.08, bottom: 0.25 } },
      timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickFmt, rightOffset: 4 },
      localization: { timeFormatter: (t) => fmtTime(new Date(t * 1000), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" },
      crosshair: { mode: LW.CrosshairMode.Normal },
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true }, handleScroll: { horzTouchDrag: true, vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true }
    });
    buildSeries();
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 40) loadOlder(); });
    chart.subscribeCrosshairMove((p) => {
      if (!p || !p.time) { showOHLC(state.chart.bars[state.chart.bars.length - 1]); return; }
      const b = state.chart.bars.find((x) => x.time === p.time); showOHLC(b);
    });
  }
  function priceFmt() { return state.chart.cur === "usd" ? { type: "price", precision: 8, minMove: 0.00000001 } : { type: "price", precision: 6, minMove: 0.000001 }; }
  let indSeries = [], indData = {};
  const PANE_H = 110;
  function buildSeries() {
    if (!chart) return;
    const LW = window.LightweightCharts, c = chartColors();
    [sMain, sVol].concat(indSeries.map((x) => x.s)).forEach((s) => { if (s) { try { chart.removeSeries(s); } catch (e) {} } });
    indSeries = []; sMA = {};
    try { while (chart.panes().length > 1) chart.removePane(chart.panes().length - 1); } catch (e) {}
    sMain = state.chart.type === "candle"
      ? chart.addSeries(LW.CandlestickSeries, { upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down, priceFormat: priceFmt() })
      : chart.addSeries(LW.AreaSeries, { lineColor: c.up, topColor: c.up + "55", bottomColor: c.up + "00", lineWidth: 2, priceFormat: priceFmt() });
    sVol = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const IND = window.SNEKIND; let pane = 0;
    const line = (cfg, key, color, opts, paneIdx) => { const s = chart.addSeries(LW.LineSeries, Object.assign({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, opts), paneIdx); indSeries.push({ id: cfg.id, key, s }); return s; };
    if (IND) IND.active().forEach((cfg) => {
      if (cfg.kind === "overlay") {
        if (cfg.id === "bb") { line(cfg, "upper", cfg.color, { priceFormat: priceFmt() }, 0); line(cfg, "main", cfg.color, { priceFormat: priceFmt(), lineStyle: 2, lineWidth: 1 }, 0); line(cfg, "lower", cfg.color, { priceFormat: priceFmt() }, 0); }
        else line(cfg, "main", cfg.color, { priceFormat: priceFmt() }, 0);
      } else if (cfg.kind === "volume") line(cfg, "main", cfg.color, { priceScaleId: "vol", priceFormat: { type: "volume" } }, 0);
      else {
        pane++;
        const fmt = cfg.id === "atr" ? priceFmt() : cfg.id === "macd" ? { type: "price", precision: state.chart.cur === "usd" ? 9 : 7, minMove: state.chart.cur === "usd" ? 1e-9 : 1e-7 } : { type: "price", precision: 1, minMove: 0.1 };
        if (cfg.id === "macd") { const h = chart.addSeries(LW.HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: fmt }, pane); indSeries.push({ id: cfg.id, key: "hist", s: h, hist: true }); }
        const m = line(cfg, "main", cfg.color, { priceFormat: fmt, lastValueVisible: true }, pane);
        if (cfg.id === "macd" || cfg.id === "stochrsi") line(cfg, "signal", "#ff8a65", { priceFormat: fmt }, pane);
        if (cfg.id === "rsi" || cfg.id === "stochrsi") (cfg.id === "rsi" ? [70, 30] : [80, 20]).forEach((g) => m.createPriceLine({ price: g, color: c.text, lineWidth: 1, lineStyle: 2, axisLabelVisible: false }));
      }
    });
    const el = $("tvchart"); el.style.height = pane ? "calc(clamp(320px,55vh,520px) + " + pane * PANE_H + "px)" : "";
    try { chart.panes().forEach((p, i) => { if (i > 0) p.setHeight(PANE_H); }); } catch (e) {}
    const btn = $("indBtn"); if (btn) { const n = IND ? IND.active().length : 0; btn.innerHTML = "ƒx Indicators" + (n ? ' <span class="badge">' + n + "</span>" : ""); }
    paint(true);
  }
  function paintIndicators() {
    const IND = window.SNEKIND; indData = {}; if (!IND) return;
    const bars = state.chart.bars, c = chartColors();
    IND.active().forEach((cfg) => { const r = IND.compute(cfg, bars, state.chart.iv); const maps = {}; Object.keys(r).forEach((k) => { if (Array.isArray(r[k])) maps[k] = new Map(r[k].map((p) => [p.time, p.value])); }); indData[cfg.id] = { cfg, r, maps }; });
    indSeries.forEach((x) => { const d = indData[x.id]; if (!d) return; let data = d.r[x.key] || []; if (x.hist) data = data.map((p) => ({ time: p.time, value: p.value, color: (p.value >= 0 ? c.up : c.down) + "99" })); x.s.setData(data); });
  }
  function sma(bars, n) { const out = []; let sum = 0; for (let i = 0; i < bars.length; i++) { sum += bars[i].close; if (i >= n) sum -= bars[i - n].close; if (i >= n - 1) out.push({ time: bars[i].time, value: sum / n }); } return out; }
  function volBar(b) { const c = chartColors(); return { time: b.time, value: b.volume, color: (b.close >= b.open ? c.up : c.down) + "66" }; }
  function paint(fit) {
    if (!sMain) return; const bars = state.chart.bars;
    sMain.setData(state.chart.type === "candle" ? bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })) : bars.map((b) => ({ time: b.time, value: b.close })));
    sVol.setData(bars.map(volBar));
    paintIndicators();
    if (fit && bars.length) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 120), to: bars.length + 4 });
    showOHLC(bars[bars.length - 1]);
    const hh = state.chart.hist, first = bars.length ? bars[0].time : null;
    $("chartSrc").textContent = (state.chart.live ? "· live" : bars.length ? "· saved history" : "") + (first ? " · from " + fmtTime(new Date(first * 1000), { month: "short", day: "numeric", year: "numeric" }) + (hh && hh.ci > 0 ? " · scroll left for more" : "") : "");
  }
  function showOHLC(b) {
    const el = $("ohlc"); if (!b) { el.innerHTML = '<span class="na">No candle data yet</span>'; return; }
    const f = (v) => !ok(v) ? "" : state.chart.cur === "usd" ? "$" + Number(v.toPrecision(4)) : Number(v.toPrecision(4)) + " ₳";
    const ch = ((b.close - b.open) / b.open) * 100;
    const vu = state.chart.cur === "usd" ? "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(b.volume) : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(b.volume) + " ₳";
    el.innerHTML = '<span class="muted">' + fmtTime(new Date(b.time * 1000), { year: new Date(b.time * 1000).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "</span>" + (b.src === 1 ? '<span class="vtag" title="Older candle from Gate.io SNEK/USDT (CEX)">CEX · Gate</span>' : "") + "<span>O <b>" + f(b.open) + "</b></span><span>H <b>" + f(b.high) + "</b></span><span>L <b>" + f(b.low) + "</b></span><span>C <b>" + f(b.close) + "</b></span>" + pct(ch) + "<span>Vol <b>" + vu + "</b></span>" +
      Object.values(indData).map((d) => { const v = d.maps.main && d.maps.main.get(b.time); if (v == null) return ""; const id = d.cfg.id, osc = id === "rsi" || id === "stochrsi"; const val = osc ? v.toFixed(1) : id === "volma" ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : id === "macd" ? Number(v.toPrecision(3)).toString() : f(v); const sig = d.maps.signal && d.maps.signal.get(b.time); return '<span style="color:' + d.cfg.color + '">' + window.SNEKIND.label(d.cfg, true) + " " + val + (sig != null && osc ? " / " + sig.toFixed(1) : "") + "</span>"; }).join("");
  }
  const toBars = (list) => list.map((r) => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })).sort((a, b) => a.time - b.time).filter((b, i, a) => !i || b.time !== a[i - 1].time);
  function ohlcvURL(limit) { const iv = IVS[state.chart.iv]; return "/pools/" + state.mainPool + "/ohlcv/" + iv[0] + "?aggregate=" + iv[1] + "&limit=" + limit + "&currency=" + (state.chart.cur === "usd" ? "usd" : "token"); }
  let loadSeq = 0, loadTimer = null;
  const candleCache = {};
  function loadCandles() { clearTimeout(loadTimer); loadTimer = setTimeout(loadCandlesNow, 250); }
  // Long history (assets/history, built daily by a GitHub Action) is merged under the live candles,
  // and older 500-candle chunks load when you scroll left.
  const H = () => window.SNEKHIST;
  function mergeOlder(older, bars) { const first = bars.length ? bars[0].time : Infinity; return older.filter((b) => b.time < first).concat(bars); }
  async function withHistory(bars, iv, cur, seq) {
    if (!H()) return bars;
    try {
      let r = await H().latest(iv, cur); if (seq !== loadSeq) return bars;
      let out = mergeOlder(r.bars, bars), ci = r.ci;
      while (out.length < 400 && ci > 0) { const o = await H().older(iv, cur, ci); ci = o.ci; out = mergeOlder(o.bars, out); }
      state.chart.hist = { iv, cur, ci, first: r.ix.first, count: r.ix.count };
      return out;
    } catch (e) { state.chart.hist = null; return bars; }
  }
  let olderBusy = false;
  async function loadOlder() {
    const h = state.chart.hist; if (olderBusy || !h || h.ci <= 0 || h.iv !== state.chart.iv || h.cur !== state.chart.cur || !sMain) return;
    olderBusy = true; const seq = loadSeq;
    try {
      const o = await H().older(h.iv, h.cur, h.ci); if (seq !== loadSeq) return;
      h.ci = o.ci; const before = state.chart.bars.length; const merged = mergeOlder(o.bars, state.chart.bars); const added = merged.length - before;
      if (added > 0) {
        const r = chart.timeScale().getVisibleLogicalRange();
        state.chart.bars = merged; const key = state.chart.iv + "|" + state.chart.cur; if (candleCache[key]) candleCache[key].bars = merged.slice();
        paint(false); if (r) chart.timeScale().setVisibleLogicalRange({ from: r.from + added, to: r.to + added });
        toast("Loaded older candles back to " + fmtTime(new Date(merged[0].time * 1000), { month: "short", day: "numeric", year: "numeric" }));
      }
    } catch (e) {} finally { olderBusy = false; }
  }
  function loadCandlesNow() {
    const seq = ++loadSeq; const key = state.chart.iv + "|" + state.chart.cur; const c = candleCache[key]; const iv = state.chart.iv, cur = state.chart.cur;
    if (c && Date.now() - c.t < 60000) { state.chart.bars = c.bars.slice(); state.chart.hist = c.hist ? Object.assign({}, c.hist) : null; state.chart.live = true; paint(true); return Promise.resolve(); }
    return gt(ohlcvURL(300)).then(async (r) => {
      if (seq !== loadSeq) return;
      const live = toBars(r.data.attributes.ohlcv_list); if (!live.length) throw new Error("empty");
      const bars = await withHistory(live, iv, cur, seq); if (seq !== loadSeq) return;
      candleCache[key] = { t: Date.now(), bars: bars.slice(), hist: state.chart.hist ? Object.assign({}, state.chart.hist) : null };
      state.chart.bars = bars; state.chart.live = true; state.live.candles = true; paint(true); sparkFromCandles();
    }).catch(async () => {
      if (seq !== loadSeq) return;
      state.live.candles = false; state.chart.live = false;
      const o = SNAP && SNAP.ohlcv;
      let bars = await withHistory([], iv, cur, seq); if (seq !== loadSeq) return;
      if (!bars.length) bars = o ? toBars(cur === "usd" ? o.usd : o.ada) : [];
      state.chart.bars = bars;
      paint(true);
      toast(bars.length ? "Live candles busy, showing saved history and retrying" : "Candles unavailable right now, retrying");
      setTimeout(() => { if (seq === loadSeq && !state.chart.live) loadCandles(); }, 31000);
    });
  }
  function updateLastCandles() {
    if (!state.chart.live || !sMain) return Promise.resolve();
    const seq = loadSeq;
    return gt(ohlcvURL(2)).then((r) => {
      if (seq !== loadSeq) return;
      const nb = toBars(r.data.attributes.ohlcv_list); const bars = state.chart.bars;
      nb.forEach((b) => {
        const last = bars[bars.length - 1];
        if (!last || b.time > last.time) bars.push(b); else if (b.time === last.time) bars[bars.length - 1] = b; else return;
        sMain.update(state.chart.type === "candle" ? { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close } : { time: b.time, value: b.close });
        sVol.update(volBar(b));
      });
      paintIndicators(); showOHLC(bars[bars.length - 1]);
    }).catch(() => {});
  }
  function setupChartControls() {
    const chips = $("ivChips"); chips.innerHTML = Object.keys(IVS).map((k) => '<button data-v="' + k + '">' + k + "</button>").join("");
    const mark = () => {
      [...chips.children].forEach((b) => { b.classList.toggle("on", b.dataset.v === state.chart.iv); b.setAttribute("aria-pressed", b.dataset.v === state.chart.iv); });
      [...$("typeSeg").children].forEach((b) => b.classList.toggle("on", b.dataset.v === state.chart.type));
      [...$("curSeg").children].forEach((b) => b.classList.toggle("on", b.dataset.v === state.chart.cur));
    };
    const on = (id, fn) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { fn(b.dataset.v); mark(); } });
    on("ivChips", (v) => { state.chart.iv = v; store.set("snek-iv", v); loadCandles(); });
    on("typeSeg", (v) => { state.chart.type = v; store.set("snek-type", v); buildSeries(); });
    on("curSeg", (v) => { state.chart.cur = v; store.set("snek-cur", v); buildSeries(); loadCandles(); });
    if (window.SNEKIND) { $("indBtn").addEventListener("click", () => window.SNEKIND.open()); let t = null; window.SNEKIND.onChange(() => { clearTimeout(t); t = setTimeout(() => { const r = chart && chart.timeScale().getVisibleLogicalRange(); buildSeries(); if (r) chart.timeScale().setVisibleLogicalRange(r); }, 150); }); }
    mark();
  }
  function retheme() {
    if (!chart) return; const c = chartColors();
    chart.applyOptions({ layout: { background: { type: "solid", color: c.bg }, textColor: c.text }, grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } }, rightPriceScale: { borderColor: c.grid }, timeScale: { borderColor: c.grid } });
    buildSeries();
  }

  // ---------------- calculator / portfolio / alerts ----------------
  function renderCalc() {
    const m = state.market, out = $("calcOut"); const a = parseFloat($("calcAmt").value), u = $("calcUnit").value; const pa = priceAda();
    if (!m || !ok(m.price) || !ok(a) || a < 0) { out.innerHTML = '<div><span>Result</span><span class="na">enter an amount</span></div>'; return; }
    const snek = u === "snek" ? a : u === "usd" ? a / m.price : pa ? a / pa : null;
    out.innerHTML = "<div><span>SNEK</span><b>" + num(snek) + "</b></div><div><span>US dollars</span><b>" + (ok(snek) ? "$" + num(snek * m.price, 2) : na()) + "</b></div><div><span>ADA</span><b>" + (ok(snek) && pa ? num(snek * pa, 2) + " ADA" : na()) + "</b></div>";
  }
  function renderPortfolio() {
    const m = state.market, out = $("pfOut"); const amt = parseFloat($("pfAmt").value), cost = parseFloat($("pfCost").value); const pa = priceAda();
    if (!ok(amt) || amt <= 0) { out.innerHTML = '<div><span>Your SNEK</span><span class="muted">enter an amount to track</span></div>'; return; }
    if (!m || !ok(m.price)) { out.innerHTML = '<div><span>Value</span><span class="na">waiting for price</span></div>'; return; }
    const val = amt * m.price; const prev = ok(m.ch24) ? val / (1 + m.ch24 / 100) : null; const pl24 = ok(prev) ? val - prev : null;
    const sign = (v) => (v >= 0 ? "+$" : "−$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    let h = "<div><span>Value</span><b>$" + num(val, 2) + "</b></div><div><span>Value in ADA</span><b>" + (pa ? num(amt * pa, 2) + " ADA" : na()) + "</b></div>";
    h += "<div><span>24h P/L</span>" + (ok(pl24) ? '<b class="' + (pl24 < 0 ? "down" : "") + '">' + sign(pl24) + " (" + pct(m.ch24) + ")</b>" : na()) + "</div>";
    if (ok(cost) && cost > 0) { const pl = val - amt * cost; h += '<div><span>Total P/L vs cost</span><b class="' + (pl < 0 ? "down" : "") + '">' + sign(pl) + " (" + pct((m.price / cost - 1) * 100) + ")</b></div>"; }
    out.innerHTML = h;
  }
  function setupPortfolio() {
    const pf = store.get("snek-portfolio", {}); if (pf.amt) $("pfAmt").value = pf.amt; if (pf.cost) $("pfCost").value = pf.cost;
    const save = () => { store.set("snek-portfolio", { amt: $("pfAmt").value, cost: $("pfCost").value }); renderPortfolio(); };
    $("pfAmt").addEventListener("input", save); $("pfCost").addEventListener("input", save);
    const go = () => {
      const a = $("lookupAddr").value.trim(); const out = $("lookupOut");
      if (!/^(addr1[0-9a-z]{20,}|stake1[0-9a-z]{20,}|Ae2[1-9A-HJ-NP-Za-km-z]{40,})$/.test(a)) { out.innerHTML = '<span class="sell">Enter a valid addr1… or stake1… address.</span>'; return; }
      out.textContent = "Looking up…";
      if (a.startsWith("stake1") || !window.SNEKWALLETS) { out.innerHTML = '<span class="sell">Paste an addr1… address (a stake key alone can’t be summed with the free, keyless APIs).</span>'; return; }
      window.SNEKWALLETS.balanceOf(a)
        .then((b) => { $("pfAmt").value = b.snek; save(); out.innerHTML = "Found <b>" + num(b.snek) + " SNEK</b> at this address. Portfolio updated."; })
        .catch((e) => { out.innerHTML = '<span class="sell">Lookup failed (' + esc(e.message) + "). The free API may be busy, try again.</span>"; });
    };
    $("lookupBtn").addEventListener("click", go); $("lookupAddr").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }
  let alerts = store.get("snek-alerts", []);
  function renderAlerts() {
    $("alList").innerHTML = alerts.map((a, i) => "<li><span>Price " + a.dir + " <b>$" + a.price + "</b></span><button class=\"btn\" data-i=\"" + i + "\" aria-label=\"Remove alert\">Remove</button></li>").join("");
  }
  function checkAlerts() {
    const p = state.market && state.market.price; if (!ok(p) || !alerts.length) return;
    const hit = alerts.filter((a) => (a.dir === "above" ? p >= a.price : p <= a.price)); if (!hit.length) return;
    if (FX) FX.haptic([30, 60, 30, 60, 30]);
    hit.forEach((a) => {
      const msg = "SNEK is " + a.dir + " $" + a.price + " (now $" + Number(Number(p).toPrecision(4)) + ")";
      toast("🔔 " + msg + " · fan-made alert");
      if ("Notification" in window && Notification.permission === "granted") { try { new Notification("SNEK price alert", { body: msg, icon: "assets/icons/icon-192.png" }); } catch (e) {} }
    });
    alerts = alerts.filter((a) => !hit.includes(a)); store.set("snek-alerts", alerts); renderAlerts();
  }
  function setupAlerts() {
    renderAlerts();
    $("alAdd").addEventListener("click", () => {
      const v = parseFloat($("alPrice").value); if (!ok(v) || v <= 0) { toast("Enter a USD price"); return; }
      alerts.push({ dir: $("alDir").value, price: v }); store.set("snek-alerts", alerts); renderAlerts(); $("alPrice").value = "";
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().then((r) => { if (r !== "granted") $("alNote").textContent = "Notifications are blocked, so alerts show as an on-page banner while this tab is open."; });
      toast("Alert added"); checkAlerts();
    });
    $("alList").addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (!b) return; alerts.splice(+b.dataset.i, 1); store.set("snek-alerts", alerts); renderAlerts(); });
  }

  // ---------------- bars / donut / treemap ----------------
  function bars(el, rows) {
    if (!rows.length) { el.innerHTML = empty("No data right now. It will appear on the next refresh."); return; }
    const mx = Math.max(...rows.map((r) => r.value)) || 1;
    el.innerHTML = '<div class="bars">' + rows.map((r) => '<div class="bar"><span>' + esc(r.label) + (r.meta ? ' <span class="muted small">' + esc(r.meta) + "</span>" : "") + '</span><div class="track"><div class="fill" style="width:' + Math.max(1, (r.value / mx) * 100) + '%"></div></div><span class="val">' + r.display + "</span></div>").join("") + "</div>";
  }
  const PAL = () => [css("--snek"), css("--blue"), css("--purple"), css("--cyan"), css("--muted")];
  function donut(el, parts) {
    const cols = PAL(); const tot = parts.reduce((s, p) => s + p.value, 0); let a0 = -Math.PI / 2, segs = "";
    parts.forEach((p, i) => {
      const a1 = a0 + (p.value / tot) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const P = (a, r) => (50 + r * Math.cos(a)).toFixed(2) + " " + (50 + r * Math.sin(a)).toFixed(2);
      segs += '<path d="M' + P(a0, 46) + " A46 46 0 " + large + " 1 " + P(a1, 46) + " L" + P(a1, 28) + " A28 28 0 " + large + " 0 " + P(a0, 28) + ' Z" fill="' + cols[i % cols.length] + '"/>'; a0 = a1;
    });
    el.innerHTML = '<div class="donut"><svg viewBox="0 0 100 100" role="img" aria-label="Supply share by holder tier">' + segs + '</svg><div class="legend">' + parts.map((p, i) => '<div><i style="background:' + cols[i % cols.length] + '"></i>' + esc(p.label) + " — <b>" + p.value.toFixed(2) + '%</b> <span class="muted">' + esc(p.meta) + "</span></div>").join("") + "</div></div>";
  }
  function treemap(el, top) {
    if (!window.d3 || !d3.treemap || !top.length) { el.innerHTML = ""; return; }
    const W = 1000, H = 300;
    const root = d3.hierarchy({ children: top.map((t, i) => ({ name: t[0], v: t[1], pct: t[2], rank: i + 1 })) }).sum((d) => d.v || 0).sort((a, b) => b.value - a.value);
    d3.treemap().size([W, H]).padding(3).round(true)(root);
    const cols = PAL();
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Top 10 wallets sized by SNEK held">' + root.leaves().map((n, i) => {
      const w = n.x1 - n.x0, h = n.y1 - n.y0;
      return '<g><title>#' + n.data.rank + " " + esc(n.data.name) + " — " + n.data.pct + '%</title><rect x="' + n.x0 + '" y="' + n.y0 + '" width="' + w + '" height="' + h + '" rx="6" fill="' + cols[i % 4] + '" opacity="' + (1 - i * 0.05) + '"/>' +
        (w > 70 && h > 34 ? '<text x="' + (n.x0 + 8) + '" y="' + (n.y0 + 20) + '" font-weight="700">#' + n.data.rank + " · " + n.data.pct + "%</text>" + (w > 140 ? '<text x="' + (n.x0 + 8) + '" y="' + (n.y0 + 36) + '">' + esc(n.data.name) + "</text>" : "") : "") + "</g>";
    }).join("") + "</svg>";
  }

  // ---------------- holders ----------------
  function renderHolders() {
    const h = SNAP && SNAP.holders;
    if (!h) { $("holderNote").textContent = "Holder data unavailable"; ["tierChart", "rankChart", "treemap"].forEach((id) => ($(id).innerHTML = empty("Holder data unavailable right now."))); return; }
    const when = new Date(h.asOf);
    $("holderNote").innerHTML = "Updated " + ago(when) + ' <span class="muted">(' + stamp(when) + ", " + esc(h.source) + ")</span>";
    unskel($("holderCount")); if (FX) FX.countUp($("holderCount"), h.count, (v) => num(Math.round(v)), 1200); else $("holderCount").textContent = num(h.count);
    $("holderSub").textContent = "holders" + (ok(h.top100) ? " · top 100 hold " + h.top100 + "%" : "");
    if (h.tiers && h.tiers.length) donut($("tierChart"), h.tiers.map((t) => ({ label: t[0], value: t[2], meta: num(t[1]) + " wallets" }))); else $("tierChart").innerHTML = na();
    if (h.ranks && h.ranks.length) bars($("rankChart"), h.ranks.map((r) => ({ label: r[0], value: r[1], display: r[1] + "%" }))); else $("rankChart").innerHTML = na();
    treemap($("treemap"), h.top || []);
    $("holdersTable").innerHTML = (h.top || []).length ? "<tr><th>Rank</th><th>Wallet</th><th>SNEK</th><th>Share</th></tr>" + h.top.map((t, i) => "<tr><td>" + (i + 1) + '</td><td class="mono">' + esc(t[0]) + "</td><td>" + num(t[1]) + "</td><td>" + t[2].toFixed(2) + "%</td></tr>").join("") : "";
  }
  function refreshHolders() {
    if (!HTTP) return Promise.resolve();
    return getJSON("assets/snapshot.json?t=" + Date.now(), { cache: "no-store" }).then((s) => {
      if (s && s.holders && (!SNAP || !SNAP.holders || s.holders.asOf !== SNAP.holders.asOf)) { SNAP = Object.assign({}, SNAP, { holders: s.holders, ohlcv: s.ohlcv }); renderHolders(); renderMarket(); }
    }).catch(() => {});
  }

  // ---------------- pools / venues / trades ----------------
  function renderPools() {
    const pools = state.pools.map((p) => {
      const a = p.attributes, dex = p.relationships && p.relationships.dex && p.relationships.dex.data.id;
      return { name: a.name, dex: DEX_NAMES[dex] || dex, liq: parseFloat(a.reserve_in_usd) || 0, vol: parseFloat(a.volume_usd && a.volume_usd.h24) || 0, ch: parseFloat(a.price_change_percentage && a.price_change_percentage.h24), tx: a.transactions && a.transactions.h24 ? a.transactions.h24.buys + a.transactions.h24.sells : null, addr: a.address };
    }).sort((a, b) => b.liq - a.liq);
    const by = {}; pools.forEach((p) => { by[p.dex] = by[p.dex] || { liq: 0, n: 0 }; by[p.dex].liq += p.liq; by[p.dex].n++; });
    bars($("dexChart"), Object.keys(by).map((k) => ({ label: k, value: by[k].liq, display: big(by[k].liq), meta: by[k].n + " pools" })).sort((a, b) => b.value - a.value));
    const top = pools.filter((p) => p.liq >= 1000).slice(0, 10);
    $("poolsTable").innerHTML = top.length ? "<tr><th>Pool</th><th>DEX</th><th>Liquidity</th><th>24h vol</th><th>24h</th><th>Trades</th></tr>" + top.map((p) => '<tr><td><a href="https://www.geckoterminal.com/cardano/pools/' + encodeURIComponent(p.addr) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a></td><td>" + esc(p.dex) + "</td><td>" + big(p.liq) + "</td><td>" + big(p.vol) + "</td><td>" + pct(p.ch) + "</td><td>" + num(p.tx) + "</td></tr>").join("") : "<tr><td>" + empty("Pool data unavailable right now.") + "</td></tr>";
  }
  function renderVenues() {
    const agg = {}; state.tickers.forEach((t) => (agg[t.market] = (agg[t.market] || 0) + (t.vol || 0)));
    const dex = { Minswap: 1, WingRiders: 1, "CSWAP DEX": 1, SundaeSwap: 1, Splash: 1 };
    bars($("venueChart"), Object.keys(agg).map((k) => ({ label: k, value: agg[k], display: big(agg[k]), meta: dex[k] ? "DEX" : "" })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 10));
  }
  function tradeRows(vf) {
    const mp = state.pools.find((p) => p.attributes && p.attributes.address === state.mainPool), mdex = mp && mp.relationships && mp.relationships.dex ? (DEX_NAMES[mp.relationships.dex.data.id] || mp.relationships.dex.data.id) : "Minswap";
    let rows = vf === "cex" ? [] : state.trades.map((t) => { const a = t.attributes, buy = a.kind === "buy"; return { id: a.tx_hash, addr: a.tx_from_address, venue: mdex, dex: true, time: new Date(a.block_timestamp).getTime(), buy, usd: parseFloat(a.volume_in_usd), snek: parseFloat(buy ? a.to_token_amount : a.from_token_amount), ada: parseFloat(buy ? a.from_token_amount : a.to_token_amount) }; });
    if (vf !== "cex") {
      const have = new Set(rows.map((r) => r.id)), adaUsd = state.market && state.market.adaUsd;
      rows = rows.concat(state.dhTrades.filter((d) => !have.has(d.id) && !have.has(d.alt)).map((d) => Object.assign({}, d, { usd: ok(adaUsd) ? d.ada * adaUsd : NaN })));
    }
    if (LIVE && vf !== "dex") rows = rows.concat(LIVE.trades.map((t) => ({ id: t.id, venue: t.venue, pair: t.pair, dex: false, time: t.time, buy: t.side === "buy", usd: t.usd, snek: t.qty, ada: null })));
    rows.sort((x, y) => y.time - x.time);
    return rows;
  }
  function renderTrades() {
    const min = +$("whaleMin").value, only = $("whaleOnly").checked, vf = $("tradeVenue") ? $("tradeVenue").value : "all";
    const mp = state.pools.find((p) => p.attributes && p.attributes.address === state.mainPool), mdex = mp && mp.relationships && mp.relationships.dex ? (DEX_NAMES[mp.relationships.dex.data.id] || mp.relationships.dex.data.id) : "Minswap";
    let rows = tradeRows(vf);
    const whales = rows.filter((r) => r.usd >= min);
    $("whaleSummary").innerHTML = rows.length ? "🐋 " + whales.length + " of " + rows.length + " recent trades are ≥ $" + min.toLocaleString() + " · whale buys " + big(whales.filter((r) => r.buy).reduce((s, r) => s + r.usd, 0)) + " vs sells " + big(whales.filter((r) => !r.buy).reduce((s, r) => s + r.usd, 0)) : "";
    const show = (only ? whales : rows).slice(0, 25);
    if (!show.length) { $("tradesTable").innerHTML = "<tr><td>" + empty(rows.length ? "No whale trades in the latest batch. Try a lower threshold." : "Trade data unavailable right now.") + "</td></tr>"; return; }
    const seen = new Set(); STATS._ids = STATS._ids || new Set();
    $("tradesTable").innerHTML = "<tr><th>Time (CT)</th><th>Venue</th><th>Side</th><th>ADA</th><th>SNEK</th><th>USD</th></tr>" + show.map((r) => {
      const w = r.usd >= min; seen.add(r.id);
      const href = r.dex ? "https://cardanoscan.io/transaction/" + encodeURIComponent(r.id) : VENUE_URL[r.venue];
      return '<tr data-tx="' + esc(r.id) + '"' + (Date.now() - r.time > 180000 ? " data-old" : "") + ' class="' + (w ? "whale" : "") + '"><td><a href="' + esc(href) + '" target="_blank" rel="noopener">' + fmtTime(new Date(r.time), Date.now() - r.time < 72000000 ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "</a></td><td><span class=\"vtag " + (r.dex ? "dex" : "cex") + '">' + esc(r.venue) + (r.dex ? "" : ' <span class="muted">' + esc(r.pair) + "</span>") + "</span></td><td class=\"" + (r.buy ? "buy" : "sell") + '">' + (w ? "🐋 " : "") + (r.buy ? "Buy" : "Sell") + "</td><td>" + (r.dex ? num(r.ada, 2) : '<span class="muted" title="CEX trade, quoted in USD/USDT">—</span>') + "</td><td>" + num(r.snek) + "</td><td>" + usd(r.usd) + "</td></tr>";
    }).join("");
    seen.forEach((id) => { if (!STATS._ids.has(id)) { STATS._ids.add(id); if (STATS._init) STATS.tradeNew.push(Date.now()); } }); STATS._init = true;
    if (FX) FX.trades($("tradesTable"));
  }

  // ---------------- sparkline ----------------
  let sparkVals = null;
  function seedSpark() {
    const o = SNAP && SNAP.ohlcv && SNAP.ohlcv.usd;
    if (o && o.length) sparkVals = o.slice(-24).map((r) => +r[4]);
  }
  function pushSpark(p) {
    if (!ok(p)) return; if (!sparkVals) sparkVals = [];
    const t = Date.now();
    if (pushSpark._t && t - pushSpark._t < 60000 && sparkVals.length) sparkVals[sparkVals.length - 1] = p; else { sparkVals.push(p); pushSpark._t = t; }
    if (sparkVals.length > 60) sparkVals = sparkVals.slice(-60);
    if (FX) FX.spark($("tSpark"), sparkVals);
  }
  function sparkFromCandles() {
    if (state.chart.iv === "1H" && state.chart.cur === "usd" && state.chart.live && state.chart.bars.length > 24) {
      sparkVals = state.chart.bars.slice(-24).map((b) => b.close); if (FX) FX.spark($("tSpark"), sparkVals);
    }
  }

  // ---------------- status / refresh ----------------
  function renderStatus() {
    const L = state.live, all = L.market && L.pools && L.trades, any = L.market || L.pools || L.trades;
    $("statusDot").className = "dot" + (all ? " live" : "");
    const when = state.asOf ? fmtTime(state.asOf, { hour: "numeric", minute: "2-digit", second: "2-digit" }) + " CT" : "";
    $("statusText").textContent = all ? "Live · updated " + when : any ? "Partly live · updated " + when + " · some panels show the saved snapshot" : "Offline · showing saved snapshot from " + (SNAP && SNAP.asOf ? stamp(new Date(SNAP.asOf)) : "unknown time");
  }
  function loadSnapshot() { if (!SNAP) return; state.market = baseline(Object.assign({}, SNAP.market)); state.pools = SNAP.pools || []; state.trades = SNAP.trades || []; state.tickers = SNAP.tickers || []; }
  // DexHunter's public global order feed: completed SNEK swaps routed across Cardano DEXes (keyless, CORS-enabled).
  let dhPauseUntil = 0, dhFails = 0;
  function dhOrders() {
    if (Date.now() < dhPauseUntil) return Promise.reject(new Error("backoff"));
    STATS.dhCalls = (STATS.dhCalls || 0) + 1;
    return getJSON(DHAPI + "/swap/globalOrders", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ filters: [{ filterType: "TOKENID", values: [TOKEN] }, { filterType: "STATUS", values: ["COMPLETE"] }], page: 0, perPage: 25 }) }, 8000)
      .then((r) => {
        dhFails = 0;
        state.dhTrades = (r.orders || []).filter((o) => o.token_id_in === LOVELACE || o.token_id_out === LOVELACE).map((o) => {
          const buy = o.token_id_out === TOKEN, ada = buy ? +o.amount_in : +o.actual_out_amount, snek = buy ? +o.actual_out_amount : +o.amount_in;
          return { id: o.update_tx_hash || o.tx_hash, alt: o.tx_hash, addr: o.user_address || o.address || null, venue: DH_DEX[o.dex] || o.dex, dex: true, time: Date.parse(o.last_update || o.submission_time), buy, ada, snek };
        }).filter((x) => x.ada > 0 && x.snek > 0);
      }).catch((e) => { dhFails++; dhPauseUntil = Date.now() + Math.min(120000, 10000 * Math.pow(2, dhFails - 1)); throw e; });
  }
  let busy = false;
  function refresh(full) {
    if (busy) return Promise.resolve(); busy = true;
    const t = state.tick++; // 5 s ticks. GeckoTerminal's keyless API allows ~10 calls/min and caches responses for 1 min, so it is polled sparingly
    // (last candle 60 s, trades and pools 5 min = ~1.4 calls/min, calls spaced ≥4 s); DexHunter's order feed carries the 5 s on-chain trade cadence.
    // On page load, pools and trades come from the snapshot (if under 6 h old) + DexHunter, so the only GeckoTerminal call at load is the candle history.
    const snapFresh = SNAP && SNAP.asOf && Date.now() - new Date(SNAP.asOf).getTime() < 21600000;
    const doMarket = full || t % 12 === 0; const doPools = (full && !snapFresh) || t % 60 === 9; const doCandle = full || t % 12 === 3; const doGT = (full && !snapFresh) || t % 60 === 39; const doDH = true;
    if (full && snapFresh && t === 0) { state.live.pools = true; state.tradeLive.gt = true; }
    const pMarket = !doMarket ? Promise.resolve() : Promise.all([
      getJSON(CG + "/coins/snek?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false"),
      getJSON(CG + "/simple/price?ids=cardano&vs_currencies=usd").catch(() => null)
    ]).then((r) => { STATS.cgCalls += 2; const m = baseline(marketFromCG(r[0])); m.adaUsd = r[1] && r[1].cardano ? r[1].cardano.usd : (state.market && state.market.adaUsd) || null; state.market = m; state.tickers = tickersFromCG(r[0]); state.live.market = true; })
      .catch(() => { state.live.market = false; });
    const pPools = !doPools ? Promise.resolve() : gt("/tokens/" + TOKEN + "/pools?page=1").then((r) => {
      if (!r.data || !r.data.length) throw new Error("empty"); state.pools = r.data; state.live.pools = true;
      const ada = r.data.filter((p) => /SNEK \/ ADA/.test(p.attributes.name)).sort((a, b) => parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd))[0];
      if (ada) state.mainPool = ada.attributes.address;
    }).catch(() => { state.live.pools = false; });
    return Promise.all([pMarket, pPools])
      .then(() => Promise.all([
        !doGT ? null : gt("/pools/" + state.mainPool + "/trades").then((r) => { if (!r.data) throw 0; state.trades = r.data; state.tradeLive.gt = true; (STATS.tradePolls = STATS.tradePolls || []).push(["gt", Date.now()]); }).catch(() => { state.tradeLive.gt = false; }),
        !doDH ? null : dhOrders().then(() => { state.tradeLive.dh = true; (STATS.tradePolls = STATS.tradePolls || []).push(["dh", Date.now()]); }).catch(() => { state.tradeLive.dh = false; })
      ]).then(() => { state.live.trades = state.tradeLive.gt || state.tradeLive.dh; }))
      .then(() => (doCandle && !full ? updateLastCandles() : null)).then(() => { state.asOf = new Date(); renderMarket(); renderPools(); renderVenues(); renderTrades(); renderStatus(); }).finally(() => { busy = false; });
  }

  // ---------------- UI chrome ----------------
  function setupChrome() {
    // ◐ cycles dark → light → OLED → SNEK green; the Settings panel owns the value
    $("themeBtn").addEventListener("click", () => {
      const T = ["dark", "light", "oled", "green"], c = document.documentElement.dataset.theme || "dark", t = T[(T.indexOf(c) + 1) % T.length];
      if (window.SNEKSET) SNEKSET.set("theme", t); else { document.documentElement.dataset.theme = t; retheme(); renderHolders(); }
      toast("Theme: " + { dark: "Dark", light: "Light", oled: "OLED black", green: "SNEK green" }[t]);
    });
    window.addEventListener("snek:theme", () => { retheme(); renderHolders(); });
    window.addEventListener("snek:fmt", () => { renderMarket(); renderHolders(); renderPools(); renderVenues(); renderTrades(); renderCalc(); });
    $("shareBtn").addEventListener("click", () => {
      const p = state.market && state.market.price;
      if (window.SNEKSHARE) SNEKSHARE.open({ title: "Share the dashboard", text: "$SNEK" + (ok(p) ? " is at $" + Number(p.toPrecision(4)) : "") + ". Live price, chart, whales and wallet tracker on this free, fan-made dashboard by @DavidSandy 🐍" });
      else copy(location.href.split("#")[0], "Link copied");
    });
    $("copyPolicy").addEventListener("click", () => copy(POLICY, "Policy ID copied"));
    $("refreshBtn").addEventListener("click", () => { refresh(true); loadCandles(); refreshHolders(); toast("Refreshing…"); });
    ["calcAmt", "calcUnit"].forEach((id) => $(id).addEventListener("input", renderCalc));
    $("whaleMin").addEventListener("change", renderTrades); $("whaleOnly").addEventListener("change", renderTrades); if ($("tradeVenue")) $("tradeVenue").addEventListener("change", renderTrades);
    const tabs = [...document.querySelectorAll(".tabs a")];
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) tabs.forEach((t) => t.classList.toggle("on", t.dataset.tab === e.target.dataset.tab)); }), { rootMargin: "-45% 0px -50% 0px" });
      document.querySelectorAll("#wgrid > .w").forEach((s) => io.observe(s));
    }
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
    $("installBtn").addEventListener("click", () => { if (deferred) { deferred.prompt(); deferred = null; $("installBtn").hidden = true; } });
    if ("serviceWorker" in navigator && HTTP) {
      // New deploys: sw.js skips waiting and claims clients; when a new worker takes over we offer a one-tap reload,
      // and reload by ourselves if the tab is in the background or idle (never mid-drag, mid-edit or while typing).
      const hadController = !!navigator.serviceWorker.controller; let reloading = false;
      const busy = () => document.body.classList.contains("dragging") || document.body.classList.contains("editing") || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) || document.querySelector(".snakegame");
      const doReload = () => { if (reloading) return; reloading = true; location.reload(); };
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController || reloading) return;
        if (document.visibilityState === "hidden") { doReload(); return; }
        let bar = document.getElementById("updBar");
        if (!bar) { bar = document.createElement("div"); bar.id = "updBar"; bar.className = "updbar"; bar.setAttribute("role", "status"); bar.innerHTML = '<span>✨ A new version of the dashboard is ready</span><button type="button" class="btn primary">Reload</button>'; document.body.appendChild(bar); bar.querySelector("button").addEventListener("click", doReload); requestAnimationFrame(() => bar.classList.add("show")); }
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") doReload(); });
        setTimeout(function idle() { if (busy()) setTimeout(idle, 15000); else doReload(); }, 60000);
      });
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
        const check = () => reg.update().catch(() => {});
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
        setInterval(check, 15 * 60000);
      }).catch(() => {});
    }
  }
  function copy(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) { toast(text); } t.remove(); }
  }

  function init() {
    window.SNEKAPP = { state, toast, chart: () => chart, tradeRows: () => tradeRows("all"), chartScrollStart: () => { if (chart) chart.timeScale().setVisibleLogicalRange({ from: 0, to: 120 }); } };
    loadSnapshot(); seedSpark(); setupChrome();
    if (FX) FX.init({ onRefresh: () => Promise.all([refresh(true), refreshHolders()]).then(() => { loadCandles(); toast("Updated", "ok"); }) }); setupPortfolio(); setupAlerts(); setupChartControls(); initChart();
    renderMarket(); renderHolders(); renderPools(); renderVenues(); renderTrades(); renderStatus();
    $("statusText").textContent = "Fetching live data…";
    setupNotice(); setTimeout(hideSplash, 3500);
    refresh(true).then(hideSplash, hideSplash); loadCandles(); refreshHolders();
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 5000);
    setInterval(() => { if (document.visibilityState === "visible") { renderPriceSrc(); renderLiveVenues(); } }, 1000);
    if (LIVE) { LIVE.on("price", scheduleLive); LIVE.on("trade", scheduleTrades); LIVE.on("venue", renderLiveVenues); LIVE.start(); }
    setInterval(() => { if (document.visibilityState === "visible") refreshHolders(); }, 300000);
    setInterval(() => { if (SNAP && SNAP.holders) $("holderNote").firstChild && renderHoldersNote(); }, 60000);
    let lastFull = Date.now();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { const f = Date.now() - lastFull > 60000; if (f) lastFull = Date.now(); refresh(f); refreshHolders(); } });
  }
  // Fan-made notice: shows on first visit; after "Got it" it stays hidden for 7 days, then returns.
  function setupNotice() {
    const n = $("fanNotice"), until = store.get("snek-notice-until", 0);
    if (Date.now() > until) n.hidden = false;
    $("fanNoticeClose").addEventListener("click", () => { n.hidden = true; store.set("snek-notice-until", Date.now() + 7 * 86400000); });
  }
  function renderHoldersNote() { const h = SNAP.holders, w = new Date(h.asOf); $("holderNote").innerHTML = "Updated " + ago(w) + ' <span class="muted">(' + stamp(w) + ", " + esc(h.source) + ")</span>"; }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
