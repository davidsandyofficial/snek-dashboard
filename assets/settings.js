/* Personal settings for the fan-made SNEK dashboard: theme + accent, density, font size, background art, currency,
   number format, default tab, effects, sound, dashboard name, saved layouts (profiles), export/import.
   Everything stays in this browser (localStorage "snek-settings"). FX rates: Frankfurter (ECB, keyless). */
(function () {
  "use strict";
  const KEY = "snek-settings", PKEY = "snek-profiles";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const DEF = { theme: "dark", accent: "", density: "comfy", fs: "m", bg: "none", cur: "USD", numfmt: "compact", locale: "en-US", tab: "overview", fx: true, sound: false, pricevib: false, name: "" };
  const get = () => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return Object.assign({}, DEF); } };
  let S = get();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); localStorage.setItem("snek-theme", S.theme); } catch (e) {} };
  const THEMES = [["dark", "Dark"], ["light", "Light"], ["oled", "OLED black"], ["green", "SNEK green"]];
  const ACCENTS = ["", "#18f2b2", "#88eaff", "#c684f0", "#f2c94c", "#ff7a59", "#fc4c61", "#5491d9"];
  const CURS = [["USD", "$"], ["ADA", "₳"], ["EUR", "€"], ["GBP", "£"], ["JPY", "¥"], ["CAD", "C$"], ["AUD", "A$"], ["CHF", "CHF "], ["INR", "₹"], ["BRL", "R$"], ["KRW", "₩"], ["MXN", "MX$"]];
  const LOCALES = [["en-US", "1,234.56"], ["de-DE", "1.234,56"], ["fr-FR", "1 234,56"], ["en-IN", "1,23,456.7"]];
  const TABS = [["overview", "Overview"], ["chart", "Chart"], ["holders", "Holders"], ["wallets", "Wallets"], ["pools", "Pools"], ["trades", "Trades"], ["tools", "Tools"]];
  const BGS = [["none", "None"], ["space", "Space"], ["pipe", "Pipe"], ["faces", "Faces"]];

  // ---------- apply ----------
  function hexToRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function applyAll() {
    const d = document.documentElement;
    d.dataset.theme = S.theme; d.dataset.density = S.density; d.dataset.fs = S.fs; d.dataset.bg = S.bg;
    d.classList.toggle("nofx", !S.fx);
    const rgb = hexToRgb(S.accent);
    if (rgb) { const dk = rgb.map((x) => Math.round(x * 0.82)); d.style.setProperty("--snek", S.accent); d.style.setProperty("--snek2", "rgb(" + dk.join(",") + ")"); d.style.setProperty("--glow", "rgba(" + rgb.join(",") + ",.14)"); const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255; d.style.setProperty("--onSnek", lum > 0.55 ? "#05080a" : "#ffffff"); }
    else ["--snek", "--snek2", "--glow", "--onSnek"].forEach((v) => d.style.removeProperty(v));
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = S.theme === "light" ? "#f4f3ef" : S.theme === "oled" ? "#000000" : S.theme === "green" ? "#041a12" : "#05080a";
    const h1 = document.querySelector(".brand h1"); if (h1) h1.textContent = S.name ? S.name : "SNEK Dashboard";
    document.title = (S.name ? S.name + " · " : "") + "SNEK Dashboard (Fan-made) — live, unofficial Cardano memecoin analytics";
    window.dispatchEvent(new Event("snek:theme"));
  }

  // ---------- money / number formatting used by the rest of the site ----------
  let rates = null;
  try { const c = JSON.parse(localStorage.getItem("snek-fxrates") || "null"); if (c && Date.now() - c.t < 12 * 3600000) rates = c.r; } catch (e) {}
  function loadRates() {
    if (rates && rates.EUR) return Promise.resolve(rates);
    return fetch("https://api.frankfurter.dev/v1/latest?base=USD").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.rates) { rates = Object.assign({ USD: 1 }, j.rates); try { localStorage.setItem("snek-fxrates", JSON.stringify({ t: Date.now(), r: rates })); } catch (e) {} } return rates; }).catch(() => null);
  }
  const adaUsd = () => { const m = window.SNEKAPP && SNEKAPP.state && SNEKAPP.state.market; return m && m.adaUsd > 0 ? m.adaUsd : null; };
  const FMT = {
    // returns null when the currency can't be converted right now (caller falls back to USD)
    conv(v) {
      if (S.cur === "USD") return { v, sym: "$" };
      if (S.cur === "ADA") { const a = adaUsd(); return a ? { v: v / a, sym: "₳", suffix: true } : null; }
      const r = rates && rates[S.cur]; if (!r) return null;
      return { v: v * r, sym: (CURS.find((c) => c[0] === S.cur) || [0, S.cur + " "])[1] };
    },
    locale: () => S.locale, compact: () => S.numfmt === "compact", cur: () => S.cur,
    money(v, kind) {
      const c = FMT.conv(v) || { v, sym: "$" }, L = S.locale, x = c.v;
      let s;
      if (kind === "compact" && S.numfmt === "compact") s = Intl.NumberFormat(L, { notation: "compact", maximumFractionDigits: 2 }).format(x);
      else if (kind === "big" || kind === "compact") s = Math.round(x).toLocaleString(L);
      else s = Math.abs(x) >= 1 ? x.toLocaleString(L, { maximumFractionDigits: 2 }) : Number(Number(x).toPrecision(4)).toLocaleString(L, { maximumSignificantDigits: 4 });
      return c.suffix ? s + " " + c.sym : (x < 0 ? "−" + c.sym + s.replace("-", "") : c.sym + s);
    },
  };
  window.SNEKFMT = FMT;

  // ---------- sound (WebAudio blips, off by default) ----------
  let ac = null;
  const SOUND = {
    play(kind) {
      if (!S.sound) return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        const notes = { ok: [660, 880], whale: [330, 247, 330], warn: [440, 330], tap: [880] }[kind] || [740];
        notes.forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.09; o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.14); });
      } catch (e) {}
    },
  };
  window.SNEKSOUND = SOUND;

  // ---------- share codes (settings + layout) ----------
  const b64e = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))));
  const layoutNow = () => (window.SNEKLAYOUT ? SNEKLAYOUT.get() : null);
  function bundle(withLayout) { const o = { app: "snek-dashboard", v: 1, settings: S }; if (withLayout !== false) o.layout = layoutNow(); return o; }
  function applyBundle(o) {
    if (!o || (o.app && o.app !== "snek-dashboard")) throw new Error("Not a SNEK Dashboard settings file");
    if (o.settings) { S = Object.assign({}, DEF, sanitize(o.settings)); save(); applyAll(); loadRates().then(() => window.dispatchEvent(new Event("snek:fmt"))); }
    if (o.layout && window.SNEKLAYOUT && SNEKLAYOUT.set) SNEKLAYOUT.set(o.layout);
    if (o.profiles && Array.isArray(o.profiles)) saveProfiles(o.profiles.slice(0, 12));
  }
  function sanitize(x) { const o = {}; Object.keys(DEF).forEach((k) => { if (x[k] !== undefined && typeof x[k] === typeof DEF[k]) o[k] = x[k]; }); if (o.name) o.name = o.name.slice(0, 40); if (o.accent && !hexToRgb(o.accent)) o.accent = ""; return o; }

  // ---------- profiles (multiple saved layouts) ----------
  const profiles = () => { try { return JSON.parse(localStorage.getItem(PKEY) || "[]"); } catch (e) { return []; } };
  const saveProfiles = (l) => { try { localStorage.setItem(PKEY, JSON.stringify(l)); } catch (e) {} };

  // ---------- panel ----------
  let panel = null;
  const toast = (m, t) => (window.SNEKFX ? SNEKFX.toast(m, t || "ok", 3000) : null);
  function seg(name, opts, val) { return '<div class="seg sm sseg" data-set="' + name + '">' + opts.map((o) => '<button type="button" data-v="' + o[0] + '" class="' + (String(val) === String(o[0]) ? "on" : "") + '">' + esc(o[1]) + "</button>").join("") + "</div>"; }
  function row(label, ctl, hint) { return '<div class="srow"><div class="sl"><b>' + label + "</b>" + (hint ? '<span class="muted small">' + hint + "</span>" : "") + '</div><div class="sc">' + ctl + "</div></div>"; }
  function widgetList() {
    const L = window.SNEKLAYOUT ? SNEKLAYOUT.get() : { hidden: [] };
    return [...document.querySelectorAll("#wgrid > .w[data-w]")].filter((w) => w.dataset.w !== "follow").map((w) => '<label class="wl"><input type="checkbox" data-wshow="' + esc(w.dataset.w) + '"' + (L.hidden.includes(w.dataset.w) ? "" : " checked") + "><span>" + esc(w.dataset.title) + "</span></label>").join("");
  }
  function render() {
    const P = profiles();
    panel.querySelector(".sbody").innerHTML =
      '<h4>Look</h4>' +
      row("Theme", seg("theme", THEMES, S.theme)) +
      row("Accent", '<div class="swatches">' + ACCENTS.map((a) => '<button type="button" class="sw' + (S.accent === a ? " on" : "") + '" data-accent="' + a + '" style="--c:' + (a || "var(--snek)") + '" aria-label="' + (a ? "Accent " + a : "Theme default") + '">' + (a ? "" : "↺") + "</button>").join("") + '<label class="swc" title="Custom color"><input type="color" id="sAccent" value="' + (S.accent || "#18f2b2") + '"></label></div>') +
      row("Density", seg("density", [["compact", "Compact"], ["comfy", "Comfy"]], S.density)) +
      row("Text size", seg("fs", [["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]], S.fs)) +
      row("Background art", seg("bg", BGS, S.bg), "Official SNEK media-kit art") +
      row("Effects & animations", '<label class="tgl"><input type="checkbox" id="sFx"' + (S.fx ? " checked" : "") + "><span></span></label>", "Off = no motion, glow or confetti. Also off when your device asks for reduced motion") +
      row("Vibrate on price moves", '<label class="tgl"><input type="checkbox" id="sPriceVib"' + (S.pricevib ? " checked" : "") + "><span></span></label>", "Phone buzz on live price ticks and price alerts · off by default") +
      row("Sound", '<label class="tgl"><input type="checkbox" id="sSound"' + (S.sound ? " checked" : "") + "><span></span></label>", "Soft blips for alerts and whale moves") +
      '<h4>Numbers</h4>' +
      row("Currency", '<select id="sCur">' + CURS.map((c) => '<option value="' + c[0] + '"' + (S.cur === c[0] ? " selected" : "") + ">" + c[0] + "</option>").join("") + "</select>", "Fiat via ECB rates (Frankfurter), ADA via live ADA/USD") +
      row("Number style", seg("numfmt", [["compact", "1.2M"], ["full", "1,234,567"]], S.numfmt)) +
      row("Separators", '<select id="sLocale">' + LOCALES.map((l) => '<option value="' + l[0] + '"' + (S.locale === l[0] ? " selected" : "") + ">" + l[1] + "</option>").join("") + "</select>") +
      '<h4>Dashboard</h4>' +
      row("Name", '<input id="sName" maxlength="40" placeholder="SNEK Dashboard" value="' + esc(S.name) + '">', "Shown in the header · the fan-made label always stays") +
      row("Open on", '<select id="sTab">' + TABS.map((t) => '<option value="' + t[0] + '"' + (S.tab === t[0] ? " selected" : "") + ">" + t[1] + "</option>").join("") + "</select>") +
      '<h4>Layout & widgets</h4>' +
      row("Layout template", '<div class="row wrap gap ptpl">' + [["trader", "📈 Trader"], ["holder", "💎 Holder"], ["watcher", "🐋 Whale watcher"], ["reset", "↺ Default"]].map((p) => '<button type="button" class="btn sm" data-tpl="' + p[0] + '">' + p[1] + "</button>").join("") + "</div>", "Reorders, pins and hides widgets · Ctrl+Z undoes") +
      '<div class="srow col"><div class="sl"><b>Show widgets</b><span class="muted small">Untick to hide. Hidden widgets also wait in the Customize tray.</span></div><div class="wlist">' + widgetList() + "</div></div>" +
      '<h4>Help</h4>' +
      row("Guided tour", '<button type="button" class="btn sm" id="sTour">🧭 Take the tour</button>', "A 30-second walkthrough · press ? anytime") +
      row("Search & commands", '<button type="button" class="btn sm" id="sPal">⌕ Open</button>', "⌘K / Ctrl+K or / · jump anywhere, run actions, look up a $handle") +
      '<h4>Saved layouts</h4><div class="profiles">' + (P.length ? P.map((p, i) => '<div class="prof"><b>' + esc(p.name) + '</b><span class="muted small">' + new Date(p.t).toLocaleDateString() + '</span><button type="button" class="btn sm" data-pload="' + i + '">Use</button><button type="button" class="btn sm" data-pdel="' + i + '" aria-label="Delete ' + esc(p.name) + '">✕</button></div>').join("") : '<p class="muted small">No saved layouts yet.</p>') +
      '<form class="row gap" id="sProfForm"><input id="sProfName" maxlength="30" placeholder="Name this layout (e.g. Trading)" class="grow"><button class="btn primary sm">Save current</button></form></div>' +
      '<h4>Backup & share</h4><div class="row gap wrap"><button type="button" class="btn sm" id="sExport">⬇ Export file</button><label class="btn sm filebtn">⬆ Import file<input type="file" id="sImport" accept="application/json,.json" hidden></label><button type="button" class="btn sm" id="sCode">🔗 Copy look + layout link</button><button type="button" class="btn sm" id="sLayLink">🧩 Copy layout link</button></div>' +
      '<form class="row gap mt" id="sCodeForm"><input id="sCodeIn" class="grow" placeholder="Paste a share code or link"><button class="btn sm">Apply</button></form>' +
      '<p class="muted small mt">Settings, layouts and watchlists live only in this browser. Fan-made dashboard · not affiliated with SNEK · SNEK art © SNEK, used per snek.com terms.</p>' +
      '<div class="row gap"><button type="button" class="btn sm" id="sReset">Reset settings</button></div>';
  }
  function open() {
    if (!panel) build();
    render(); panel.hidden = false; document.body.classList.add("settings-open");
    requestAnimationFrame(() => panel.classList.add("open"));
    const f = panel.querySelector(".sclose"); f && f.focus();
  }
  function close() { if (!panel) return; panel.classList.remove("open"); document.body.classList.remove("settings-open"); setTimeout(() => { panel.hidden = true; }, 250); }
  function set(k, v) { S[k] = v; save(); applyAll(); if (k === "cur" || k === "numfmt" || k === "locale") loadRates().then(() => window.dispatchEvent(new Event("snek:fmt"))); }
  function build() {
    panel = document.createElement("div"); panel.className = "spanel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Settings");
    panel.innerHTML = '<div class="sback" data-x></div><div class="ssheet"><div class="shead"><img src="assets/brand/snek-face-smirk.webp" alt="" width="40" height="25"><b class="grow">Settings</b><button type="button" class="icon-btn sm sclose" data-x aria-label="Close settings">✕</button></div><div class="sbody"></div></div>';
    document.body.appendChild(panel);
    panel.addEventListener("click", (e) => {
      if (e.target.closest("[data-x]")) return close();
      const b = e.target.closest(".sseg [data-v]"); if (b) { set(b.closest(".sseg").dataset.set, b.dataset.v); render(); return; }
      const a = e.target.closest("[data-accent]"); if (a) { set("accent", a.dataset.accent); render(); return; }
      const pl = e.target.closest("[data-pload]"); if (pl) { const p = profiles()[+pl.dataset.pload]; if (p && window.SNEKLAYOUT) { SNEKLAYOUT.set(p.layout); toast("Layout “" + p.name + "” applied"); } return; }
      const pd = e.target.closest("[data-pdel]"); if (pd) { const l = profiles(); l.splice(+pd.dataset.pdel, 1); saveProfiles(l); render(); return; }
      if (e.target.closest("#sExport")) { const blob = new Blob([JSON.stringify(Object.assign(bundle(), { profiles: profiles() }), null, 2)], { type: "application/json" }), u = URL.createObjectURL(blob), x = document.createElement("a"); x.href = u; x.download = "snek-dashboard-settings-" + new Date().toISOString().slice(0, 10) + ".json"; document.body.appendChild(x); x.click(); setTimeout(() => { URL.revokeObjectURL(u); x.remove(); }, 800); toast("Settings file saved"); return; }
      if (e.target.closest("#sCode")) { const url = location.href.split("#")[0] + "#cfg=" + b64e(bundle()); (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast("Share link copied: it carries your look and layout"), () => prompt("Copy this link", url)); return; }
      const tp = e.target.closest("[data-tpl]"); if (tp && window.SNEKLAYOUT) { const k = tp.dataset.tpl; if (k === "reset") { const L = SNEKLAYOUT.get(); SNEKLAYOUT.set({ order: [], pinned: [], hidden: [], size: {}, height: {} }); } else SNEKLAYOUT.applyPreset(k); render(); if (k === "reset") toast("Default layout restored · Ctrl+Z undoes"); return; }
      if (e.target.closest("#sTour")) { close(); setTimeout(() => window.SNEKEXTRAS && SNEKEXTRAS.tour(0), 280); return; }
      if (e.target.closest("#sPal")) { close(); setTimeout(() => window.SNEKEXTRAS && SNEKEXTRAS.palette(), 280); return; }
      if (e.target.closest("#sLayLink")) { if (window.SNEKEXTRAS) SNEKEXTRAS.copyLayoutLink(); return; }
      if (e.target.closest("#sReset")) { S = Object.assign({}, DEF); save(); applyAll(); window.dispatchEvent(new Event("snek:fmt")); render(); toast("Settings reset"); }
    });
    panel.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "sFx") set("fx", t.checked); else if (t.id === "sPriceVib") set("pricevib", t.checked); else if (t.id === "sSound") { set("sound", t.checked); SOUND.play("ok"); }
      else if (t.id === "sCur") set("cur", t.value); else if (t.id === "sLocale") set("locale", t.value); else if (t.id === "sTab") set("tab", t.value);
      else if (t.id === "sAccent") { set("accent", t.value); render(); }
      else if (t.dataset && t.dataset.wshow && window.SNEKLAYOUT) { const L = SNEKLAYOUT.get(), id = t.dataset.wshow; L.hidden = t.checked ? L.hidden.filter((x) => x !== id) : L.hidden.concat(id); SNEKLAYOUT.set(L); }
      else if (t.id === "sImport" && t.files[0]) { t.files[0].text().then((x) => { applyBundle(JSON.parse(x)); render(); toast("Settings imported"); }).catch((err) => toast("Import failed: " + err.message, "warn")); }
    });
    panel.addEventListener("input", (e) => { if (e.target.id === "sName") { S.name = e.target.value.slice(0, 40); save(); applyAll(); } });
    panel.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.target.id === "sProfForm") { const n = $("sProfName").value.trim() || "Layout " + (profiles().length + 1); const l = profiles().filter((p) => p.name !== n); l.unshift({ name: n, t: Date.now(), layout: layoutNow() }); saveProfiles(l.slice(0, 12)); render(); toast("Saved layout “" + n + "”"); }
      if (e.target.id === "sCodeForm") { const v = $("sCodeIn").value.trim(), m = v.match(/cfg=([A-Za-z0-9_-]+)/), code = m ? m[1] : v; try { applyBundle(b64d(code)); render(); toast("Shared settings applied"); } catch (err) { toast("That code doesn’t look right", "warn"); } }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel && !panel.hidden) close(); });
  }

  // ---------- incoming #cfg= / #layout= links: ask, never overwrite silently ----------
  function offer(kind, obj) {
    const bar = document.createElement("div"); bar.className = "updbar show"; bar.setAttribute("role", "status");
    bar.innerHTML = "<span>" + (kind === "cfg" ? "🎨 Someone shared their dashboard look" + (obj.layout ? " and layout" : "") : "🧩 Someone shared a dashboard layout") + '</span><button type="button" class="btn primary">Apply</button><button type="button" class="btn">Ignore</button>';
    document.body.appendChild(bar);
    bar.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; if (b.classList.contains("primary")) { try { applyBundle(kind === "cfg" ? obj : { layout: obj }); toast("Applied"); } catch (err) { toast(err.message, "warn"); } } bar.remove(); history.replaceState(null, "", location.pathname + location.search); });
  }
  function init() {
    applyAll(); loadRates().then(() => { if (S.cur !== "USD") window.dispatchEvent(new Event("snek:fmt")); });
    document.querySelectorAll("#settingsBtn,[data-open-settings]").forEach((b) => b.addEventListener("click", open));
    document.addEventListener("keydown", (e) => { if (e.key === "," && !e.target.closest("input,textarea,select") && !e.metaKey && !e.ctrlKey) open(); });
    const h = location.hash, m = h.match(/^#cfg=([A-Za-z0-9_-]+)/), l = h.match(/^#layout=([A-Za-z0-9_-]+)/);
    try { if (m) setTimeout(() => offer("cfg", b64d(m[1])), 1500); else if (l) setTimeout(() => offer("layout", b64d(l[1])), 1500); } catch (e) {}
    if (!h && S.tab && S.tab !== "overview") setTimeout(() => { if (window.SNEKLAYOUT && scrollY < 50) SNEKLAYOUT.goto(S.tab); }, 1200);
    if (window.SNEKFX && SNEKFX.toast && !SNEKFX.__snd) { const t = SNEKFX.toast; SNEKFX.toast = function (m, type) { SOUND.play(type === "whale" ? "whale" : type === "warn" ? "warn" : type === "ok" ? "ok" : "tap"); return t.apply(this, arguments); }; SNEKFX.__snd = 1; }
  }
  window.SNEKSET = { open, close, get: () => Object.assign({}, S), set, code: (withLayout) => b64e(bundle(withLayout)), decode: b64d };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
