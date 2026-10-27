/* Chart indicators, computed in plain JS from OHLCV bars ({time, open, high, low, close, volume}).
   Overlays draw on the price pane; oscillators get their own pane. Settings are saved in localStorage. */
(function () {
  "use strict";
  const KEY = "snek-ind";
  const DEFS = [
    { id: "sma1", name: "SMA", kind: "overlay", color: "#c684f0", params: { n: 20 }, on: true, help: "Simple moving average" },
    { id: "sma2", name: "SMA", kind: "overlay", color: "#88eaff", params: { n: 50 }, on: false, help: "Simple moving average" },
    { id: "ema1", name: "EMA", kind: "overlay", color: "#ffb74d", params: { n: 21 }, on: false, help: "Exponential moving average" },
    { id: "ema2", name: "EMA", kind: "overlay", color: "#f06292", params: { n: 200 }, on: false, help: "Exponential moving average" },
    { id: "bb", name: "Bollinger Bands", short: "BB", kind: "overlay", color: "#7aa2ff", params: { n: 20, k: 2 }, on: false, help: "SMA ± k standard deviations" },
    { id: "vwap", name: "VWAP", kind: "overlay", color: "#ffd54f", params: {}, on: false, help: "Volume-weighted average price, resets daily (UTC); anchored to the first candle on 1D" },
    { id: "volma", name: "Volume MA", short: "Vol MA", kind: "volume", color: "#bdbdbd", params: { n: 20 }, on: false, help: "Moving average of volume" },
    { id: "rsi", name: "RSI", kind: "pane", color: "#c684f0", params: { n: 14 }, on: false, help: "Relative Strength Index (Wilder), 70/30 guides" },
    { id: "macd", name: "MACD", kind: "pane", color: "#88eaff", params: { fast: 12, slow: 26, signal: 9 }, on: false, help: "MACD line, signal line and histogram" },
    { id: "stochrsi", name: "Stoch RSI", short: "StochRSI", kind: "pane", color: "#ffb74d", params: { rsi: 14, stoch: 14, k: 3, d: 3 }, on: false, help: "Stochastic of RSI, %K and %D, 80/20 guides" },
    { id: "atr", name: "ATR", kind: "pane", color: "#f06292", params: { n: 14 }, on: false, help: "Average True Range (Wilder)" },
  ];
  const LIMITS = { n: [2, 500], k: [0.5, 5], fast: [2, 100], slow: [3, 200], signal: [2, 100], rsi: [2, 100], stoch: [2, 100], d: [1, 20] };
  function load() {
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    let legacy = null; try { legacy = JSON.parse(localStorage.getItem("snek-ma")); } catch (e) {}
    return DEFS.map((d) => {
      const s = saved && saved[d.id];
      const on = s ? !!s.on : legacy && !saved ? (d.id === "sma1" ? legacy.includes("20") : d.id === "sma2" ? legacy.includes("50") : d.on) : d.on;
      return Object.assign({}, d, { on, params: Object.assign({}, d.params, s && s.params) });
    });
  }
  let cfg = load();
  function save() { const o = {}; cfg.forEach((c) => (o[c.id] = { on: c.on, params: c.params })); try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  const label = (c, sh) => ((sh && c.short) || c.name) + (c.id.startsWith("sma") || c.id.startsWith("ema") ? " " + c.params.n : c.id === "bb" ? " " + c.params.n + ", " + c.params.k : c.id === "rsi" || c.id === "atr" || c.id === "volma" ? " " + c.params.n : c.id === "macd" ? " " + c.params.fast + "/" + c.params.slow + "/" + c.params.signal : c.id === "stochrsi" ? " " + c.params.rsi + "/" + c.params.stoch : "");

  // ---- math ----
  const pt = (t, v) => ({ time: t, value: v });
  function smaArr(vals, n) { const out = new Array(vals.length).fill(null); let s = 0; for (let i = 0; i < vals.length; i++) { s += vals[i]; if (i >= n) s -= vals[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  function emaArr(vals, n, startIdx) { const out = new Array(vals.length).fill(null), k = 2 / (n + 1); let e = null, s = 0, c = 0; for (let i = startIdx || 0; i < vals.length; i++) { const v = vals[i]; if (v == null) continue; if (e == null) { s += v; c++; if (c === n) { e = s / n; out[i] = e; } continue; } e = v * k + e * (1 - k); out[i] = e; } return out; }
  function wilder(vals, n) { const out = new Array(vals.length).fill(null); let a = null, s = 0, c = 0; for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (v == null) continue; if (a == null) { s += v; c++; if (c === n) { a = s / n; out[i] = a; } continue; } a = (a * (n - 1) + v) / n; out[i] = a; } return out; }
  function rsiArr(close, n) {
    const out = new Array(close.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < close.length; i++) {
      const d = close[i] - close[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } continue; }
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  const series = (bars, arr) => { const o = []; for (let i = 0; i < bars.length; i++) if (arr[i] != null && isFinite(arr[i])) o.push(pt(bars[i].time, arr[i])); return o; };
  function compute(c, bars, iv) {
    const close = bars.map((b) => b.close), P = c.params;
    switch (c.id) {
      case "sma1": case "sma2": return { main: series(bars, smaArr(close, P.n)) };
      case "ema1": case "ema2": return { main: series(bars, emaArr(close, P.n)) };
      case "bb": {
        const m = smaArr(close, P.n), up = [], lo = [];
        for (let i = 0; i < bars.length; i++) { if (m[i] == null) { up.push(null); lo.push(null); continue; } let v = 0; for (let j = i - P.n + 1; j <= i; j++) v += (close[j] - m[i]) ** 2; const sd = Math.sqrt(v / P.n); up.push(m[i] + P.k * sd); lo.push(m[i] - P.k * sd); }
        return { main: series(bars, m), upper: series(bars, up), lower: series(bars, lo) };
      }
      case "vwap": {
        const out = []; let pv = 0, vv = 0, day = null;
        for (const b of bars) { const d = iv === "1D" ? 0 : Math.floor(b.time / 86400); if (d !== day) { pv = 0; vv = 0; day = d; } const tp = (b.high + b.low + b.close) / 3, v = b.volume || 0; pv += tp * v; vv += v; out.push(vv > 0 ? pv / vv : tp); }
        return { main: series(bars, out) };
      }
      case "volma": return { main: series(bars, smaArr(bars.map((b) => b.volume || 0), P.n)) };
      case "rsi": return { main: series(bars, rsiArr(close, P.n)), guides: [70, 30] };
      case "macd": {
        const f = emaArr(close, P.fast), s = emaArr(close, P.slow), line = close.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
        const first = line.findIndex((v) => v != null), sig = emaArr(line, P.signal, first < 0 ? 0 : first), hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
        return { main: series(bars, line), signal: series(bars, sig), hist: series(bars, hist) };
      }
      case "stochrsi": {
        const r = rsiArr(close, P.rsi), st = r.map((v, i) => { if (v == null || i < P.stoch - 1) return null; let lo = Infinity, hi = -Infinity; for (let j = i - P.stoch + 1; j <= i; j++) { if (r[j] == null) return null; lo = Math.min(lo, r[j]); hi = Math.max(hi, r[j]); } return hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100; });
        const kk = smaNull(st, P.k), dd = smaNull(kk, P.d);
        return { main: series(bars, kk), signal: series(bars, dd), guides: [80, 20] };
      }
      case "atr": {
        const tr = bars.map((b, i) => (i ? Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)) : b.high - b.low));
        return { main: series(bars, wilder(tr, P.n)) };
      }
    }
    return {};
  }
  function smaNull(vals, n) { const out = new Array(vals.length).fill(null); for (let i = 0; i < vals.length; i++) { let s = 0, ok = true; if (i < n - 1) continue; for (let j = i - n + 1; j <= i; j++) { if (vals[j] == null) { ok = false; break; } s += vals[j]; } if (ok) out[i] = s / n; } return out; }

  // ---- picker (a <dialog> sheet: bottom sheet on phones, centered on desktop) ----
  let onChange = () => {};
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const PNAMES = { n: "Period", k: "Std dev", fast: "Fast", slow: "Slow", signal: "Signal", rsi: "RSI", stoch: "Stoch", d: "%D" };
  function sheet() {
    let d = document.getElementById("indSheet"); if (d) return d;
    d = document.createElement("dialog"); d.id = "indSheet"; d.className = "sheet"; d.setAttribute("aria-label", "Chart indicators");
    document.body.appendChild(d);
    d.addEventListener("click", (e) => {
      if (e.target === d) { d.close(); return; }
      if (e.target.closest("[data-close]")) d.close();
      if (e.target.closest("[data-reset]")) { cfg = DEFS.map((x) => Object.assign({}, x, { params: Object.assign({}, x.params) })); save(); render(); onChange(); }
    });
    d.addEventListener("change", (e) => {
      const row = e.target.closest("[data-id]"); if (!row) return; const c = cfg.find((x) => x.id === row.dataset.id);
      if (e.target.type === "checkbox") c.on = e.target.checked;
      else if (e.target.dataset.p) { const p = e.target.dataset.p, L = LIMITS[p] || [1, 500]; let v = parseFloat(e.target.value); if (!isFinite(v)) v = DEFS.find((x) => x.id === c.id).params[p]; v = Math.min(L[1], Math.max(L[0], p === "k" ? Math.round(v * 10) / 10 : Math.round(v))); e.target.value = v; c.params[p] = v; if (!c.on) { c.on = true; row.querySelector("input[type=checkbox]").checked = true; } }
      save(); row.querySelector(".iname").textContent = label(c); onChange();
    });
    return d;
  }
  function render() {
    const d = sheet(), groups = [["Overlays", (c) => c.kind !== "pane"], ["Oscillators (own pane)", (c) => c.kind === "pane"]];
    d.innerHTML = '<div class="sheet-h"><b>Indicators</b><span class="grow"></span><button class="btn" type="button" data-reset>Reset</button><button class="btn primary" type="button" data-close>Done</button></div><div class="sheet-b">' +
      groups.map((g) => "<h4>" + g[0] + "</h4>" + cfg.filter(g[1]).map((c) => '<div class="irow" data-id="' + c.id + '"><label class="itog"><input type="checkbox"' + (c.on ? " checked" : "") + '><span class="idot" style="background:' + c.color + '"></span><span><span class="iname">' + esc(label(c)) + '</span><span class="muted small ihelp">' + esc(c.help) + "</span></span></label>" +
        '<div class="iparams">' + Object.keys(c.params).map((p) => '<label class="small muted">' + PNAMES[p] + '<input type="number" inputmode="decimal" data-p="' + p + '" value="' + c.params[p] + '" min="' + (LIMITS[p] || [1])[0] + '" max="' + (LIMITS[p] || [0, 500])[1] + '" step="' + (p === "k" ? "0.1" : "1") + '"></label>').join("") + "</div></div>").join("")).join("") +
      '<p class="muted small">Calculated in your browser from the candles on the chart. Saved in this browser. Not financial advice.</p></div>';
  }
  function open() { render(); const d = sheet(); if (d.showModal) d.showModal(); else d.setAttribute("open", ""); }
  window.SNEKIND = { get: () => cfg, active: () => cfg.filter((c) => c.on), compute, label, open, onChange: (f) => (onChange = f) };
})();
