/* Guidance + delight layer for the fan-made SNEK dashboard:
   - ⓘ help popovers on metric labels (what a number means and where it comes from)
   - command / search palette (⌘K, Ctrl+K or "/"): jump to sections and widgets, run actions, look up a wallet
   - first-visit guided tour (skippable, re-open from Settings, the palette or the More menu)
   - mobile "More" sheet so the bottom bar keeps 5 big targets
   - widget enter animation when a widget is shown, celebration + share prompt on a new all-time high or a big pump
   Everything is local to this browser. Nothing is ever posted for you: share buttons open X's composer or Web Share. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduced = () => document.documentElement.classList.contains("nofx") || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const toast = (m, t) => (window.SNEKFX ? SNEKFX.toast(m, t || "info", 3200) : null);
  const visible = (el) => { if (!el || !el.getClientRects().length) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // ---------------- help popovers ----------------
  const HELP = {
    "Market cap": "Circulating supply × price, from CoinGecko (refreshed every 60 s).",
    "24h volume": "USD value traded across all tracked exchanges and DEXes in the last 24 hours (CoinGecko).",
    "FDV": "Fully diluted valuation: max supply × price. For SNEK it is close to market cap because almost all supply circulates.",
    "7d change": "Price change over the last 7 days (CoinGecko).",
    "30d change": "Price change over the last 30 days (CoinGecko).",
    "ADA price": "Live ADA/USD from the Kraken and Coinbase WebSockets. SNEK trades on Cardano DEXes against ADA.",
    "CoinGecko rank": "Position by market cap on CoinGecko.",
    "Circulating supply": "SNEK tokens in circulation (CoinGecko).",
    "Total supply": "All SNEK tokens minted (CoinGecko).",
    "Max supply": "The hard cap: no more SNEK can ever be minted.",
    "24h high / low": "Highest and lowest USD price in the last 24 hours (CoinGecko).",
    "1y change": "Price change over the last 365 days (CoinGecko).",
    "All-time high": "Highest price ever recorded by CoinGecko, with its date.",
    "All-time low": "Lowest price ever recorded by CoinGecko, with its date.",
    "On-chain transactions": "Number of Cardano transactions that moved SNEK, from Cardanoscan via the scheduled snapshot.",
    "Value now": "Today's balance of the included assets × live prices.",
    "Change": "Value at the end of the range minus value at the start. Includes deposits and withdrawals.",
    "Price-driven P/L": "Gain or loss from price moves only: each day's held balance × that day's price change. The % is time-weighted, so deposits and withdrawals don't distort it.",
    "Net transfers": "Value of tokens moved in minus moved out, priced on the day they moved.",
    "Max drawdown": "Largest drop from a previous peak to a later low within the range.",
    "ATH / ATL": "Highest and lowest daily portfolio value within the range.",
    "Staking": "Whether the wallet's stake key is delegated, and to which pool (Yoroi backend).",
    "Net SNEK": "SNEK received minus SNEK sent in the transactions shown.",
  };
  let pop = null;
  function decorate() {
    document.querySelectorAll(".kpi .l:not([data-h]), dl.props dt:not([data-h])").forEach((el) => {
      el.dataset.h = "1"; const key = el.textContent.trim(); if (!HELP[key]) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "hlp"; b.dataset.help = key; b.setAttribute("aria-label", "What is " + key + "?"); b.textContent = "i";
      el.appendChild(b);
    });
  }
  let decQ = false; const queueDecorate = () => { if (decQ) return; decQ = true; requestAnimationFrame(() => { decQ = false; decorate(); }); };
  function showHelp(b) {
    if (!pop) { pop = document.createElement("div"); pop.className = "hpop"; pop.setAttribute("role", "tooltip"); pop.id = "hpop"; document.body.appendChild(pop); }
    if (pop.dataset.for === b.dataset.help && !pop.hidden) { hideHelp(); return; }
    pop.dataset.for = b.dataset.help; pop.innerHTML = "<b>" + esc(b.dataset.help) + "</b><span>" + esc(HELP[b.dataset.help]) + "</span>"; pop.hidden = false;
    const r = b.getBoundingClientRect(), w = Math.min(280, innerWidth - 24); pop.style.width = w + "px";
    pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)) + "px";
    const below = r.bottom + 8 + pop.offsetHeight < innerHeight; pop.style.top = (below ? r.bottom + 8 : r.top - pop.offsetHeight - 8) + scrollY + "px";
    b.setAttribute("aria-describedby", "hpop"); requestAnimationFrame(() => pop.classList.add("in"));
  }
  function hideHelp() { if (pop) { pop.hidden = true; pop.classList.remove("in"); pop.dataset.for = ""; } }

  // ---------------- command palette ----------------
  const TABS = [["overview", "Overview", "◎"], ["chart", "Chart", "📈"], ["holders", "Holders", "👥"], ["wallets", "Wallets", "🔎"], ["pools", "Pools", "💧"], ["trades", "Trades", "⇄"], ["tools", "Tools", "🧰"]];
  const goto = (t) => { closeAll(); if (window.SNEKLAYOUT) SNEKLAYOUT.goto(t); };
  function widgets() { return [...document.querySelectorAll("#wgrid > .w[data-w]")].map((w) => ({ id: w.dataset.w, title: w.dataset.title, hidden: w.classList.contains("whid"), el: w })); }
  function showWidget(id) {
    if (!window.SNEKLAYOUT) return; const L = SNEKLAYOUT.get(); if (L.hidden.includes(id)) { L.hidden = L.hidden.filter((x) => x !== id); SNEKLAYOUT.set(L); }
    setTimeout(() => { const w = document.querySelector('#wgrid > .w[data-w="' + id + '"]'); if (w) w.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }); }, 60);
  }
  function actions() {
    const S = window.SNEKSET ? SNEKSET.get() : {};
    const A = [
      { k: "Share a price card", d: "Image with live price, 24h change and the dashboard link", i: "↗", run: () => SNEKSHARE && SNEKSHARE.price() },
      { k: "Share this chart", d: "Branded chart snapshot", i: "📸", run: () => { goto("chart"); setTimeout(() => SNEKSHARE && SNEKSHARE.chart(), 300); } },
      { k: "Settings", d: "Themes, accent, currency, animations, layouts", i: "⚙", run: () => SNEKSET && SNEKSET.open() },
      { k: "Customize layout", d: "Drag, pin, resize and hide widgets", i: "✎", run: () => SNEKLAYOUT && SNEKLAYOUT.setEditing(true) },
      { k: "Take the tour", d: "A 30-second walkthrough", i: "🧭", run: () => tour(0) },
      { k: "Switch theme", d: "Dark → Light → OLED → SNEK green", i: "◐", run: () => $("themeBtn") && $("themeBtn").click() },
      { k: (S.fx === false ? "Turn animations on" : "Turn animations off"), d: "Motion, glow and confetti", i: "✨", run: () => { SNEKSET.set("fx", S.fx === false); toast(S.fx === false ? "Animations on" : "Animations off"); } },
      { k: "Refresh data", d: "Fetch everything now", i: "⟳", run: () => $("refreshBtn") && $("refreshBtn").click() },
      { k: "Copy layout link", d: "A link that offers your layout to whoever opens it", i: "🧩", run: copyLayoutLink },
    ];
    [["trader", "Trader"], ["holder", "Holder"], ["watcher", "Whale watcher"]].forEach(([p, n]) => A.push({ k: "Layout: " + n, d: "Apply the " + n + " widget preset (undo with Ctrl+Z)", i: "▦", run: () => SNEKLAYOUT.applyPreset(p) }));
    ["USD", "ADA", "EUR", "GBP", "JPY"].forEach((c) => A.push({ k: "Currency: " + c, d: "Show values in " + c, i: "¤", run: () => { SNEKSET.set("cur", c); toast("Currency: " + c); } }));
    return A;
  }
  function copyLayoutLink() {
    if (!window.SNEKSET || !window.SNEKLAYOUT) return;
    const url = location.href.split("#")[0] + "#layout=" + b64(SNEKLAYOUT.get());
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast("Layout link copied. Whoever opens it is asked before anything changes.", "ok"), () => prompt("Copy this link", url));
  }
  const b64 = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const looksWallet = (q) => /^\$[a-z0-9_.-]{1,15}$/i.test(q) || /^(addr1|stake1)[0-9a-z]{20,}$/i.test(q);
  let pal = null, palItems = [], palSel = 0;
  function palette() {
    closeAll();
    if (!pal) {
      pal = document.createElement("div"); pal.className = "pal"; pal.setAttribute("role", "dialog"); pal.setAttribute("aria-modal", "true"); pal.setAttribute("aria-label", "Search and commands");
      pal.innerHTML = '<div class="palback" data-x></div><div class="palbox"><div class="palin"><span aria-hidden="true">⌕</span><input id="palQ" type="search" autocomplete="off" spellcheck="false" placeholder="Search sections, widgets, actions, or paste a $handle / address" aria-controls="palList"><kbd>Esc</kbd></div><ul id="palList" role="listbox"></ul><div class="palfoot muted small">↑↓ to move · Enter to run · ⌘K / Ctrl+K or / opens this anywhere</div></div>';
      document.body.appendChild(pal);
      pal.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) return closePal(); const li = e.target.closest("[data-i]"); if (li) runItem(+li.dataset.i); });
      pal.addEventListener("input", (e) => { if (e.target.id === "palQ") { palSel = 0; listPal(); } });
      pal.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); listPal(true); }
        else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); listPal(true); }
        else if (e.key === "Enter") { e.preventDefault(); runItem(palSel); }
        else if (e.key === "Escape") { e.preventDefault(); closePal(); }
      });
    }
    pal.hidden = false; $("palQ").value = ""; palSel = 0; listPal(); requestAnimationFrame(() => { pal.classList.add("open"); $("palQ").focus(); });
  }
  function closePal() { if (!pal || pal.hidden) return; pal.classList.remove("open"); pal.hidden = true; }
  function score(q, s) { s = s.toLowerCase(); if (!q) return 1; if (s.startsWith(q)) return 3; if (s.includes(" " + q)) return 2.5; if (s.includes(q)) return 2; let i = 0; for (const ch of s) if (ch === q[i]) i++; return i === q.length ? 1 : 0; }
  function listPal(keepScroll) {
    const raw = $("palQ").value.trim(), q = raw.toLowerCase(), items = [];
    if (looksWallet(raw)) items.push({ g: "Wallet", i: "🔎", k: "Look up " + raw, d: "Open it in the wallet tracker (read-only)", run: () => { goto("wallets"); const inp = $("wInput"); if (inp) { inp.value = raw; const f = $("wSearch"); if (f) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true })); } } });
    TABS.forEach(([t, n, ic]) => items.push({ g: "Sections", i: ic, k: n, d: "Jump to " + n, run: () => goto(t) }));
    widgets().forEach((w) => items.push({ g: "Widgets", i: w.hidden ? "◌" : "▣", k: w.title, d: w.hidden ? "Hidden · show it and jump there" : "Jump to this widget", run: () => { closeAll(); showWidget(w.id); } }));
    actions().forEach((a) => items.push(Object.assign({ g: "Actions" }, a)));
    palItems = items.map((x) => Object.assign(x, { s: Math.max(score(q, x.k), score(q, x.d) * 0.6) })).filter((x) => x.s > 0);
    if (q) palItems.sort((a, b) => b.s - a.s);
    palItems = palItems.slice(0, 40);
    let g = "";
    $("palList").innerHTML = palItems.length ? palItems.map((x, i) => { const head = !q && x.g !== g ? '<li class="palg" role="presentation">' + (g = x.g) + "</li>" : ""; return head + '<li role="option" data-i="' + i + '" class="' + (i === palSel ? "on" : "") + '" aria-selected="' + (i === palSel) + '"><span class="pali">' + x.i + '</span><span class="palt"><b>' + esc(x.k) + "</b><span>" + esc(x.d) + "</span></span></li>"; }).join("") : '<li class="palnone muted">No matches. Try “chart”, “holder”, “theme” or paste a $handle.</li>';
    const on = $("palList").querySelector("li.on"); if (on && keepScroll) on.scrollIntoView({ block: "nearest" });
  }
  function runItem(i) { const x = palItems[i]; if (!x) return; closePal(); setTimeout(() => x.run(), 30); }

  // ---------------- mobile "More" sheet ----------------
  let more = null;
  function moreSheet() {
    closeAll();
    if (!more) {
      more = document.createElement("div"); more.className = "msheet"; more.setAttribute("role", "dialog"); more.setAttribute("aria-modal", "true"); more.setAttribute("aria-label", "More");
      more.innerHTML = '<div class="palback" data-x></div><div class="mbox"><div class="mgrip" aria-hidden="true"></div><div class="mgrid">' +
        [["holders", "👥", "Holders"], ["pools", "💧", "Pools"], ["tools", "🧰", "Tools"]].map((t) => '<button type="button" data-goto="' + t[0] + '"><span>' + t[1] + "</span>" + t[2] + "</button>").join("") +
        '<button type="button" data-m="search"><span>⌕</span>Search</button><button type="button" data-m="share"><span>↗</span>Share card</button><button type="button" data-m="layout"><span>✎</span>Customize</button><button type="button" data-m="settings"><span>⚙</span>Settings</button><button type="button" data-m="tour"><span>🧭</span>Tour</button><button type="button" data-m="theme"><span>◐</span>Theme</button>' +
        '</div><p class="muted small">Fan-made · not affiliated with SNEK</p></div>';
      document.body.appendChild(more);
      more.addEventListener("click", (e) => {
        if (e.target.closest("[data-x]")) return closeMore();
        const g = e.target.closest("[data-goto]"); if (g) { closeMore(); goto(g.dataset.goto); return; }
        const m = e.target.closest("[data-m]"); if (!m) return; closeMore();
        ({ search: palette, share: () => SNEKSHARE && SNEKSHARE.price(), layout: () => SNEKLAYOUT && SNEKLAYOUT.setEditing(true), settings: () => SNEKSET && SNEKSET.open(), tour: () => tour(0), theme: () => $("themeBtn") && $("themeBtn").click() })[m.dataset.m]();
      });
    }
    more.hidden = false; requestAnimationFrame(() => more.classList.add("open"));
  }
  function closeMore() { if (!more || more.hidden) return; more.classList.remove("open"); setTimeout(() => { more.hidden = true; }, 200); }
  function setupNav() {
    const nav = document.querySelector("nav.tabs"); if (!nav || nav.querySelector(".tmore")) return;
    ["holders", "pools", "tools"].forEach((t) => { const a = nav.querySelector('a[data-tab="' + t + '"]'); if (a) a.classList.add("mhide"); });
    const b = document.createElement("a"); b.href = "#more"; b.className = "tmore"; b.setAttribute("role", "button"); b.setAttribute("aria-haspopup", "dialog"); b.innerHTML = "<span>☰</span>More"; nav.appendChild(b);
    b.addEventListener("click", (e) => { e.preventDefault(); moreSheet(); });
    // the More button lights up while you're in a section that lives inside it
    new MutationObserver(() => { const on = !!nav.querySelector("a.mhide.on"); if (b.classList.contains("on") !== on) b.classList.toggle("on", on); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
  }

  // ---------------- guided tour ----------------
  const STEPS = [
    { sel: ["#overview"], t: "Live SNEK price", b: "The price ticks in real time from Cardano DEXes × live ADA/USD. Tap any ⓘ next to a number to see what it means and where it comes from." },
    { sel: ["nav.tabs"], t: "Sections", b: "Jump between Overview, Chart, Wallets, Trades and more. On phones, ☰ More holds the rest. You can also swipe sideways." },
    { sel: ["#paletteBtn"], t: "Search everything", b: "Find any widget or action, switch currency or theme, or paste a $handle to look up a wallet. Shortcut: ⌘K / Ctrl+K or /." },
    { sel: ["#layoutBtn", "#layoutFab"], t: "Make it yours", b: "Drag, pin, resize and hide widgets, or pick a Trader, Holder or Whale watcher layout in one tap. Ctrl+Z undoes." },
    { sel: ["#settingsBtn", ".tabs .tmore"], t: "Settings", b: "Themes, custom accent color, text size, density, currency, animations on/off, saved layouts, export/import and share links. On phones it lives under ☰ More." },
    { sel: ["#shareBtn"], t: "Share a card", b: "Make a branded image with the live price and 24h change. It opens X's composer or your phone's share sheet. Nothing is ever posted for you." },
    { sel: ["#wallets"], t: "Wallets & P/L", b: "Look up any wallet or $handle (read-only). Portfolio history rebuilds real value over time, with an opt-in P/L card that never shows the address." },
  ];
  let tourEl = null, step = 0;
  function tour(i) {
    closeAll(); step = i || 0;
    if (!tourEl) {
      tourEl = document.createElement("div"); tourEl.className = "tour"; tourEl.setAttribute("role", "dialog"); tourEl.setAttribute("aria-modal", "true"); tourEl.setAttribute("aria-label", "Guided tour");
      tourEl.innerHTML = '<div class="tspot"></div><div class="tcard"><div class="tprog"></div><b class="tt"></b><p class="tb"></p><div class="row gap tbtns"><button type="button" class="btn sm" data-t="skip">Skip</button><span class="grow"></span><button type="button" class="btn sm" data-t="back">Back</button><button type="button" class="btn sm primary" data-t="next">Next</button></div></div>';
      document.body.appendChild(tourEl);
      tourEl.addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (!b) return; const a = b.dataset.t; if (a === "skip") endTour(); else if (a === "back") showStep(step - 1); else showStep(step + 1); });
      tourEl.addEventListener("keydown", (e) => { if (e.key === "Escape") endTour(); else if (e.key === "ArrowRight") showStep(step + 1); else if (e.key === "ArrowLeft") showStep(step - 1); });
      addEventListener("resize", () => { if (tourEl && !tourEl.hidden) place(); });
      addEventListener("scroll", () => { if (tourEl && !tourEl.hidden) requestAnimationFrame(place); }, { passive: true });
    }
    try { localStorage.setItem("snek-coach", "1"); } catch (e) {} document.querySelectorAll(".coach").forEach((c) => c.remove());
    tourEl.hidden = false; document.body.classList.add("touring"); showStep(step);
  }
  const target = (s) => s.sel.map((q) => document.querySelector(q)).find(visible);
  function showStep(i) {
    if (i < 0) i = 0;
    while (i < STEPS.length && !target(STEPS[i])) i++;
    if (i >= STEPS.length) return endTour(true);
    step = i; const s = STEPS[i], el = target(s);
    tourEl.querySelector(".tt").textContent = s.t; tourEl.querySelector(".tb").textContent = s.b;
    tourEl.querySelector(".tprog").innerHTML = STEPS.map((_, j) => "<i" + (j === i ? ' class="on"' : "") + "></i>").join("");
    tourEl.querySelector('[data-t="back"]').disabled = i === 0;
    tourEl.querySelector('[data-t="next"]').textContent = i === STEPS.length - 1 ? "Done 🎉" : "Next";
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 70) { const y = scrollY + r.top - (r.height > innerHeight * 0.6 ? 80 : (innerHeight - r.height) / 2); window.scrollTo({ top: Math.max(0, y), behavior: "instant" }); }
    requestAnimationFrame(place); tourEl.querySelector('[data-t="next"]').focus({ preventScroll: true });
  }
  function place() {
    const s = STEPS[step], el = s && target(s); if (!el) return;
    const r = el.getBoundingClientRect(), pad = 6, sp = tourEl.querySelector(".tspot"), card = tourEl.querySelector(".tcard");
    const top = Math.max(4, r.top - pad), h = Math.min(innerHeight - top - 4, r.height + pad * 2);
    Object.assign(sp.style, { left: Math.max(4, r.left - pad) + "px", top: top + "px", width: Math.min(innerWidth - 8, r.width + pad * 2) + "px", height: Math.max(24, h) + "px" });
    const cw = Math.min(360, innerWidth - 24); card.style.width = cw + "px";
    const ch = card.offsetHeight, below = top + h + 12 + ch < innerHeight, above = top - 12 - ch > 0;
    card.style.left = Math.max(12, Math.min(innerWidth - cw - 12, r.left + r.width / 2 - cw / 2)) + "px";
    card.style.top = Math.max(8, Math.min(innerHeight - ch - 8, below ? top + h + 12 : above ? top - ch - 12 : innerHeight - ch - 84)) + "px";
  }
  function endTour(done) {
    if (!tourEl) return; tourEl.hidden = true; document.body.classList.remove("touring"); ls.set("snek-tour", 2);
    if (done) { toast("You're all set. ⌘K / Ctrl+K or / opens search anytime.", "ok"); if (window.SNEKFX && SNEKFX.confetti) SNEKFX.confetti($("shareBtn")); }
  }
  function maybeTour() {
    if (ls.get("snek-tour", 0) || /^#(wallet|cfg|layout|chart|s)=/.test(location.hash) || navigator.webdriver) return;
    try { localStorage.setItem("snek-coach", "1"); } catch (e) {} // the tour covers the Customize tip
    const go = () => setTimeout(() => { if (!ls.get("snek-tour", 0) && !document.querySelector(".spanel:not([hidden]), .tour:not([hidden])")) tour(0); }, 700);
    const n = $("fanNotice");
    if (n && !n.hidden) { const b = $("fanNoticeClose"); if (b) b.addEventListener("click", go, { once: true }); }
    else setTimeout(go, 2600);
  }

  // ---------------- celebrations + milestone share prompts ----------------
  // Real data only: a new ATH means the live price is above CoinGecko's recorded all-time high; a big pump means 24h change ≥ +15%.
  function prompt2(key, msg, onShare) {
    const day = new Date().toISOString().slice(0, 10), seen = ls.get("snek-milestones", {});
    if (seen[key] === day) return false; seen[key] = day; ls.set("snek-milestones", seen);
    const bar = document.createElement("div"); bar.className = "updbar nudge milestone"; bar.setAttribute("role", "status");
    bar.innerHTML = "<span>" + esc(msg) + '</span><button type="button" class="btn primary">Share card</button><button type="button" class="icon-btn sm" aria-label="Dismiss">✕</button>';
    document.body.appendChild(bar); requestAnimationFrame(() => bar.classList.add("show"));
    const done = () => { bar.classList.remove("show"); setTimeout(() => bar.remove(), 300); };
    bar.addEventListener("click", (e) => { if (e.target.closest(".primary")) { done(); onShare(); } else if (e.target.closest(".icon-btn")) done(); });
    setTimeout(done, 12000); return true;
  }
  function watchMarket() {
    const m = window.SNEKAPP && SNEKAPP.state && SNEKAPP.state.market; if (!m || !isFinite(m.price)) return;
    if (document.body.classList.contains("touring") || document.body.classList.contains("editing")) return;
    if (isFinite(m.ath) && m.ath > 0 && m.price > m.ath) {
      if (prompt2("ath", "🏆 SNEK just printed a new all-time high: $" + Number(m.price.toPrecision(4)) + ". Share the moment?", () => SNEKSHARE.price())) celebrate();
    } else if (isFinite(m.ch24) && m.ch24 >= 15) {
      if (prompt2("pump", "🚀 SNEK is up " + m.ch24.toFixed(1) + "% in 24h. Share a price card?", () => SNEKSHARE.price())) celebrate();
    }
  }
  function celebrate() { if (reduced() || !window.SNEKFX) return; SNEKFX.confetti($("price")); const p = $("price"); if (p) { p.classList.remove("celebrate"); void p.offsetWidth; p.classList.add("celebrate"); } }

  // ---------------- widget enter animation ----------------
  function setupEnter() {
    const g = $("wgrid"); if (!g) return;
    new MutationObserver((ms) => ms.forEach((m) => {
      const w = m.target; if (w.parentElement !== g || !w.classList.contains("w")) return;
      const was = /\bwhid\b/.test(m.oldValue || ""); if (was && !w.classList.contains("whid") && !reduced()) { w.classList.remove("wenter"); void w.offsetWidth; w.classList.add("wenter"); setTimeout(() => w.classList.remove("wenter"), 600); }
    })).observe(g, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
  }

  function closeAll() { closePal(); closeMore(); hideHelp(); }

  function init() {
    // header search button (before Share)
    const acts = document.querySelector("header .actions");
    if (acts && !$("paletteBtn")) { const b = document.createElement("button"); b.id = "paletteBtn"; b.className = "icon-btn"; b.type = "button"; b.setAttribute("aria-label", "Search and commands (Ctrl+K)"); b.title = "Search & commands (⌘K / Ctrl+K or /)"; b.textContent = "⌕"; acts.insertBefore(b, acts.firstChild); b.addEventListener("click", palette); }
    setupNav(); setupEnter();
    const main = $("wgrid"); if (main) new MutationObserver(queueDecorate).observe(main, { childList: true, subtree: true }); decorate();
    document.addEventListener("click", (e) => {
      const h = e.target.closest(".hlp"); if (h) { e.preventDefault(); e.stopPropagation(); showHelp(h); return; }
      if (pop && !pop.hidden && !e.target.closest(".hpop")) hideHelp();
      if (e.target.closest("[data-tour]")) { e.preventDefault(); tour(0); }
    }, true);
    addEventListener("scroll", () => { if (pop && !pop.hidden) hideHelp(); }, { passive: true });
    document.addEventListener("keydown", (e) => {
      const typing = e.target.closest && e.target.closest("input,textarea,select,[contenteditable]");
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); pal && !pal.hidden ? closePal() : palette(); return; }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); palette(); return; }
      if (e.key === "?" && !typing) { e.preventDefault(); tour(0); return; }
      if (e.key === "Escape") { if (pop && !pop.hidden) hideHelp(); if (more && !more.hidden) closeMore(); if (tourEl && !tourEl.hidden) endTour(); }
    });
    maybeTour();
    setInterval(watchMarket, 5000);
  }
  window.SNEKEXTRAS = { tour, palette, more: moreSheet, help: HELP, copyLayoutLink };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
