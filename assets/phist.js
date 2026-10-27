/* Portfolio history v2 for the fan-made SNEK dashboard (Wallets tab). Read-only, keyless, real data only.
   Transactions: Yoroi's public backend (/v2/txs/history), paged backwards in segments between chain anchors
   (1/7/30/90/365 days back, from the 30-min snapshot) and finally from the first transaction.
   Whole wallet (stake key): Koios blocks browser requests, so addresses are discovered from the wallet's own
   transactions (any input/output address carrying the same stake credential), seeded by the stake key's own txs.
   Balances: rebuilt backwards from today's on-chain balance by undoing each transaction's change (ADA, SNEK and
   priced tokens). Prices: SNEK daily OHLC (assets/history/1D), ADA/USD daily OHLC (Kraken, ~720 days, older days
   implied by SNEK USD ÷ SNEK ADA), other tokens: GeckoTerminal daily OHLC (~180 days), fiat: ECB via Frankfurter.
   Missing prices or uncovered days stay empty and are labeled; nothing is interpolated.
   Cache: IndexedDB ("snek-phist") keeps fetched transactions and prices; reopening only fetches what is new. */
(function () {
  "use strict";
  const SNEK_ID = "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f.534e454b";
  const PAGE_BUDGET = 40, DAY = 86400, MAX_ADDR = 200, BATCH = 50, SHELLEY0 = 1591566291, MAX_TOKENS = 8;
  const $ = (id) => document.getElementById(id);
  const ok = (v) => v !== null && v !== undefined && isFinite(v);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cmp = (v) => (ok(v) ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : "–");
  const dstr = (t) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(t * 1000));
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);
  const ctstr = (ms) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms)) + " CT";
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const W = () => window.SNEKWALLETS || {};
  const yoroi = (path, body) => (W().yoroi ? W().yoroi(path, body) : Promise.reject(new Error("wallet module not ready")));
  const today0 = () => Math.floor(Date.now() / 1000 / DAY) * DAY;
  const CURS = [["USD", "$"], ["ADA", "₳"], ["EUR", "€"], ["GBP", "£"], ["JPY", "¥"], ["CAD", "C$"], ["AUD", "A$"], ["CHF", "CHF "], ["INR", "₹"], ["BRL", "R$"], ["KRW", "₩"], ["MXN", "MX$"]];
  const COLS = ["#18f2b2", "#c684f0", "#88eaff", "#f2c94c", "#5491d9", "#ff7a59", "#f06292", "#9ccc65", "#bdbdbd", "#ffd54f"];

  // ---------- IndexedDB key/value cache ----------
  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => { if (!window.indexedDB) return rej(new Error("no IndexedDB")); const r = indexedDB.open("snek-phist", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const run = (mode, fn) => open().then((db) => new Promise((res, rej) => { const t = db.transaction("kv", mode), q = fn(t.objectStore("kv")); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }));
    return { get: (k) => run("readonly", (s) => s.get(k)).catch(() => null), set: (k, v) => run("readwrite", (s) => s.put(v, k)).catch(() => null), del: (k) => run("readwrite", (s) => s.delete(k)).catch(() => null), keys: () => run("readonly", (s) => s.getAllKeys()).catch(() => []) };
  })();
  async function cached(key, ttl, fn) {
    const c = await idb.get(key); if (c && Date.now() - c.t < ttl) return c.v;
    try { const v = await fn(); if (v != null) idb.set(key, { t: Date.now(), v }); return v; } catch (e) { if (c) return c.v; throw e; }
  }

  // ---------- prices ----------
  let snekP = null, adaP = null;
  function snekDaily() {
    return snekP || (snekP = (async () => {
      const ix = await fetch("assets/history/1D/index.json", { cache: "no-cache" }).then((r) => r.json());
      const bodies = await Promise.all(ix.chunks.map((c, i) => fetch("assets/history/1D/" + c.file + (i === ix.chunks.length - 1 ? "?v=" + encodeURIComponent(ix.updatedAt) : ""), { cache: "no-cache" }).then((r) => r.json())));
      const m = {};
      bodies.forEach((b) => { (b.usd || []).forEach((k) => { m[k[0]] = Object.assign(m[k[0]] || {}, { o: k[1], h: k[2], l: k[3], c: k[4], src: k[6] }); }); (b.ada || []).forEach((k) => { (m[k[0]] = m[k[0]] || {}).ac = k[4]; }); });
      return m;
    })().catch((e) => { snekP = null; throw e; }));
  }
  function adaDaily() {
    return adaP || (adaP = cached("px:ADAUSD", 6 * 3600e3, async () => {
      const r = await fetch("https://api.kraken.com/0/public/OHLC?pair=ADAUSD&interval=1440").then((x) => x.json());
      const key = r && r.result && Object.keys(r.result).find((k) => k !== "last"); const m = {};
      (key ? r.result[key] : []).forEach((k) => { m[k[0]] = { o: +k[1], h: +k[2], l: +k[3], c: +k[4] }; });
      return Object.keys(m).length ? m : null;
    }).then((v) => v || {}).catch(() => ({})));
  }
  // Coinbase Exchange ADA-USD daily candles for days older than Kraken's window (listed Mar 2021); 300 days per request
  async function adaOlder(from, until) {
    const out = {}; if (!(from < until)) return out;
    const start0 = Math.floor(from / (300 * DAY)) * 300 * DAY;
    for (let a = start0; a < until; a += 300 * DAY) {
      const b = a + 299 * DAY, key = "px:ADA-CB:" + a, past = b < today0() - 2 * DAY;
      try {
        const m = await cached(key, past ? 3650 * 86400e3 : 6 * 3600e3, async () => {
          const r = await fetch("https://api.exchange.coinbase.com/products/ADA-USD/candles?granularity=86400&start=" + new Date(a * 1000).toISOString() + "&end=" + new Date(b * 1000).toISOString()).then((x) => (x.ok ? x.json() : null));
          if (!Array.isArray(r)) return null; const o = {}; r.forEach((k) => { o[k[0]] = { l: k[1], h: k[2], o: k[3], c: k[4] }; }); return o;
        });
        Object.assign(out, m || {});
      } catch (e) {}
    }
    return out;
  }
  // GeckoTerminal: one request at a time, ~2.2 s apart (free tier: 30/min)
  let gtChain = Promise.resolve(), gtLast = 0;
  function gt(path) {
    const run = async () => {
      for (let i = 0; i < 2; i++) {
        const wait = Math.max(0, gtLast + 2200 - Date.now()); await new Promise((r) => setTimeout(r, wait)); gtLast = Date.now();
        try { const r = await fetch("https://api.geckoterminal.com/api/v2" + path, { headers: { Accept: "application/json" } }); if (r.status === 404) return null; if (r.ok) return r.json(); if (r.status !== 429) throw new Error("HTTP " + r.status); } catch (e) { if (i) throw e; }
        await new Promise((r) => setTimeout(r, 15000));
      }
      throw new Error("rate-limited");
    };
    const p = gtChain.then(run, run); gtChain = p.catch(() => {}); return p;
  }
  const tokFail = new Set();
  let dhP = null;
  function dhTokens() { // tokens DexHunter lists; others almost never have a GeckoTerminal pool (avoids 404s)
    if (dhP) return dhP;
    try { const c = JSON.parse(sessionStorage.getItem("snek-dhtok") || "null"); if (c && Date.now() - c.t < 3600000) return (dhP = Promise.resolve(new Set(c.ids))); } catch (e) {}
    return (dhP = fetch("https://api-us.dexhunterv3.app/swap/tokens").then((r) => (r.ok ? r.json() : [])).then((d) => { const ids = (d || []).map((t) => t.token_id); try { sessionStorage.setItem("snek-dhtok", JSON.stringify({ t: Date.now(), ids })); } catch (e) {} return new Set(ids); }).catch(() => null));
  }
  // top pool per token in ONE request (missing tokens are simply absent, no 404s); cached a day
  async function gtPools(units) {
    const out = {}, need = [];
    for (const u of units) { const c = await idb.get("gtpool:" + u); if (c && Date.now() - c.t < 24 * 3600e3) out[u] = c.v; else need.push(u); }
    if (need.length) {
      const r = await gt("/networks/cardano/tokens/multi/" + need.slice(0, 30).join(",") + "?include=top_pools");
      const names = {}; ((r && r.included) || []).forEach((x) => { names[x.id] = x.attributes && x.attributes.name; });
      const found = {}; ((r && r.data) || []).forEach((x) => { const pl = x.relationships && x.relationships.top_pools && x.relationships.top_pools.data[0]; if (pl) found[x.attributes.address] = { id: pl.id.replace(/^cardano_/, ""), name: names[pl.id] || x.attributes.symbol }; });
      need.slice(0, 30).forEach((u) => { out[u] = found[u] || null; idb.set("gtpool:" + u, { t: Date.now(), v: out[u] }); });
    }
    return out;
  }
  async function tokenDaily(unit, pool) {
    if (!pool || tokFail.has(unit)) return { none: true };
    try {
      return await cached("px:" + unit, 12 * 3600e3, async () => {
        const r = await gt("/networks/cardano/pools/" + pool.id + "/ohlcv/day?limit=1000&currency=usd&token=" + unit);
        const m = {}; ((r && r.data && r.data.attributes.ohlcv_list) || []).forEach((k) => { m[k[0]] = { o: k[1], h: k[2], l: k[3], c: k[4] }; });
        return { pool: pool.name, days: m };
      });
    } catch (e) { tokFail.add(unit); throw e; }
  }
  // ECB reference rates (USD base); weekends/holidays use the last published fixing, as the ECB intends
  function fxDaily(cur, from) {
    const y = iso(from).slice(0, 7);
    return cached("fx:" + cur + ":" + y, 12 * 3600e3, async () => {
      const r = await fetch("https://api.frankfurter.dev/v1/" + iso(from - 7 * DAY) + "..?base=USD&symbols=" + cur).then((x) => (x.ok ? x.json() : null));
      return r && r.rates ? Object.fromEntries(Object.entries(r.rates).map(([d, v]) => [Date.parse(d) / 1000, v[cur]])) : null;
    });
  }
  // token registry (names/decimals), cached forever
  async function registry(units) {
    const reg = (await idb.get("reg")) || {}; const need = units.filter((u) => !(u in reg)).slice(0, 100);
    for (let i = 0; i < need.length; i += 50) {
      const part = need.slice(i, i + 50);
      try {
        const r = await fetch("https://tokens.cardano.org/metadata/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjects: part, properties: ["name", "ticker", "decimals"] }) }).then((x) => (x.ok ? x.json() : null));
        part.forEach((u) => (reg[u] = null));
        ((r && r.subjects) || []).forEach((s) => { reg[s.subject] = { name: s.name && s.name.value, ticker: s.ticker && s.ticker.value, dec: s.decimals ? +s.decimals.value : 0 }; });
      } catch (e) {}
    }
    if (need.length) idb.set("reg", reg);
    return reg;
  }

  // ---------- wallet state: streams of ≤50 addresses paged through the anchor segments ----------
  function segments() {
    const A = ((window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.anchors) || []).slice().sort((a, b) => a.days - b.days);
    const segs = []; let until = null;
    A.forEach((a) => { segs.push({ after: { block: a.block, tx: a.tx }, until: until && { block: until.block }, from: a.time, label: a.days + (a.days === 1 ? " day" : " days") }); until = a; });
    segs.push({ after: null, until: until && { block: until.block }, from: null, label: "first transaction" });
    return segs;
  }
  const mem = {};
  const aid = (x) => { x = String(x || "").toLowerCase(); return x.includes(".") || x.length < 56 ? x : x.slice(0, 56) + "." + x.slice(56); };
  const stakeMemo = new Map();
  const stakeOf = (a) => { if (stakeMemo.has(a)) return stakeMemo.get(a); const i = W().addrInfo ? W().addrInfo(a) : null; const s = i && i.stake; stakeMemo.set(a, s || null); return s || null; };
  function blank(spec) { return { v: 3, key: spec.key, mode: spec.mode, address: spec.address || null, stake: spec.stake || null, name: spec.name || "", addrs: [], streams: [], segs: segments(), txs: {}, best: null, balAt: 0, bal: null, full: false, from: null, level: 0, capped: false, at: 0 }; }
  async function getState(spec) {
    if (mem[spec.key]) return mem[spec.key];
    const c = await idb.get("w:" + spec.key);
    const st = c && c.v === 3 ? c : blank(spec);
    st.name = spec.name || st.name; mem[spec.key] = st; return st;
  }
  const persist = (st) => { const o = Object.assign({}, st); delete o.loading; delete o.err; delete o.prog; idb.set("w:" + st.key, o); };
  const ours = (st, a) => (st.mode === "addr" ? a === st.address : stakeOf(a) === st.stake);
  function ingest(st, r) {
    const known = new Set(st.addrs), fresh = [];
    r.forEach((t) => {
      const seenIo = (io) => io.forEach((x) => { if (ours(st, x.address) && !known.has(x.address) && !fresh.includes(x.address)) fresh.push(x.address); });
      seenIo(t.inputs || []); seenIo(t.outputs || []);
      if (st.txs[t.hash]) return;
      const d = {}; let any = false;
      const add = (io, s) => io.forEach((x) => { if (!ours(st, x.address)) return; any = true; d.ADA = (d.ADA || 0) + (s * +x.amount) / 1e6; (x.assets || []).forEach((a) => { const k = aid(a.assetId); d[k] = (d[k] || 0) + s * +a.amount; }); });
      add(t.outputs || [], 1); add(t.inputs || [], -1);
      if (any) st.txs[t.hash] = { t: Date.parse(t.time) / 1000, ok: t.tx_state === "Successful", d };
    });
    return fresh;
  }
  function addAddrs(st, list) {
    list = list.filter((a) => !st.addrs.includes(a));
    const room = MAX_ADDR - st.addrs.length; if (list.length > room) { st.capped = true; list = list.slice(0, Math.max(0, room)); }
    if (!list.length) return false;
    st.addrs.push(...list);
    for (let i = 0; i < list.length; i += BATCH) st.streams.push({ addrs: list.slice(i, i + BATCH), seg: 0, cursor: null });
    st.addrsChanged = true; return true;
  }
  async function bestblock() { const b = await yoroi("/v2/bestblock"); if (!b || !b.hash) throw new Error("Yoroi best block unavailable"); return { hash: b.hash, time: SHELLEY0 + (b.globalSlot || 0) }; }
  async function balanceAll(st) {
    const bal = {};
    for (let i = 0; i < st.addrs.length; i += BATCH) {
      const r = await yoroi("/txs/utxoSumForAddresses", { addresses: st.addrs.slice(i, i + BATCH) });
      if (!r) continue; bal.ADA = (bal.ADA || 0) + +(r.sum || 0) / 1e6;
      (r.tokensBalance || []).forEach((t) => { const k = aid(t.assetId); bal[k] = (bal[k] || 0) + +t.quantity; });
    }
    st.bal = bal; st.balAt = Date.now();
  }
  async function pageStream(st, s, untilHash, after) {
    const body = { addresses: s.addrs, untilBlock: untilHash }; if (after) body.after = { block: after.block, tx: after.tx };
    const r = await yoroi("/v2/txs/history", body);
    if (!Array.isArray(r)) throw new Error((r && r.error && r.error.response) || "history unavailable");
    const fresh = ingest(st, r); if (fresh.length) addAddrs(st, fresh);
    return r;
  }
  async function seed(st, prog) {
    if (st.mode === "addr") { addAddrs(st, [st.address]); return; }
    const best = st.best; let after = null, n = 0;
    if (st.address && stakeOf(st.address) === st.stake) addAddrs(st, [st.address]);
    for (;;) { // the stake key's own transactions (registration, delegation, withdrawals) reveal wallet addresses
      prog("Finding the wallet’s addresses…", 0.02);
      const body = { addresses: [st.stake], untilBlock: best.hash }; if (after) body.after = after;
      const r = await yoroi("/v2/txs/history", body); if (!Array.isArray(r)) break;
      addAddrs(st, ingest(st, r)); n += r.length;
      if (r.length < 50 || n > 500) break; const l = r[r.length - 1]; after = { block: l.block_hash, tx: l.hash };
    }
    if (!st.addrs.length) throw new Error("No addresses found for this stake key yet (it has no on-chain transactions of its own). Look up one of its addr1… addresses instead.");
  }
  const levelOf = (st) => (st.streams.length ? Math.min(...st.streams.map((s) => s.seg)) : 0);
  function coverage(st) {
    st.level = levelOf(st);
    st.full = st.level >= st.segs.length;
    if (st.full) { let first = Infinity; Object.values(st.txs).forEach((x) => { if (x.t < first) first = x.t; }); st.from = isFinite(first) ? first : (st.segs[st.segs.length - 2] || {}).from || null; }
    else st.from = st.level > 0 ? st.segs[st.level - 1].from : null;
  }
  // newest anchor older than t (for incremental refresh)
  function anchorBefore(t) { const A = ((window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.anchors) || []).slice().sort((a, b) => b.time - a.time); return A.find((a) => a.time <= t - 600) || null; }
  // one loader per wallet state at a time: overlapping runs (switching wallets/modes mid-load) would race on the page cursors
  const locks = new WeakMap();
  async function load(st, prog, budget) {
    while (locks.get(st)) { try { await locks.get(st); } catch (e) {} }
    const p = load0(st, prog, budget); locks.set(st, p);
    try { return await p; } finally { if (locks.get(st) === p) locks.delete(st); }
  }
  async function load0(st, prog, budget) {
    let pages = 0;
    if (!st.best) { st.best = await bestblock(); }
    if (!st.addrs.length) await seed(st, prog);
    if (!st.bal) { prog("Reading current balances…", 0.04); await balanceAll(st); st.addrsChanged = false; }
    const total = () => st.streams.length * st.segs.length || 1;
    for (;;) {
      const open = st.streams.filter((s) => s.seg < st.segs.length); if (!open.length) break;
      const s = open.reduce((a, b) => (b.seg < a.seg ? b : a));
      if (pages >= budget) break;
      const sg = st.segs[s.seg], untilHash = sg.until ? sg.until.block : st.best.hash;
      const r = await pageStream(st, s, untilHash, s.cursor || sg.after); pages++;
      if (r.length < 50) { s.seg++; s.cursor = null; } else { const l = r[r.length - 1]; s.cursor = { block: l.block_hash, tx: l.hash }; }
      const done = st.streams.reduce((a, x) => a + x.seg, 0);
      prog("Reading transactions back to " + sg.label + (sg.after ? " ago" : "") + " · " + Object.keys(st.txs).length + " txs · " + st.addrs.length + " address" + (st.addrs.length > 1 ? "es" : ""), 0.05 + 0.85 * (done / total()));
      if (pages % 8 === 0) { coverage(st); persist(st); }
    }
    coverage(st);
    st.more = st.streams.some((s) => s.seg < st.segs.length);
    // new addresses joined mid-way, or the cache is old: catch up to the chain tip and re-read balances together
    if (st.addrsChanged || Date.now() - st.balAt > 10 * 60e3) await topup(st, prog);
    st.at = Date.now(); persist(st);
  }
  async function topup(st, prog) {
    const a = anchorBefore(st.balAt / 1000 || 0);
    const best = await bestblock();
    if (!a) { // older than the oldest anchor: start over (rare)
      const fresh = blank(st); Object.assign(st, fresh, { addrs: [], streams: [] }); return load(st, prog, PAGE_BUDGET);
    }
    for (let i = 0; i < st.addrs.length; i += BATCH) {
      const s = { addrs: st.addrs.slice(i, i + BATCH) }; let after = { block: a.block, tx: a.tx };
      for (let n = 0; n < 60; n++) {
        prog("Catching up to the latest block · " + Object.keys(st.txs).length + " txs", 0.93);
        const r = await pageStream(st, s, best.hash, after); if (r.length < 50) break; const l = r[r.length - 1]; after = { block: l.block_hash, tx: l.hash };
      }
    }
    st.best = best; prog("Reading current balances…", 0.97); await balanceAll(st); st.addrsChanged = false;
  }

  // ---------- daily balances per wallet ----------
  async function pricedTokens(sts) {
    const units = new Map(); // assetId -> score
    sts.forEach((st) => { Object.keys(st.bal || {}).forEach((k) => { if (k !== "ADA" && k !== SNEK_ID) units.set(k, (units.get(k) || 0) + 1000); }); Object.values(st.txs).forEach((x) => Object.keys(x.d).forEach((k) => { if (k !== "ADA" && k !== SNEK_ID) units.set(k, (units.get(k) || 0) + 1); })); });
    const ids = [...units.keys()].sort((a, b) => units.get(b) - units.get(a));
    const reg = await registry(ids.map((i) => i.replace(".", "")));
    const dh = await dhTokens();
    const fung = ids.filter((i) => reg[i.replace(".", "")] && (reg[i.replace(".", "")].dec > 0 || reg[i.replace(".", "")].ticker) && (!dh || dh.has(i.replace(".", ""))));
    return { candidates: fung.slice(0, MAX_TOKENS), reg, totalOther: ids.length, fungible: fung.length };
  }
  function balances(st, assets) {
    const now = Date.now() / 1000, tdy = today0(); if (!st.from || !st.bal) return null;
    const txs = Object.values(st.txs).filter((x) => x.ok).sort((a, b) => b.t - a.t);
    const d0 = Math.ceil(st.from / DAY) * DAY - (st.full ? DAY : 0);
    const cur = {}; assets.forEach((a) => (cur[a] = st.bal[a] || 0));
    const days = [], bal = {}; assets.forEach((a) => (bal[a] = []));
    const txDay = {}; let i = 0;
    for (let d = tdy; d >= d0; d -= DAY) {
      const end = d === tdy ? now : d + DAY;
      while (i < txs.length && txs[i].t > end) { const x = txs[i]; assets.forEach((a) => { if (x.d[a]) cur[a] -= x.d[a]; }); i++; }
      days.push(d); assets.forEach((a) => bal[a].push(Math.max(0, cur[a])));
    }
    txs.forEach((x) => { if (x.t < d0) return; const d = Math.floor(x.t / DAY) * DAY; (txDay[d] = txDay[d] || []).push(x.d); });
    days.reverse(); assets.forEach((a) => bal[a].reverse());
    return { days, bal, txDay, from: days[0], full: st.full };
  }
  function combine(list, assets) {
    const ok2 = list.filter(Boolean); if (!ok2.length) return null;
    const from = Math.max(...ok2.map((b) => b.days[0])), days = ok2[0].days.filter((d) => d >= from);
    const bal = {}; assets.forEach((a) => (bal[a] = days.map(() => 0))); const txDay = {};
    ok2.forEach((b) => { const off = b.days.indexOf(from); assets.forEach((a) => days.forEach((_, j) => (bal[a][j] += b.bal[a][off + j] || 0))); Object.entries(b.txDay).forEach(([d, l]) => { if (+d >= from) (txDay[d] = txDay[d] || []).push(...l); }); });
    return { days, bal, txDay, from, full: ok2.every((b) => b.full) };
  }

  // ---------- values in the chosen currency ----------
  async function priceBook(B, tokens, reg, cur, prev) {
    if (prev && prev.from <= B.days[0] && tokens.every((u) => u in prev.T || prev.tokErr.includes(u))) {
      let fx = null; if (cur !== "USD" && cur !== "ADA") { try { fx = await fxDaily(cur, B.days[0]); } catch (e) {} }
      return Object.assign({}, prev, { fx, reg });
    }
    const [S, A0] = await Promise.all([snekDaily(), adaDaily()]);
    const kMin = Math.min(...Object.keys(A0).map(Number).concat([today0()]));
    const old = B.days[0] < kMin ? await adaOlder(B.days[0], kMin) : {};
    const A = Object.assign({}, Object.fromEntries(Object.entries(old).map(([d, v]) => [d, Object.assign({ cb: 1 }, v)])), A0);
    const T = {}; const tokErr = [];
    let pools = {}, poolErr = false; try { pools = tokens.length ? await gtPools(tokens.map((u) => u.replace(".", ""))) : {}; } catch (e) { poolErr = true; }
    const tokBad = [];
    for (const u of tokens) { try { if (poolErr || tokFail.has(u.replace(".", ""))) { tokBad.push(u); continue; } const r = await tokenDaily(u.replace(".", ""), pools[u.replace(".", "")]); if (r && !r.none && Object.keys(r.days).length) T[u] = r; else tokErr.push(u); } catch (e) { tokBad.push(u); } }
    let fx = null; if (cur !== "USD" && cur !== "ADA") { try { fx = await fxDaily(cur, B.days[0]); } catch (e) { fx = null; } }
    return { S, A, T, fx, tokErr, tokBad, reg, from: B.days[0] };
  }
  function buildRows(B, P, assets, cur) {
    const live = (window.SNEKAPP && window.SNEKAPP.state && window.SNEKAPP.state.market) || {}, tdy = today0();
    const fxKeys = P.fx ? Object.keys(P.fx).map(Number).sort((a, b) => a - b) : null;
    const fxAt = (d) => { if (!fxKeys) return null; let v = null; for (const k of fxKeys) { if (k <= d) v = P.fx[k]; else break; } const last = fxKeys.filter((k) => k <= d).pop(); return last != null && d - last <= 7 * DAY ? v : null; };
    return B.days.map((d, j) => {
      const s = P.S[d] || {}, a = P.A[d] || {}, isT = d === tdy;
      let aU = a.c, aH = a.h, aL = a.l, aSrc = a.cb ? "Coinbase" : "Kraken";
      if (isT && ok(live.adaUsd)) { aU = live.adaUsd; aSrc = "live"; }
      if (!ok(aU) && ok(s.c) && ok(s.ac) && s.ac > 0) { aU = s.c / s.ac; aH = aL = null; aSrc = "implied"; }
      const px = { ADA: { c: 1 * (aU || NaN), h: aH, l: aL }, [SNEK_ID]: { c: isT && ok(live.price) ? live.price : s.c, h: s.h, l: s.l } };
      Object.entries(P.T).forEach(([u, t]) => { const k = t.days[d]; px[u] = k ? { c: k.c, h: k.h, l: k.l } : { c: null }; });
      const k = cur === "USD" ? 1 : cur === "ADA" ? (ok(aU) && aU > 0 ? 1 / aU : null) : fxAt(d);
      const row = { time: d, k, aU, aSrc, sU: px[SNEK_ID].c, bal: {}, v: {}, vh: {}, vl: {}, missing: [], txs: B.txDay[d] || [] };
      let tot = 0, hi = 0, lo = 0, bad = !ok(k);
      row.up = {};
      assets.forEach((as) => {
        const dec = as === "ADA" || as === SNEK_ID ? 0 : ((P.reg[as.replace(".", "")] || {}).dec || 0);
        const q = B.bal[as][j] / Math.pow(10, dec); row.bal[as] = q;
        const p = px[as] || {}, c = as === "ADA" ? aU : p.c;
        row.up[as] = ok(c) && ok(k) ? c * k : null;
        if (q === 0) { row.v[as] = 0; row.vh[as] = 0; row.vl[as] = 0; return; }
        if (!ok(c) || !ok(k)) { row.v[as] = null; row.missing.push(as); bad = true; return; }
        row.v[as] = q * c * k; row.vh[as] = q * (ok(p.h) ? (as === "ADA" ? aH : p.h) || c : c) * k; row.vl[as] = q * (ok(p.l) ? (as === "ADA" ? aL : p.l) || c : c) * k;
        tot += row.v[as]; hi += row.vh[as]; lo += row.vl[as];
      });
      row.total = bad ? null : tot; row.hi = bad ? null : hi; row.lo = bad ? null : lo;
      row.snekC = ok(px[SNEK_ID].c) && ok(k) ? px[SNEK_ID].c * k : null; row.adaC = ok(aU) && ok(k) ? aU * k : null;
      return row;
    });
  }
  // stats over a slice of rows (only for the enabled assets)
  function stats(rows, on) {
    const val = rows.filter((r) => ok(r.total));
    if (val.length < 1) return null;
    const first = val[0], last = val[val.length - 1];
    let pl = 0, n = 0, twr = 1, twrN = 0, peak = -Infinity, peakT = null, mdd = 0, mddA = null, mddB = null, ath = null, atl = null;
    for (let i = 1; i < rows.length; i++) { const a = rows[i - 1], c = rows[i]; let x = 0, okk = true;
      on.forEach((as) => { const q = a.bal[as]; if (!q) return; const pa = a.up[as], pc = c.up[as]; if (!ok(pa) || !ok(pc)) okk = false; else x += q * (pc - pa); });
      if (okk) { pl += x; n++; if (ok(a.total) && a.total > 0) { twr *= 1 + x / a.total; twrN++; } } }
    val.forEach((r) => { if (r.total > peak) { peak = r.total; peakT = r.time; } const dd = peak > 0 ? r.total / peak - 1 : 0; if (dd < mdd) { mdd = dd; mddA = peakT; mddB = r.time; } if (!ath || r.total > ath.total) ath = r; if (!atl || r.total < atl.total) atl = r; });
    const ch = last.total - first.total;
    return { first, last, ch, chPct: first.total > 0 ? (ch / first.total) * 100 : null, pl: n ? pl : null, plPct: twrN ? (twr - 1) * 100 : null, transfers: n ? ch - pl : null, mdd: mdd * 100, mddA, mddB, ath, atl, days: rows.length, gaps: rows.length - val.length };
  }

  // ---------- UI state + preferences ----------
  const DEF = { range: "all", from: null, to: null, type: "area", view: "value", cur: null, log: false, smooth: false, markers: true, bench: "none", dd: true, off: [], on: [], scope: "stake" };
  const prefsAll = () => store.get("snek-ph-prefs", {});
  const prefsOf = (key) => Object.assign({}, DEF, store.get("snek-ph-def", {}), prefsAll()[key] || {});
  function savePrefs(key, p) { const all = prefsAll(); all[key] = p; const ks = Object.keys(all); if (ks.length > 40) delete all[ks[0]]; store.set("snek-ph-prefs", all); store.set("snek-ph-def", { type: p.type, view: p.view, cur: p.cur, log: p.log, smooth: p.smooth, markers: p.markers, bench: p.bench, dd: p.dd, range: p.range }); }
  const RANGES = [["7d", 7, "7D"], ["30d", 30, "30D"], ["90d", 90, "90D"], ["1y", 365, "1Y"], ["all", 0, "All"], ["custom", -1, "Custom"]];
  let sel = null; // { key, kind: 'one'|'all', specs:[...], label }
  let prefs = Object.assign({}, DEF), view = null, chart = null, ctx = null, loadingN = 0;
  const curNow = () => prefs.cur || (window.SNEKSET ? SNEKSET.get().cur : "USD") || "USD";
  const sym = (c) => (CURS.find((x) => x[0] === c) || [c, c + " "])[1];
  function fmt(v, c, sign) {
    if (!ok(v)) return "–"; c = c || curNow(); if (Math.abs(v) < 0.005) v = 0; const a = Math.abs(v), s = sign ? (v >= 0 ? "+" : "−") : v < 0 ? "−" : "";
    const n = a >= 1e4 ? cmp(a) : a >= 1 ? a.toLocaleString("en-US", { maximumFractionDigits: 2 }) : Number(a.toPrecision(3)).toString();
    return c === "ADA" ? s + n + " ₳" : s + sym(c) + n;
  }
  const pctS = (v) => (ok(v) ? (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1) + "%" : "–");
  const nameOf = (as, reg) => (as === "ADA" ? "ADA" : as === SNEK_ID ? "SNEK" : ((reg && reg[as.replace(".", "")]) || {}).ticker || ((reg && reg[as.replace(".", "")]) || {}).name || as.slice(0, 8) + "…");

  function walletSpecs() {
    const list = [], cw = W().current && W().current();
    const push = (o) => { const id = o.stake || o.address; if (!list.some((x) => (x.stake || x.address) === id)) list.push(o); else if (o.tracked) list.find((x) => (x.stake || x.address) === id).tracked = true; };
    const specFor = (address, stake, name, script) => {
      const canStake = !!stake && !script;
      return { address, stake: canStake ? stake : null, name, canStake, canAddr: !!address };
    };
    if (cw && (cw.address || cw.stake)) push(Object.assign(specFor(cw.address, cw.stake, cw.query || "Looked-up wallet", cw.script), { key: "cur:" + (cw.stake || cw.address) }));
    const notes = store.get("snek-wnotes", {});
    store.get("snek-watch", []).forEach((x) => { if (!x.address && !x.stake) return; const nm = (notes[x.id] || {}).nick || x.name; push(Object.assign(specFor(x.address, x.stake, nm, false), { key: "w:" + (x.stake || x.address), tracked: true })); });
    return list;
  }
  function specKey(sp, scope) { const st = scope === "stake" && sp.stake ? "stake" : sp.address ? "addr" : "stake"; return { key: (st === "stake" ? "s:" + sp.stake : "a:" + sp.address), mode: st, address: sp.address, stake: sp.stake, name: sp.name }; }

  // ---------- rendering ----------
  const segHTML = (id, opts, val, attr) => '<div class="seg sm" id="' + id + '" role="group">' + opts.map((o) => '<button type="button" data-' + attr + '="' + o[0] + '" class="' + (String(val) === String(o[0]) ? "on" : "") + '">' + o[1] + "</button>").join("") + "</div>";
  const tgl = (id, on, label) => '<label class="phtgl"><input type="checkbox" id="' + id + '"' + (on ? " checked" : "") + "><span>" + label + "</span></label>";
  function pickers() {
    const el = $("phPick"); if (!el) return;
    const list = walletSpecs(), tracked = list.filter((x) => x.tracked);
    el.innerHTML = list.length ? '<span class="muted small">Wallet:</span>' + list.map((x) => '<button type="button" data-k="' + esc(x.key) + '" class="' + (sel && sel.kind === "one" && sel.spec.key === x.key ? "on" : "") + '">' + esc(x.name) + "</button>").join("") +
      (tracked.length >= 2 ? '<button type="button" data-k="__all" class="' + (sel && sel.kind === "all" ? "on" : "") + '">Σ All tracked (' + tracked.length + ")</button>" : "") : "";
  }
  function shell() {
    const sp = sel.kind === "one" ? sel.spec : null, p = prefs, cur = curNow();
    return '<div class="phctl">' +
      (sp && sp.canStake && sp.canAddr ? '<div class="row wrap gap"><span class="muted small">Scope:</span>' + segHTML("phScope", [["addr", "This address"], ["stake", "Whole wallet (stake key)"]], p.scope, "s") + "</div>" : "") +
      '<div class="row wrap gap">' + segHTML("phRange", RANGES.map((r) => [r[0], r[2]]), p.range, "r") +
      '<span id="phCustom" class="row gap"' + (p.range === "custom" ? "" : " hidden") + '><input type="date" id="phFrom" aria-label="From date" value="' + (p.from || "") + '"><span class="muted">→</span><input type="date" id="phTo" aria-label="To date" value="' + (p.to || "") + '"></span></div>' +
      '<details class="phopts"' + (store.get("snek-ph-optsopen", false) ? " open" : "") + '><summary>⚙ Customize chart</summary><div class="phgrid">' +
      '<div><span class="muted small">Chart</span>' + segHTML("phType", [["area", "Area"], ["stack", "Stacked"], ["line", "Line"], ["bars", "Daily bars"]], p.type, "t") + "</div>" +
      '<div><span class="muted small">Show</span>' + segHTML("phView", [["value", "Value"], ["pct", "% change"]], p.view, "v") + "</div>" +
      '<div><span class="muted small">Currency</span><select id="phCur">' + CURS.map((c) => '<option value="' + c[0] + '"' + (c[0] === cur ? " selected" : "") + ">" + c[0] + "</option>").join("") + "</select></div>" +
      '<div><span class="muted small">Compare</span>' + segHTML("phBench", [["none", "Off"], ["snek", "Hold SNEK"], ["ada", "Hold ADA"], ["both", "Both"]], p.bench, "b") + "</div>" +
      '<div class="phtgls">' + tgl("phLog", p.log, "Log scale") + tgl("phSmooth", p.smooth, "7-day smoothing") + tgl("phMarkers", p.markers, "Markers") + tgl("phDD", p.dd, "Drawdown") + "</div>" +
      "</div></details><div class=\"phassets\" id=\"phAssets\"></div></div>" +
      '<div id="phProg" class="phprog" hidden><div class="phbar"><i></i></div><span></span></div><div id="phErr"></div>' +
      '<div class="kpis wk mt" id="phKpis"></div>' +
      '<div class="phchart-wrap"><div id="phChart" class="phchart" aria-label="Portfolio value chart"></div><div id="phTip" class="phtip" hidden></div></div>' +
      '<div id="phInspect" class="phinspect small" aria-live="polite">Tap or drag on the chart to inspect a day.</div>' +
      '<div id="phLegend" class="phlegend small"></div>' +
      '<div class="row wrap gap phacts"><button type="button" class="btn sm" id="phCsv">⬇ CSV</button><button type="button" class="btn sm" id="phShare">⇪ Share</button><button type="button" class="btn sm" id="phRefresh">⟳ Refresh</button><button type="button" class="btn sm" id="phMore" hidden>Load further back</button></div>' +
      '<h3 class="mt">P/L by range</h3><div class="table-wrap"><table class="phtable" id="phRanges"></table></div>' +
      '<details class="mt" id="phDailyBox"><summary><b>Daily changes</b></summary><div class="table-wrap"><table class="phtable" id="phDaily"></table></div><button type="button" class="btn sm" id="phAllDays" hidden>Show all days</button></details>' +
      '<div id="phNote" class="muted small mt"></div>';
  }
  function empty(msg) {
    const b = $("phBody"); if (!b) return;
    if (chart) { try { chart.remove(); } catch (e) {} chart = null; }
    b.innerHTML = '<div class="wempty"><img src="assets/brand/snek-face-love.webp" alt="" width="64" height="44" loading="lazy"><b>Portfolio history</b><span class="muted small">' + msg + "</span></div>";
  }
  function progress(text, frac) {
    const el = $("phProg"); if (!el) return;
    el.hidden = text == null; if (text == null) return;
    el.querySelector("span").textContent = text; el.querySelector("i").style.width = Math.round(Math.max(0.03, Math.min(1, frac || 0)) * 100) + "%";
  }
  function errText(e) {
    const m = String((e && e.message) || e || "");
    if (/429|rate/i.test(m)) return "The free Yoroi API is rate-limiting this connection right now. Everything loaded so far is kept; try again in about 15 seconds.";
    if (/HTTP 5\d\d/.test(m)) return "Yoroi’s free backend is busy (" + esc(m) + "). Everything loaded so far is kept; try again shortly.";
    if (/Failed to fetch|NetworkError|aborted|TypeError/i.test(m)) return "Network error: the history API couldn’t be reached (offline, blocked or timed out). Cached data is shown if available.";
    return esc(m);
  }

  // ---------- load + compute ----------
  async function run(budget) {
    const my = ++loadingN, b = $("phBody"); if (!b || !sel) return;
    const specs = sel.kind === "one" ? [specKey(sel.spec, prefs.scope)] : walletSpecs().filter((x) => x.tracked).map((x) => specKey(x, "stake"));
    if (!(window.SNEK_SNAPSHOT && window.SNEK_SNAPSHOT.anchors)) { empty("Chain anchors are unavailable right now, so history can’t be paged. Try again after the next 30-min snapshot."); return; }
    const sts = []; for (const sp of specs) sts.push(await getState(sp));
    if (sts.some((s) => s.from && s.bal)) { await compute(sts, my); }
    $("phErr").innerHTML = "";
    for (let i = 0; i < sts.length; i++) {
      const st = sts[i], pre = sts.length > 1 ? "Wallet " + (i + 1) + "/" + sts.length + " (" + (st.name || "").slice(0, 18) + ") · " : "";
      const need = !st.from || Date.now() - st.at > 10 * 60e3 || budget;
      if (!need) continue;
      try {
        st.loading = true; const pr = (t, f) => { if (my === loadingN) progress(pre + t, (i + f) / sts.length); };
        await load(st, pr, budget || PAGE_BUDGET);
        // very busy wallets: keep paging (up to 2 more rounds) until at least a week is covered
        for (let k = 0; k < 2 && st.more && (!st.from || today0() - st.from < 7 * DAY) && my === loadingN; k++) await load(st, pr, PAGE_BUDGET);
      }
      catch (e) { st.err = e; if (my === loadingN) $("phErr").innerHTML = '<p class="small warn">' + (st.name ? esc(st.name) + ": " : "") + errText(e) + ' <button type="button" class="btn sm" id="phRetry">Retry</button></p>'; }
      st.loading = false;
      if (my !== loadingN) return;
    }
    progress("Pricing tokens…", 0.98);
    await compute(sts, my);
    if (my === loadingN) progress(null);
  }
  async function compute(sts, my) {
    // first paint with SNEK + ADA only (fast), then again once other tokens are priced (GeckoTerminal is slow/rate-limited)
    if (!ctx || ctx.sts.length !== sts.filter((s) => s.from && s.bal).length) await compute2(sts, my, false);
    return compute2(sts, my, true);
  }
  async function compute2(sts, my, withTokens) {
    const good = sts.filter((s) => s.from && s.bal);
    if (!good.length) { if (!sts.some((s) => s.loading)) { const e = sts.find((s) => s.err); if (e) $("phKpis").innerHTML = ""; } return; }
    const cur = curNow();
    let tk = { candidates: [], reg: {}, totalOther: 0, fungible: 0 };
    try { tk = await pricedTokens(good); } catch (e) {}
    if (!withTokens) { tk = Object.assign({}, tk, { candidates: [] }); }
    const assets0 = ["ADA", SNEK_ID].concat(tk.candidates);
    const B = combine(good.map((s) => balances(s, assets0)), assets0);
    if (!B || !B.days.length) return;
    const P = await priceBook(B, tk.candidates, tk.reg, cur, ctx && withTokens && !ctx.pricing ? ctx.P : null);
    if (my !== loadingN && my !== -1) return;
    const priced = tk.candidates.filter((u) => P.T[u]);
    const cov = {}; priced.forEach((u) => { let held = 0, have = 0; B.days.forEach((d, j) => { if (B.bal[u][j] > 0) { held++; if (P.T[u].days[d]) have++; } }); cov[u] = held ? have / held : 1; });
    ctx = { cov, B, P, cur, sts: good, all: sts, assets: ["ADA", SNEK_ID].concat(priced.filter((u) => B.bal[u].some((x) => x > 0))), unpriced: tk.candidates.filter((u) => !P.T[u] && !(P.tokBad || []).includes(u)), failed: tk.candidates.filter((u) => (P.tokBad || []).includes(u)), otherCount: tk.totalOther - priced.length, fungible: tk.fungible, reg: tk.reg, pricing: !withTokens, inspT: ctx ? ctx.inspT : null };
    draw();
  }

  // ---------- draw ----------
  let showAllDays = false;
  function cut(rowsAll) {
    const R = RANGES.find((r) => r[0] === prefs.range) || RANGES[4];
    if (R[1] === -1) { const f = prefs.from ? Date.parse(prefs.from) / 1000 : -Infinity, t = prefs.to ? Date.parse(prefs.to) / 1000 : Infinity; return rowsAll.filter((r) => r.time >= f && r.time <= t); }
    const c = R[1] ? today0() - R[1] * DAY : -Infinity; return rowsAll.filter((r) => r.time >= c);
  }
  function classify(d) {
    const s = d[SNEK_ID] || 0, a = d.ADA || 0;
    if (s > 0 && a < -3) return "buy"; if (s < 0 && a > 3) return "sell"; if (s > 0) return "in"; if (s < 0) return "out";
    if (a > 5) return "in"; if (a < -5) return "out"; return null;
  }
  function draw() {
    if (!ctx || !$("phKpis")) return;
    const cur = curNow();
    if (ctx.cur !== cur) { compute(ctx.all, -1); return; }
    const on = ctx.assets.filter(isOn);
    const rowsAll = buildRows(ctx.B, ctx.P, on, cur), rows = cut(rowsAll), S = stats(rows, on);
    ctx.rows = rows; ctx.rowsAll = rowsAll; ctx.on = on; ctx.S = S;
    // asset chips
    $("phAssets").innerHTML = '<span class="muted small">Assets:</span>' + ctx.assets.map((a, i) => '<button type="button" class="phchip' + (isOn(a) ? " on" : "") + '" data-as="' + esc(a) + '" title="' + (ctx.cov[a] != null ? "Price on " + Math.round(ctx.cov[a] * 100) + "% of the days it was held" : "") + '"><i style="background:' + COLS[i % COLS.length] + '"></i>' + esc(label(a)) + (ctx.cov[a] != null && ctx.cov[a] < 0.9 ? ' <span class="muted">sparse ' + Math.round(ctx.cov[a] * 100) + "%</span>" : "") + "</button>").join("") +
      (ctx.pricing ? '<span class="muted small">Checking other tokens for price history…</span>' : ctx.unpriced.length || ctx.failed.length || ctx.otherCount > 0 ? '<span class="muted small">Excluded: ' + [ctx.failed.length ? ctx.failed.map((u) => esc(nameOf(u, ctx.reg))).join(", ") + " (price lookup failed, GeckoTerminal busy; tap Refresh to retry)" : "", ctx.unpriced.length ? ctx.unpriced.map((u) => esc(nameOf(u, ctx.reg))).join(", ") + " (no price history found)" : "", ctx.otherCount - ctx.unpriced.length - ctx.failed.length > 0 ? (ctx.otherCount - ctx.unpriced.length - ctx.failed.length) + " other tokens/NFTs (no registry entry or beyond the top " + MAX_TOKENS + ")" : ""].filter(Boolean).join(" · ") + "</span>" : "");
    // KPIs
    const k = (l, v, cls, sub) => '<div class="kpi"><div class="l">' + l + '</div><div class="v ' + (cls || "") + '">' + v + "</div>" + (sub ? '<div class="muted small">' + sub + "</div>" : "") + "</div>";
    const cls = (v) => (ok(v) ? (v >= 0 ? "up" : "down") : "");
    const L = S && S.last;
    $("phKpis").innerHTML = !S ? '<p class="small warn">No priced day in this range. Turn off assets without prices or pick a range inside the covered window.</p>' :
      k("Value now", fmt(L.total, cur), "", cmp(L.bal[SNEK_ID]) + " SNEK · " + cmp(L.bal.ADA) + " ADA") +
      k("Change", fmt(S.ch, cur, true), cls(S.ch), pctS(S.chPct) + " · incl. transfers") +
      k("Price-driven P/L", fmt(S.pl, cur, true), cls(S.pl), pctS(S.plPct) + " time-weighted (transfers excluded)") +
      k("Net transfers", fmt(S.transfers, cur, true), "", "deposits − withdrawals (valued)") +
      k("Max drawdown", ok(S.mdd) ? S.mdd.toFixed(1) + "%" : "–", S.mdd < 0 ? "down" : "", S.mddA ? dstr(S.mddA) + " → " + dstr(S.mddB) : "no decline in range") +
      k("ATH / ATL", fmt(S.ath.total, cur) + ' <span class="muted">/</span> ' + fmt(S.atl.total, cur), "", dstr(S.ath.time) + " / " + dstr(S.atl.time));
    drawChart(rows, on, S, cur);
    tables(rowsAll, rows, on, cur);
    notes(rows, on, cur);
    const more = $("phMore"); if (more) { const m = ctx.all.some((s) => s.more); more.hidden = !m; more.disabled = false; more.textContent = "Load further back"; }
  }
  // ADA and SNEK are on unless switched off; other tokens start on only when they have a price on ≥90% of the days they were held
  function isOn(a) { if (a === "ADA" || a === SNEK_ID) return !prefs.off.includes(a); if ((prefs.on || []).includes(a)) return true; if (prefs.off.includes(a)) return false; return (ctx.cov[a] || 0) >= 0.9; }
  function label(a) { const n = nameOf(a, ctx.reg), dup = ctx.assets.filter((x) => nameOf(x, ctx.reg) === n).length > 1; return dup ? n + "·" + a.slice(0, 4) : n; }
  function smooth(arr) { return arr.map((v, i) => { if (i < 6) return null; let s = 0; for (let j = i - 6; j <= i; j++) { if (!ok(arr[j])) return null; s += arr[j]; } return s / 7; }); }
  function drawChart(rows, on, S, cur) {
    const LW = window.LightweightCharts, el = $("phChart"); if (!LW || !el) return;
    if (chart) { try { chart.remove(); } catch (e) {} chart = null; }
    const cs = getComputedStyle(document.documentElement), col = (v) => cs.getPropertyValue(v).trim();
    const pct = prefs.view === "pct", base = S ? S.first.total : null;
    const tf = (v) => (!ok(v) ? null : pct ? (base > 0 ? (v / base - 1) * 100 : null) : v);
    const pf = { type: "custom", minMove: 0.0001, formatter: (v) => (pct ? pctS(v) : fmt(v, cur)) };
    const touch = matchMedia("(hover: none)").matches;
    chart = LW.createChart(el, {
      autoSize: true, layout: { background: { type: "solid", color: "transparent" }, textColor: col("--muted"), attributionLogo: false, fontFamily: "Inter, system-ui, sans-serif", panes: { separatorColor: col("--line") } },
      grid: { vertLines: { visible: false }, horzLines: { color: col("--line") } }, rightPriceScale: { borderVisible: false, mode: prefs.log && !pct ? 1 : 0 }, timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 }, handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: false, vertTouchDrag: false }, handleScale: { mouseWheel: true, pinch: false, axisPressedMouseMove: true },
    });
    const snek = col("--snek"), T = rows.map((r) => r.time), totals = rows.map((r) => tf(r.total));
    const data = (arr) => arr.map((v, i) => (ok(v) ? { time: T[i], value: v } : { time: T[i] }));
    let main;
    const type = pct && (prefs.type === "stack" || prefs.type === "bars") ? "line" : prefs.type;
    if (type === "stack") {
      const order = on.slice(); let cum = rows.map(() => 0); const layers = [];
      order.forEach((as) => { cum = cum.map((c, i) => (ok(c) && rows[i].v[as] != null ? c + rows[i].v[as] : null)); layers.push({ as, vals: cum.slice() }); });
      layers.reverse().forEach((Ly) => { const c = COLS[ctx.assets.indexOf(Ly.as) % COLS.length]; const s = chart.addSeries(LW.AreaSeries, { lineColor: c, topColor: c + "cc", bottomColor: c + "cc", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat: pf, crosshairMarkerVisible: false }); s.setData(data(Ly.vals)); if (!main) main = s; });
      main.applyOptions({ lastValueVisible: true });
    } else if (type === "bars") {
      main = chart.addSeries(LW.CandlestickSeries, { upColor: snek, downColor: col("--red"), borderVisible: false, wickUpColor: snek, wickDownColor: col("--red"), priceFormat: pf, priceLineVisible: false });
      main.setData(rows.map((r, i) => { const c = r.total, o = i && ok(rows[i - 1].total) ? rows[i - 1].total : c; if (!ok(c)) return { time: r.time }; return { time: r.time, open: o, close: c, high: Math.max(o, c, ok(r.hi) ? r.hi : c), low: Math.min(o, c, ok(r.lo) ? r.lo : c) }; }));
    } else {
      const vals = prefs.smooth ? smooth(totals) : totals;
      if (prefs.smooth) { const raw = chart.addSeries(LW.LineSeries, { color: snek + "55", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat: pf, crosshairMarkerVisible: false }); raw.setData(data(totals)); }
      main = type === "line" ? chart.addSeries(LW.LineSeries, { color: snek, lineWidth: 2, priceLineVisible: false, priceFormat: pf }) : chart.addSeries(LW.AreaSeries, { lineColor: snek, topColor: snek + "55", bottomColor: snek + "00", lineWidth: 2, priceLineVisible: false, priceFormat: pf });
      main.setData(data(vals));
    }
    // benchmarks: the start value held entirely in SNEK or ADA, valued with the same daily prices (no transfers)
    const benches = [];
    if (S && prefs.bench !== "none") {
      const f = S.first, mk = (key, color, label) => { if (!ok(f[key]) || !(f[key] > 0)) return; const u = f.total / f[key]; const s = chart.addSeries(LW.LineSeries, { color, lineWidth: 2, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, priceFormat: pf, crosshairMarkerVisible: false }); const arr = rows.map((r) => (r.time < f.time || !ok(r[key]) ? null : tf(u * r[key]))); s.setData(data(arr)); benches.push({ label, color, arr }); };
      if (prefs.bench === "snek" || prefs.bench === "both") mk("snekC", col("--purple"), "Hold SNEK only");
      if (prefs.bench === "ada" || prefs.bench === "both") mk("adaC", col("--cyan"), "Hold ADA only");
    }
    // drawdown pane
    let ddArr = null;
    if (prefs.dd && S) {
      let peak = -Infinity; ddArr = rows.map((r) => { if (!ok(r.total)) return null; peak = Math.max(peak, r.total); return peak > 0 ? (r.total / peak - 1) * 100 : 0; });
      const red = col("--red"), dd = chart.addSeries(LW.AreaSeries, { lineColor: red, topColor: red + "11", bottomColor: red + "66", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", formatter: (v) => v.toFixed(1) + "%" }, invertFilledArea: true }, 1);
      dd.setData(data(ddArr)); try { chart.panes()[1].setHeight(70); } catch (e) {}
    }
    // markers: ATH/ATL + real transactions (buy/sell/transfer, aggregated per day)
    if (prefs.markers && S && LW.createSeriesMarkers && type !== "stack") {
      const M = [];
      const daily = rows.map((r) => { const c = { buy: 0, sell: 0, in: 0, out: 0 }; r.txs.forEach((d) => { const k = classify(d); if (k) c[k]++; }); return c; });
      const sig = rows.map((r, i) => ({ i, w: r.txs.reduce((a, d) => a + Math.abs(d[SNEK_ID] || 0) * (r.sU || 0) + Math.abs(d.ADA || 0) * (r.aU || 0), 0) })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w).slice(0, 90).map((x) => x.i);
      sig.forEach((i) => { const c = daily[i], t = rows[i].time; if (!ok(rows[i].total)) return;
        if (c.buy) M.push({ time: t, position: "belowBar", color: snek, shape: "arrowUp", text: "B" + (c.buy > 1 ? c.buy : "") });
        if (c.sell) M.push({ time: t, position: "aboveBar", color: col("--red"), shape: "arrowDown", text: "S" + (c.sell > 1 ? c.sell : "") });
        if (c.in && !c.buy) M.push({ time: t, position: "belowBar", color: col("--cyan"), shape: "circle", text: "In" });
        if (c.out && !c.sell) M.push({ time: t, position: "aboveBar", color: col("--yellow"), shape: "circle", text: "Out" }); });
      M.push({ time: S.ath.time, position: "aboveBar", color: col("--text"), shape: "arrowDown", text: "ATH" });
      if (S.atl.time !== S.ath.time) M.push({ time: S.atl.time, position: "belowBar", color: col("--muted"), shape: "arrowUp", text: "ATL" });
      M.sort((a, b) => a.time - b.time); LW.createSeriesMarkers(main, M);
    }
    chart.timeScale().fitContent();
    const byT = new Map(rows.map((r, i) => [r.time, i]));
    const tipHTML = (i) => { const r = rows[i]; if (!r) return ""; const c = { buy: 0, sell: 0, in: 0, out: 0 }; r.txs.forEach((d) => { const k = classify(d); if (k) c[k]++; });
      return "<b>" + dstr(r.time) + "</b> <span class=\"muted\">(UTC close)</span><div>" + (ok(r.total) ? fmt(r.total, cur) + (pct && base ? " · " + pctS((r.total / base - 1) * 100) : "") : '<span class="warn">no price for ' + r.missing.map((a) => esc(label(a))).join(", ") + "</span>") + "</div>" +
        on.filter((a) => r.bal[a] > 0).map((a) => '<div class="muted"><i class="dot" style="background:' + COLS[ctx.assets.indexOf(a) % COLS.length] + '"></i>' + esc(label(a)) + " " + cmp(r.bal[a]) + " · " + (r.v[a] != null ? fmt(r.v[a], cur) : "no price") + "</div>").join("") +
        benches.map((bn) => (ok(bn.arr[i]) ? '<div style="color:' + bn.color + '">' + bn.label + ": " + (pct ? pctS(bn.arr[i]) : fmt(bn.arr[i], cur)) + "</div>" : "")).join("") +
        (ddArr && ok(ddArr[i]) ? '<div class="muted">Drawdown ' + ddArr[i].toFixed(1) + "%</div>" : "") +
        (r.txs.length ? '<div class="muted">' + r.txs.length + " tx" + (r.txs.length > 1 ? "s" : "") + (c.buy ? " · " + c.buy + " buy" : "") + (c.sell ? " · " + c.sell + " sell" : "") + (c.in ? " · " + c.in + " in" : "") + (c.out ? " · " + c.out + " out" : "") + "</div>" : ""); };
    const tip = $("phTip"), insp = $("phInspect");
    chart.subscribeCrosshairMove((p) => {
      if (!p || !p.time || !p.point || p.point.x < 0) { tip.hidden = true; return; }
      const i = byT.get(p.time); if (i == null) { tip.hidden = true; return; }
      const h = tipHTML(i);
      if (touch || el.clientWidth < 560) { tip.hidden = true; insp.innerHTML = h; return; }
      tip.innerHTML = h; tip.hidden = false;
      const wrap = tip.parentElement.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (p.point.x + 16 + tw > wrap.width ? Math.max(4, p.point.x - tw - 16) : p.point.x + 16) + "px"; tip.style.top = Math.max(4, Math.min(wrap.height - th - 4, p.point.y - th / 2)) + "px";
    });
    // touch: tap or drag horizontally to inspect (the page still scrolls vertically)
    const inspectAt = (x) => { const t = chart.timeScale().coordinateToTime(x); if (t == null) return; const i = byT.get(t); if (i == null) return; const v = main === null ? null : (type === "bars" ? rows[i].total : (type === "stack" ? null : (prefs.smooth ? null : totals[i]))); try { chart.setCrosshairPosition(ok(v) ? v : (ok(totals[i]) ? totals[i] : 0), t, main); } catch (e) {} ctx.inspT = t; insp.innerHTML = tipHTML(i); };
    el.onpointerdown = (e) => { if (e.pointerType !== "mouse") { el.__insp = true; inspectAt(e.clientX - el.getBoundingClientRect().left); } };
    el.onpointermove = (e) => { if (e.pointerType !== "mouse" && el.__insp) inspectAt(e.clientX - el.getBoundingClientRect().left); };
    el.onpointerup = el.onpointercancel = () => { el.__insp = false; };
    const last = rows.length - 1; if (last >= 0) insp.innerHTML = (touch ? "Tap or drag on the chart to inspect a day. " : "") + '<span class="muted">Latest:</span> ' + tipHTML(last);
    if (ctx.inspT != null && byT.has(ctx.inspT)) insp.innerHTML = tipHTML(byT.get(ctx.inspT));
    // legend
    $("phLegend").innerHTML = (type === "stack" ? on.map((a) => '<span><i style="background:' + COLS[ctx.assets.indexOf(a) % COLS.length] + '"></i>' + esc(label(a)) + "</span>").join("") : '<span><i style="background:' + snek + '"></i>' + (pct ? "% change" : "Portfolio value") + " (" + cur + ")" + (prefs.smooth ? ", 7-day average (faint line = daily)" : "") + (type === "bars" ? ": open = previous close, wicks = end-of-day holdings × day’s price high/low (bounds)" : "") + "</span>") +
      benches.map((bn) => '<span><i style="background:' + bn.color + '"></i>' + bn.label + " (start value, no transfers)</span>").join("") + (ddArr ? '<span><i style="background:var(--red)"></i>Drawdown from peak</span>' : "") +
      (prefs.markers && type !== "stack" ? '<span class="muted">B/S = buy/sell SNEK for ADA in one tx · In/Out = transfers · ATH/ATL in range</span>' : "");
  }
  function tables(rowsAll, rows, on, cur) {
    const covFrom = rowsAll.length ? rowsAll[0].time : null;
    const line = (label, R, partial) => { const s = stats(R, on); if (!s) return "<tr><td>" + label + '</td><td colspan="6" class="muted">no priced days</td></tr>'; const c = (v) => (ok(v) ? (v >= 0 ? "up" : "down") : "");
      return "<tr><td>" + label + (partial ? '<div class="muted small">from ' + dstr(R[0].time) + "</div>" : "") + '</td><td class="' + c(s.ch) + '">' + fmt(s.ch, cur, true) + '</td><td class="' + c(s.chPct) + '">' + pctS(s.chPct) + '</td><td class="' + c(s.pl) + '">' + fmt(s.pl, cur, true) + '</td><td class="' + c(s.plPct) + '">' + pctS(s.plPct) + "</td><td>" + fmt(s.transfers, cur, true) + '</td><td class="down">' + (ok(s.mdd) ? s.mdd.toFixed(1) + "%" : "–") + "</td></tr>"; };
    let h = "<tr><th>Range</th><th>Change</th><th>%</th><th>Price P/L</th><th>P/L %</th><th>Transfers</th><th>Max DD</th></tr>";
    RANGES.slice(0, 5).forEach((r) => { const c = r[1] ? today0() - r[1] * DAY : -Infinity, R = rowsAll.filter((x) => x.time >= c); if (R.length) h += line(r[2], R, r[1] && covFrom > c); });
    if (prefs.range === "custom" && rows.length) h += line("Custom", rows, false);
    $("phRanges").innerHTML = h;
    const D = rows.slice().reverse(), lim = showAllDays ? D.length : 14;
    let t = "<tr><th>Date (UTC)</th><th>Value</th><th>Δ</th><th>Δ%</th><th>Price P/L</th><th>Transfers</th><th>SNEK</th><th>ADA</th><th>Txs</th></tr>";
    D.slice(0, lim).forEach((r) => { const i = rows.indexOf(r), p = rows[i - 1]; let pl = null;
      if (p) { pl = 0; for (const a of on) { const q = p.bal[a]; if (!q) continue; if (!ok(p.up[a]) || !ok(r.up[a])) { pl = null; break; } pl += q * (r.up[a] - p.up[a]); } }
      const ch = p && ok(p.total) && ok(r.total) ? r.total - p.total : null, cc = (v) => (ok(v) ? (v >= 0 ? "up" : "down") : "");
      const cnt = { buy: 0, sell: 0, in: 0, out: 0 }; r.txs.forEach((d) => { const k = classify(d); if (k) cnt[k]++; });
      t += "<tr><td>" + dstr(r.time) + "</td><td>" + (ok(r.total) ? fmt(r.total, cur) : '<span class="warn">no price</span>') + '</td><td class="' + cc(ch) + '">' + fmt(ch, cur, true) + '</td><td class="' + cc(ch) + '">' + (ok(ch) && p.total > 0 ? pctS((ch / p.total) * 100) : "–") + '</td><td class="' + cc(pl) + '">' + fmt(pl, cur, true) + "</td><td>" + (ok(ch) && ok(pl) ? fmt(ch - pl, cur, true) : "–") + "</td><td>" + cmp(r.bal[SNEK_ID]) + "</td><td>" + cmp(r.bal.ADA) + "</td><td>" + (r.txs.length ? r.txs.length + ' <span class="muted">' + ["buy", "sell", "in", "out"].filter((k) => cnt[k]).map((k) => cnt[k] + k[0].toUpperCase()).join(" ") + "</span>" : "") + "</td></tr>"; });
    $("phDaily").innerHTML = t; const all = $("phAllDays"); all.hidden = showAllDays || D.length <= 14; all.textContent = "Show all " + D.length + " days";
  }
  function notes(rows, on, cur) {
    const gaps = []; let g = null;
    rows.forEach((r) => { if (!ok(r.total)) { const why = r.missing.length ? r.missing.map((a) => nameOf(a, ctx.reg)).join("+") : "FX"; if (!g || g.why !== why) { if (g) gaps.push(g); g = { a: r.time, b: r.time, why }; } else g.b = r.time; } else if (g) { gaps.push(g); g = null; } }); if (g) gaps.push(g);
    const per = ctx.all.map((st) => "<li><b>" + esc(st.name || "Wallet") + "</b>: " + (st.mode === "stake" ? "whole wallet, " + st.addrs.length + " address" + (st.addrs.length > 1 ? "es" : "") + " found" + (st.capped ? " (capped at " + MAX_ADDR + ")" : "") : "this address only") + " · " + (st.from ? dstr(st.from) + " → today" + (st.full ? " (complete since the first transaction)" : "") : "not covered yet") + " · " + Object.keys(st.txs).length + " txs" + (st.at ? " · refreshed " + ctstr(st.at) : "") + (st.err ? ' · <span class="warn">' + errText(st.err) + "</span>" : "") + "</li>").join("");
    const R = RANGES.find((r) => r[0] === prefs.range), cutT = R && R[1] > 0 ? today0() - R[1] * DAY : null;
    $("phNote").innerHTML = "<b>Coverage</b><ul class=\"phul\">" + per + "</ul>" +
      (cutT && ctx.B.from > cutT ? '<p class="warn">This range starts before the covered window, so only ' + dstr(ctx.B.from) + " onward is shown. Use “Load further back” to extend it.</p>" : "") +
      (gaps.length ? '<p class="warn">' + gaps.length + " gap" + (gaps.length > 1 ? "s" : "") + " (left empty, never filled in): " + gaps.slice(0, 5).map((x) => dstr(x.a) + (x.b !== x.a ? "–" + dstr(x.b) : "") + " (no " + esc(x.why) + " price)").join(", ") + (gaps.length > 5 ? "…" : "") + ". Turning off an asset without prices removes its gaps (and its value).</p>" : "") +
      "<p>How it works: balances are rebuilt backwards from today’s on-chain balance by undoing each transaction (failed script transactions are skipped). Values are daily closes in UTC × that day’s price. " +
      "Whole wallet finds addresses through the wallet’s own transactions (Koios blocks browser requests), so an address that never moved funds together with the others may be missed; pointer/enterprise addresses and unwithdrawn staking rewards are not included. " +
      "Prices: SNEK on-chain DEX daily (GeckoTerminal, ~180 days) and Gate.io before that (from Dec 27, 2023; no SNEK price earlier); ADA/USD Kraken (~720 days), Coinbase before that (ADA-USD since Mar 2021), else implied by SNEK USD ÷ SNEK ADA; other tokens GeckoTerminal daily (~180 days, top pool). Illiquid tokens only have prices on days they traded, so a token priced on fewer than 90% of the days it was held starts switched off (missing days are never filled); " + (cur !== "USD" && cur !== "ADA" ? cur + " at the ECB reference rate (Frankfurter), using the last fixing on weekends/holidays; " : "") + "today uses live prices. " +
      "Buy/sell markers need SNEK and ADA moving in opposite directions in the same transaction; swaps through DEX order contracts show as separate Out/In transfers. Transactions and prices are cached in this browser (IndexedDB) so reopening only fetches what’s new. Not financial or tax advice.</p>";
  }

  // ---------- CSV + share ----------
  function csv() {
    if (!ctx || !ctx.rows) return; const cur = curNow(), on = ctx.on, rows = ctx.rows;
    const head = ["date_utc", "total_" + cur, "change_" + cur, "change_pct", "price_pl_" + cur, "net_transfers_" + cur].concat(on.map((a) => label(a) + "_balance"), on.map((a) => label(a) + "_value_" + cur), ["ada_usd", "ada_usd_source", "snek_usd", "fx_factor", "txs", "missing_prices"]);
    const lines = [head.join(",")];
    rows.forEach((r, i) => { const p = rows[i - 1]; let pl = null; if (p) { pl = 0; for (const a of on) { const q = p.bal[a]; if (!q) continue; if (!ok(p.up[a]) || !ok(r.up[a])) { pl = null; break; } pl += q * (r.up[a] - p.up[a]); } }
      const ch = p && ok(p.total) && ok(r.total) ? r.total - p.total : null, n = (v) => (ok(v) ? +v.toPrecision(10) : "");
      lines.push([iso(r.time), n(r.total), n(ch), ok(ch) && p.total > 0 ? n((ch / p.total) * 100) : "", n(pl), ok(ch) && ok(pl) ? n(ch - pl) : ""].concat(on.map((a) => n(r.bal[a])), on.map((a) => n(r.v[a])), [n(r.aU), r.aSrc, n(r.sU), n(r.k), r.txs.length, '"' + r.missing.map((a) => nameOf(a, ctx.reg)).join(" ") + '"']).join(",")); });
    const blob = new Blob(["# SNEK Dashboard (fan-made) portfolio history · " + sel.label + " · real on-chain data, empty cells = no data (never interpolated)\n" + lines.join("\n")], { type: "text/csv" });
    const u = URL.createObjectURL(blob), a = document.createElement("a"); a.href = u; a.download = "snek-portfolio-" + String(sel.label).replace(/[^a-z0-9$]+/gi, "-").slice(0, 30) + "-" + iso(rows[0].time) + "-" + iso(rows[rows.length - 1].time) + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(u); a.remove(); }, 800);
  }
  function share() {
    if (!ctx || !ctx.S || !window.SNEKSHARE || !chart) return; const S = ctx.S, cur = curNow(), R = (RANGES.find((r) => r[0] === prefs.range) || RANGES[4])[2];
    const q = sel.kind === "one" ? (/^\$/.test(sel.spec.name) ? sel.spec.name : sel.spec.address || sel.spec.stake) : null;
    SNEKSHARE.open({ title: "Share portfolio history", kind: "portfolio", wallet: q, section: q ? null : "wallets",
      text: (q && q.startsWith("$") ? q + "’s" : "This") + " SNEK portfolio over " + R + ": " + pctS(S.chPct) + " (" + cur + "), max drawdown " + S.mdd.toFixed(1) + "%. Real on-chain history on the free, fan-made dashboard by @DavidSandy 🐍",
      png: () => SNEKSHARE.frameImage(async (g, Wd, H, snek) => {
        const shot = chart.takeScreenshot();
        g.fillStyle = "#0e1417"; g.beginPath(); g.roundRect ? g.roundRect(48, 150, Wd - 96, H - 222, 18) : g.rect(48, 150, Wd - 96, H - 222); g.fill();
        const r = Math.min((Wd - 120) / shot.width, (H - 246) / shot.height), w = shot.width * r, h = shot.height * r; g.drawImage(shot, (Wd - w) / 2, 162 + (H - 246 - h) / 2, w, h);
        g.textAlign = "right"; g.fillStyle = S.ch >= 0 ? snek : "#fc4c61"; g.font = "800 34px Inter, system-ui, sans-serif"; g.fillText(pctS(S.chPct) + " · " + R, Wd - 48, 70);
        g.fillStyle = "#f4f3ef"; g.font = "600 20px Inter, system-ui, sans-serif"; g.fillText((sel.kind === "one" ? sel.spec.name : sel.label) + " · " + fmt(S.last.total, cur) + " · max DD " + S.mdd.toFixed(1) + "%", Wd - 48, 100);
        g.fillStyle = "#8fa3ab"; g.font = "500 16px Inter, system-ui, sans-serif"; g.fillText("Daily closes (UTC) · real on-chain history · " + dstr(S.first.time) + " → " + dstr(S.last.time), Wd - 48, 128); g.textAlign = "left";
      }, { title: "SNEK portfolio history" }) });
  }

  // ---------- selection + events ----------
  function select(kind, spec) {
    sel = kind === "all" ? { kind: "all", key: "__all", label: "All tracked wallets" } : { kind: "one", spec, key: spec.key, label: spec.name };
    prefs = prefsOf(sel.key); if (kind === "one" && !spec.canStake) prefs.scope = "addr"; if (kind === "one" && !spec.canAddr) prefs.scope = "stake";
    showAllDays = false; ctx = null; pickers();
    const b = $("phBody"); if (!b) return; if (chart) { try { chart.remove(); } catch (e) {} chart = null; }
    b.innerHTML = shell(); progress("Loading…", 0.02); run();
  }
  const setPref = (k, v, redraw) => { prefs[k] = v; savePrefs(sel.key, prefs); if (redraw !== false) draw(); };
  function init() {
    const card = document.querySelector('.w[data-w="whist"]'); if (!card) return;
    empty("Look up a wallet above (addr1…, stake1… or $handle), or track one, to see its value over time from real on-chain history.");
    card.addEventListener("click", (e) => {
      const a = e.target.closest("#phPick [data-k]"); if (a) { if (a.dataset.k === "__all") select("all"); else { const sp = walletSpecs().find((x) => x.key === a.dataset.k); if (sp) select("one", sp); } return; }
      if (!sel) return;
      const sc = e.target.closest("#phScope [data-s]"); if (sc) { setPref("scope", sc.dataset.s, false); select("one", sel.spec); return; }
      const r = e.target.closest("#phRange [data-r]"); if (r) { prefs.range = r.dataset.r; $("phRange").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === r)); $("phCustom").hidden = prefs.range !== "custom"; if (prefs.range === "custom" && !prefs.from && ctx && ctx.rowsAll && ctx.rowsAll.length) { prefs.from = iso(Math.max(ctx.rowsAll[0].time, today0() - 30 * DAY)); prefs.to = iso(today0()); $("phFrom").value = prefs.from; $("phTo").value = prefs.to; } setPref("range", prefs.range); return; }
      const segs = [["#phType [data-t]", "type", "t"], ["#phView [data-v]", "view", "v"], ["#phBench [data-b]", "bench", "b"]];
      for (const [q, k, d] of segs) { const x = e.target.closest(q); if (x) { x.parentElement.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === x)); setPref(k, x.dataset[d]); return; } }
      const ch = e.target.closest("[data-as]"); if (ch && ctx) { const as = ch.dataset.as, off = prefs.off.filter((x) => x !== as), on = (prefs.on || []).filter((x) => x !== as);
        if (isOn(as)) { if (ctx.assets.filter(isOn).length <= 1) return; off.push(as); } else on.push(as);
        prefs.on = on; setPref("off", off); return; }
      if (e.target.closest("#phCsv")) return csv();
      if (e.target.closest("#phShare")) return share();
      if (e.target.closest("#phRefresh")) { tokFail.clear(); (sel.kind === "all" ? walletSpecs().filter((x) => x.tracked).map((x) => specKey(x, "stake")) : [specKey(sel.spec, prefs.scope)]).forEach((sp) => { const st = mem[sp.key]; if (st) st.at = 0; }); return run(); }
      if (e.target.closest("#phRetry")) return run();
      const m = e.target.closest("#phMore"); if (m) { m.disabled = true; m.textContent = "Loading…"; return run(PAGE_BUDGET); }
      if (e.target.closest("#phAllDays")) { showAllDays = true; draw(); }
    });
    card.addEventListener("change", (e) => {
      if (!sel) return; const t = e.target;
      if (t.id === "phCur") setPref("cur", t.value);
      else if (t.id === "phLog") setPref("log", t.checked); else if (t.id === "phSmooth") setPref("smooth", t.checked); else if (t.id === "phMarkers") setPref("markers", t.checked); else if (t.id === "phDD") setPref("dd", t.checked);
      else if (t.id === "phFrom" || t.id === "phTo") { prefs.from = $("phFrom").value || null; prefs.to = $("phTo").value || null; setPref("range", "custom"); }
    });
    card.addEventListener("toggle", (e) => { if (e.target.classList && e.target.classList.contains("phopts")) store.set("snek-ph-optsopen", e.target.open); }, true);
    window.addEventListener("snek:wallet", (e) => { const w = e.detail; if (!w || (!w.address && !w.stake)) return; const sp = walletSpecs().find((x) => x.key === "cur:" + (w.stake || w.address)); if (sp && (!sel || sel.key !== sp.key)) select("one", sp); else pickers(); });
    window.addEventListener("snek:watch", () => pickers());
    window.addEventListener("snek:theme", () => { if (ctx) draw(); });
    window.addEventListener("snek:fmt", () => { if (ctx && !prefs.cur) draw(); });
    pickers();
  }
  window.SNEKPHIST = { select, state: (k) => mem[k], ctx: () => ctx, clearCache: async () => { (await idb.keys()).forEach((k) => idb.del(k)); Object.keys(mem).forEach((k) => delete mem[k]); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
