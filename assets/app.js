(function () {
  "use strict";
  var SNAP = window.SNEK_SNAPSHOT || null;
  var TOKEN = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b";
  var CG = "https://api.coingecko.com/api/v3";
  var GT = "https://api.geckoterminal.com/api/v2/networks/cardano";
  var TZ = "America/Chicago";
  var TFS = [["1D", 1], ["7D", 7], ["30D", 30], ["90D", 90], ["1Y", 365]];
  var DEX_NAMES = { "minswap-cardano": "Minswap", "minswap-v2": "Minswap V2", saturnswap: "SaturnSwap", "wingriders": "WingRiders", "sundaeswap": "SundaeSwap", "splash": "Splash", "vyfinance": "VyFinance", "cswap": "CSWAP" };

  var state = { market: null, live: { market: false, pools: false, trades: false }, tf: "30D", unit: "USD", series: {}, seriesLive: {}, pools: [], trades: [], tickers: [], asOf: null };

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function na() { return '<span class="na">unavailable</span>'; }
  function ok(v) { return v !== null && v !== undefined && isFinite(v); }
  function usd(v) { if (!ok(v)) return na(); if (Math.abs(v) >= 1) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }); return "$" + Number(v.toPrecision(4)); }
  function big(v) { if (!ok(v)) return na(); return "$" + Math.round(v).toLocaleString("en-US"); }
  function compact(v) { if (!ok(v)) return na(); return "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v); }
  function num(v, d) { if (!ok(v)) return na(); return Number(v).toLocaleString("en-US", { maximumFractionDigits: d || 0 }); }
  function pct(v) { if (!ok(v)) return na(); var c = v >= 0 ? "up" : "down"; return '<span class="chg ' + c + '">' + (v >= 0 ? "+" : "") + v.toFixed(2) + "%</span>"; }
  function fmtTime(d, opts) { return new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: TZ }, opts)).format(d); }
  function stamp(d) { return fmtTime(d, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " CT"; }

  function getJSON(url, ms) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    return fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: "application/json" } })
      .then(function (r) { clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  // ---------- market ----------
  function marketFromCG(d) {
    var m = d.market_data || {};
    var g = function (o) { return o && ok(o.usd) ? o.usd : null; };
    return {
      price: g(m.current_price), ch24: m.price_change_percentage_24h, ch7: m.price_change_percentage_7d, ch30: m.price_change_percentage_30d, ch1y: m.price_change_percentage_1y,
      mcap: g(m.market_cap), vol: g(m.total_volume), fdv: g(m.fully_diluted_valuation), high24: g(m.high_24h), low24: g(m.low_24h),
      ath: g(m.ath), athDate: m.ath_date && m.ath_date.usd, atl: g(m.atl), atlDate: m.atl_date && m.atl_date.usd,
      circ: m.circulating_supply, total: m.total_supply, max: m.max_supply, rank: m.market_cap_rank, updated: m.last_updated
    };
  }
  function tickersFromCG(d) {
    return (d.tickers || []).map(function (t) {
      var tgt = t.target && t.target.length < 10 ? t.target : (t.target === "0X" ? "ADA" : "token");
      return { market: t.market.name, pair: "SNEK/" + tgt, vol: (t.converted_volume && t.converted_volume.usd) || 0 };
    });
  }

  function renderMarket() {
    var m = state.market; if (!m) return;
    var adaPrice = ok(m.price) && ok(m.adaUsd) ? m.price / m.adaUsd : null;
    $("price").innerHTML = usd(m.price);
    $("priceAda").innerHTML = ok(adaPrice) ? adaPrice.toPrecision(4) + " ADA" : na();
    $("ch24").outerHTML = '<span id="ch24">' + pct(m.ch24) + "</span>";
    document.title = (ok(m.price) ? "$" + Number(m.price.toPrecision(4)) + " · " : "") + "SNEK Analytics";
    var k = [["Market cap", compact(m.mcap)], ["24h volume", compact(m.vol)], ["FDV", compact(m.fdv)], ["7d change", pct(m.ch7)], ["30d change", pct(m.ch30)], ["ADA price", usd(m.adaUsd)], ["CoinGecko rank", ok(m.rank) ? "#" + m.rank : na()]];
    $("kpis").innerHTML = k.map(function (x) { return '<div class="kpi"><div class="l">' + x[0] + '</div><div class="v">' + x[1] + "</div></div>"; }).join("");
    var d = function (s) { return s ? fmtTime(new Date(s), { month: "short", day: "numeric", year: "numeric" }) : ""; };
    var st = [
      ["Circulating supply", ok(m.circ) ? num(m.circ) + " SNEK" : na()], ["Total supply", ok(m.total) ? num(m.total) + " SNEK" : na()], ["Max supply", ok(m.max) ? num(m.max) + " SNEK" : na()],
      ["24h high / low", ok(m.high24) ? usd(m.high24) + " / " + usd(m.low24) : na()], ["1y change", pct(m.ch1y)],
      ["All-time high", ok(m.ath) ? usd(m.ath) + ' <span class="muted small">' + d(m.athDate) + "</span>" : na()],
      ["All-time low", ok(m.atl) ? usd(m.atl) + ' <span class="muted small">' + d(m.atlDate) + "</span>" : na()]
    ];
    $("stats").innerHTML = st.map(function (x) { return "<dt>" + x[0] + "</dt><dd>" + x[1] + "</dd>"; }).join("");
    renderCalc();
  }

  // ---------- chart ----------
  function nearest(arr, t) {
    var lo = 0, hi = arr.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (arr[mid][0] < t) lo = mid; else hi = mid; }
    return Math.abs(arr[lo][0] - t) <= Math.abs(arr[hi][0] - t) ? arr[lo] : arr[hi];
  }
  function loadSeries(tf) {
    if (state.seriesLive[tf]) return Promise.resolve();
    var days = TFS.filter(function (x) { return x[0] === tf; })[0][1];
    return Promise.all([
      getJSON(CG + "/coins/snek/market_chart?vs_currency=usd&days=" + days),
      getJSON(CG + "/coins/cardano/market_chart?vs_currency=usd&days=" + days).catch(function () { return null; })
    ]).then(function (r) {
      var p = r[0].prices || []; var a = r[1] && r[1].prices && r[1].prices.length ? r[1].prices : null;
      if (!p.length) throw new Error("empty");
      state.series[tf] = p.map(function (x) { var ad = a ? nearest(a, x[0])[1] : null; return { t: x[0], usd: x[1], ada: ad ? x[1] / ad : null }; });
      state.seriesLive[tf] = true;
    });
  }
  function snapSeries(tf) {
    if (!SNAP || !SNAP.series[tf]) return null;
    return SNAP.series[tf].map(function (r) { return { label: r[0], usd: r[1], ada: r[2] }; });
  }
  function labelFor(pt, tf) {
    if (pt.label) return pt.label;
    var d = new Date(pt.t);
    if (tf === "1D") return fmtTime(d, { hour: "numeric", minute: "2-digit" });
    if (tf === "1Y") return fmtTime(d, { month: "short", year: "2-digit" });
    return fmtTime(d, { month: "short", day: "numeric" });
  }
  function drawChart() {
    var tf = state.tf, unit = state.unit;
    var pts = state.series[tf] || snapSeries(tf);
    var el = $("chart");
    if (!pts || !pts.length) { el.innerHTML = '<p class="na">Price history unavailable.</p>'; $("chartMeta").textContent = ""; return; }
    var key = unit === "USD" ? "usd" : "ada";
    pts = pts.filter(function (p) { return ok(p[key]); });
    if (!pts.length) { el.innerHTML = '<p class="na">' + unit + " history unavailable.</p>"; return; }
    var W = 1000, H = 320, L = 70, R = 16, T = 16, B = 34;
    var vals = pts.map(function (p) { return p[key]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals); var pad = (max - min) * 0.08 || max * 0.05; min -= pad; max += pad;
    var x = function (i) { return L + (i / (pts.length - 1 || 1)) * (W - L - R); };
    var y = function (v) { return T + (1 - (v - min) / (max - min)) * (H - T - B); };
    var up = vals[vals.length - 1] >= vals[0];
    var col = up ? "#5ee87a" : "#ff6b6b";
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[key]).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1) + " " + (H - B) + " L" + L + " " + (H - B) + " Z";
    var fmt = function (v) { return unit === "USD" ? "$" + Number(v.toPrecision(3)) : Number(v.toPrecision(3)) + " ADA"; };
    var grid = "", i;
    for (i = 0; i <= 4; i++) { var v = min + (max - min) * i / 4, yy = y(v); grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="#223027"/><text x="' + (L - 8) + '" y="' + (yy + 4) + '" fill="#8fa197" font-size="12" text-anchor="end">' + fmt(v) + "</text>"; }
    var n = pts.length; var ticks = [0, .2, .4, .6, .8, 1].map(function (f) { return Math.round(f * (n - 1)); });
    ticks.forEach(function (ti) { grid += '<text x="' + x(ti) + '" y="' + (H - 10) + '" fill="#8fa197" font-size="12" text-anchor="' + (ti === 0 ? "start" : ti === n - 1 ? "end" : "middle") + '">' + esc(labelFor(pts[ti], tf)) + "</text>"; });
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".35"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' + grid +
      '<path d="' + area + '" fill="url(#g)"/><path d="' + line + '" fill="none" stroke="' + col + '" stroke-width="2.2" vector-effect="non-scaling-stroke"/><line id="hx" y1="' + T + '" y2="' + (H - B) + '" stroke="#8fa197" stroke-dasharray="3 3" opacity="0"/><circle id="hc" r="4" fill="' + col + '" opacity="0"/></svg><div class="tip" id="tip" style="display:none"></div>';
    var ch = ((vals[n - 1] - vals[0]) / vals[0]) * 100;
    $("chartMeta").innerHTML = tf + " change " + pct(ch) + " · high " + fmt(Math.max.apply(null, vals)) + " · low " + fmt(Math.min.apply(null, vals)) + ' · <span class="muted">' + (state.seriesLive[tf] ? "live" : "snapshot") + "</span>";
    var svg = el.querySelector("svg"), tip = $("tip"), hx = el.querySelector("#hx"), hc = el.querySelector("#hc");
    function move(ev) {
      var r = svg.getBoundingClientRect(); var cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      var fx = cx / r.width * W; var idx = Math.max(0, Math.min(n - 1, Math.round((fx - L) / (W - L - R) * (n - 1)))); var p = pts[idx];
      hx.setAttribute("x1", x(idx)); hx.setAttribute("x2", x(idx)); hx.setAttribute("opacity", 1); hc.setAttribute("cx", x(idx)); hc.setAttribute("cy", y(p[key])); hc.setAttribute("opacity", 1);
      tip.style.display = "block"; tip.style.left = (x(idx) / W * r.width) + "px"; tip.style.top = (y(p[key]) / H * r.height) + "px";
      var when = p.t ? fmtTime(new Date(p.t), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT" : p.label;
      tip.innerHTML = "<b>" + fmt(p[key]) + '</b> <span class="muted">' + esc(when) + "</span>";
    }
    function leave() { tip.style.display = "none"; hx.setAttribute("opacity", 0); hc.setAttribute("opacity", 0); }
    svg.addEventListener("mousemove", move); svg.addEventListener("touchmove", move, { passive: true }); svg.addEventListener("mouseleave", leave);
  }
  function setupSegs() {
    var tfs = $("tfSeg"), us = $("unitSeg");
    tfs.innerHTML = TFS.map(function (t) { return '<button data-tf="' + t[0] + '">' + t[0] + "</button>"; }).join("");
    us.innerHTML = '<button data-u="USD">USD</button><button data-u="ADA">ADA</button>';
    function mark() {
      [].forEach.call(tfs.children, function (b) { b.classList.toggle("on", b.dataset.tf === state.tf); });
      [].forEach.call(us.children, function (b) { b.classList.toggle("on", b.dataset.u === state.unit); });
    }
    tfs.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.tf = b.dataset.tf; mark(); drawChart(); loadSeries(state.tf).then(drawChart).catch(function () {}); });
    us.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.unit = b.dataset.u; mark(); drawChart(); });
    mark();
  }

  // ---------- calculator ----------
  function renderCalc() {
    var m = state.market; var out = $("calcOut");
    var a = parseFloat($("calcAmt").value); var u = $("calcUnit").value;
    if (!m || !ok(m.price) || !ok(a) || a < 0) { out.innerHTML = '<div><span>Result</span><span class="na">enter an amount</span></div>'; return; }
    var pa = ok(m.adaUsd) ? m.price / m.adaUsd : null;
    var snek = u === "snek" ? a : u === "usd" ? a / m.price : (pa ? a / pa : null);
    out.innerHTML = '<div><span>SNEK</span><b>' + num(snek) + "</b></div><div><span>US dollars</span><b>" + (ok(snek) ? "$" + num(snek * m.price, 2) : na()) + "</b></div><div><span>ADA</span><b>" + (ok(snek) && pa ? num(snek * pa, 2) + " ADA" : na()) + "</b></div>";
  }

  // ---------- bars / donut ----------
  function bars(el, rows) {
    if (!rows.length) { el.innerHTML = '<p class="na">unavailable</p>'; return; }
    var mx = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    el.innerHTML = '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar"><span>' + esc(r.label) + (r.meta ? ' <span class="muted small">' + esc(r.meta) + "</span>" : "") + '</span><div class="track"><div class="fill" style="width:' + Math.max(1, r.value / mx * 100) + '%"></div></div><span class="val">' + r.display + "</span></div>";
    }).join("") + "</div>";
  }
  function donut(el, parts) {
    var cols = ["#5ee87a", "#2fbf55", "#f2c94c", "#56ccf2", "#6b7d72"]; var tot = parts.reduce(function (s, p) { return s + p.value; }, 0);
    var a0 = -Math.PI / 2, segs = "";
    parts.forEach(function (p, i) {
      var a1 = a0 + p.value / tot * Math.PI * 2; var large = a1 - a0 > Math.PI ? 1 : 0;
      var P = function (a, r) { return (50 + r * Math.cos(a)).toFixed(2) + " " + (50 + r * Math.sin(a)).toFixed(2); };
      segs += '<path d="M' + P(a0, 46) + " A46 46 0 " + large + " 1 " + P(a1, 46) + " L" + P(a1, 28) + " A28 28 0 " + large + " 0 " + P(a0, 28) + ' Z" fill="' + cols[i % cols.length] + '"/>';
      a0 = a1;
    });
    el.innerHTML = '<div class="donut"><svg viewBox="0 0 100 100">' + segs + '</svg><div class="legend">' + parts.map(function (p, i) { return "<div><i style=\"background:" + cols[i % cols.length] + '"></i>' + esc(p.label) + ' — <b>' + p.value.toFixed(2) + '%</b> <span class="muted">' + esc(p.meta) + "</span></div>"; }).join("") + "</div></div>";
  }

  // ---------- holders (snapshot) ----------
  function renderHolders() {
    var h = SNAP && SNAP.holders;
    if (!h) { $("tierChart").innerHTML = na(); $("rankChart").innerHTML = na(); $("holdersTable").innerHTML = ""; $("holderNote").textContent = "Holder data unavailable"; return; }
    $("holderNote").textContent = num(h.count) + " holders · " + h.source + " snapshot, " + stamp(new Date(h.asOf));
    donut($("tierChart"), h.tiers.map(function (t) { return { label: t[0], value: t[2], meta: num(t[1]) + " wallets" }; }));
    bars($("rankChart"), h.ranks.map(function (r) { return { label: r[0], value: r[1], display: r[1] + "%" }; }));
    $("holdersTable").innerHTML = "<tr><th>Rank</th><th>Wallet</th><th>SNEK</th><th>Share</th></tr>" + h.top.map(function (t, i) { return "<tr><td>" + (i + 1) + '</td><td class="mono">' + esc(t[0]) + "</td><td>" + num(t[1]) + "</td><td>" + t[2].toFixed(2) + "%</td></tr>"; }).join("");
  }

  // ---------- pools ----------
  function renderPools() {
    var pools = state.pools.map(function (p) {
      var a = p.attributes, dex = p.relationships && p.relationships.dex && p.relationships.dex.data.id;
      return { name: a.name, dex: DEX_NAMES[dex] || dex, liq: parseFloat(a.reserve_in_usd) || 0, vol: parseFloat(a.volume_usd && a.volume_usd.h24) || 0, ch: parseFloat(a.price_change_percentage && a.price_change_percentage.h24), tx: a.transactions && a.transactions.h24 ? a.transactions.h24.buys + a.transactions.h24.sells : null, addr: a.address };
    }).sort(function (a, b) { return b.liq - a.liq; });
    var byDex = {};
    pools.forEach(function (p) { byDex[p.dex] = byDex[p.dex] || { liq: 0, n: 0 }; byDex[p.dex].liq += p.liq; byDex[p.dex].n++; });
    bars($("dexChart"), Object.keys(byDex).map(function (k) { return { label: k, value: byDex[k].liq, display: big(byDex[k].liq), meta: byDex[k].n + " pools" }; }).sort(function (a, b) { return b.value - a.value; }));
    var top = pools.filter(function (p) { return p.liq >= 1000; }).slice(0, 10);
    $("poolsTable").innerHTML = top.length ? "<tr><th>Pool</th><th>DEX</th><th>Liquidity</th><th>24h volume</th><th>24h</th><th>Trades 24h</th></tr>" + top.map(function (p) {
      return '<tr><td><a href="https://www.geckoterminal.com/cardano/pools/' + encodeURIComponent(p.addr) + '" target="_blank" rel="noopener">' + esc(p.name) + "</a></td><td>" + esc(p.dex) + "</td><td>" + big(p.liq) + "</td><td>" + big(p.vol) + "</td><td>" + pct(p.ch) + "</td><td>" + num(p.tx) + "</td></tr>";
    }).join("") : '<tr><td class="na">Pool data unavailable</td></tr>';
  }

  // ---------- venues ----------
  function renderVenues() {
    var agg = {};
    state.tickers.forEach(function (t) { agg[t.market] = (agg[t.market] || 0) + (t.vol || 0); });
    var dex = { Minswap: 1, WingRiders: 1, "CSWAP DEX": 1, SundaeSwap: 1, Splash: 1 };
    var rows = Object.keys(agg).map(function (k) { return { label: k, value: agg[k], display: big(agg[k]), meta: dex[k] ? "DEX" : "" }; }).filter(function (r) { return r.value > 0; }).sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
    bars($("venueChart"), rows);
  }

  // ---------- trades ----------
  function renderTrades() {
    var tr = state.trades.slice(0, 15);
    if (!tr.length) { $("tradesTable").innerHTML = '<tr><td class="na">Trade data unavailable</td></tr>'; return; }
    $("tradesTable").innerHTML = "<tr><th>Time (CT)</th><th>Side</th><th>ADA</th><th>SNEK</th><th>USD</th></tr>" + tr.map(function (t) {
      var a = t.attributes, buy = a.kind === "buy";
      var snek = parseFloat(buy ? a.to_token_amount : a.from_token_amount), ada = parseFloat(buy ? a.from_token_amount : a.to_token_amount);
      return '<tr><td><a href="https://cardanoscan.io/transaction/' + esc(a.tx_hash) + '" target="_blank" rel="noopener">' + fmtTime(new Date(a.block_timestamp), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + '</a></td><td class="' + (buy ? "buy" : "sell") + '">' + (buy ? "Buy" : "Sell") + "</td><td>" + num(ada, 2) + "</td><td>" + num(snek) + "</td><td>" + usd(parseFloat(a.volume_in_usd)) + "</td></tr>";
    }).join("");
  }

  // ---------- status ----------
  function renderStatus() {
    var L = state.live, all = L.market && L.pools && L.trades, any = L.market || L.pools || L.trades;
    $("statusDot").className = "dot " + (all ? "live" : "snap");
    var when = state.asOf ? stamp(state.asOf) : "";
    $("statusText").textContent = all ? "Live · updated " + when : any ? "Partly live · updated " + when + " (some panels show the saved snapshot)" : "Showing saved snapshot from " + (SNAP ? stamp(new Date(SNAP.asOf)) : "unknown time") + " — live APIs unreachable";
  }

  // ---------- load ----------
  function loadSnapshot() {
    if (!SNAP) return;
    state.market = Object.assign({}, SNAP.market); state.pools = SNAP.pools; state.trades = SNAP.trades; state.tickers = SNAP.tickers;
  }
  var tick = 0;
  function refresh(full) {
    var mainPool = null;
    var doMarket = full || (tick++ % 3 === 0);
    var pMarket = !doMarket ? Promise.resolve() : Promise.all([
      getJSON(CG + "/coins/snek?localization=false&tickers=true&market_data=true&community_data=false&developer_data=false"),
      getJSON(CG + "/simple/price?ids=cardano&vs_currencies=usd").catch(function () { return null; })
    ]).then(function (r) {
      var m = marketFromCG(r[0]);
      m.adaUsd = r[1] && r[1].cardano ? r[1].cardano.usd : (state.market && state.market.adaUsd) || null;
      state.market = m; state.tickers = tickersFromCG(r[0]); state.live.market = true;
    }).catch(function () { state.live.market = false; });
    var pPools = getJSON(GT + "/tokens/" + TOKEN + "/pools?page=1").then(function (r) {
      if (!r.data || !r.data.length) throw new Error("empty");
      state.pools = r.data; state.live.pools = true;
      var ada = r.data.filter(function (p) { return /SNEK \/ ADA/.test(p.attributes.name); }).sort(function (a, b) { return parseFloat(b.attributes.reserve_in_usd) - parseFloat(a.attributes.reserve_in_usd); })[0];
      mainPool = ada ? ada.attributes.address : null;
    }).catch(function () { state.live.pools = false; });
    return Promise.all([pMarket, pPools]).then(function () {
      var addr = mainPool || "f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c2ffadbb87144e875749122e0bbb9f535eeaa7f5660c6c4a91bcc4121e477f08d";
      return getJSON(GT + "/pools/" + addr + "/trades").then(function (r) { if (!r.data) throw 0; state.trades = r.data; state.live.trades = true; }).catch(function () { state.live.trades = false; });
    }).then(function () {
      state.asOf = new Date();
      renderMarket(); renderPools(); renderVenues(); renderTrades(); renderStatus();
    });
  }

  function init() {
    loadSnapshot(); setupSegs();
    renderMarket(); renderHolders(); renderPools(); renderVenues(); renderTrades(); drawChart(); renderStatus();
    $("calcAmt").addEventListener("input", renderCalc); $("calcUnit").addEventListener("change", renderCalc);
    $("refreshBtn").addEventListener("click", function () { state.seriesLive[state.tf] = false; refresh(true).then(function () { return loadSeries(state.tf); }).then(drawChart).catch(drawChart); });
    $("statusText").textContent = "Fetching live data…";
    refresh().then(function () { return loadSeries(state.tf); }).then(drawChart).catch(drawChart);
    setInterval(function () { if (document.visibilityState === "visible") refresh(); }, 10000);
    window.addEventListener("resize", function () { /* svg scales by viewBox */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
