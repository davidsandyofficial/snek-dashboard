/* Sharing for the fan-made SNEK dashboard: share sheet (X intent mentioning @DavidSandy, Web Share API, copy link),
   branded PNG snapshots drawn on a canvas (chart, wallet card, whale move) with the site URL watermark,
   deep links (#wallet=, #chart=, #layout=, #s=) and one gentle share nudge after a positive moment. No popups. */
(function () {
  "use strict";
  const SITE = "https://davidsandyofficial.github.io/snek-dashboard/", SHORT = "davidsandyofficial.github.io/snek-dashboard";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast = (m, t) => (window.SNEKFX ? SNEKFX.toast(m, t || "ok", 3500) : null);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const cmp = (v) => (isFinite(v) ? Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : "–");
  const imgs = {};
  const img = (src) => imgs[src] || (imgs[src] = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  // section pages carry per-section OG/Twitter images and forward to the dashboard
  const SECTION_PAGE = { chart: "s/chart.html", wallets: "s/wallets.html", holders: "s/holders.html", trades: "s/holders.html" };
  function linkFor(o) {
    o = o || {};
    if (o.wallet) return SITE + "s/wallets.html#wallet=" + encodeURIComponent(o.wallet);
    if (o.chart) return SITE + "s/chart.html#" + o.chart;
    if (o.section && SECTION_PAGE[o.section]) return SITE + SECTION_PAGE[o.section];
    if (o.section) return SITE + "#s=" + o.section;
    return SITE;
  }
  function chartHash() {
    const st = window.SNEKAPP && SNEKAPP.state && SNEKAPP.state.chart; if (!st) return "chart=1H";
    const ind = window.SNEKIND ? SNEKIND.active().map((c) => c.id).join(",") : "";
    return "chart=" + st.iv + (st.cur === "ada" ? "&cur=ada" : "") + (st.type === "line" ? "&type=line" : "") + (ind ? "&ind=" + ind : "");
  }

  // ---------- branded canvas frame ----------
  async function frame(draw, opts) {
    const W = 1200, H = 675, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), snek = css("--snek") || "#18f2b2", bg = "#05080a";
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "#0b1416"); gr.addColorStop(1, bg); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W - 160, 120, 10, W - 160, 120, 520); rg.addColorStop(0, snek + "33"); rg.addColorStop(1, "transparent"); g.fillStyle = rg; g.fillRect(0, 0, W, H);
    const logo = await img("assets/brand/snek-logomark.svg"); if (logo) g.drawImage(logo, 48, 36, 46, 43);
    g.fillStyle = "#f4f3ef"; g.font = "800 30px Inter, system-ui, sans-serif"; g.fillText(opts.title || "SNEK Dashboard", 108, 68);
    g.font = "600 16px Inter, system-ui, sans-serif"; g.fillStyle = snek; g.fillText("Fan-made · Unofficial · Not affiliated with SNEK", 108, 92);
    await draw(g, W, H, snek);
    g.fillStyle = "rgba(5,8,10,.82)"; g.fillRect(0, H - 54, W, 54);
    g.fillStyle = "#f4f3ef"; g.font = "700 20px Inter, system-ui, sans-serif"; g.fillText(SHORT, 48, H - 20);
    g.fillStyle = "#8fa3ab"; g.font = "500 16px Inter, system-ui, sans-serif"; g.textAlign = "right"; g.fillText("by @DavidSandy · SNEK art © SNEK · not financial advice", W - 48, H - 21); g.textAlign = "left";
    return c;
  }
  async function chartPNG() {
    const ch = window.SNEKAPP && SNEKAPP.chart && SNEKAPP.chart(); if (!ch) throw new Error("Chart not ready");
    const shot = ch.takeScreenshot(), st = SNEKAPP.state.chart, m = SNEKAPP.state.market || {};
    return frame(async (g, W, H) => {
      g.fillStyle = "#0e1417"; roundRect(g, 48, 118, W - 96, H - 190, 18); g.fill();
      const r = Math.min((W - 120) / shot.width, (H - 214) / shot.height), w = shot.width * r, h = shot.height * r;
      g.drawImage(shot, (W - w) / 2, 130 + (H - 214 - h) / 2, w, h);
      g.fillStyle = "#f4f3ef"; g.font = "700 22px Inter, system-ui, sans-serif"; g.textAlign = "right";
      g.fillText("SNEK/" + (st.cur === "ada" ? "ADA" : "USD") + " · " + st.iv + (isFinite(m.price) ? " · $" + Number(m.price.toPrecision(4)) : ""), W - 48, 70);
      g.textAlign = "left";
    }, { title: "SNEK price chart" });
  }
  async function walletPNG(w) {
    const nm = (window.SNEKWALLETS && w) ? (w.query && w.query.startsWith("$") ? w.query : (w.address || w.stake || "").slice(0, 12) + "…") : "Wallet";
    const mk = (window.SNEKAPP && SNEKAPP.state.market) || {}, p = mk.price, au = mk.adaUsd;
    const sv = isFinite(w.snek) && p ? w.snek * p : null, av = isFinite(w.ada) && au ? w.ada * au : null;
    const usdV = sv == null && av == null ? null : (sv || 0) + (av || 0);
    const mascot = await img("assets/brand/snek-mascot-front.webp");
    return frame(async (g, W, H, snek) => {
      g.fillStyle = "#0e1417"; roundRect(g, 48, 130, 760, 420, 26); g.fill(); g.strokeStyle = snek + "88"; g.lineWidth = 2; g.stroke();
      let hh = 0; for (const ch of String(w.address || w.stake || "snek")) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0; const hue = hh % 360;
      const ag = g.createLinearGradient(90, 170, 190, 270); ag.addColorStop(0, "hsl(" + hue + ",85%,55%)"); ag.addColorStop(1, "hsl(" + ((hue + 70) % 360) + ",85%,50%)");
      g.fillStyle = ag; g.beginPath(); g.arc(140, 220, 50, 0, 7); g.fill();
      g.fillStyle = "#fff"; g.font = "800 34px Inter, system-ui, sans-serif"; g.textAlign = "center"; g.fillText(nm.replace(/^\$/, "").slice(0, 2).toUpperCase(), 140, 232); g.textAlign = "left";
      g.fillStyle = "#f4f3ef"; g.font = "800 40px Inter, system-ui, sans-serif"; g.fillText(nm.slice(0, 22), 214, 212);
      g.fillStyle = "#8fa3ab"; g.font = "500 20px Inter, system-ui, sans-serif"; g.fillText("Cardano wallet · read-only snapshot", 214, 246);
      g.fillStyle = snek; g.font = "900 76px Inter, system-ui, sans-serif"; g.fillText(usdV != null ? "$" + cmp(usdV) : "–", 90, 372);
      g.fillStyle = "#8fa3ab"; g.font = "500 18px Inter, system-ui, sans-serif"; g.fillText(usdV != null ? (sv != null && av != null ? "SNEK + ADA value (USD)" : sv != null ? "SNEK value (USD)" : "ADA value (USD)") : "Value unavailable", 92, 398);
      g.fillStyle = "#f4f3ef"; g.font = "600 28px Inter, system-ui, sans-serif"; g.fillText((isFinite(w.snek) ? cmp(w.snek) + " SNEK" : "") + (isFinite(w.ada) ? "  ·  " + cmp(w.ada) + " ADA" : ""), 90, 432);
      g.fillStyle = "#8fa3ab"; g.font = "500 18px Inter, system-ui, sans-serif"; g.fillText("Snapshot " + new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date()) + " CT · public on-chain data", 90, 500);
      if (mascot) g.drawImage(mascot, W - 360, 150, 300, 300 * mascot.height / mascot.width);
    }, { title: "SNEK wallet tracker" });
  }
  async function whalePNG(it) {
    const face = await img(it.buy ? "assets/brand/snek-face-tongue.webp" : "assets/brand/snek-face-shock.webp");
    return frame(async (g, W, H, snek) => {
      const red = css("--red") || "#fc4c61", col = it.buy ? snek : red;
      g.fillStyle = "#0e1417"; roundRect(g, 48, 140, W - 96, 380, 26); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.stroke();
      const parts = it.text.split(" · ");
      g.fillStyle = col; g.font = "900 66px Inter, system-ui, sans-serif"; g.fillText((it.buy ? "🐋 " : "📤 ") + (parts[0] || "").slice(0, 18), 90, 240);
      g.fillStyle = "#f4f3ef"; g.font = "800 40px Inter, system-ui, sans-serif"; g.fillText((parts[1] || "").slice(0, 28), 90, 300);
      g.font = "600 26px Inter, system-ui, sans-serif"; g.fillText(it.sub.slice(0, 44), 90, 360);
      g.fillStyle = "#8fa3ab"; g.font = "500 22px Inter, system-ui, sans-serif"; g.fillText(it.when || "", 90, 404);
      g.fillText("SNEK whale feed · live public data", 90, 480);
      if (face) { const fw = 250; g.drawImage(face, W - fw - 90, 200, fw, fw * face.height / face.width); }
    }, { title: "SNEK whale move" });
  }
  // price share card: live price, 24h/7d change, market cap and a real 7-day hourly sparkline (assets/history/1H)
  async function priceCardPNG() {
    const m = (window.SNEKAPP && SNEKAPP.state && SNEKAPP.state.market) || {};
    let pts = [];
    try { const h = await SNEKHIST.latest("1H", "usd"); const from = Date.now() / 1000 - 7 * 86400; pts = h.bars.filter((b) => b.time >= from && isFinite(b.close)).map((b) => b.close); } catch (e) {}
    if (pts.length && isFinite(m.price)) pts.push(m.price);
    const up = isFinite(m.ch24) ? m.ch24 >= 0 : true;
    const mascot = await img("assets/brand/snek-mascot-front.webp");
    return frame(async (g, W, H, snek) => {
      const red = css("--red") || "#fc4c61", col = up ? snek : red;
      g.fillStyle = "#0e1417"; roundRect(g, 48, 122, W - 96, H - 196, 26); g.fill(); g.strokeStyle = col + "88"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "#8fa3ab"; g.font = "600 22px Inter, system-ui, sans-serif"; g.fillText("SNEK / USD · live", 90, 176);
      g.fillStyle = "#f4f3ef"; g.font = "900 92px Inter, system-ui, sans-serif"; g.fillText(isFinite(m.price) ? "$" + Number(m.price.toPrecision(5)) : "Price unavailable", 86, 270);
      const pc = (v) => (isFinite(v) ? (v >= 0 ? "▲ +" : "▼ −") + Math.abs(v).toFixed(2) + "%" : "–");
      g.fillStyle = col; g.font = "800 40px Inter, system-ui, sans-serif"; g.fillText(pc(m.ch24) + "  24h", 90, 328);
      g.fillStyle = "#c9d4d8"; g.font = "600 24px Inter, system-ui, sans-serif";
      g.fillText("7d " + pc(m.ch7) + (isFinite(m.mcap) ? "   ·   Market cap $" + cmp(m.mcap) : "") + (isFinite(m.vol) ? "   ·   24h vol $" + cmp(m.vol) : ""), 90, 372);
      if (pts.length > 2) {
        const x0 = 90, x1 = W - 380, y0 = 400, y1 = H - 100, lo = Math.min(...pts), hi = Math.max(...pts), sx = (i) => x0 + (i / (pts.length - 1)) * (x1 - x0), sy = (v) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);
        const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, col + "55"); gr.addColorStop(1, col + "00");
        g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(sx(i), sy(v)) : g.moveTo(sx(i), sy(v)))); g.lineTo(x1, y1); g.lineTo(x0, y1); g.closePath(); g.fillStyle = gr; g.fill();
        g.beginPath(); pts.forEach((v, i) => (i ? g.lineTo(sx(i), sy(v)) : g.moveTo(sx(i), sy(v)))); g.strokeStyle = col; g.lineWidth = 4; g.lineJoin = "round"; g.stroke();
        g.fillStyle = "#8fa3ab"; g.font = "500 16px Inter, system-ui, sans-serif"; g.fillText("Last 7 days · hourly closes", x0, y1 + 22);
      } else { g.fillStyle = "#8fa3ab"; g.font = "500 18px Inter, system-ui, sans-serif"; g.fillText("7-day chart unavailable right now", 90, 440); }
      if (mascot) g.drawImage(mascot, W - 330, 150, 250, 250 * mascot.height / mascot.width);
      g.fillStyle = "#8fa3ab"; g.font = "500 16px Inter, system-ui, sans-serif"; g.textAlign = "right";
      g.fillText(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date()) + " CT", W - 70, H - 82); g.textAlign = "left";
    }, { title: "SNEK live price" });
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ---------- share sheet ----------
  let sheet = null, cur = null;
  function open(o) {
    o = o || {}; cur = o; const url = o.url || linkFor(o);
    const text = o.text || "Tracking $SNEK on this free, fan-made dashboard by @DavidSandy 🐍 Live price, chart, whales and wallets.";
    if (!sheet) { sheet = document.createElement("div"); sheet.className = "spanel share"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Share"); document.body.appendChild(sheet); sheet.addEventListener("click", onClick); sheet.addEventListener("change", onToggle); }
    sheet.innerHTML = '<div class="sback" data-x></div><div class="ssheet"><div class="shead"><img src="assets/brand/snek-face-grin.webp" alt="" width="40" height="24"><b class="grow">' + esc(o.title || "Share") + '</b><button type="button" class="icon-btn sm" data-x aria-label="Close">✕</button></div><div class="sbody">' +
      (o.png ? '<div class="shprev"><div class="skel h120"></div></div>' : "") +
      (o.toggle ? '<label class="shtgl"><input type="checkbox" id="shTgl"' + (o.toggle.on ? " checked" : "") + "> " + esc(o.toggle.label) + "</label>" : "") +
      '<textarea id="shText" rows="3" maxlength="260">' + esc(text) + '</textarea><div class="shlink mono small">' + esc(url) + "</div>" +
      '<div class="shbtns"><button type="button" class="btn primary" data-sh="x">𝕏 Post on X</button>' + (navigator.share ? '<button type="button" class="btn" data-sh="native">↗ Share…</button>' : "") + '<button type="button" class="btn" data-sh="copy">🔗 Copy link</button>' + (o.png ? '<button type="button" class="btn" data-sh="png">⬇ Save image</button>' : "") + "</div>" +
      (o.png ? '<p class="muted small">On X, attach the saved image to your post. Your phone’s Share… can send the image directly.</p>' : "") +
      '<p class="muted small">Nothing is posted for you. You review and send it yourself. Fan-made dashboard, not affiliated with SNEK.</p></div></div>';
    sheet.hidden = false; requestAnimationFrame(() => sheet.classList.add("open"));
    cur.url = url; cur.blob = null;
    render(o);
  }
  function render(o) {
    cur.blob = null; const pv0 = sheet.querySelector(".shprev"); if (pv0 && o.png) pv0.innerHTML = '<div class="skel h120"></div>';
    const on = o.toggle ? !!o.toggle.on : undefined;
    const tok = (cur.tok = (cur.tok || 0) + 1);
    if (o.png) o.png(on).then((c) => new Promise((res) => c.toBlob(res, "image/png"))).then((b) => { if (tok !== cur.tok) return; cur.blob = b; const pv = sheet.querySelector(".shprev"); if (pv) { const u = URL.createObjectURL(b); pv.innerHTML = '<img src="' + u + '" alt="Share image preview">'; } }).catch((e) => { const pv = sheet.querySelector(".shprev"); if (pv) pv.innerHTML = '<p class="small warn">Couldn’t make the image: ' + esc(e.message) + "</p>"; });
  }
  function onToggle(e) {
    if (!cur || !cur.toggle || e.target.id !== "shTgl") return;
    cur.toggle.on = e.target.checked;
    if (cur.toggle.apply) { const r = cur.toggle.apply(cur.toggle.on) || {}; if (r.text != null && $("shText")) $("shText").value = r.text; if (r.url) { cur.url = r.url; const l = sheet.querySelector(".shlink"); if (l) l.textContent = r.url; } }
    render(cur);
  }
  function close() { if (!sheet) return; sheet.classList.remove("open"); setTimeout(() => { sheet.hidden = true; }, 220); }
  function onClick(e) {
    if (e.target.closest("[data-x]")) return close();
    const b = e.target.closest("[data-sh]"); if (!b || !cur) return;
    const text = ($("shText") || {}).value || "", url = cur.url, a = b.dataset.sh;
    if (a === "x") window.open("https://x.com/intent/post?text=" + encodeURIComponent(text) + "&url=" + encodeURIComponent(url), "_blank", "noopener");
    else if (a === "copy") (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast("Link copied"), () => prompt("Copy this link", url));
    else if (a === "png") { if (!cur.blob) return toast("Image still rendering…", "info"); const u = URL.createObjectURL(cur.blob), x = document.createElement("a"); x.href = u; x.download = "snek-" + (cur.kind || "snapshot") + "-" + new Date().toISOString().slice(0, 10) + ".png"; document.body.appendChild(x); x.click(); setTimeout(() => { URL.revokeObjectURL(u); x.remove(); }, 800); }
    else if (a === "native") {
      const data = { title: "SNEK Dashboard (Fan-made)", text, url };
      if (cur.blob) { const f = new File([cur.blob], "snek-" + (cur.kind || "snapshot") + ".png", { type: "image/png" }); if (navigator.canShare && navigator.canShare({ files: [f] })) data.files = [f]; }
      navigator.share(data).catch(() => {});
    }
  }

  // ---------- public helpers used by other modules ----------
  const API = {
    open, close, linkFor,
    price() {
      const m = (window.SNEKAPP && SNEKAPP.state && SNEKAPP.state.market) || {}, p = m.price;
      open({ title: "Share a SNEK price card", kind: "price", png: priceCardPNG,
        text: "$SNEK " + (isFinite(p) ? "$" + Number(p.toPrecision(4)) : "") + (isFinite(m.ch24) ? " (" + (m.ch24 >= 0 ? "+" : "−") + Math.abs(m.ch24).toFixed(1) + "% 24h)" : "") + " 🐍 Live price, chart, whales and wallets on the free, fan-made SNEK dashboard by @DavidSandy" });
    },
    chart() { open({ title: "Share this chart", kind: "chart", chart: chartHash(), png: chartPNG, text: "$SNEK " + ((SNEKAPP.state.chart || {}).iv || "") + " chart on the free, fan-made SNEK dashboard by @DavidSandy 📈" }); },
    wallet(w) { const q = w.query && w.query.startsWith("$") ? w.query : w.address || w.stake; open({ title: "Share this wallet", kind: "wallet", wallet: q, png: () => walletPNG(w), text: "Checking " + (q.startsWith("$") ? q : "this wallet") + " on the free, fan-made SNEK dashboard by @DavidSandy 🐍" }); },
    whale(it) { open({ title: "Share this whale move", kind: "whale", section: "trades", png: () => whalePNG(it), text: (it.buy ? "🐋 " : "📤 ") + "$SNEK whale move: " + it.text + ". Spotted on the free, fan-made dashboard by @DavidSandy" }); },
    // one gentle nudge after a positive moment, at most once a week
    nudge(reason, payload) {
      try { if (Date.now() - +(localStorage.getItem("snek-nudge") || 0) < 7 * 86400000) return; localStorage.setItem("snek-nudge", Date.now()); } catch (e) { return; }
      const bar = document.createElement("div"); bar.className = "updbar nudge"; bar.setAttribute("role", "status");
      bar.innerHTML = "<span>" + esc(reason) + '</span><button type="button" class="btn primary">Share</button><button type="button" class="icon-btn sm" aria-label="Dismiss">✕</button>';
      document.body.appendChild(bar); requestAnimationFrame(() => bar.classList.add("show"));
      const done = () => { bar.classList.remove("show"); setTimeout(() => bar.remove(), 300); };
      bar.addEventListener("click", (e) => { if (e.target.closest(".primary")) { done(); payload ? API.wallet(payload) : open({}); } else if (e.target.closest(".icon-btn")) done(); });
      setTimeout(done, 9000);
    },
    chartHash,
    frameImage: frame,
  };
  window.SNEKSHARE = API;

  function init() {
    // section deep link (#s=wallets) and chart deep link (#chart=…) scroll into place once the page settles
    const h = location.hash, s = h.match(/^#s=([a-z]+)/), c = h.match(/^#chart=/);
    if (s || c) setTimeout(() => { if (window.SNEKLAYOUT) SNEKLAYOUT.goto(s ? s[1] : "chart"); }, 900);
    const cb = $("chartShare"); if (cb) cb.addEventListener("click", () => API.chart());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
