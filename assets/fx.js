/* Interaction layer for the fan-made SNEK dashboard: price flash + rolling digits, count-ups,
   ripple/press feedback, swipe between sections, pull-to-refresh, scroll reveal, trade slide-in
   with whale splash, header sparkline, stacked toasts, haptics. Respects prefers-reduced-motion. */
(function () {
  "use strict";
  const mq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  const reduced = () => mq.matches || document.documentElement.classList.contains("nofx");
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
      if (!seen.has(tx)) { seen.add(tx); if (primed && !tr.hasAttribute("data-old")) { tr.classList.add("slide-in"); fresh.push(tr); } }
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
      if (innerWidth >= 900 || e.touches.length !== 1 || document.body.classList.contains("editing")) { ok = false; return; }
      ok = !e.target.closest("#tvchart,.table-wrap,input,select,textarea,.treemap,.chips,.seg");
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!ok || document.body.classList.contains("dragging")) { ok = false; return; } ok = false;
      const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      if (Date.now() - t0 > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const cur = (document.querySelector(".tabs a.on") || {}).dataset ? document.querySelector(".tabs a.on").dataset.tab : ids[0];
      const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(cur) + (dx < 0 ? 1 : -1)));
      if (ids[i] === cur) return;
      FX.haptic(8);
      if (window.SNEKLAYOUT) { if (!SNEKLAYOUT.goto(ids[i])) return; } else document.getElementById(ids[i]).scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
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
    document.addEventListener("touchstart", (e) => { if (scrollY <= 0 && !busy && e.touches.length === 1 && !e.target.closest("#tvchart") && !document.body.classList.contains("editing")) { y0 = e.touches[0].clientY; dist = 0; } else y0 = null; }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (y0 !== null && document.body.classList.contains("dragging")) { y0 = null; dist = 0; ind.style.transform = ""; ind.style.opacity = 0; ind.classList.remove("ready"); }
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


  // ---- pointer spotlight + gentle 3D tilt on cards (mouse only, rAF-throttled) ----
  function setupSpotlight() {
    if (!matchMedia("(pointer: fine)").matches || reduced()) return;
    let pend = null, cur = null, queued = false;
    document.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      pend = e; if (queued) return; queued = true;
      requestAnimationFrame(() => {
        queued = false; const ev = pend; pend = null; if (!ev) return;
        const c = ev.target.closest && ev.target.closest(".card");
        if (cur && cur !== c) { cur.classList.remove("tilt"); cur.style.removeProperty("--rx"); cur.style.removeProperty("--ry"); }
        cur = c; if (!c || document.body.classList.contains("editing") || document.body.classList.contains("dragging")) return;
        const r = c.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
        c.style.setProperty("--mx", x + "px"); c.style.setProperty("--my", y + "px");
        // tilt only small cards; big charts/tables stay flat so reading and panning are not disturbed
        if (r.height < 420 && r.width < 700 && !ev.target.closest("#tvchart,.table-wrap,input,select,textarea")) {
          c.classList.add("tilt"); c.style.setProperty("--rx", ((0.5 - y / r.height) * 4).toFixed(2) + "deg"); c.style.setProperty("--ry", ((x / r.width - 0.5) * 5).toFixed(2) + "deg");
        } else c.classList.remove("tilt");
      });
    }, { passive: true });
    document.addEventListener("pointerleave", () => { if (cur) cur.classList.remove("tilt"); cur = null; }, { passive: true });
  }

  // ---- scroll: progress bar, parallax hero glow, sliding tab indicator ----
  function setupScrollFx() {
    const bar = document.createElement("div"); bar.className = "scrollbar"; bar.setAttribute("aria-hidden", "true"); document.body.appendChild(bar);
    const hero = document.querySelector(".hero"), tabs = document.querySelector(".tabs");
    let tk = false;
    const run = () => {
      tk = false; const h = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty("--sp", h > 0 ? Math.min(1, scrollY / h).toFixed(4) : 0);
      if (hero && !reduced() && scrollY < 900) hero.style.setProperty("--py", (scrollY * 0.25).toFixed(1) + "px");
    };
    addEventListener("scroll", () => { if (!tk) { tk = true; requestAnimationFrame(run); } }, { passive: true });
    run();
    if (tabs) {
      const links = [...tabs.querySelectorAll("a")];
      const sync = () => { const i = links.findIndex((a) => a.classList.contains("on")); if (i >= 0) tabs.style.setProperty("--ti", i); };
      new MutationObserver(sync).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class"] }); sync();
    }
  }

  // ---- confetti burst (canvas, ~1.2 s, skipped with reduced motion) ----
  FX.confetti = (from) => {
    if (reduced()) return;
    const cv = document.createElement("canvas"), dpr = Math.min(2, devicePixelRatio || 1); cv.className = "confetti";
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; document.body.appendChild(cv);
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const ox = r.left + r.width / 2, oy = r.top + r.height / 2, cs = getComputedStyle(document.documentElement);
    const cols = ["--snek", "--cyan", "--purple", "--yellow", "--red"].map((v) => cs.getPropertyValue(v).trim());
    const N = innerWidth < 600 ? 70 : 120, P = [];
    for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7; P.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, s: 4 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[i % cols.length] }); }
    const t0 = performance.now();
    const step = (now) => {
      const k = (now - t0) / 1300; g.clearRect(0, 0, innerWidth, innerHeight);
      P.forEach((p) => { p.vy += 0.28; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.globalAlpha = Math.max(0, 1 - k); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); g.restore(); });
      if (k < 1) requestAnimationFrame(step); else cv.remove();
    };
    requestAnimationFrame(step);
  };

  // ---- easter egg: tap the SNEK logomark 5 times for a tiny snake game ----
  function setupSnake() {
    const logo = document.querySelector(".top .logo"); if (!logo) return;
    let taps = 0, tt = 0;
    logo.addEventListener("click", () => {
      logo.classList.remove("wiggle"); void logo.offsetWidth; logo.classList.add("wiggle");
      taps = Date.now() - tt < 700 ? taps + 1 : 1; tt = Date.now();
      if (taps >= 5) { taps = 0; openSnake(); }
    });
  }
  function openSnake() {
    if (document.querySelector(".snakegame")) return;
    const wrap = document.createElement("div"); wrap.className = "snakegame"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Snake mini-game");
    const best = +(localStorage.getItem("snek-snake-best") || 0);
    wrap.innerHTML = '<div class="snakebox"><div class="row between" style="width:100%"><b>🐍 Snek snack</b><span class="small muted">Score <b id="snkScore">0</b> · Best <b id="snkBest">' + best + '</b></span></div><canvas width="320" height="320" aria-label="Snake game board"></canvas>' +
      '<div class="snakepad"><span></span><button class="btn" data-d="0,-1" aria-label="Up">▲</button><span></span><button class="btn" data-d="-1,0" aria-label="Left">◀</button><button class="btn" data-d="0,1" aria-label="Down">▼</button><button class="btn" data-d="1,0" aria-label="Right">▶</button></div>' +
      '<div class="small muted">Arrow keys, swipe, or the pad · Esc to close · fan-made fun, not affiliated with SNEK</div><button class="btn" data-x>Close</button></div>';
    document.body.appendChild(wrap);
    const cv = wrap.querySelector("canvas"), g = cv.getContext("2d"), N = 16, S = 20, cs = getComputedStyle(document.documentElement);
    const C = { s: cs.getPropertyValue("--snek").trim(), f: cs.getPropertyValue("--yellow").trim(), l: cs.getPropertyValue("--line").trim() };
    let sn = [[8, 8], [7, 8], [6, 8]], dir = [1, 0], nd = [1, 0], food = [12, 8], score = 0, dead = false, timer;
    const place = () => { do { food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; } while (sn.some((p) => p[0] === food[0] && p[1] === food[1])); };
    const setDir = (d) => { if (d[0] !== -dir[0] || d[1] !== -dir[1]) nd = d; };
    const draw = () => {
      g.clearRect(0, 0, 320, 320); g.strokeStyle = C.l; g.globalAlpha = 0.25; for (let i = 1; i < N; i++) { g.beginPath(); g.moveTo(i * S, 0); g.lineTo(i * S, 320); g.moveTo(0, i * S); g.lineTo(320, i * S); g.stroke(); } g.globalAlpha = 1;
      g.fillStyle = C.f; g.beginPath(); g.arc(food[0] * S + 10, food[1] * S + 10, 7, 0, 7); g.fill();
      sn.forEach((p, i) => { g.fillStyle = C.s; g.globalAlpha = 1 - (i / sn.length) * 0.5; g.fillRect(p[0] * S + 1, p[1] * S + 1, S - 2, S - 2); }); g.globalAlpha = 1;
      if (dead) { g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, 0, 320, 320); g.fillStyle = "#fff"; g.font = "bold 22px Inter,system-ui"; g.textAlign = "center"; g.fillText("Game over · tap to retry", 160, 165); }
    };
    const tick = () => {
      dir = nd; const h = [(sn[0][0] + dir[0] + N) % N, (sn[0][1] + dir[1] + N) % N];
      if (sn.some((p) => p[0] === h[0] && p[1] === h[1])) { dead = true; clearInterval(timer); FX.haptic([30, 50, 30]); const b = Math.max(score, +(localStorage.getItem("snek-snake-best") || 0)); try { localStorage.setItem("snek-snake-best", b); } catch (e) {} wrap.querySelector("#snkBest").textContent = b; draw(); return; }
      sn.unshift(h);
      if (h[0] === food[0] && h[1] === food[1]) { score++; wrap.querySelector("#snkScore").textContent = score; FX.haptic(10); place(); if (score % 5 === 0) FX.confetti(cv); } else sn.pop();
      draw();
    };
    const start = () => { sn = [[8, 8], [7, 8], [6, 8]]; dir = nd = [1, 0]; score = 0; dead = false; wrap.querySelector("#snkScore").textContent = 0; place(); clearInterval(timer); timer = setInterval(tick, reduced() ? 180 : 120); draw(); };
    const keys = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
    const onKey = (e) => { if (e.key === "Escape") return close(); const d = keys[e.key]; if (d) { e.preventDefault(); setDir(d); } };
    const close = () => { clearInterval(timer); document.removeEventListener("keydown", onKey); wrap.remove(); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-x]")) return close(); const b = e.target.closest("[data-d]"); if (b) setDir(b.dataset.d.split(",").map(Number)); if (e.target === cv && dead) start(); });
    let sx = 0, sy = 0;
    cv.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    cv.addEventListener("touchend", (e) => { const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) { if (dead) start(); return; } setDir(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]); }, { passive: true });
    start();
  }

  FX.init = (opts) => { setupRipple(); setupReveal(); setupSwipe(); setupPull(opts.onRefresh); setupSpotlight(); setupScrollFx(); setupSnake(); };
  FX.reduced = reduced;
  window.SNEKFX = FX;
})();
