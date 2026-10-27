/* Wallet tracker for the fan-made SNEK dashboard. Read-only and keyless, straight from the browser:
   - Yoroi's public wallet backend (api.yoroiwallet.com): address balances (ADA + tokens) and stake-key state.
   - Handle.me public API: ADA Handle -> address, and handles held by a stake key.
   - Top-holder details (24 h activity etc.) are precomputed every 30 min by a GitHub Action using Koios
     (Koios's keyless tier blocks browser CORS, so it is only used server-side).
   Never asks for seed phrases, never connects a wallet, never signs anything. Watchlist lives in this browser only. */
(function () {
  const POLICY = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f", SNEK_HEX = "534e454b";
  const YOROI = "https://api.yoroiwallet.com/api", HANDLE = "https://api.handle.me";
  const MAX_WATCH = 12, WATCH_KEY = "snek-watch";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ok = (v) => v !== null && v !== undefined && isFinite(v);
  const n0 = (v) => (ok(v) ? Math.round(v).toLocaleString("en-US") : "–");
  const cmp = (v) => (ok(v) ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : "–");
  const usdc = (v) => (ok(v) ? "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : "–");
  const short = (a) => (!a ? "" : a.length <= 18 ? a : a.slice(0, 10) + "…" + a.slice(-6));
  const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±") + cmp(Math.abs(v));
  const app = () => window.SNEKAPP || {};
  const price = () => { const m = app().state && app().state.market; return m && ok(m.price) ? m.price : null; };
  const circ = () => { const m = app().state && app().state.market; return m && ok(m.circ) ? m.circ : 74.67e9; };
  const FX = () => window.SNEKFX;
  const toast = (m, t) => { if (FX()) FX().toast(m, t || "info", 4000); };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const tz = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(t)) + " CT";

  // ---------- polite request queue (one at a time, backoff on errors) ----------
  let chain = Promise.resolve(), pauseUntil = 0;
  function req(url, body, ms) {
    const run = () => {
      const wait = Math.max(0, pauseUntil - Date.now());
      return new Promise((r) => setTimeout(r, wait + 200)).then(() => {
        const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 20000);
        const o = body ? { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: c.signal } : { headers: { Accept: "application/json" }, signal: c.signal };
        return fetch(url, o).then((r) => { clearTimeout(t); if (r.status === 404) return null; if (!r.ok) { if (r.status === 429 || r.status >= 500) pauseUntil = Date.now() + 15000; throw new Error("HTTP " + r.status); } return r.json(); });
      });
    };
    const p = chain.then(run, run); chain = p.catch(() => {}); return p;
  }
  const yoroi = (path, body) => req(YOROI + path, body);

  // ---------- bech32 (addresses) ----------
  const CH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  function polymod(v) { const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]; let c = 1; for (const x of v) { const b = c >> 25; c = ((c & 0x1ffffff) << 5) ^ x; for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= G[i]; } return c; }
  const hrpExp = (h) => [...h].map((c) => c.charCodeAt(0) >> 5).concat([0], [...h].map((c) => c.charCodeAt(0) & 31));
  function conv(data, from, to, pad) { let acc = 0, bits = 0; const out = [], max = (1 << to) - 1; for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & max); } } if (pad && bits) out.push((acc << (to - bits)) & max); return out; }
  function b32dec(s) { s = s.toLowerCase(); const p = s.lastIndexOf("1"); const d = [...s.slice(p + 1)].map((c) => CH.indexOf(c)); if (d.some((x) => x < 0) || polymod(hrpExp(s.slice(0, p)).concat(d)) !== 1) return null; return { hrp: s.slice(0, p), bytes: conv(d.slice(0, -6), 5, 8, false) }; }
  function b32enc(hrp, bytes) { const d = conv(bytes, 8, 5, true); const pm = polymod(hrpExp(hrp).concat(d, [0, 0, 0, 0, 0, 0])) ^ 1; const ck = []; for (let i = 0; i < 6; i++) ck.push((pm >> (5 * (5 - i))) & 31); return hrp + "1" + d.concat(ck).map((x) => CH[x]).join(""); }
  const hex = (b) => b.map((x) => x.toString(16).padStart(2, "0")).join("");
  const unhex = (h) => (h.match(/../g) || []).map((x) => parseInt(x, 16));
  // Shelley address -> { script, stakeBytes } (base addresses carry a stake credential in bytes 29..57)
  function addrInfo(a) {
    if (/^(Ae2|Ddz)/.test(a)) return { byron: true, script: false, stake: null };
    const d = b32dec(a); if (!d || d.hrp !== "addr") return null;
    const t = d.bytes[0] >> 4;
    const script = [1, 3, 5, 7].includes(t);
    let stake = null;
    if (t <= 3 && d.bytes.length >= 57) stake = b32enc("stake", [(t === 2 || t === 3) ? 0xf1 : 0xe1].concat(d.bytes.slice(29, 57)));
    return { byron: false, script, stake };
  }
  const stakeHex = (st) => { const d = b32dec(st); return d && d.hrp === "stake" ? hex(d.bytes) : null; };
  const poolBech = (h) => { try { return b32enc("pool", unhex(h)); } catch (e) { return h; } };

  // ---------- labels + signals ----------
  let LABELS = {};
  fetch("assets/labels.json").then((r) => r.json()).then((d) => { (d.labels || []).forEach((l) => { LABELS[l.address] = l; if (l.stake) LABELS[l.stake] = l; }); renderTop(); }).catch(() => {});
  function signals(w) {
    if (w.script) return { list: [["Smart contract (DEX or protocol), not a person", true]], count: 0, contract: true };
    const big = ok(w.ada) && w.ada >= 1e6 && (w.stakeStatus !== "registered" || !w.pool);
    const list = [
      ["Holds ≥1M ADA without staking it", big],
      ["Holds ≥20 ADA Handles", (w.handles || 0) >= 20],
      ["Very busy: ≥100 transactions in 24 h" + (ok(w.tx24) ? "" : " (checked for top holders only)"), (w.tx24 || 0) >= 100],
      ["Legacy Byron address (common for older exchange wallets)", !!w.byron]
    ];
    return { list, count: list.filter((x) => x[1]).length };
  }
  const exLike = (w) => { const s = signals(w); return !s.contract && s.count >= 2; };
  function nameOf(w) {
    const lab = LABELS[w.address] || (w.stake && LABELS[w.stake]);
    if (lab) return { text: lab.label, kind: "label", src: lab.source };
    if (w.searchedHandle) return { text: "$" + w.searchedHandle, kind: "handle" };
    if (w.defaultHandle) return { text: "$" + w.defaultHandle, kind: "handle" };
    if (w.handles === 1 && w.handleSample && w.handleSample[0]) return { text: "$" + w.handleSample[0], kind: "handle" };
    if (w.handles > 1) return { text: "Wallet with " + n0(w.handles) + " handles", kind: "handles" };
    if (w.script) return { text: "Smart contract", kind: "addr" };
    return { text: "Unlabeled wallet", kind: "addr" };
  }
  const topMatch = (w) => { const T = window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.holders && window.SNEK_SNAPSHOT.holders.wallets; return T && T.find((x) => (w.address && x.address === w.address) || (w.stake && x.stake === w.stake)); };

  // ---------- resolve + load a wallet ----------
  function parse(q) {
    q = q.trim(); if (!q) return null;
    if (/^stake1[0-9a-z]{50,}$/.test(q)) return { stake: q };
    if (/^(addr1[0-9a-z]{50,}|Ae2[1-9A-HJ-NP-Za-km-z]{40,}|DdzFF[1-9A-HJ-NP-Za-km-z]{60,})$/.test(q)) return { address: q };
    const h = q.replace(/^\$/, "").toLowerCase();
    if (/^[a-z0-9_.-]{1,15}(@[a-z0-9_.-]{1,15})?$/.test(h)) return { handle: h };
    return null;
  }
  async function resolve(p) {
    if (p.handle) {
      const r = await req(HANDLE + "/handles/" + encodeURIComponent(p.handle));
      if (!r || !r.holder) throw new Error("No ADA Handle $" + p.handle + " found");
      const addr = r.resolved_addresses && r.resolved_addresses.ada;
      if (addr) { const i = addrInfo(addr) || {}; return { address: addr, stake: i.stake || (r.holder.startsWith("stake") ? r.holder : null), script: i.script, byron: i.byron, searchedHandle: p.handle }; }
      return { stake: r.holder.startsWith("stake") ? r.holder : null, searchedHandle: p.handle };
    }
    if (p.address) { const i = addrInfo(p.address); if (!i) throw new Error("That address doesn’t decode as a Cardano mainnet address"); return { address: p.address, stake: i.stake, script: i.script, byron: i.byron }; }
    return { stake: p.stake };
  }
  const SNEK_ID = POLICY + "." + SNEK_HEX;
  async function balanceOf(address) {
    const r = await yoroi("/txs/utxoSumForAddresses", { addresses: [address] });
    if (!r) return { ada: 0, snek: 0 };
    const t = (r.tokensBalance || []).find((x) => x.assetId === SNEK_ID);
    return { ada: +(r.sum || 0) / 1e6, snek: t ? +t.quantity : 0 };
  }
  async function load(p, onStep) {
    const w = await resolve(p); onStep && onStep(w);
    const tm = topMatch(w); if (tm) ["tx24", "tx24Capped", "rank", "pct"].forEach((k) => { if (tm[k] != null) w[k] = tm[k]; });
    if (w.address) { const b = await balanceOf(w.address); w.snek = b.snek; w.ada = b.ada; w.scope = "address"; onStep && onStep(w); }
    if (w.stake) {
      try {
        const h = stakeHex(w.stake), st = h && await yoroi("/account/state", { addresses: [h] });
        const a = st && st[h];
        if (a) { w.stakeStatus = a.stakeRegistered ? "registered" : "not registered"; w.pool = a.delegation ? poolBech(a.delegation) : null; }
      } catch (e) {}
      onStep && onStep(w);
      try { const hd = await req(HANDLE + "/holders/" + w.stake); w.handles = hd ? +hd.total_handles || (hd.handles || []).length : 0; w.handleSample = hd ? (hd.handles || []).slice(0, 12) : []; if (hd && hd.manually_set) w.defaultHandle = hd.default_handle; } catch (e) { w.handles = null; }
    }
    if (!w.address && tm) { w.snek = tm.snek; w.ada = tm.ada; w.scope = "snapshot"; }
    w.t = Date.now(); onStep && onStep(w);
    return w;
  }
  async function snekOf(x) { if (!x.address) throw new Error("no address"); return (await balanceOf(x.address)).snek; }

  // ---------- profile card ----------
  let current = null;
  function profileHTML(w, loading) {
    const nm = nameOf(w), p = price(), s = signals(w), id = w.address || w.stake, watched = watch().some((x) => x.id === id);
    const stat = (l, v, sub) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + "</div>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>";
    const staking = w.script && !w.stake ? "Contract" : !w.stake ? "No stake key" : w.stakeStatus === "registered" ? (w.pool ? "Delegated" : "Registered, not delegated") : w.stakeStatus ? "Not staking" : "…";
    const noBal = !w.address && !ok(w.snek);
    const pend = '<span class="skel w80">&nbsp;</span>';
    return '<div class="whead"><div><div class="wname">' + esc(nm.text) + (nm.kind === "label" ? ' <span class="vtag dex">label</span>' : "") + (exLike(w) ? ' <span class="vtag ex">exchange-like</span>' : "") + "</div>" +
      '<div class="mono small muted">' + esc(short(w.address || id)) + ' <button class="linkbtn" data-copy="' + esc(w.address || id) + '">copy</button></div>' + (w.rank ? '<div class="small muted">Top holder #' + w.rank + "</div>" : "") + "</div>" +
      '<button class="btn ' + (watched ? "" : "primary") + '" id="wTrackBtn"' + (loading ? " disabled" : "") + ">" + (watched ? "✓ Tracking" : "★ Track") + "</button></div>" +
      '<div class="kpis wk">' +
      stat("SNEK", ok(w.snek) ? n0(w.snek) : noBal ? "–" : pend, ok(w.snek) ? usdc(p ? w.snek * p : null) + " · " + (w.snek / circ() * 100).toFixed(3) + "% of supply" : "") +
      stat("ADA", ok(w.ada) ? n0(w.ada) : noBal ? "–" : pend, "") +
      stat("Staking", staking, w.stakeStatus === "not registered" ? "stake key unregistered" : w.pool ? '<a class="mono" href="https://cardanoscan.io/pool/' + encodeURIComponent(w.pool) + '" target="_blank" rel="noopener">' + esc(short(w.pool)) + "</a>" : "") +
      stat("ADA Handles", w.stake ? (ok(w.handles) ? n0(w.handles) : loading ? pend : "–") : "0", "") +
      (ok(w.tx24) ? stat("Txs, last 24 h", n0(w.tx24) + (w.tx24Capped ? "+" : ""), "from the 30-min snapshot") : "") +
      "</div>" +
      (noBal && !loading ? '<p class="small warn">Balances need an address: paste an <span class="mono">addr1…</span> or a $handle (a stake key alone can’t be summed with the free APIs).</p>' : w.scope === "address" && !loading ? '<p class="muted small">Balances are for this address. Staking and handles cover the whole stake key.</p>' : "") +
      (w.handleSample && w.handleSample.length ? '<div class="hchips">' + w.handleSample.map((h) => '<span class="hchip">$' + esc(h) + "</span>").join("") + (w.handles > w.handleSample.length ? '<span class="muted small">+' + n0(w.handles - w.handleSample.length) + " more</span>" : "") + "</div>" : "") +
      '<ul class="signals">' + s.list.map((x) => '<li class="' + (x[1] ? "on" : "") + '">' + (x[1] ? "●" : "○") + " " + esc(x[0]) + "</li>").join("") + "</ul>" +
      '<p class="small"><a href="https://cardanoscan.io/' + (w.stake ? "stakekey/" : "address/") + encodeURIComponent(id) + '" target="_blank" rel="noopener">Open on Cardanoscan</a> · <a href="https://pool.pm/' + encodeURIComponent(id) + '" target="_blank" rel="noopener">pool.pm</a>' + (loading ? ' · <span class="muted">loading on-chain data…</span>' : w.t ? ' · <span class="muted">checked ' + tz(w.t) + "</span>" : "") + "</p>";
  }
  function renderProfile(w, loading) { current = w; $("wProfile").innerHTML = profileHTML(w, loading); }
  async function lookup(q) {
    const p = parse(q); const el = $("wProfile");
    if (!p) { el.innerHTML = '<p class="small warn">That doesn’t look like an addr1…, stake1… or $handle.</p>'; return; }
    el.innerHTML = '<div class="skel h120"></div>';
    try { const w = await load(p, (x) => renderProfile(x, true)); renderProfile(w, false); }
    catch (e) { el.innerHTML = '<p class="small warn">' + esc(e.message || "Lookup failed") + ". The free APIs can be busy, so try again in a moment.</p>"; }
  }

  // ---------- watchlist ----------
  const watch = () => store.get(WATCH_KEY, []);
  const saveWatch = (l) => store.set(WATCH_KEY, l);
  function track(w) {
    const l = watch(), id = w.address || w.stake;
    if (l.some((x) => x.id === id)) { saveWatch(l.filter((x) => x.id !== id)); toast("Stopped tracking " + nameOf(w).text); }
    else {
      if (l.length >= MAX_WATCH) { toast("You can track up to " + MAX_WATCH + " wallets", "warn"); return; }
      l.push({ id, stake: w.stake || null, address: w.address || null, name: nameOf(w).text, added: Date.now(), snek0: w.snek, snek: w.snek, ada: w.ada, last: Date.now(), hist: [[Date.now(), w.snek]], ex: exLike(w) });
      saveWatch(l); toast("Tracking " + nameOf(w).text + ". You’ll get a heads-up here when its SNEK balance moves.", "ok");
      if (FX()) FX().haptic(15);
    }
    renderWatch(); if (current) renderProfile(current, false);
  }
  function renderWatch() {
    const l = watch(), el = $("wWatch"); $("wCount").textContent = l.length ? "(" + l.length + "/" + MAX_WATCH + ")" : "";
    if (!l.length) { el.innerHTML = '<div class="empty small"><img src="assets/brand/snek-face-love.webp" alt="" width="72" height="49" loading="lazy"><div>No wallets tracked yet. Look one up and tap <b>★ Track</b>, or tap a top holder below.</div><span class="fan">Fan-made dashboard · not affiliated with SNEK</span></div>'; return; }
    el.innerHTML = '<div class="wlist">' + l.map((x) => {
      const d0 = x.snek - x.snek0, dl = x.prev != null ? x.snek - x.prev : 0;
      return '<div class="witem" data-id="' + esc(x.id) + '"><div class="wl"><button class="linkbtn wopen" data-id="' + esc(x.id) + '">' + esc(x.name) + "</button>" + (x.ex ? ' <span class="vtag ex">exchange-like</span>' : "") +
        '<div class="muted small mono">' + esc(short(x.id)) + '</div></div><div class="wspark" id="ws_' + esc(x.id.slice(-10)) + '"></div><div class="wr"><div class="wv">' + cmp(x.snek) + ' <span class="muted small">SNEK</span></div>' +
        '<div class="small ' + (d0 > 0 ? "up" : d0 < 0 ? "down" : "muted") + '">' + signed(d0) + " since tracked</div>" + (dl ? '<div class="small ' + (dl > 0 ? "up" : "down") + '">' + signed(dl) + " last check</div>" : "") +
        '<div class="muted small">' + tz(x.last) + '</div></div><button class="icon-btn sm wdel" aria-label="Stop tracking" data-id="' + esc(x.id) + '">✕</button></div>';
    }).join("") + "</div>";
    l.forEach((x) => { const s = document.getElementById("ws_" + x.id.slice(-10)); if (s && FX() && x.hist.length > 1) FX().spark(s, x.hist.map((h) => h[1])); });
  }
  let refreshing = false;
  async function refreshWatch() {
    if (refreshing || document.visibilityState === "hidden") return; refreshing = true;
    try {
      for (const x of watch()) {
        try {
          const snek = await snekOf(x);
          const l = watch(), y = l.find((z) => z.id === x.id); if (!y) continue;
          const diff = snek - y.snek; y.prev = y.snek; y.snek = snek; y.last = Date.now();
          if (diff !== 0) { y.hist.push([Date.now(), snek]); if (y.hist.length > 100) y.hist = y.hist.slice(-100); }
          saveWatch(l);
          if (Math.abs(diff) >= Math.max(1e6, 0.005 * Math.max(1, snek - diff))) {
            toast((diff > 0 ? "🐋 " : "📤 ") + y.name + " " + signed(diff) + " SNEK", "whale");
            if (FX()) FX().haptic([20, 40, 20]);
          }
        } catch (e) {}
      }
    } finally { refreshing = false; renderWatch(); }
  }

  // ---------- top holders ----------
  function renderTop() {
    const S = window.SNEK_SNAPSHOT, H = S && S.holders, rows = H && H.wallets, el = $("wTop"); if (!el) return;
    if (!rows || !rows.length) { el.innerHTML = '<tr><td class="muted small">Top-holder details unavailable right now.</td></tr>'; return; }
    $("wTopNote").textContent = "Updated " + tz(H.asOf) + " · Cardanoscan + Koios";
    el.innerHTML = "<tr><th>#</th><th>Wallet</th><th>SNEK</th><th>ADA</th><th>Staking</th><th>Handles</th><th>Txs 24h</th></tr>" + rows.map((w) => {
      const nm = nameOf(w), s = signals(w);
      const staking = w.script ? "Contract" : !w.stake ? "No stake key" : w.stakeStatus === "registered" ? (w.pool ? (w.poolTicker ? esc(w.poolTicker) : "Delegated") : "Not delegated") : w.stakeStatus ? "Unregistered" : "–";
      const tag = s.contract ? (nm.kind === "label" ? '<span class="vtag dex">contract</span>' : "") : exLike(w) ? '<span class="vtag ex">exchange-like</span>' : "";
      return '<tr class="wrow" data-addr="' + esc(w.address || "") + '" tabindex="0"><td>' + w.rank + '</td><td><button class="linkbtn">' + esc(nm.text) + "</button> " + tag + '<div class="muted small mono">' + esc(w.short) + "</div></td><td>" + cmp(w.snek) + ' <span class="muted small">' + w.pct + "%</span></td><td>" + (ok(w.ada) ? cmp(w.ada) : "–") + "</td><td>" + staking + "</td><td>" + (ok(w.handles) ? n0(w.handles) : "–") + "</td><td>" + (ok(w.tx24) ? n0(w.tx24) + (w.tx24Capped ? "+" : "") : "–") + "</td></tr>";
    }).join("");
  }

  // ---------- follow card (personal, dismissible) ----------
  function setupFollow() {
    const c = $("followCard"); if (!c) return;
    if (Date.now() > store.get("snek-follow-until", 0)) c.hidden = false;
    $("followClose").addEventListener("click", () => { c.hidden = true; store.set("snek-follow-until", Date.now() + 30 * 86400000); });
  }

  function init() {
    if (!$("wallets")) return;
    setupFollow();
    const ex = [["$genesisfleet", "$genesisfleet"]];
    const S = window.SNEK_SNAPSHOT, top = S && S.holders && S.holders.wallets;
    if (top) top.slice(0, 3).forEach((w) => { if (w.address && !w.script) ex.push(["#" + w.rank + " holder", w.address]); });
    $("wExamples").innerHTML = '<span class="muted small">Try:</span>' + ex.map((e) => '<button type="button" data-q="' + esc(e[1]) + '">' + esc(e[0]) + "</button>").join("");
    $("wExamples").addEventListener("click", (e) => { const b = e.target.closest("button[data-q]"); if (b) { $("wInput").value = b.dataset.q; lookup(b.dataset.q); } });
    $("wSearch").addEventListener("submit", (e) => { e.preventDefault(); $("wInput").blur(); lookup($("wInput").value); });
    $("wProfile").addEventListener("click", (e) => {
      if (e.target.id === "wTrackBtn" && current) track(current);
      const c = e.target.closest("[data-copy]"); if (c) { navigator.clipboard && navigator.clipboard.writeText(c.dataset.copy).then(() => toast("Copied", "ok"), () => {}); }
    });
    $("wWatch").addEventListener("click", (e) => {
      const d = e.target.closest(".wdel"); if (d) { saveWatch(watch().filter((x) => x.id !== d.dataset.id)); renderWatch(); return; }
      const o = e.target.closest(".wopen"); if (o) { $("wInput").value = o.dataset.id; lookup(o.dataset.id); $("wallets").scrollIntoView({ behavior: "smooth" }); }
    });
    const openRow = (tr) => { if (tr && tr.dataset.addr) { $("wInput").value = tr.dataset.addr; lookup(tr.dataset.addr); $("wProfile").scrollIntoView({ behavior: "smooth", block: "center" }); } };
    $("wTop").addEventListener("click", (e) => openRow(e.target.closest(".wrow")));
    $("wTop").addEventListener("keydown", (e) => { if (e.key === "Enter") openRow(e.target.closest(".wrow")); });
    renderTop(); renderWatch();
    setTimeout(refreshWatch, 8000); setInterval(refreshWatch, 300000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && watch().some((x) => Date.now() - x.last > 300000)) refreshWatch(); });
    const m = location.hash.match(/^#wallet=(.+)$/); if (m) { const q = decodeURIComponent(m[1]); $("wInput").value = q; lookup(q); setTimeout(() => $("wallets").scrollIntoView(), 300); }
  }
  window.SNEKWALLETS = { lookup, refreshWatch, signals, parse, balanceOf, addrInfo };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
