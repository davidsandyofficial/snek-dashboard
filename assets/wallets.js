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
    return { ada: +(r.sum || 0) / 1e6, snek: t ? +t.quantity : 0, tokens: r.tokensBalance || [] };
  }
  async function load(p, onStep) {
    const w = await resolve(p); onStep && onStep(w);
    const tm = topMatch(w); if (tm) ["tx24", "tx24Capped", "rank", "pct"].forEach((k) => { if (tm[k] != null) w[k] = tm[k]; });
    if (w.address) { const b = await balanceOf(w.address); w.snek = b.snek; w.ada = b.ada; w.tokens = b.tokens; w.scope = "address"; onStep && onStep(w); }
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
      (loading ? "" : '<div class="row gap wrap wacts">' + (w.address ? '<button class="btn" data-act="activity">⏱ Activity &amp; PnL</button>' : "") + '<button class="btn" data-act="cmpopen">⇆ Compare</button><button class="btn" data-act="share">↗ Share</button></div>' +
        '<div id="wCmpBox" hidden><form class="wsearch mt" id="wCmpForm"><input id="wCmpIn" class="grow" placeholder="Compare with addr1…, stake1… or $handle" list="wCmpList" autocomplete="off" spellcheck="false" autocapitalize="off"><datalist id="wCmpList">' + watch().filter((x) => x.id !== id).map((x) => '<option value="' + esc(x.id) + '">' + esc(x.name) + "</option>").join("") + '</datalist><button class="btn primary">Compare</button></form>' +
        (watch().filter((x) => x.id !== id).length ? '<div class="chips wchips">' + watch().filter((x) => x.id !== id).slice(0, 6).map((x) => '<button type="button" data-cmp="' + esc(x.id) + '">' + esc(x.name) + "</button>").join("") + "</div>" : "") + '<div id="wCmp"></div></div>' +
        '<div id="wHold" class="wsec"></div><div id="wAct" class="wsec"></div>') +
      '<p class="small"><a href="https://cardanoscan.io/' + (w.stake ? "stakekey/" : "address/") + encodeURIComponent(id) + '" target="_blank" rel="noopener">Open on Cardanoscan</a> · <a href="https://pool.pm/' + encodeURIComponent(id) + '" target="_blank" rel="noopener">pool.pm</a>' + (loading ? ' · <span class="muted">loading on-chain data…</span>' : w.t ? ' · <span class="muted">checked ' + tz(w.t) + "</span>" : "") + "</p>";
  }
  function renderProfile(w, loading) { current = w; $("wProfile").innerHTML = profileHTML(w, loading); }
  async function lookup(q) {
    const p = parse(q); const el = $("wProfile");
    if (!p) { el.innerHTML = '<p class="small warn">That doesn’t look like an addr1…, stake1… or $handle.</p>'; return; }
    el.innerHTML = '<div class="skel h120"></div>';
    try { const w = await load(p, (x) => renderProfile(x, true)); w.query = q.trim(); renderProfile(w, false); renderHoldings(w); }
    catch (e) { el.innerHTML = '<p class="small warn">' + esc(e.message || "Lookup failed") + ". The free APIs can be busy, so try again in a moment.</p>"; }
  }

  // ---------- holdings (all native tokens) ----------
  const REG = "https://tokens.cardano.org/metadata/query", DHP = "https://api-us.dexhunterv3.app/swap/averagePrice/ADA/";
  const regCache = {}, pxCache = {};
  async function registry(ids) {
    const need = ids.filter((i) => !(i in regCache)).slice(0, 60);
    if (need.length) {
      try {
        const r = await req(REG, { subjects: need, properties: ["name", "ticker", "decimals"] });
        need.forEach((i) => (regCache[i] = null));
        ((r && r.subjects) || []).forEach((s) => { regCache[s.subject] = { name: s.name && s.name.value, ticker: s.ticker && s.ticker.value, decimals: s.decimals ? +s.decimals.value : 0 }; });
      } catch (e) {}
    }
    const o = {}; ids.forEach((i) => (o[i] = regCache[i] || null)); return o;
  }
  async function adaPrice(unit) {
    const c = pxCache[unit]; if (c && Date.now() - c.t < 300000) return c.v;
    let v = null; try { const r = await fetch(DHP + unit, { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined }).then((x) => (x.ok ? x.json() : null)); v = r && ok(+r.price_ba) && +r.price_ba > 0 ? +r.price_ba : null; } catch (e) {}
    pxCache[unit] = { t: Date.now(), v }; return v;
  }
  const asciiName = (h) => { const x = h.startsWith("0014df10") || h.startsWith("000de140") || h.startsWith("000643b0") ? h.slice(8) : h; try { const s = decodeURIComponent(x.replace(/../g, "%$&")); return /^[\x20-\x7e]{1,32}$/.test(s) ? s : null; } catch (e) { return null; } };
  async function renderHoldings(w) {
    const el = $("wHold"); if (!el || !w.tokens) return;
    const adaUsd = app().state && app().state.market && app().state.market.adaUsd;
    const toks = w.tokens.filter((t) => t.assetId !== SNEK_ID).map((t) => { const [pol, nm] = t.assetId.split("."); return { unit: pol + (nm || ""), pol, nm: nm || "", q: +t.quantity }; });
    const handles = toks.filter((t) => t.pol === "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a").length;
    el.innerHTML = '<h3>Holdings</h3><div class="skel h56"></div>';
    const meta = await registry(toks.map((t) => t.unit));
    const fung = toks.filter((t) => meta[t.unit]).map((t) => Object.assign(t, meta[t.unit], { amt: t.q / Math.pow(10, meta[t.unit].decimals || 0) }));
    const other = toks.length - fung.length - handles;
    for (const t of fung.slice(0, 12)) t.ada = await adaPrice(t.unit);
    const p = price(), rows = [{ name: "ADA", amt: w.ada, usd: ok(adaUsd) ? w.ada * adaUsd : null }, { name: "SNEK", amt: w.snek, usd: p ? w.snek * p : null }]
      .concat(fung.map((t) => ({ name: t.ticker || t.name || asciiName(t.nm) || short(t.unit), sub: t.name && t.ticker ? t.name : "", amt: t.amt, usd: ok(t.ada) && ok(adaUsd) ? t.amt * t.ada * adaUsd : null })));
    rows.sort((a, b) => (b.usd || 0) - (a.usd || 0));
    const total = rows.reduce((s, r) => s + (r.usd || 0), 0);
    if (current !== w) return;
    el.innerHTML = '<div class="row between wrap"><h3>Holdings</h3><span class="small">' + (total ? "≈ " + usdc(total) + ' <span class="muted">priced tokens</span>' : "") + "</span></div>" +
      '<div class="table-wrap"><table class="htable"><tr><th>Token</th><th>Amount</th><th>Value</th></tr>' + rows.slice(0, 14).map((r) => "<tr><td><b>" + esc(r.name) + "</b>" + (r.sub ? '<div class="muted small">' + esc(r.sub) + "</div>" : "") + "</td><td>" + cmp(r.amt) + "</td><td>" + (ok(r.usd) ? (r.usd > 0 && r.usd < 0.01 ? "<$0.01" : usdc(r.usd)) : '<span class="muted">unavailable</span>') + "</td></tr>").join("") + "</table></div>" +
      '<p class="muted small">' + (rows.length > 14 ? rows.length - 14 + " more registered tokens · " : "") + (handles ? n0(handles) + " ADA Handles · " : "") + (other > 0 ? n0(other) + " NFTs or unregistered tokens · " : "") + "Names from the Cardano Token Registry, prices from DexHunter (ADA) × ADA/USD. This address only.</p>";
  }

  // ---------- activity: recent transactions with SNEK in/out ----------
  const anchorsList = () => ((window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.anchors) || []).slice().sort((a, b) => a.days - b.days);
  async function pages(addr, best, after, maxPages, onPage) {
    const out = []; let cur = after, capped = false;
    for (let i = 0; i < maxPages; i++) {
      const body = { addresses: [addr], untilBlock: best.hash }; if (cur) body.after = { block: cur.block, tx: cur.tx };
      const r = await yoroi("/v2/txs/history", body);
      if (!Array.isArray(r)) throw new Error((r && r.error && r.error.response) || "history unavailable");
      out.push(...r); onPage && onPage(out.length);
      if (r.length < 50) { capped = false; break; }
      capped = true; const l = r[r.length - 1]; cur = { block: l.block_hash, tx: l.hash };
    }
    return { txs: out, capped, next: cur };
  }
  function summarize(addr, t) {
    let dAda = 0, dSnek = 0, otherTok = 0, script = false;
    const add = (io, sign) => io.forEach((x) => {
      if (x.address !== addr) { const i = addrInfo(x.address); if (i && i.script) script = true; return; }
      dAda += sign * +x.amount;
      (x.assets || []).forEach((a) => { if (a.assetId === SNEK_ID) dSnek += sign * +a.amount; else otherTok += 1; });
    });
    add(t.outputs || [], 1); add(t.inputs || [], -1);
    const ada = dAda / 1e6, kind = dSnek > 0 && ada < -2 ? "Swap in" : dSnek < 0 && ada > 1 ? "Swap out" : dSnek > 0 ? "SNEK in" : dSnek < 0 ? "SNEK out" : ada > 0 ? "ADA in" : "ADA out";
    return { hash: t.hash, time: Date.parse(t.time), block: t.block_num, ada, snek: dSnek, fee: +t.fee / 1e6, kind, script, ok: t.tx_state === "Successful" && t.valid_contract !== false, other: otherTok };
  }
  async function loadActivity(w, more) {
    const el = $("wAct"); if (!el || !w.address) return;
    const st = w.act || (w.act = { rows: [], from: null });
    el.innerHTML = '<h3>Activity</h3><p class="muted small" id="wActProg">Reading recent transactions…</p>';
    try {
      const best = await yoroi("/v2/bestblock");
      if (more && st.next) {
        const r = await pages(w.address, best, st.next, 6, (n) => prog(n));
        st.rows = st.rows.concat(r.txs.map((t) => summarize(w.address, t))); st.capped = r.capped; st.next = r.next;
      } else {
        const A = anchorsList(); let res = null, used = null;
        for (const a of A.concat([null])) {
          const r = await pages(w.address, best, a ? { block: a.block, tx: a.tx } : null, 6, (n) => prog(n, a));
          if (a === null && r.capped && res) break; // tiny-window result beats the oldest 300 since genesis
          res = r; used = a;
          if (r.txs.length >= 25 || r.capped) break;
        }
        st.rows = res.txs.map((t) => summarize(w.address, t)); st.capped = res.capped; st.next = res.next; st.from = used ? used.time * 1000 : null; st.days = used ? used.days : null;
      }
      const seen = new Set(); st.rows = st.rows.filter((r) => (seen.has(r.hash) ? false : seen.add(r.hash)));
      st.rows.sort((a, b) => b.time - a.time);
      await pnl(st);
      if (current === w) renderActivity(w);
    } catch (e) { el.innerHTML = '<h3>Activity</h3><p class="small warn">Couldn’t read transactions: ' + esc(e.message) + ". Try again in a moment.</p>"; }
    function prog(n, a) { const p = $("wActProg"); if (p) p.textContent = "Reading transactions" + (a ? " from the last " + a.days + (a.days === 1 ? " day" : " days") : " since the wallet’s first one") + "… " + n; }
  }
  async function pnl(st) {
    const H = window.SNEKHIST; if (!H) return;
    for (const r of st.rows) { if (r.snek && r.px === undefined) { const q = await H.priceAt(Math.floor(r.time / 1000), "usd"); r.px = q ? q.price : null; r.pxSrc = q ? q.src : null; } }
    const ins = st.rows.filter((r) => r.snek > 0 && ok(r.px)), outs = st.rows.filter((r) => r.snek < 0 && ok(r.px));
    const qIn = ins.reduce((s, r) => s + r.snek, 0), cIn = ins.reduce((s, r) => s + r.snek * r.px, 0);
    const qOut = outs.reduce((s, r) => s - r.snek, 0), vOut = outs.reduce((s, r) => s - r.snek * r.px, 0);
    const avgIn = qIn ? cIn / qIn : null, p = price();
    st.pnl = { qIn, cIn, qOut, vOut, avgIn, avgOut: qOut ? vOut / qOut : null, realized: avgIn && qOut ? (vOut / qOut - avgIn) * Math.min(qOut, qIn) : null, unreal: avgIn && p ? (qIn - Math.min(qOut, qIn)) * (p - avgIn) : null, missing: st.rows.filter((r) => r.snek && !ok(r.px)).length };
  }
  function renderActivity(w) {
    const el = $("wAct"), st = w.act; if (!el || !st) return;
    const rows = st.rows, P = st.pnl || {}, showN = st.show || 15;
    const since = st.from ? "since " + tz(st.from) : rows.length ? "since " + tz(rows[rows.length - 1].time) : "";
    const net = rows.reduce((s, r) => s + r.snek, 0), sIn = rows.filter((r) => r.snek > 0).reduce((s, r) => s + r.snek, 0), sOut = -rows.filter((r) => r.snek < 0).reduce((s, r) => s + r.snek, 0);
    const k = (l, v, cls) => '<div class="kpi"><div class="l">' + l + '</div><div class="v ' + (cls || "") + '">' + v + "</div></div>";
    el.innerHTML = '<div class="row between wrap"><h3>Activity</h3><span class="muted small">' + n0(rows.length) + " txs " + esc(since) + (st.capped ? " · more available" : "") + "</span></div>" +
      '<div class="kpis wk">' + k("SNEK in", "+" + cmp(sIn), "up") + k("SNEK out", "−" + cmp(sOut), "down") + k("Net SNEK", signed(net), net > 0 ? "up" : net < 0 ? "down" : "") +
      k("Avg in price", ok(P.avgIn) ? "$" + Number(P.avgIn.toPrecision(3)) : "–") + k("PnL estimate", ok(P.realized) || ok(P.unreal) ? '<span class="' + ((P.realized || 0) + (P.unreal || 0) >= 0 ? "up" : "down") + '">' + ((P.realized || 0) + (P.unreal || 0) >= 0 ? "+" : "−") + usdc(Math.abs((P.realized || 0) + (P.unreal || 0))) + "</span>" : "–") + "</div>" +
      '<p class="muted small">PnL estimate covers only the transactions loaded here: SNEK received is valued at the hourly USD close when it arrived, SNEK sent at the close when it left' + (ok(P.realized) ? " (realized " + (P.realized >= 0 ? "+" : "−") + usdc(Math.abs(P.realized)) + ", unrealized " + (P.unreal >= 0 ? "+" : "−") + usdc(Math.abs(P.unreal || 0)) + ")" : "") + ". Transfers between your own wallets count as in/out. Not financial or tax advice." + (P.missing ? " " + P.missing + " txs had no candle to price them." : "") + "</p>" +
      '<div class="wtx">' + rows.slice(0, showN).map((r) => '<a class="wtxr" href="https://cardanoscan.io/transaction/' + r.hash + '" target="_blank" rel="noopener"><span class="wk ' + (r.snek > 0 ? "up" : r.snek < 0 ? "down" : "muted") + '">' + esc(r.kind) + (r.ok ? "" : " ⚠") + '</span><span class="wt muted small">' + tz(r.time) + '</span><span class="wv">' + (r.snek ? '<b class="' + (r.snek > 0 ? "up" : "down") + '">' + signed(r.snek) + " SNEK</b>" : "") + '<span class="muted small">' + (r.ada >= 0 ? "+" : "−") + cmp(Math.abs(r.ada)) + " ADA" + (ok(r.px) && r.snek ? " · ≈" + usdc(Math.abs(r.snek * r.px)) : "") + "</span></span></a>").join("") + "</div>" +
      '<div class="row gap wrap mt">' + (rows.length > showN ? '<button class="btn" data-act="actmore">Show more</button>' : "") + (st.capped ? '<button class="btn" data-act="actnext">Load newer txs</button>' : "") + '<button class="btn" data-act="csv">⬇ CSV</button></div>' +
      '<p class="muted small">From Yoroi’s public backend · this address only · times CT.</p>';
  }
  function csv(w) {
    const st = w.act; if (!st || !st.rows.length) return;
    const head = ["time_utc", "time_ct", "tx_hash", "type", "snek_change", "ada_change", "fee_ada", "snek_usd_price_at_time", "snek_usd_value", "other_tokens_moved", "status"];
    const ct = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
    const lines = [head.join(",")].concat(st.rows.map((r) => [new Date(r.time).toISOString(), '"' + ct(r.time) + '"', r.hash, r.kind, r.snek, r.ada.toFixed(6), r.fee.toFixed(6), ok(r.px) ? r.px : "", ok(r.px) && r.snek ? (r.snek * r.px).toFixed(2) : "", r.other, r.ok ? "ok" : "failed"].join(",")));
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "snek-wallet-" + (w.address || "").slice(-8) + "-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("CSV saved (" + st.rows.length + " txs)", "ok");
  }
  function shareLink(w) {
    const q = w.query && w.query.startsWith("$") ? w.query : w.address || w.stake;
    const url = location.href.split("#")[0] + "#wallet=" + encodeURIComponent(q);
    const data = { title: nameOf(w).text + " · SNEK wallet (fan-made dashboard)", text: nameOf(w).text + " on the fan-made SNEK dashboard", url };
    if (navigator.share) navigator.share(data).catch(() => {}); else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("Link copied", "ok"), () => toast(url));
    history.replaceState(null, "", "#wallet=" + encodeURIComponent(q));
  }

  // ---------- compare two wallets ----------
  async function compare(a, q) {
    const el = $("wCmp"); if (!el) return;
    const p = parse(q); if (!p) { el.innerHTML = '<p class="small warn">Enter an addr1…, stake1… or $handle to compare.</p>'; return; }
    el.innerHTML = '<div class="skel h120"></div>';
    try {
      const b = await load(p);
      const pr = price(), rows = [
        ["SNEK", (x) => cmp(x.snek)], ["% of supply", (x) => (ok(x.snek) ? (x.snek / circ() * 100).toFixed(3) + "%" : "–")], ["SNEK value", (x) => usdc(pr && ok(x.snek) ? x.snek * pr : null)],
        ["ADA", (x) => cmp(x.ada)], ["Staking", (x) => (!x.stake ? "No stake key" : x.stakeStatus === "registered" ? (x.pool ? "Delegated" : "Not delegated") : x.stakeStatus ? "Not staking" : "–")],
        ["ADA Handles", (x) => (ok(x.handles) ? n0(x.handles) : "–")], ["Top-holder rank", (x) => (x.rank ? "#" + x.rank : "–")], ["Txs, 24 h", (x) => (ok(x.tx24) ? n0(x.tx24) : "–")],
        ["Exchange-like signals", (x) => signals(x).count + " of 4"],
      ];
      const ratio = ok(a.snek) && ok(b.snek) && b.snek > 0 ? a.snek / b.snek : null;
      el.innerHTML = '<div class="table-wrap"><table class="ctable"><tr><th></th><th>' + esc(nameOf(a).text) + "</th><th>" + esc(nameOf(b).text) + "</th></tr>" + rows.map((r) => "<tr><td class=\"muted\">" + r[0] + "</td><td>" + r[1](a) + "</td><td>" + r[1](b) + "</td></tr>").join("") + "</table></div>" +
        (ratio ? '<p class="small">' + esc(nameOf(a).text) + " holds <b>" + (ratio >= 1 ? ratio.toFixed(ratio > 10 ? 0 : 2) + "×" : (1 / ratio).toFixed(1 / ratio > 10 ? 0 : 2) + "× less") + "</b> SNEK than " + esc(nameOf(b).text) + ".</p>" : "");
    } catch (e) { el.innerHTML = '<p class="small warn">' + esc(e.message || "Compare failed") + "</p>"; }
  }

  // ---------- whale feed: big trades + top-holder moves + your tracked wallets ----------
  const LOG_KEY = "snek-watchlog";
  function renderFeed() {
    const el = $("wFeed"); if (!el) return;
    const min = +(store.get("snek-feedmin", 2000)), S = window.SNEK_SNAPSHOT || {}, items = [];
    const tr = (app().tradeRows && app().tradeRows()) || [];
    tr.filter((r) => ok(r.usd) && r.usd >= min).forEach((r) => items.push({ t: r.time, icon: r.buy ? "🐋" : "📤", cls: r.buy ? "up" : "down", text: (r.buy ? "Buy " : "Sell ") + usdc(r.usd) + " · " + cmp(r.snek) + " SNEK", sub: r.venue + (r.dex ? " · on-chain" : " · CEX"), addr: r.addr, link: r.dex && r.id && /^[0-9a-f]{64}$/.test(r.id) ? "https://cardanoscan.io/transaction/" + r.id : null }));
    (S.whaleMoves || []).forEach((m) => items.push({ t: Date.parse(m.t), icon: m.delta > 0 ? "⬆" : "⬇", cls: m.delta > 0 ? "up" : "down", text: "Top holder #" + m.rank + " " + signed(m.delta) + " SNEK", sub: (m.label || short(m.address)) + " · 30-min snapshot", addr: m.address }));
    store.get(LOG_KEY, []).forEach((m) => items.push({ t: m.t, icon: "★", cls: m.d > 0 ? "up" : "down", text: m.name + " " + signed(m.d) + " SNEK", sub: "Your tracked wallet", addr: m.id }));
    items.sort((a, b) => b.t - a.t);
    $("wFeedNote").textContent = "Trades ≥ " + usdc(min) + " · top-10 holder moves ≥ 1M SNEK · your tracked wallets";
    el.innerHTML = items.length ? '<div class="wfeed">' + items.slice(0, 30).map((i) => '<div class="wfi"><span class="wfic">' + i.icon + '</span><div class="grow"><div class="' + i.cls + '"><b>' + esc(i.text) + '</b></div><div class="muted small">' + esc(i.sub) + " · " + tz(i.t) + "</div></div>" +
      (i.addr ? '<button class="linkbtn wopen" data-id="' + esc(i.addr) + '">Wallet</button>' : "") + (i.link ? ' <a class="linkbtn" href="' + i.link + '" target="_blank" rel="noopener">Tx</a>' : "") + "</div>").join("") + "</div>"
      : '<p class="muted small">No whale moves in the latest data. Lower the threshold or check back soon.</p>';
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
          if (Math.abs(diff) >= Math.max(1e6, 0.005 * Math.max(1, snek - diff))) { const lg = store.get(LOG_KEY, []); lg.unshift({ t: Date.now(), id: y.id, name: y.name, d: diff }); store.set(LOG_KEY, lg.slice(0, 40)); renderFeed();
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
      const act = e.target.closest("[data-act]"), w = current;
      if (act && w) {
        const a = act.dataset.act;
        if (a === "activity") { act.disabled = true; loadActivity(w).then(() => { act.disabled = false; }); }
        else if (a === "actmore") { w.act.show = (w.act.show || 15) + 30; renderActivity(w); }
        else if (a === "actnext") loadActivity(w, true);
        else if (a === "csv") csv(w);
        else if (a === "share") shareLink(w);
        else if (a === "cmpopen") { const b = $("wCmpBox"); b.hidden = !b.hidden; if (!b.hidden) $("wCmpIn").focus(); }
      }
      const cb = e.target.closest("[data-cmp]"); if (cb && w) { $("wCmpIn").value = cb.dataset.cmp; compare(w, cb.dataset.cmp); }
      const c = e.target.closest("[data-copy]"); if (c) { navigator.clipboard && navigator.clipboard.writeText(c.dataset.copy).then(() => toast("Copied", "ok"), () => {}); }
    });
    $("wProfile").addEventListener("submit", (e) => { if (e.target.id === "wCmpForm") { e.preventDefault(); if (current) compare(current, $("wCmpIn").value); } });
    const feed = $("wFeed");
    if (feed) {
      feed.addEventListener("click", (e) => { const o = e.target.closest(".wopen"); if (o) { $("wInput").value = o.dataset.id; lookup(o.dataset.id); $("wallets").scrollIntoView({ behavior: "smooth" }); } });
      const sel = $("wFeedMin"); if (sel) { sel.value = String(store.get("snek-feedmin", 2000)); sel.addEventListener("change", () => { store.set("snek-feedmin", +sel.value); renderFeed(); }); }
      setTimeout(renderFeed, 4000); setInterval(() => { if (document.visibilityState === "visible") renderFeed(); }, 15000);
    }
    window.addEventListener("hashchange", () => { const m = location.hash.match(/^#wallet=(.+)$/); if (m) { const q = decodeURIComponent(m[1]); if (!current || current.query !== q) { $("wInput").value = q; lookup(q); $("wallets").scrollIntoView({ behavior: "smooth" }); } } });
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
  window.SNEKWALLETS = { lookup, refreshWatch, signals, parse, balanceOf, addrInfo, renderFeed, current: () => current };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
