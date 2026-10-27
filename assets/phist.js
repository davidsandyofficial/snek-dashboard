/* Portfolio history for the fan-made SNEK dashboard (Wallets tab). Read-only, keyless, real data only:
   - Transactions: Yoroi's public backend (/v2/txs/history), paged backwards in segments between chain anchors
     (1/7/30/90/365 days back, from the 30-min snapshot) and finally from the address's first transaction.
   - Balances: rebuilt backwards from today's on-chain balance by undoing each transaction's SNEK and ADA change.
   - Prices: SNEK daily closes from assets/history/1D (on-chain DEX, older days Gate.io); ADA/USD daily closes from
     Kraken's public OHLC (last ~720 days). Older days use the ADA/USD implied by the same day's SNEK USD and ADA closes.
   Days without a price or outside the covered window are left empty (shown as gaps), never interpolated. */
(function () {
  "use strict";
  const POLICY_ID = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f.534e454b";
  const PAGE_BUDGET = 40, DAY = 86400;
  const $ = (id) => document.getElementById(id);
  const ok = (v) => v !== null && v !== undefined && isFinite(v);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cmp = (v) => (ok(v) ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : "–");
  const usd = (v) => (ok(v) ? (Math.abs(v) < 1000 ? "$" + v.toFixed(2) : "$" + cmp(v)) : "–");
  const fmtV = (v, cur) => (cur === "usd" ? usd(v) : ok(v) ? cmp(v) + " ₳" : "–");
  const dstr = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(t * 1000));
  const ctstr = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms)) + " CT";
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const W = () => window.SNEKWALLETS || {};
  const yoroi = (path, body) => (W().yoroi ? W().yoroi(path, body) : Promise.reject(new Error("wallet module not ready")));

  // ---------- prices (cached for the session) ----------
  let pricesP = null;
  function prices() {
    if (pricesP) return pricesP;
    pricesP = (async () => {
      const snek = {}; // day -> {usd, ada}
      const ix = await fetch("assets/history/1D/index.json", { cache: "no-cache" }).then((r) => r.json());
      const bodies = await Promise.all(ix.chunks.map((c, i) => fetch("assets/history/1D/" + c.file + (i === ix.chunks.length - 1 ? "?v=" + encodeURIComponent(ix.updatedAt) : ""), { cache: "no-cache" }).then((r) => r.json())));
      bodies.forEach((b) => { (b.usd || []).forEach((k) => { (snek[k[0]] = snek[k[0]] || {}).usd = k[4]; snek[k[0]].src = k[6]; }); (b.ada || []).forEach((k) => { (snek[k[0]] = snek[k[0]] || {}).ada = k[4]; }); });
      const ada = {};
      try {
        const r = await fetch("https://api.kraken.com/0/public/OHLC?pair=ADAUSD&interval=1440").then((x) => x.json());
        const key = r && r.result && Object.keys(r.result).find((k) => k !== "last");
        (key ? r.result[key] : []).forEach((k) => { ada[k[0]] = +k[4]; });
      } catch (e) {}
      return { snek, ada, sources: ix.sources || [] };
    })().catch((e) => { pricesP = null; throw e; });
    return pricesP;
  }

  // ---------- transactions, paged backwards in anchor segments ----------
  const cache = {}; // address -> state
  function deltaOf(addr, t) {
    let ada = 0, snek = 0, other = 0;
    const add = (io, s) => io.forEach((x) => { if (x.address !== addr) return; ada += s * +x.amount; (x.assets || []).forEach((a) => { if (a.assetId === POLICY_ID) snek += s * +a.amount; else other++; }); });
    add(t.outputs || [], 1); add(t.inputs || [], -1);
    return { hash: t.hash, time: Date.parse(t.time) / 1000, ada: ada / 1e6, snek, other, ok: t.tx_state === "Successful" };
  }
  function segments() {
    const A = ((window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.anchors) || []).slice().sort((a, b) => a.days - b.days);
    const segs = []; let until = null;
    A.forEach((a) => { segs.push({ after: { block: a.block, tx: a.tx }, until, from: a.time, label: a.days + (a.days === 1 ? " day" : " days") }); until = a; });
    segs.push({ after: null, until, from: null, label: "first transaction" });
    return segs;
  }
  async function loadTxs(st, onProg) {
    const best = st.best || (st.best = await yoroi("/v2/bestblock"));
    let pages = 0;
    while (st.seg < st.segs.length) {
      const sg = st.segs[st.seg];
      const untilHash = sg.until ? sg.until.block : best.hash;
      let cur = st.cursor || sg.after;
      for (;;) {
        if (pages >= PAGE_BUDGET) { st.cursor = cur; st.more = true; return; }
        const body = { addresses: [st.address], untilBlock: untilHash }; if (cur) body.after = { block: cur.block, tx: cur.tx };
        const r = await yoroi("/v2/txs/history", body); pages++;
        if (!Array.isArray(r)) throw new Error((r && r.error && r.error.response) || "history unavailable");
        r.forEach((t) => { if (!st.seen.has(t.hash)) { st.seen.add(t.hash); st.pending.push(deltaOf(st.address, t)); } });
        onProg && onProg(st.txs.length + st.pending.length, sg.label);
        if (r.length < 50) break;
        const l = r[r.length - 1]; cur = { block: l.block_hash, tx: l.hash };
      }
      // segment complete: its transactions join the covered set
      st.txs = st.txs.concat(st.pending); st.pending = []; st.cursor = null;
      st.from = sg.from; st.full = !sg.after; st.seg++;
      if (st.full) { const first = st.txs.reduce((m, t) => Math.min(m, t.time), Infinity); st.from = isFinite(first) ? first : null; }
    }
    st.more = false;
  }

  // ---------- daily series ----------
  function series(st, P) {
    const live = (window.SNEKAPP && window.SNEKAPP.state && window.SNEKAPP.state.market) || {};
    const now = Date.now() / 1000, txs = st.txs.slice().sort((a, b) => b.time - a.time);
    if (!st.from) return [];
    const d0 = Math.ceil(st.from / DAY) * DAY, today = Math.floor(now / DAY) * DAY;
    let ada = st.ada, snek = st.snek, i = 0; const out = [];
    for (let d = today; d >= d0 - (st.full ? DAY : 0); d -= DAY) {
      const end = d === today ? now : d + DAY;
      while (i < txs.length && txs[i].time > end) { ada -= txs[i].ada; snek -= txs[i].snek; i++; }
      const isToday = d === today, sp = P.snek[d] || {};
      let sU = sp.usd, sA = sp.ada, aU = P.ada[d], aSrc = "Kraken";
      if (isToday && ok(live.price)) { sU = live.price; sA = ok(live.priceAda) ? live.priceAda : ok(live.adaUsd) ? live.price / live.adaUsd : sA; aU = ok(live.adaUsd) ? live.adaUsd : aU; aSrc = "live"; }
      if (!ok(aU) && ok(sU) && ok(sA) && sA > 0) { aU = sU / sA; aSrc = "implied (SNEK USD ÷ SNEK ADA, same day)"; }
      const bal = { ada: Math.max(0, ada), snek: Math.max(0, snek) };
      const vA = bal.snek === 0 ? bal.ada : ok(sA) ? bal.ada + bal.snek * sA : null;
      const vU = ok(aU) && (bal.snek === 0 || ok(sU)) ? bal.ada * aU + bal.snek * (sU || 0) : null;
      out.push({ time: d, ada: bal.ada, snek: bal.snek, sU, sA, aU, aSrc, vU, vA, src: sp.src });
    }
    return out.reverse();
  }

  // ---------- UI ----------
  let chart = null, sVal = null, sBal = null, curAddr = null, cur = store.get("snek-ph-cur", "usd"), range = store.get("snek-ph-range", "all");
  const RANGES = [["7d", 7, "7D"], ["30d", 30, "30D"], ["90d", 90, "90D"], ["1y", 365, "1Y"], ["all", 0, "All"]];
  function shell() {
    return '<div class="row between wrap gap"><div class="seg sm" id="phRange" role="group" aria-label="Range">' + RANGES.map((r) => '<button type="button" data-r="' + r[0] + '">' + r[2] + "</button>").join("") + '</div><div class="seg sm" id="phCur" role="group" aria-label="Currency"><button type="button" data-c="usd">USD</button><button type="button" data-c="ada">ADA</button></div></div>' +
      '<div class="kpis wk mt" id="phKpis"></div><div class="phchart-wrap"><div id="phChart" class="phchart"></div><div id="phTip" class="phtip" hidden></div></div><div id="phLegend" class="phlegend small"></div><div id="phNote" class="muted small"></div>';
  }
  function pickers() {
    const el = $("phPick"); if (!el) return;
    const cw = W().current && W().current(), list = [];
    if (cw && cw.address) list.push({ id: cw.address, name: cw.query || "Looked-up wallet" });
    store.get("snek-watch", []).forEach((x) => { if (x.address && !list.some((y) => y.id === x.address)) { const n = (store.get("snek-wnotes", {})[x.id] || {}).nick || x.name; list.push({ id: x.address, name: n }); } });
    el.innerHTML = list.length ? '<span class="muted small">Wallet:</span>' + list.map((x) => '<button type="button" data-a="' + esc(x.id) + '" class="' + (x.id === curAddr ? "on" : "") + '">' + esc(x.name) + "</button>").join("") : "";
  }
  function empty(msg) {
    const b = $("phBody"); if (!b) return;
    if (chart) { try { chart.remove(); } catch (e) {} chart = null; }
    b.innerHTML = '<div class="wempty"><img src="assets/brand/snek-face-love.webp" alt="" width="64" height="44" loading="lazy"><b>Portfolio history</b><span class="muted small">' + msg + "</span></div>";
  }
  async function open(address, w) {
    curAddr = address; pickers();
    const b = $("phBody"); if (!b) return;
    let st = cache[address];
    if (!st) {
      let bal = w && w.address === address && ok(w.snek) ? { ada: w.ada, snek: w.snek } : null;
      if (!bal) { const r = await W().balanceOf(address); bal = { ada: r.ada, snek: r.snek }; }
      st = cache[address] = { address, ada: bal.ada, snek: bal.snek, at: Date.now(), segs: segments(), seg: 0, cursor: null, txs: [], pending: [], seen: new Set(), from: null, full: false, more: false };
    }
    if (!st.segs.length || !(window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.anchors)) { empty("Chain anchors are unavailable right now, so history can’t be paged. Try again after the next 30-min snapshot."); return; }
    if (!st.done && !st.loading) await extend(st);
    else draw(st);
  }
  async function extend(st) {
    const b = $("phBody"); if (!b || st.loading) return;
    st.loading = true;
    if (!st.txs.length) { if (chart) { try { chart.remove(); } catch (e) {} chart = null; } b.dataset.addr = ""; b.innerHTML = '<div class="skel h120"></div><p class="muted small" id="phProg">Reading transactions…</p>'; }
    else { const p = $("phMore"); if (p) { p.disabled = true; p.textContent = "Loading…"; } }
    try {
      const [P] = await Promise.all([prices(), loadTxs(st, (n, lbl) => { const p = $("phProg"); if (p) p.textContent = "Reading transactions back to " + lbl + " ago… " + n; const m = $("phMore"); if (m) m.textContent = "Loading… " + n + " txs"; })]);
      st.P = P; st.done = !st.more;
    } catch (e) { st.err = e.message || String(e); }
    st.loading = false;
    if (curAddr === st.address) draw(st);
  }
  function draw(st) {
    const b = $("phBody"); if (!b) return;
    if (!st.P || (!st.from && !st.full)) {
      empty(st.err ? "Couldn’t read history: " + esc(st.err) + ". The free APIs can be busy, so try again in a moment." : "This wallet is too busy to page even its last day of transactions within one load (" + (st.txs.length + st.pending.length) + "+ txs). " + (st.more ? '<button class="btn" id="phMore" type="button">Keep loading</button>' : ""));
      return;
    }
    const all = series(st, st.P);
    if (!b.querySelector("#phChart")) { if (chart) { try { chart.remove(); } catch (e) {} chart = null; } b.innerHTML = shell(); }
    b.dataset.addr = st.address;
    $("phRange").querySelectorAll("[data-r]").forEach((x) => x.classList.toggle("on", x.dataset.r === range));
    $("phCur").querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x.dataset.c === cur));
    const R = RANGES.find((r) => r[0] === range) || RANGES[4], cut = R[1] ? Math.floor(Date.now() / 1000 / DAY) * DAY - R[1] * DAY : -Infinity;
    const pts = all.filter((p) => p.time >= cut), key = cur === "usd" ? "vU" : "vA", val = pts.filter((p) => ok(p[key]));
    const covFrom = all.length ? all[0].time : null, short = R[1] && covFrom && covFrom > cut;
    // KPIs
    const first = val[0], last = val[val.length - 1];
    const ch = first && last ? last[key] - first[key] : null, chPct = first && first[key] > 0 && ok(ch) ? (ch / first[key]) * 100 : null;
    let mkt = 0, mktN = 0; // price-driven P/L: yesterday's holdings × today's price change (transfers excluded)
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], c = pts[i];
      if (cur === "usd") { if (ok(a.aU) && ok(c.aU) && (a.snek === 0 || (ok(a.sU) && ok(c.sU)))) { mkt += a.ada * (c.aU - a.aU) + a.snek * ((c.sU || 0) - (a.sU || 0)); mktN++; } }
      else if (a.snek === 0 || (ok(a.sA) && ok(c.sA))) { mkt += a.snek * ((c.sA || 0) - (a.sA || 0)); mktN++; } }
    const ath = val.reduce((m, p) => (!m || p[key] > m[key] ? p : m), null);
    const k = (l, v, cls, sub) => '<div class="kpi"><div class="l">' + l + '</div><div class="v ' + (cls || "") + '">' + v + "</div>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>";
    $("phKpis").innerHTML = k("Value now", last ? fmtV(last[key], cur) : "–", "", last ? cmp(last.snek) + " SNEK · " + cmp(last.ada) + " ADA" : "") +
      k("Change over range", ok(ch) ? (ch >= 0 ? "+" : "−") + fmtV(Math.abs(ch), cur) : "–", ok(ch) ? (ch >= 0 ? "up" : "down") : "", ok(chPct) ? (chPct >= 0 ? "+" : "") + chPct.toFixed(1) + "% · includes transfers in/out" : "includes transfers in/out") +
      k("Price-driven P/L", mktN ? (mkt >= 0 ? "+" : "−") + fmtV(Math.abs(mkt), cur) : "–", mktN ? (mkt >= 0 ? "up" : "down") : "", "held balance × daily price moves") +
      k("ATH portfolio value", ath ? fmtV(ath[key], cur) : "–", "", ath ? dstr(ath.time) + " (daily close, in range)" : "");
    // chart
    const LW = window.LightweightCharts, el = $("phChart");
    if (!chart && LW) {
      const cs = getComputedStyle(document.documentElement), col = (v) => cs.getPropertyValue(v).trim();
      chart = LW.createChart(el, { autoSize: true, layout: { background: { type: "solid", color: "transparent" }, textColor: col("--muted"), attributionLogo: false, fontFamily: "Inter, system-ui, sans-serif" }, grid: { vertLines: { visible: false }, horzLines: { color: col("--line") } }, leftPriceScale: { visible: true, borderVisible: false }, rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, crosshair: { mode: 0 }, handleScroll: { vertTouchDrag: false }, localization: { timeFormatter: (t) => dstr(t) } });
      sVal = chart.addSeries(LW.AreaSeries, { lineColor: col("--snek"), topColor: col("--snek") + "55", bottomColor: col("--snek") + "00", lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      sBal = chart.addSeries(LW.LineSeries, { color: col("--purple"), lineWidth: 2, lineType: 1, priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: (v) => cmp(v) } });
      chart.subscribeCrosshairMove((p) => tip(p));
    }
    if (chart) {
      sVal.applyOptions({ priceFormat: { type: "custom", formatter: (v) => (cur === "usd" ? usd(v) : cmp(v) + " ₳") } });
      sVal.setData(pts.map((p) => (ok(p[key]) ? { time: p.time, value: p[key] } : { time: p.time })));
      const anySnek = pts.some((p) => p.snek > 0); sBal.applyOptions({ visible: anySnek }); chart.applyOptions({ leftPriceScale: { visible: anySnek } });
      sBal.setData(pts.map((p) => ({ time: p.time, value: p.snek })));
      chart.timeScale().fitContent();
      chart.__pts = pts;
    }
    // gaps + coverage
    const gaps = []; let g = null;
    pts.forEach((p) => { if (!ok(p[key])) { if (!g) g = [p.time, p.time]; else g[1] = p.time; } else if (g) { gaps.push(g); g = null; } }); if (g) gaps.push(g);
    $("phLegend").innerHTML = '<span><i style="background:var(--snek)"></i>Portfolio value (' + (cur === "usd" ? "USD" : "ADA") + ', right axis)</span><span><i style="background:var(--purple)"></i>SNEK balance (left axis)</span>';
    $("phNote").innerHTML = "<b>Covered:</b> " + (covFrom ? dstr(covFrom) + " → today" : "–") + (st.full ? " (since this address’s first transaction)" : "") + " · " + st.txs.length + " txs" +
      (short ? ' · <span class="warn">this range starts before the covered window, so only the covered part is shown</span>' : "") +
      (gaps.length ? ' · <span class="warn">' + gaps.length + " gap" + (gaps.length > 1 ? "s" : "") + " with no price data: " + gaps.slice(0, 4).map((x) => dstr(x[0]) + (x[1] !== x[0] ? "–" + dstr(x[1]) : "")).join(", ") + (gaps.length > 4 ? "…" : "") + "</span>" : "") +
      (st.more ? ' · <button class="btn sm" id="phMore" type="button">Load further back</button>' : "") +
      "<br>Balances are for this address only, rebuilt from today’s balance (" + ctstr(st.at) + ") by undoing each transaction’s SNEK and ADA change; other tokens and NFTs are not included. Daily closes in UTC. SNEK prices: on-chain DEX via GeckoTerminal for the last ~180 days, Gate.io before that (from Dec 27, 2023). ADA/USD: Kraken daily close (last ~720 days); older days use the same-day SNEK USD ÷ SNEK ADA ratio. Today uses live prices. No interpolation: missing days stay empty. Not financial advice.";
  }
  function tip(p) {
    const t = $("phTip"); if (!t || !chart) return;
    if (!p || !p.time || !p.point || p.point.x < 0) { t.hidden = true; return; }
    const d = (chart.__pts || []).find((x) => x.time === p.time); if (!d) { t.hidden = true; return; }
    const key = cur === "usd" ? "vU" : "vA";
    t.innerHTML = "<b>" + dstr(d.time) + "</b><div>" + (ok(d[key]) ? fmtV(d[key], cur) : '<span class="warn">no price data</span>') + '</div><div class="muted">' + cmp(d.snek) + " SNEK · " + cmp(d.ada) + " ADA</div>" +
      '<div class="muted">SNEK ' + (ok(d.sU) ? "$" + Number(d.sU.toPrecision(3)) : "–") + " · ADA " + (ok(d.aU) ? "$" + d.aU.toFixed(3) : "–") + "</div>";
    t.hidden = false;
    const wrap = t.parentElement.getBoundingClientRect(), tw = t.offsetWidth;
    t.style.left = Math.max(4, Math.min(wrap.width - tw - 4, p.point.x + 14)) + "px"; t.style.top = Math.max(4, p.point.y - 70) + "px";
  }
  function init() {
    const card = document.querySelector('.w[data-w="whist"]'); if (!card) return;
    empty("Look up a wallet above (an <span class=\"mono\">addr1…</span> or $handle), or track one, to see its value over time from real on-chain history.");
    card.addEventListener("click", (e) => {
      const a = e.target.closest("#phPick [data-a]"); if (a) return open(a.dataset.a);
      const r = e.target.closest("#phRange [data-r]"); if (r) { range = r.dataset.r; store.set("snek-ph-range", range); if (cache[curAddr]) draw(cache[curAddr]); return; }
      const c = e.target.closest("#phCur [data-c]"); if (c) { cur = c.dataset.c; store.set("snek-ph-cur", cur); if (cache[curAddr]) draw(cache[curAddr]); return; }
      if (e.target.closest("#phMore") && cache[curAddr]) extend(cache[curAddr]);
    });
    window.addEventListener("snek:wallet", (e) => { const w = e.detail; pickers(); if (w && w.address && w.address !== curAddr) open(w.address, w); else if (w && !w.address) empty("Portfolio history needs an address (addr1… or $handle); a stake key alone can’t be paged with the free APIs."); });
    pickers();
  }
  window.SNEKPHIST = { open, series: (a) => cache[a] && cache[a].P ? series(cache[a], cache[a].P) : null, state: (a) => cache[a] };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
