(function () {
  "use strict";
  let SNAP = window.SNEK_SNAPSHOT || null;
  const POLICY = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f";
  const TOKEN = POLICY + "534e454b";
  const CG = "https://api.coingecko.com/api/v3";
  const GT = "https://api.geckoterminal.com/api/v2/networks/cardano";
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
    mainPool: DEFAULT_POOL, tick: 0,
    chart: { iv: store.get("snek-iv", "1H"), type: store.get("snek-type", "candle"), cur: store.get("snek-cur", "usd"), ma: store.get("snek-ma", ["20"]), bars: [], live: false }
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const na = () => '<span class="na">unavailable</span>';
  const ok = (v) => v !== null && v !== undefined && v !== "" && isFinite(v);
  const usd = (v) => !ok(v) ? na() : Math.abs(v) >= 1 ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "$" + Number(Number(v).toPrecision(4));
  const big = (v) => !ok(v) ? na() : "$" + Math.round(v).toLocaleString("en-US");
  const compact = (v) => !ok(v) ? na() : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v);
  const num = (v, d) => !ok(v) ? na() : Number(v).toLocaleString("en-US", { maximumFractionDigits: d || 0 });
  const pct = (v) => !ok(v) ? na() : '<span class="chg ' + (v >= 0 ? "up" : "down") + '">' + (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%</span>";
  const fmtTime = (d, o) => new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, o)).format(d);
  const stamp = (d) => fmtTime(d, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " CT";
  const ago = (d) => { const s = Math.round((Date.now() - d.getTime()) / 1000); if (s < 90) return s + " s ago"; if (s < 5400) return Math.round(s / 60) + " min ago"; if (s < 172800) return Math.round(s / 3600) + " h ago"; return Math.round(s / 86400) + " days ago"; };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
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
  let gtPauseUntil = 0, gtChain = Promise.resolve(), gtLast = 0;
  function gt(path) {
    const run = () => {
      if (Date.now() < gtPauseUntil) return Promise.reject(new Error("rate limited, retrying shortly"));
      const wait = Math.max(0, gtLast + 1500 - Date.now());
      return new Promise((r) => setTimeout(r, wait)).then(() => { gtLast = Date.now(); return getJSON(GT + path); })
        .catch((e) => { gtPauseUntil = Date.now() + 30000; throw e; });
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

  function renderMarket() {
    const m = state.market; if (!m) return;
    const pa = priceAda();
    $("price").innerHTML = usd(m.price);
    unskel($("priceAda")); $("priceAda").innerHTML = ok(pa) ? pa.toPrecision(4) + " ADA" : na();
    $("ch24").innerHTML = pct(m.ch24);
    unskel($("tPrice")); $("tPrice").innerHTML = usd(m.price); $("tChg").innerHTML = pct(m.ch24);
    document.title = (ok(m.price) ? "$" + Number(m.price.toPrecision(4)) + " · " : "") + "SNEK Dashboard (Fan-made)";
    const k = [["Market cap", compact(m.mcap)], ["24h volume", compact(m.vol)], ["FDV", compact(m.fdv)], ["7d change", pct(m.ch7)], ["30d change", pct(m.ch30)], ["ADA price", usd(m.adaUsd)], ["CoinGecko rank", ok(m.rank) ? "#" + m.rank : na()]];
    $("kpis").innerHTML = k.map((x) => '<div class="kpi"><div class="l">' + x[0] + '</div><div class="v">' + x[1] + "</div></div>").join("");
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
    chart.subscribeCrosshairMove((p) => {
      if (!p || !p.time) { showOHLC(state.chart.bars[state.chart.bars.length - 1]); return; }
      const b = state.chart.bars.find((x) => x.time === p.time); showOHLC(b);
    });
  }
  function priceFmt() { return state.chart.cur === "usd" ? { type: "price", precision: 8, minMove: 0.00000001 } : { type: "price", precision: 6, minMove: 0.000001 }; }
  function buildSeries() {
    if (!chart) return;
    const LW = window.LightweightCharts, c = chartColors();
    [sMain, sVol].concat(Object.values(sMA)).forEach((s) => { if (s) chart.removeSeries(s); });
    sMA = {};
    sMain = state.chart.type === "candle"
      ? chart.addSeries(LW.CandlestickSeries, { upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down, priceFormat: priceFmt() })
      : chart.addSeries(LW.AreaSeries, { lineColor: c.up, topColor: c.up + "55", bottomColor: c.up + "00", lineWidth: 2, priceFormat: priceFmt() });
    sVol = chart.addSeries(LW.HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    state.chart.ma.forEach((n) => { sMA[n] = chart.addSeries(LW.LineSeries, { color: MA_COLORS[n], lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: priceFmt() }); });
    paint(true);
  }
  function sma(bars, n) { const out = []; let sum = 0; for (let i = 0; i < bars.length; i++) { sum += bars[i].close; if (i >= n) sum -= bars[i - n].close; if (i >= n - 1) out.push({ time: bars[i].time, value: sum / n }); } return out; }
  function volBar(b) { const c = chartColors(); return { time: b.time, value: b.volume, color: (b.close >= b.open ? c.up : c.down) + "66" }; }
  function paint(fit) {
    if (!sMain) return; const bars = state.chart.bars;
    sMain.setData(state.chart.type === "candle" ? bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })) : bars.map((b) => ({ time: b.time, value: b.close })));
    sVol.setData(bars.map(volBar));
    Object.keys(sMA).forEach((n) => sMA[n].setData(sma(bars, +n)));
    if (fit && bars.length) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 120), to: bars.length + 4 });
    showOHLC(bars[bars.length - 1]);
    $("chartSrc").textContent = state.chart.live ? "· live" : bars.length ? "· saved snapshot" : "";
  }
  function showOHLC(b) {
    const el = $("ohlc"); if (!b) { el.innerHTML = '<span class="na">No candle data yet</span>'; return; }
    const f = (v) => state.chart.cur === "usd" ? "$" + Number(v.toPrecision(4)) : Number(v.toPrecision(4)) + " ₳";
    const ch = ((b.close - b.open) / b.open) * 100;
    const vu = state.chart.cur === "usd" ? "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(b.volume) : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(b.volume) + " ₳";
    el.innerHTML = '<span class="muted">' + fmtTime(new Date(b.time * 1000), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "</span><span>O <b>" + f(b.open) + "</b></span><span>H <b>" + f(b.high) + "</b></span><span>L <b>" + f(b.low) + "</b></span><span>C <b>" + f(b.close) + "</b></span>" + pct(ch) + "<span>Vol <b>" + vu + "</b></span>" +
      state.chart.ma.map((n) => { const s = sma(state.chart.bars.slice(0, state.chart.bars.indexOf(b) + 1).slice(-n), n); return s.length ? '<span style="color:' + MA_COLORS[n] + '">MA' + n + " " + f(s[s.length - 1].value) + "</span>" : ""; }).join("");
  }
  const toBars = (list) => list.map((r) => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })).sort((a, b) => a.time - b.time).filter((b, i, a) => !i || b.time !== a[i - 1].time);
  function ohlcvURL(limit) { const iv = IVS[state.chart.iv]; return "/pools/" + state.mainPool + "/ohlcv/" + iv[0] + "?aggregate=" + iv[1] + "&limit=" + limit + "&currency=" + (state.chart.cur === "usd" ? "usd" : "token"); }
  let loadSeq = 0, loadTimer = null;
  const candleCache = {};
  function loadCandles() { clearTimeout(loadTimer); loadTimer = setTimeout(loadCandlesNow, 250); }
  function loadCandlesNow() {
    const seq = ++loadSeq; const key = state.chart.iv + "|" + state.chart.cur; const c = candleCache[key];
    if (c && Date.now() - c.t < 60000) { state.chart.bars = c.bars.slice(); state.chart.live = true; paint(true); return Promise.resolve(); }
    return gt(ohlcvURL(300)).then((r) => {
      if (seq !== loadSeq) return;
      const bars = toBars(r.data.attributes.ohlcv_list); if (!bars.length) throw new Error("empty");
      candleCache[key] = { t: Date.now(), bars: bars.slice() };
      state.chart.bars = bars; state.chart.live = true; state.live.candles = true; paint(true);
    }).catch(() => {
      if (seq !== loadSeq) return;
      state.live.candles = false; state.chart.live = false;
      const o = SNAP && SNAP.ohlcv;
      state.chart.bars = o ? toBars(state.chart.cur === "usd" ? o.usd : o.ada) : [];
      paint(true);
      if (o && state.chart.iv !== "1H") toast("Live candles busy, showing saved 1H snapshot and retrying");
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
        Object.keys(sMA).forEach((n) => { const s = sma(bars.slice(-n), +n); if (s.length) sMA[n].update(s[s.length - 1]); });
      });
      showOHLC(bars[bars.length - 1]);
    }).catch(() => {});
  }
  function setupChartControls() {
    const chips = $("ivChips"); chips.innerHTML = Object.keys(IVS).map((k) => '<button data-v="' + k + '">' + k + "</button>").join("");
    const mark = () => {
      [...chips.children].forEach((b) => { b.classList.toggle("on", b.dataset.v === state.chart.iv); b.setAttribute("aria-pressed", b.dataset.v === state.chart.iv); });
      [...$("typeSeg").children].forEach((b) => b.classList.toggle("on", b.dataset.v === state.chart.type));
      [...$("curSeg").children].forEach((b) => b.classList.toggle("on", b.dataset.v === state.chart.cur));
      [...$("maSeg").children].forEach((b) => { const on = state.chart.ma.includes(b.dataset.v); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    };
    const on = (id, fn) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { fn(b.dataset.v); mark(); } });
    on("ivChips", (v) => { state.chart.iv = v; store.set("snek-iv", v); loadCandles(); });
    on("typeSeg", (v) => { state.chart.type = v; store.set("snek-type", v); buildSeries(); });
    on("curSeg", (v) => { state.chart.cur = v; store.set("snek-cur", v); buildSeries(); loadCandles(); });
    on("maSeg", (v) => { const i = state.chart.ma.indexOf(v); if (i >= 0) state.chart.ma.splice(i, 1); else state.chart.ma.push(v); store.set("snek-ma", state.chart.ma); buildSeries(); });
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
      if (!/^(addr1|stake1)[0-9a-z]{20,}$/.test(a)) { out.innerHTML = '<span class="sell">Enter a valid addr1… or stake1… address.</span>'; return; }
      out.textContent = "Looking up…";
      const stake = a.startsWith("stake1");
      getJSON(KOIOS + (stake ? "/account_assets" : "/address_assets"), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(stake ? { _stake_addresses: [a] } : { _addresses: [a] }) }, 20000)
        .then((rows) => {
          const hits = (rows || []).filter((r) => r.policy_id === POLICY && r.asset_name === "534e454b");
          const q = hits.reduce((s, r) => s + Number(r.quantity) / Math.pow(10, r.decimals || 0), 0);
          $("pfAmt").value = q; save(); out.innerHTML = "Found <b>" + num(q) + " SNEK</b> at this " + (stake ? "stake account" : "address") + ". Portfolio updated.";
        }).catch((e) => { out.innerHTML = '<span class="sell">Lookup failed (' + esc(e.message) + "). Koios may be busy, try again.</span>"; });
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
    hit.forEach((a) => {
      const msg = "SNEK is " + a.dir + " $" + a.price + " (now $" + Number(p.toPrecision(4)) + ")";
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
    unskel($("holderCount")); $("holderCount").textContent = num(h.count);
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
  function renderTrades() {
    const min = +$("whaleMin").value, only = $("whaleOnly").checked;
    const rows = state.trades.map((t) => { const a = t.attributes, buy = a.kind === "buy"; return { a, buy, usd: parseFloat(a.volume_in_usd), snek: parseFloat(buy ? a.to_token_amount : a.from_token_amount), ada: parseFloat(buy ? a.from_token_amount : a.to_token_amount) }; });
    const whales = rows.filter((r) => r.usd >= min);
    $("whaleSummary").innerHTML = rows.length ? "🐋 " + whales.length + " of " + rows.length + " recent trades are ≥ $" + min.toLocaleString() + " · whale buys " + big(whales.filter((r) => r.buy).reduce((s, r) => s + r.usd, 0)) + " vs sells " + big(whales.filter((r) => !r.buy).reduce((s, r) => s + r.usd, 0)) : "";
    const show = (only ? whales : rows).slice(0, 25);
    if (!show.length) { $("tradesTable").innerHTML = "<tr><td>" + empty(rows.length ? "No whale trades in the latest batch. Try a lower threshold." : "Trade data unavailable right now.") + "</td></tr>"; return; }
    $("tradesTable").innerHTML = "<tr><th>Time (CT)</th><th>Side</th><th>ADA</th><th>SNEK</th><th>USD</th></tr>" + show.map((r) => {
      const w = r.usd >= min;
      return '<tr class="' + (w ? "whale" : "") + '"><td><a href="https://cardanoscan.io/transaction/' + esc(r.a.tx_hash) + '" target="_blank" rel="noopener">' + fmtTime(new Date(r.a.block_timestamp), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + "</a></td><td class=\"" + (r.buy ? "buy" : "sell") + '">' + (w ? "🐋 " : "") + (r.buy ? "Buy" : "Sell") + "</td><td>" + num(r.ada, 2) + "</td><td>" + num(r.snek) + "</td><td>" + usd(r.usd) + "</td></tr>";
    }).join("");
  }

  // ---------------- status / refresh ----------------
  function renderStatus() {
    const L = state.live, all = L.market && L.pools && L.trades, any = L.market || L.pools || L.trades;
    $("statusDot").className = "dot" + (all ? " live" : "");
    const when = state.asOf ? fmtTime(state.asOf, { hour: "numeric", minute: "2-digit", second: "2-digit" }) + " CT" : "";
    $("statusText").textContent = all ? "Live · updated " + when : any ? "Partly live · updated " + when + " · some panels show the saved snapshot" : "Offline · showing saved snapshot from " + (SNAP && SNAP.asOf ? stamp(new Date(SNAP.asOf)) : "unknown time");
  }
  function loadSnapshot() { if (!SNAP) return; state.market = Object.assign({}, SNAP.market); state.pools = SNAP.pools || []; state.trades = SNAP.trades || []; state.tickers = SNAP.tickers || []; }
  let busy = false;
  function refresh(full) {
    if (busy) return Promise.resolve(); busy = true;
    const t = state.tick++; const doMarket = full || t % 3 === 0; const doPools = full || t % 6 === 0; const doCandle = full || t % 2 === 0;
    const pMarket = !doMarket ? Promise.resolve() : Promise.all([
      getJSON(CG + "/coins/snek?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false"),
      getJSON(CG + "/simple/price?ids=cardano&vs_currencies=usd").catch(() => null)
    ]).then((r) => { const m = marketFromCG(r[0]); m.adaUsd = r[1] && r[1].cardano ? r[1].cardano.usd : (state.market && state.market.adaUsd) || null; state.market = m; state.tickers = tickersFromCG(r[0]); state.live.market = true; })
      .catch(() => { state.live.market = false; });
    const pPools = !doPools ? Promise.resolve() : gt("/tokens/" + TOKEN + "/pools?page=1").then((r) => {
      if (!r.data || !r.data.length) throw new Error("empty"); state.pools = r.data; state.live.pools = true;
      const ada = r.data.filter((p) => /SNEK \/ ADA/.test(p.attributes.name)).sort((a, b) => parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd))[0];
      if (ada) state.mainPool = ada.attributes.address;
    }).catch(() => { state.live.pools = false; });
    return Promise.all([pMarket, pPools])
      .then(() => gt("/pools/" + state.mainPool + "/trades").then((r) => { if (!r.data) throw 0; state.trades = r.data; state.live.trades = true; }).catch(() => { state.live.trades = false; }))
      .then(() => (doCandle ? updateLastCandles() : null)).then(() => { state.asOf = new Date(); renderMarket(); renderPools(); renderVenues(); renderTrades(); renderStatus(); }).finally(() => { busy = false; });
  }

  // ---------------- UI chrome ----------------
  function setupChrome() {
    $("themeBtn").addEventListener("click", () => {
      const t = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = t;
      try { localStorage.setItem("snek-theme", t); } catch (e) {}
      document.querySelector('meta[name="theme-color"]').content = t === "light" ? "#f4f3ef" : "#05080a";
      retheme(); renderHolders();
    });
    $("shareBtn").addEventListener("click", () => {
      const p = state.market && state.market.price; const data = { title: "SNEK Dashboard (Fan-made)", text: "SNEK live" + (ok(p) ? " at $" + Number(p.toPrecision(4)) : "") + " — fan-made, unofficial dashboard: price, chart, holders and whale trades", url: location.href.split("#")[0] };
      if (navigator.share) navigator.share(data).catch(() => {}); else copy(data.url, "Link copied");
    });
    $("copyPolicy").addEventListener("click", () => copy(POLICY, "Policy ID copied"));
    $("refreshBtn").addEventListener("click", () => { refresh(true); loadCandles(); refreshHolders(); toast("Refreshing…"); });
    ["calcAmt", "calcUnit"].forEach((id) => $(id).addEventListener("input", renderCalc));
    $("whaleMin").addEventListener("change", renderTrades); $("whaleOnly").addEventListener("change", renderTrades);
    const tabs = [...document.querySelectorAll(".tabs a")];
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) tabs.forEach((t) => t.classList.toggle("on", t.dataset.tab === e.target.id)); }), { rootMargin: "-45% 0px -50% 0px" });
      document.querySelectorAll(".sect").forEach((s) => io.observe(s));
    }
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; });
    $("installBtn").addEventListener("click", () => { if (deferred) { deferred.prompt(); deferred = null; $("installBtn").hidden = true; } });
    if ("serviceWorker" in navigator && HTTP) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  function copy(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) { toast(text); } t.remove(); }
  }

  function init() {
    loadSnapshot(); setupChrome(); setupPortfolio(); setupAlerts(); setupChartControls(); initChart();
    renderMarket(); renderHolders(); renderPools(); renderVenues(); renderTrades(); renderStatus();
    $("statusText").textContent = "Fetching live data…";
    setupNotice(); setTimeout(hideSplash, 3500);
    refresh(true).then(hideSplash, hideSplash); loadCandles(); refreshHolders();
    setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 10000);
    setInterval(() => { if (document.visibilityState === "visible") refreshHolders(); }, 300000);
    setInterval(() => { if (SNAP && SNAP.holders) $("holderNote").firstChild && renderHoldersNote(); }, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { refresh(true); refreshHolders(); } });
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
