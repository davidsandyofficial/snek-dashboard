/* Interaction layer for the fan-made SNEK dashboard: price flash + rolling digits, count-ups,
   ripple/press feedback, swipe between sections, pull-to-refresh, scroll reveal, trade slide-in
   with whale splash, header sparkline, stacked toasts, haptics. Respects prefers-reduced-motion. */
(function () {
  "use strict";
  const mq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const reduced = () => mq.matches;
  const $ = (id) => document.getElementById(id);
  const FX = {};

  // ---- haptics ----
  // Only after the user has interacted (browsers block vibrate before a tap); silently skipped on iOS/desktop.
  FX.haptic = (p) => { try { const ua = navigator.userActivation; if (!reduced() && navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(p || 8); } catch (e) {} };

  // ---- toasts (stacked, typed) ----
  FX.toast = (msg, type, ms) => {
    let wrap = $("toasts");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "toasts"; wrap.className = "toasts"; wrap.setAttribute("aria-live", "polite"); document.body.appendChild(wrap); }
    const t = document.createElement("div");
    t.className = "toast2 " + (type || "info");
    const icon = { info: "ℹ️", ok: "✅", warn: "⚠️", alert: "🔔", whale: "🐋" }[type || "info"] || "ℹ️";
    t.innerHTML = '<span class="ti">' + icon + "</span><span></span>";
    t.lastChild.textContent = msg;
    wrap.appendChild(t);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, ms || 2800);
  };

  // ---- price: rolling digits + flash ----
  const lastPrice = {};
  FX.price = (el, text, value) => {
    if (!el) return;
    const prev = lastPrice[el.id];
    lastPrice[el.id] = value;
    const old = el.dataset.txt || "";
    el.dataset.txt = text;
    if (reduced() || !old || old.length !== text.length) { el.textContent = text; }
    else {
      el.innerHTML = [...text].map((ch, i) => {
        const changed = ch !== old[i];
        return changed ? '<span class="dg roll"><span class="o">' + old[i] + "</span><span class=\"n\">" + ch + "</span></span>" : '<span class="dg">' + ch + "</span>";
      }).join("");
    }
    if (prev !== undefined && value !== prev && isFinite(prev)) {
      const up = value > prev;
      el.classList.remove("flash-up", "flash-down"); void el.offsetWidth;
      el.classList.add(up ? "flash-up" : "flash-down");
      if (el.id === "price") FX.haptic(5);
    }
  };

  // ---- count-up ----
  FX.countUp = (el, to, fmt, ms) => {
    if (!el || !isFinite(to)) return;
    const from = parseFloat(el.dataset.val);
    el.dataset.val = to;
    const start = isFinite(from) ? from : (el.dataset.counted ? to : 0);
    el.dataset.counted = "1";
    if (reduced() || start === to) { el.innerHTML = fmt(to); return; }
    const t0 = performance.now(), d = ms || 900;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3);
      el.innerHTML = fmt(start + (to - start) * e);
      if (k < 1 && el.dataset.val == String(to)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ---- header sparkline ----
  FX.spark = (el, values) => {
    if (!el || !values || values.length < 2) return;
    const W = 84, H = 26, mn = Math.min(...values), mx = Math.max(...values), r = mx - mn || mx * 0.01 || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 2 - ((v - mn) / r) * (H - 4)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const up = values[values.length - 1] >= values[0];
    const last = pts[pts.length - 1];
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><path d="' + d + " L" + W + " " + H + " L0 " + H + ' Z" class="sp-area ' + (up ? "up" : "down") + '"/><path d="' + d + '" class="sp-line ' + (up ? "up" : "down") + '"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.4" class="sp-dot ' + (up ? "up" : "down") + '"/></svg>';
    el.title = "Last 24h";
  };

  // ---- trades: slide-in + whale splash ----
  const seen = new Set(); let primed = false;
  FX.trades = (table, rows, isWhale) => {
    if (!table) return;
    const fresh = [];
    table.querySelectorAll("tr[data-tx]").forEach((tr) => {
      const tx = tr.dataset.tx;
      if (!seen.has(tx)) { seen.add(tx); if (primed) { tr.classList.add("slide-in"); fresh.push(tr); } }
    });
    primed = true;
    const whales = fresh.filter((tr) => tr.classList.contains("whale"));
    if (whales.length) {
      FX.haptic([20, 40, 20]);
      FX.toast(whales.length + " new whale trade" + (whales.length > 1 ? "s" : "") + " just landed", "whale", 3500);
      if (!reduced()) whales.forEach((tr) => splash(tr));
    }
  };
  function splash(tr) {
    const r = tr.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    for (let i = 0; i < 7; i++) {
      const s = document.createElement("span"); s.className = "drop"; s.textContent = i ? "💧" : "🐋";
      s.style.left = (r.left + 24 + Math.random() * 40) + "px"; s.style.top = (r.top + r.height / 2) + "px";
      s.style.setProperty("--dx", ((Math.random() - 0.5) * 120).toFixed(0) + "px");
      s.style.setProperty("--dy", (-40 - Math.random() * 70).toFixed(0) + "px");
      document.body.appendChild(s); setTimeout(() => s.remove(), 1000);
    }
  }

  // ---- ripple / press ----
  function setupRipple() {
    document.addEventListener("pointerdown", (e) => {
      const b = e.target.closest(".btn,.icon-btn,.seg button,.chips button,.tabs a,.links a,.kpi");
      if (!b) return;
      if (!b.classList.contains("kpi")) FX.haptic(6);
      if (reduced()) return;
      const r = b.getBoundingClientRect(), s = document.createElement("span"), size = Math.max(r.width, r.height);
      s.className = "ripple"; s.style.width = s.style.height = size + "px";
      s.style.left = (e.clientX - r.left - size / 2) + "px"; s.style.top = (e.clientY - r.top - size / 2) + "px";
      b.appendChild(s); setTimeout(() => s.remove(), 600);
    }, { passive: true });
  }

  // ---- scroll reveal ----
  function setupReveal() {
    const cards = document.querySelectorAll("main .card");
    if (reduced() || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    cards.forEach((c) => { const r = c.getBoundingClientRect(); if (r.top > innerHeight) { c.classList.add("reveal"); io.observe(c); } });
  }

  // ---- swipe between sections (mobile) ----
  function setupSwipe() {
    const ids = [...document.querySelectorAll(".tabs a")].map((a) => a.dataset.tab);
    let x0 = 0, y0 = 0, t0 = 0, ok = false;
    document.addEventListener("touchstart", (e) => {
      if (innerWidth >= 900 || e.touches.length !== 1) { ok = false; return; }
      ok = !e.target.closest("#tvchart,.table-wrap,input,select,textarea,.treemap,.chips,.seg");
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!ok) return; ok = false;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const cur = (document.querySelector(".tabs a.on") || {}).dataset ? document.querySelector(".tabs a.on").dataset.tab : ids[0];
      const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(cur) + (dx < 0 ? 1 : -1)));
      if (ids[i] === cur) return;
      FX.haptic(8);
      document.getElementById(ids[i]).scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
      showSwipeHint(dx < 0 ? "→ " : "← ", document.querySelector('.tabs a[data-tab="' + ids[i] + '"]').textContent.trim());
    }, { passive: true });
  }
  function showSwipeHint(arrow, label) {
    let h = $("swipeHint"); if (!h) { h = document.createElement("div"); h.id = "swipeHint"; h.className = "swipe-hint"; document.body.appendChild(h); }
    h.textContent = arrow + label; h.classList.remove("show"); void h.offsetWidth; h.classList.add("show");
  }

  // ---- pull to refresh (mobile) ----
  function setupPull(onRefresh) {
    const ind = document.createElement("div"); ind.className = "ptr"; ind.innerHTML = '<img src="assets/brand/snek-face-happy.webp" alt=""><span>Pull to refresh</span>'; document.body.appendChild(ind);
    let y0 = null, dist = 0, busy = false;
    document.addEventListener("touchstart", (e) => { if (scrollY <= 0 && !busy && e.touches.length === 1 && !e.target.closest("#tvchart")) { y0 = e.touches[0].clientY; dist = 0; } else y0 = null; }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (y0 === null) return; dist = Math.max(0, e.touches[0].clientY - y0);
      if (dist <= 0) return;
      const d = Math.min(110, dist * 0.55); ind.style.transform = "translate(-50%," + (d - 60) + "px)"; ind.style.opacity = Math.min(1, d / 60);
      ind.querySelector("span").textContent = d >= 60 ? "Release to refresh" : "Pull to refresh";
      ind.classList.toggle("ready", d >= 60);
    }, { passive: true });
    document.addEventListener("touchend", () => {
      if (y0 === null) return; y0 = null;
      if (Math.min(110, dist * 0.55) >= 60) {
        busy = true; ind.classList.add("spin"); ind.querySelector("span").textContent = "Refreshing…"; FX.haptic(15);
        Promise.resolve(onRefresh()).finally(() => { setTimeout(() => { busy = false; ind.classList.remove("spin", "ready"); ind.style.transform = ""; ind.style.opacity = 0; }, 400); });
      } else { ind.style.transform = ""; ind.style.opacity = 0; }
    }, { passive: true });
  }

  FX.init = (opts) => { setupRipple(); setupReveal(); setupSwipe(); setupPull(opts.onRefresh); };
  FX.reduced = reduced;
  window.SNEKFX = FX;
})();
