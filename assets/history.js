/* Long candle history built by the GitHub Action (scripts/update_history.py) and stored in assets/history/<iv>/.
   Chunks of 1,000 candles are fetched on demand, so older candles load only when you scroll left (or when a
   wallet's PnL estimate needs a price from that time). Candle: [time, open, high, low, close, volumeUSD, source]. */
(function () {
  "use strict";
  const BASE = "assets/history/";
  const idx = {}, chunks = {};
  const getJSON = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  function index(iv) {
    const c = idx[iv];
    if (c && Date.now() - c.t < 600000) return c.p;
    const p = getJSON(BASE + iv + "/index.json").catch((e) => { delete idx[iv]; throw e; });
    idx[iv] = { t: Date.now(), p }; return p;
  }
  function chunk(iv, file, stamp) {
    const k = iv + "/" + file + "?" + (stamp || "");
    if (!chunks[k]) chunks[k] = getJSON(BASE + iv + "/" + file + (stamp ? "?v=" + encodeURIComponent(stamp) : "")).catch((e) => { delete chunks[k]; throw e; });
    return chunks[k];
  }
  const toBar = (b) => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5], src: b[6] });
  async function bars(iv, cur, ci) { const ix = await index(iv); const c = ix.chunks[ci]; if (!c) return []; const last = ci === ix.chunks.length - 1; const body = await chunk(iv, c.file, last ? ix.updatedAt : c.to); return (body[cur === "ada" ? "ada" : "usd"] || []).map(toBar); }
  // newest chunk, plus the chunk index so the chart can ask for older ones
  async function latest(iv, cur) { const ix = await index(iv); if (!ix.chunks.length) return { bars: [], ci: -1, ix }; const ci = ix.chunks.length - 1; return { bars: await bars(iv, cur, ci), ci, ix }; }
  async function older(iv, cur, ci) { if (ci <= 0) return { bars: [], ci: -1 }; return { bars: await bars(iv, cur, ci - 1), ci: ci - 1 }; }
  // USD (or ADA) close price for a unix time: hourly candles first, daily as fallback
  async function priceAt(ts, cur) {
    for (const iv of ["1H", "4H", "1D"]) {
      try {
        const ix = await index(iv); const step = iv === "1H" ? 3600 : iv === "4H" ? 14400 : 86400;
        const ci = ix.chunks.findIndex((c) => ts >= c.from && ts <= c.to + step); if (ci < 0) continue;
        const bs = await bars(iv, cur, ci); let best = null;
        for (const b of bs) { if (b.time <= ts) best = b; else break; }
        if (best && ts - best.time <= step * 2) return { price: best.close, iv, src: best.src };
      } catch (e) {}
    }
    return null;
  }
  window.SNEKHIST = { index, latest, older, priceAt };
})();
