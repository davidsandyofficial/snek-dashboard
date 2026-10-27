/* Movable widgets. Every card is a widget with a ⋯ menu (pin, move, width, hide) that works without edit mode.
   "Customize" opens edit mode: long-press or drag the bar to move (SortableJS, MIT), ↑/↓ buttons, presets,
   hidden-widget tray, undo, reset. Saved only in this browser (localStorage "snek-layout"). */
(function () {
  "use strict";
  const KEY = "snek-layout", COACH = "snek-coach", SIZES = [4, 6, 8, 12], SIZE_NAMES = { 4: "⅓", 6: "½", 8: "⅔", 12: "Full" };
  const grid = document.getElementById("wgrid"); if (!grid) return;
  const all = () => [...grid.querySelectorAll(":scope > .w")];
  const byId = (id) => grid.querySelector(':scope > .w[data-w="' + id + '"]');
  const DEFAULT = all().map((w) => w.dataset.w);
  const DEFSIZE = {}; all().forEach((w) => (DEFSIZE[w.dataset.w] = +w.dataset.size || 12));
  const wide = () => innerWidth >= 900;
  const reduced = () => document.documentElement.classList.contains("nofx") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // v2: the "Built by @DavidSandy" follow card is pinned to the very top by default; older saved layouts get it pinned once.
  const TOP = "follow";
  const load = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY)); if (!v) return null;
      if (v.v === 1) { v.v = 2; v.pinned = [TOP].concat((v.pinned || []).filter((x) => x !== TOP)); v.hidden = (v.hidden || []).filter((x) => x !== TOP); v.order = [TOP].concat((v.order || []).filter((x) => x !== TOP)); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
      return v.v === 2 ? v : null;
    } catch (e) { return null; }
  };
  const blank = () => ({ v: 2, order: [TOP].concat(DEFAULT.filter((x) => x !== TOP)), pinned: [TOP], hidden: [], size: {}, height: {} });
  const sizeName = (n) => SIZE_NAMES[n] || n + "/12";
  let L = load() || blank();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) {} };
  const toast = (m) => (window.SNEKAPP && window.SNEKAPP.toast ? window.SNEKAPP.toast(m) : null);
  const haptic = (n) => { try { window.SNEKFX && SNEKFX.haptic ? SNEKFX.haptic(n) : navigator.vibrate && navigator.vibrate(n); } catch (e) {} };
  const title = (id) => (byId(id) ? byId(id).dataset.title : id);

  // ---------- presets ----------
  const PRESETS = {
    trader: { name: "Trader", icon: "📈", desc: "Chart, live prices, trades and whale feed first", order: ["chart", "price", "venues", "trades", "wfeed", "liquidity", "volume", "alerts", "stats"], pinned: ["chart"], hidden: ["calc", "links"], size: { price: 6, venues: 6 } },
    holder: { name: "Holder", icon: "💎", desc: "Price, your portfolio, alerts and holder stats", order: ["price", "portfolio", "alerts", "stats", "holders", "chart", "calc", "wtop"], pinned: ["price"], hidden: ["trades", "volume", "liquidity", "venues"], size: {} },
    watcher: { name: "Wallet watcher", icon: "🔎", desc: "Wallet tracker, your watchlist and whale moves", order: ["wsearch", "whist", "watch", "wfeed", "wtop", "price", "holders", "chart"], pinned: ["wsearch"], hidden: ["calc", "venues", "volume", "portfolio"], size: { wsearch: 8, watch: 4 } },
  };
  function applyPreset(k) {
    const P = PRESETS[k]; if (!P) return; snap();
    const known = new Set(DEFAULT), first = P.order.filter((x) => known.has(x));
    L = { v: 2, order: [TOP].concat(first.filter((x) => x !== TOP), DEFAULT.filter((x) => !first.includes(x) && x !== TOP)), pinned: [TOP].concat(P.pinned.filter((x) => x !== TOP)), hidden: P.hidden.filter((x) => known.has(x) && x !== TOP), size: Object.assign({}, P.size), height: {}, preset: k };
    save(); apply(true); undoToast(P.icon + " " + P.name + " layout applied"); haptic(10);
    window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
  }

  function normalize() {
    const known = new Set(DEFAULT);
    let order = (L.order || []).filter((id, i, a) => known.has(id) && a.indexOf(id) === i);
    DEFAULT.forEach((id, i) => { if (!order.includes(id)) order.splice(Math.min(i, order.length), 0, id); });
    L.pinned = (L.pinned || []).filter((id) => known.has(id));
    L.hidden = (L.hidden || []).filter((id) => known.has(id));
    L.size = L.size || {}; L.height = L.height || {};
    L.order = L.pinned.concat(order.filter((id) => !L.pinned.includes(id)));
  }
  // FLIP animation so widgets glide to their new spot
  function apply(animate) {
    normalize();
    const first = animate && !reduced() ? new Map(all().map((w) => [w, w.getBoundingClientRect()])) : null;
    L.order.forEach((id) => { const w = byId(id); if (w) grid.appendChild(w); });
    all().forEach((w) => {
      const id = w.dataset.w, sz = L.size[id] || DEFSIZE[id];
      w.style.setProperty("--span", sz);
      const hh = L.height[id]; w.classList.toggle("wsized", !!hh); if (hh) w.style.setProperty("--h", hh + "px"); else w.style.removeProperty("--h");
      w.classList.toggle("pinned", L.pinned.includes(id));
      w.classList.toggle("whid", L.hidden.includes(id));
      const c = w.querySelector(":scope > .wctl"); if (c) paintCtl(w, c);
      kebabFor(w);
    });
    if (first) all().forEach((w) => { const a = first.get(w); if (!a || w.classList.contains("whid")) return; const b = w.getBoundingClientRect(); const dx = a.left - b.left, dy = a.top - b.top; if (!dx && !dy) return; if (Math.abs(dy) > innerHeight * 1.5) return; w.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }); });
    renderTray();
  }
  const isDefault = () => { const B = blank(); return JSON.stringify(L.order) === JSON.stringify(B.order) && JSON.stringify(L.pinned) === JSON.stringify(B.pinned) && !L.hidden.length && !Object.keys(L.size).length && !Object.keys(L.height || {}).length; };

  // ---------- undo ----------
  const undoStack = [];
  function snap() { undoStack.push(JSON.stringify(L)); if (undoStack.length > 30) undoStack.shift(); }
  function undo() { const s = undoStack.pop(); if (!s) return; L = JSON.parse(s); save(); apply(true); hideUndo(); toast("Undone"); haptic(6); }
  let ut = null;
  function undoToast(msg) {
    let el = document.getElementById("undoToast");
    if (!el) { el = document.createElement("div"); el.id = "undoToast"; el.className = "utoast"; el.setAttribute("role", "status"); el.innerHTML = '<span class="um"></span><button type="button" class="ubtn">Undo</button>'; document.body.appendChild(el); el.querySelector(".ubtn").addEventListener("click", undo); }
    el.querySelector(".um").textContent = msg; el.classList.add("show"); clearTimeout(ut); ut = setTimeout(hideUndo, 6000);
  }
  function hideUndo() { const el = document.getElementById("undoToast"); if (el) el.classList.remove("show"); }

  // ---------- actions shared by the ⋯ menu and edit mode ----------
  const shown = (id) => { const w = byId(id); return w && !L.hidden.includes(id) && !w.hidden; };
  const visibleOrder = () => L.order.filter(shown);
  function move(id, dir, quiet) {
    const vis = visibleOrder(), i = vis.indexOf(id), j = i + dir; if (j < 0 || j >= vis.length) return false;
    const pin = L.pinned.includes(id); if (pin !== L.pinned.includes(vis[j])) return false;
    snap();
    const a = L.order.indexOf(id), b = L.order.indexOf(vis[j]); L.order.splice(a, 1); L.order.splice(b, 0, id);
    if (pin) L.pinned = L.order.filter((x) => L.pinned.includes(x));
    save(); apply(true); haptic(6);
    if (!quiet) undoToast("Moved " + title(id) + (dir < 0 ? " up" : " down"));
    return true;
  }
  function togglePin(id) {
    snap();
    const was = L.pinned.includes(id);
    if (was) L.pinned = L.pinned.filter((x) => x !== id); else L.pinned.push(id);
    L.order = L.order.filter((x) => x !== id); L.order.splice(was ? L.pinned.length : L.pinned.length - 1, 0, id);
    save(); apply(true); haptic(8); undoToast((was ? "Unpinned " : "📌 Pinned ") + title(id) + (was ? "" : " to the top"));
  }
  function cycleSize(id) { snap(); const cur = L.size[id] || DEFSIZE[id], nx = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length] || 12; if (nx === DEFSIZE[id]) delete L.size[id]; else L.size[id] = nx; save(); apply(true); undoToast(title(id) + " width: " + sizeName(nx)); setTimeout(() => window.dispatchEvent(new Event("resize")), 300); }
  function hide(id) { snap(); L.hidden.push(id); save(); apply(true); haptic(8); undoToast("Hid " + title(id)); }
  function show(id) { snap(); L.hidden = L.hidden.filter((x) => x !== id); save(); apply(true); const w = byId(id); if (w) w.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); haptic(6); }

  // ---------- ⋯ menu on every widget (no edit mode needed) ----------
  function kebabFor(w) {
    if (w.querySelector(":scope > .wkebab")) return;
    const b = document.createElement("button"); b.type = "button"; b.className = "wkebab"; b.setAttribute("aria-label", "Options for " + w.dataset.title); b.setAttribute("aria-haspopup", "menu"); b.innerHTML = "<span>⋯</span>";
    w.appendChild(b);
    const g = document.createElement("span"); g.className = "wgrip"; g.setAttribute("aria-hidden", "true"); g.title = "Drag to move";
    w.appendChild(g);
  }
  let menu = null, menuFor = null;
  function openMenu(btn) {
    const w = btn.closest(".w"), id = w.dataset.w; closeMenu();
    menu = document.createElement("div"); menu.className = "wmenu"; menu.setAttribute("role", "menu"); menuFor = id;
    const vis = visibleOrder(), i = vis.indexOf(id), pin = L.pinned.includes(id), sz = L.size[id] || DEFSIZE[id];
    const canUp = i > 0 && L.pinned.includes(vis[i - 1]) === pin, canDown = i < vis.length - 1 && L.pinned.includes(vis[i + 1]) === pin;
    const item = (a, label, dis) => '<button type="button" role="menuitem" data-m="' + a + '"' + (dis ? " disabled" : "") + ">" + label + "</button>";
    menu.innerHTML = '<div class="wmh">' + esc(w.dataset.title) + "</div>" + item("pin", pin ? "📌 Unpin" : "📌 Pin to top") + item("up", "↑ Move up", !canUp) + item("down", "↓ Move down", !canDown) + (wide() ? item("size", "↔ Width: " + sizeName(sz) + " → " + sizeName(SIZES[(SIZES.indexOf(sz) + 1) % SIZES.length])) + (L.size[id] || L.height[id] ? item("rsize", "↺ Reset size") : "") : "") + item("hide", "🙈 Hide") + '<div class="wmsep"></div>' + item("edit", "✎ Customize layout…") + item("settings", "⚙ Settings…");
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    let top = r.bottom + 6, left = Math.min(innerWidth - mw - 8, Math.max(8, r.right - mw));
    if (top + mh > innerHeight - 70) top = Math.max(8, r.top - mh - 6);
    menu.style.top = top + "px"; menu.style.left = left + "px";
    requestAnimationFrame(() => menu && menu.classList.add("open"));
    const f = menu.querySelector("button:not([disabled])"); if (f) f.focus();
    btn.setAttribute("aria-expanded", "true"); menuY = scrollY;
  }
  function closeMenu() { if (menu) { menu.remove(); menu = null; } document.querySelectorAll('.wkebab[aria-expanded="true"]').forEach((b) => b.setAttribute("aria-expanded", "false")); }
  document.addEventListener("click", (e) => {
    const k = e.target.closest(".wkebab"); if (k) { e.preventDefault(); if (menu && menuFor === k.closest(".w").dataset.w) closeMenu(); else openMenu(k); return; }
    const m = e.target.closest(".wmenu [data-m]");
    if (m) { const id = menuFor, a = m.dataset.m; closeMenu(); if (a === "pin") togglePin(id); else if (a === "up") move(id, -1); else if (a === "down") move(id, 1); else if (a === "size") cycleSize(id); else if (a === "rsize") resetSize(id); else if (a === "hide") hide(id); else if (a === "edit") setEditing(true); else if (a === "settings" && window.SNEKSET) SNEKSET.open(); return; }
    if (menu && !e.target.closest(".wmenu")) closeMenu();
  });
  let menuY = 0; addEventListener("scroll", () => { if (menu && Math.abs(scrollY - menuY) > 40) closeMenu(); }, { passive: true });

  // ---------- edit mode ----------
  let editing = false, sortable = null, bar = null;
  function ctlFor(w) {
    let c = w.querySelector(":scope > .wctl"); if (c) return c;
    c = document.createElement("div"); c.className = "wctl";
    c.innerHTML = '<span class="wh" aria-hidden="true" title="Drag or long-press to move">⠿</span><b class="wt"></b>' +
      '<button type="button" class="wb" data-a="up" aria-label="Move up">↑</button>' +
      '<button type="button" class="wb" data-a="down" aria-label="Move down">↓</button>' +
      '<button type="button" class="wb wsz" data-a="size" aria-label="Change width"></button>' +
      '<button type="button" class="wb" data-a="pin"></button>' +
      '<button type="button" class="wb" data-a="hide" aria-label="Hide widget">✕</button>';
    w.prepend(c); paintCtl(w, c); return c;
  }
  function paintCtl(w, c) {
    const id = w.dataset.w, pinned = L.pinned.includes(id), sz = L.size[id] || DEFSIZE[id];
    c.querySelector(".wt").textContent = (pinned ? "📌 " : "") + w.dataset.title;
    const pb = c.querySelector('[data-a="pin"]'); pb.textContent = pinned ? "Unpin" : "Pin"; pb.setAttribute("aria-pressed", pinned); pb.setAttribute("aria-label", (pinned ? "Unpin " : "Pin to top: ") + w.dataset.title);
    const sb = c.querySelector('[data-a="size"]'); sb.textContent = SIZE_NAMES[sz] || sz; sb.title = "Width on wide screens";
    const vis = visibleOrder(), i = vis.indexOf(id), np = L.pinned.length;
    c.querySelector('[data-a="up"]').disabled = pinned ? L.pinned.indexOf(id) === 0 : i <= 0 || (vis[i - 1] && L.pinned.includes(vis[i - 1]));
    c.querySelector('[data-a="down"]').disabled = pinned ? L.pinned.indexOf(id) === np - 1 : i === vis.length - 1;
  }
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".wctl .wb"); if (!b || !editing) return;
    const id = b.closest(".w").dataset.w, a = b.dataset.a;
    if (a === "up" || a === "down") { move(id, a === "up" ? -1 : 1, true); const w = byId(id); const nb = w && w.querySelector('.wctl [data-a="' + a + '"]'); if (nb && !nb.disabled) nb.focus(); w && w.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" }); }
    else if (a === "pin") togglePin(id); else if (a === "size") cycleSize(id); else if (a === "hide") hide(id);
  });
  function renderTray() {
    if (!bar) return;
    const t = bar.querySelector(".ltray"), hid = L.hidden.filter((id) => byId(id));
    t.innerHTML = hid.length ? '<span class="muted small">Hidden:</span> ' + hid.map((id) => '<button type="button" data-show="' + id + '">+ ' + esc(title(id)) + "</button>").join("") : "";
    t.hidden = !hid.length;
    bar.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("on", L.preset === b.dataset.preset && !isDefault()));
    bar.querySelector("#layoutReset").disabled = isDefault();
    bar.querySelector("#layoutUndo").disabled = !undoStack.length;
  }
  function makeBar() {
    bar = document.createElement("div"); bar.className = "lbar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Layout editor");
    bar.innerHTML = '<div class="lrow"><div class="grow"><b>Customize layout</b><div class="muted small">' + (matchMedia("(pointer: coarse)").matches ? "Long-press a bar to drag, or tap ↑ ↓" : "Drag a bar or use ↑ ↓ · Pin keeps it on top" + (wide() ? " · ½ ⅔ sets width" : "")) + '</div></div>' +
      '<button type="button" class="btn" id="layoutUndo" aria-label="Undo">↶</button><button type="button" class="btn" id="layoutReset">Reset</button><button type="button" class="btn primary" id="layoutDone">Done</button></div>' +
      '<div class="lpresets"><span class="muted small">Presets:</span>' + Object.keys(PRESETS).map((k) => '<button type="button" data-preset="' + k + '" title="' + esc(PRESETS[k].desc) + '">' + PRESETS[k].icon + " " + PRESETS[k].name + "</button>").join("") + '</div><div class="ltray" hidden></div>';
    document.body.appendChild(bar);
    bar.addEventListener("click", (e) => {
      const s = e.target.closest("[data-show]"); if (s) return show(s.dataset.show);
      const p = e.target.closest("[data-preset]"); if (p) return applyPreset(p.dataset.preset);
      if (e.target.closest("#layoutUndo")) return undo();
      if (e.target.closest("#layoutDone")) return setEditing(false);
      if (e.target.closest("#layoutReset")) { snap(); L = blank(); save(); apply(true); undoToast("Layout reset to default"); }
    });
  }
  // ---------- drag to reorder: always on (press and hold anywhere non-interactive on a card), plus edit-mode bars ----------
  const NO_DRAG = "a,button,input,select,textarea,label,summary,details,canvas,svg,img,video,iframe,[contenteditable],[role=button],[role=tab],[data-nodrag]," +
    "#tvchart,.chartbox,.table-wrap,table,.treemap,.seg,.chips,.wkebab,.wmenu,.wvalchart,.wlist,.wfeed,.tline,.wtx,.hchips,.pinned,.whid,.wb";
  // The ⠿ grip (any pointer) and, with a mouse, the card title start a drag instantly; anywhere else needs a press-and-hold.
  const TITLE = ".w > h2, .w > .row:first-child h2, .w > .row:first-child h3";
  const holdDelay = () => (matchMedia("(pointer: coarse)").matches ? 400 : 300);
  const instantStart = (e) => {
    if (!sortable || editing) return;
    const t = e.target, mouse = e.type === "mousedown" || e.pointerType === "mouse";
    const fast = !!(t.closest && (t.closest(".wgrip") || (mouse && t.closest(TITLE) && !t.closest("a,button,input,select,label"))));
    sortable.option("delay", fast ? 0 : holdDelay());
  };
  ["pointerdown", "mousedown", "touchstart"].forEach((ev) => grid.addEventListener(ev, instantStart, { capture: true, passive: true }));
  function sortMode(edit) {
    if (!window.Sortable) return;
    const opts = edit ? { handle: ".wctl", filter: ".wb,.pinned", delay: 180, delayOnTouchOnly: true } : { handle: null, filter: NO_DRAG, delay: holdDelay(), delayOnTouchOnly: false };
    if (!sortable) {
      sortable = Sortable.create(grid, Object.assign({
        draggable: ".w", preventOnFilter: false, touchStartThreshold: 6, animation: reduced() ? 0 : 200, easing: "cubic-bezier(.2,.8,.2,1)",
        ghostClass: "wghost", chosenClass: "wchosen", dragClass: "wdrag", forceFallback: true, fallbackTolerance: 3, fallbackOnBody: true,
        scroll: true, scrollSensitivity: 90, bubbleScroll: true,
        onMove: (ev) => { const r = ev.related, bad = r.classList.contains("pinned"); grid.querySelectorAll(".wtarget,.wnodrop").forEach((x) => x !== r && x.classList.remove("wtarget", "wnodrop")); if (r !== ev.dragged) r.classList.add(bad ? "wnodrop" : "wtarget"); return !bad; },
        onChoose: (ev) => { haptic(15); ev.item.classList.add("wlift"); closeMenu(); hideCoach(); },
        onUnchoose: (ev) => ev.item.classList.remove("wlift"),
        onStart: () => { snap(); document.body.classList.add("dragging"); try { getSelection().removeAllRanges(); } catch (e) {} },
        onEnd: (ev) => { document.body.classList.remove("dragging"); ev.item.classList.remove("wlift"); grid.querySelectorAll(".wtarget,.wnodrop").forEach((x) => x.classList.remove("wtarget", "wnodrop")); const now = all().map((w) => w.dataset.w); if (JSON.stringify(now) === JSON.stringify(L.order)) { undoStack.pop(); return; } L.order = now; save(); apply(); haptic(8); undoToast("Moved " + title(ev.item.dataset.w)); },
      }, opts));
    } else Object.keys(opts).forEach((k) => sortable.option(k, opts[k]));
    sortable.option("disabled", false);
  }
  function setEditing(on) {
    if (on === editing) return;
    closeMenu();
    const anchor = all().find((w) => { const r = w.getBoundingClientRect(); return r.bottom > 90 && r.height > 0 && !w.classList.contains("whid"); });
    editing = on; document.body.classList.toggle("editing", on);
    all().forEach((w) => ctlFor(w));
    if (on) {
      if (!bar) makeBar(); bar.hidden = false; apply();
      sortMode(true);
      try { localStorage.setItem(COACH, "1"); } catch (e) {} hideCoach();
    } else {
      sortMode(false);
      if (bar) bar.hidden = true;
      window.dispatchEvent(new Event("resize"));
      toast(isDefault() ? "Layout saved (default)" : "Layout saved in this browser");
    }
    document.querySelectorAll("#layoutBtn,#layoutBtn2,#layoutFab").forEach((b) => b.setAttribute("aria-pressed", on));
    if (anchor) requestAnimationFrame(() => anchor.scrollIntoView({ block: on ? "center" : "start" }));
  }

  // ---------- floating "Customize" pill on phones (hides while scrolling down) ----------
  const fab = document.getElementById("layoutFab");
  if (fab) { let lastY = scrollY, tk = false; addEventListener("scroll", () => { if (tk) return; tk = true; requestAnimationFrame(() => { const y = scrollY; fab.classList.toggle("tuck", y > lastY + 4 && y > 200); if (y < lastY - 4 || y < 200) fab.classList.remove("tuck"); lastY = y; tk = false; }); }, { passive: true }); }


  // ---------- resize with the mouse (wide screens): corner, right edge and bottom edge handles ----------
  // Width snaps to the 12-column grid (3 = ¼ … 12 = full); height moves in 10 px steps (160–1600 px) or "auto".
  const MINSPAN = 3, MINH = 160, MAXH = 1600, HSTEP = 10;
  function resetSize(id) { if (!L.size[id] && !L.height[id]) return; snap(); delete L.size[id]; delete L.height[id]; save(); apply(true); undoToast(title(id) + " size reset"); redraw(); }
  const redraw = () => { [60, 320].forEach((t) => setTimeout(() => window.dispatchEvent(new Event("resize")), t)); };
  const rz = document.createElement("div"); rz.className = "rzlayer"; rz.hidden = true;
  rz.innerHTML = '<span class="rzh rz-e" data-rz="e" title="Drag to change width · double-click to reset"></span><span class="rzh rz-s" data-rz="s" title="Drag to change height · double-click to reset"></span><span class="rzh rz-se" data-rz="se" title="Drag to resize · double-click to reset"><i></i></span>';
  document.body.appendChild(rz);
  let rzFor = null, rzing = null;
  const rzOk = () => wide() && !editing && !document.body.classList.contains("dragging");
  function placeRz(w) {
    if (!w || !rzOk() || w.classList.contains("whid")) { if (!rzing) { rz.hidden = true; rzFor = null; } return; }
    const r = w.getBoundingClientRect(); rzFor = w; rz.hidden = false;
    rz.style.cssText = "left:" + (r.left + scrollX) + "px;top:" + (r.top + scrollY) + "px;width:" + r.width + "px;height:" + r.height + "px";
  }
  let rzRaf = 0;
  document.addEventListener("pointermove", (e) => {
    if (rzing || rzRaf) return;
    rzRaf = requestAnimationFrame(() => {
      rzRaf = 0;
      if (e.target.closest && e.target.closest(".rzh")) return;
      const w = e.target.closest && e.target.closest("#wgrid > .w");
      if (e.pointerType === "mouse" || w) placeRz(w);
    });
  }, { passive: true });
  // touch on a wide screen (tablet): tapping a card shows a bigger corner handle for it
  document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" && !e.target.closest(".rzh")) { const w = e.target.closest("#wgrid > .w"); rz.classList.add("touch"); placeRz(w); } }, { passive: true, capture: true });
  addEventListener("resize", () => { if (rzFor && !rzing) placeRz(rzFor); }, { passive: true });
  function colMetrics() {
    const cs = getComputedStyle(grid), gap = parseFloat(cs.columnGap) || 16, gw = grid.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    return { gap, col: (gw - 11 * gap) / 12 };
  }
  rz.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(".rzh"); if (!h || !rzFor) return;
    e.preventDefault(); e.stopPropagation();
    const w = rzFor, id = w.dataset.w, r = w.getBoundingClientRect(), m = colMetrics(), mode = h.dataset.rz;
    const span0 = L.size[id] || DEFSIZE[id];
    rzing = { w, id, mode, x0: e.clientX, y0: e.clientY, W0: r.width, H0: r.height, span: span0, h: L.height[id] || null, span0, h0: L.height[id] || null, m, left: r.left + scrollX, top: r.top + scrollY };
    try { h.setPointerCapture(e.pointerId); } catch (x) {}
    document.body.classList.add("resizing", "rzm-" + mode); closeMenu(); hideCoach();
    const g = document.createElement("div"); g.className = "rzghost"; g.innerHTML = '<span class="rzlabel"></span>'; document.body.appendChild(g); rzing.g = g;
    paintGhost(); haptic(10);
  });
  function paintGhost() {
    const z = rzing, m = z.m, wpx = z.span * m.col + (z.span - 1) * m.gap, hpx = z.h || z.H0;
    z.g.style.cssText = "left:" + z.left + "px;top:" + z.top + "px;width:" + Math.min(wpx, grid.clientWidth) + "px;height:" + hpx + "px";
    z.g.querySelector(".rzlabel").textContent = z.span + " col" + (z.span > 1 ? "s" : "") + (SIZE_NAMES[z.span] ? " (" + (SIZE_NAMES[z.span] === "Full" ? "full" : SIZE_NAMES[z.span]) + ")" : "") + " × " + (z.h ? Math.round(z.h) + "px" : "auto (" + Math.round(z.H0) + "px)");
  }
  rz.addEventListener("pointermove", (e) => {
    const z = rzing; if (!z) return;
    const m = z.m;
    if (z.mode !== "s") { const W = z.W0 + (e.clientX - z.x0); z.span = Math.max(MINSPAN, Math.min(12, Math.round((W + m.gap) / (m.col + m.gap)))); }
    if (z.mode !== "e") { const H = z.H0 + (e.clientY - z.y0); z.h = Math.max(MINH, Math.min(MAXH, Math.round(H / HSTEP) * HSTEP)); }
    paintGhost();
  });
  function endRz(cancel) {
    const z = rzing; if (!z) return; rzing = null;
    z.g.remove(); document.body.classList.remove("resizing", "rzm-e", "rzm-s", "rzm-se");
    if (cancel) return;
    const changedW = z.span !== z.span0, changedH = z.mode !== "e" && z.h !== z.h0 && Math.abs(z.h - z.H0) >= HSTEP;
    if (!changedW && !changedH) return;
    snap();
    if (changedW) { if (z.span === DEFSIZE[z.id]) delete L.size[z.id]; else L.size[z.id] = z.span; }
    if (changedH) L.height[z.id] = z.h;
    save(); apply(true); haptic(8); redraw();
    undoToast(title(z.id) + ": " + z.span + " col" + (z.span > 1 ? "s" : "") + " × " + (L.height[z.id] ? L.height[z.id] + "px" : "auto"));
    setTimeout(() => placeRz(byId(z.id)), 300);
  }
  rz.addEventListener("pointerup", () => endRz(false));
  rz.addEventListener("pointercancel", () => endRz(true));
  rz.addEventListener("dblclick", (e) => { const h = e.target.closest(".rzh"); if (h && rzFor) { resetSize(rzFor.dataset.w); setTimeout(() => placeRz(rzFor), 320); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && rzing) endRz(true); });

  // ---------- first-visit coach mark ----------
  let coach = null;
  function showCoach() {
    try { if (localStorage.getItem(COACH)) return; } catch (e) { return; }
    if (editing || document.querySelector("#fanNotice:not([hidden])")) { setTimeout(showCoach, 4000); return; }
    const target = [document.getElementById("layoutBtn"), fab].find((b) => b && getComputedStyle(b).display !== "none" && b.getBoundingClientRect().width > 0 && !b.classList.contains("tuck"));
    if (!target) return;
    coach = document.createElement("div"); coach.className = "coach"; coach.setAttribute("role", "dialog"); coach.setAttribute("aria-label", "Tip");
    coach.innerHTML = '<b>✨ Make this dashboard yours</b><p><b>Press and hold</b> any card to drag it somewhere new. Tap <b>Customize</b> to pin, hide and resize widgets, or pick a preset: Trader, Holder or Wallet watcher. Every card also has a <b>⋯</b> menu.</p><div class="row gap"><button type="button" class="btn primary" data-c="go">Show me</button><button type="button" class="btn" data-c="x">Got it</button></div>';
    document.body.appendChild(coach);
    const r = target.getBoundingClientRect(), cw = coach.offsetWidth, ch = coach.offsetHeight, below = r.top < innerHeight / 2;
    coach.style.left = Math.min(innerWidth - cw - 10, Math.max(10, r.left + r.width / 2 - cw / 2)) + "px";
    coach.style.top = (below ? r.bottom + 12 : r.top - ch - 12) + "px";
    coach.style.setProperty("--ax", Math.max(16, Math.min(cw - 16, r.left + r.width / 2 - parseFloat(coach.style.left))) + "px");
    coach.classList.add(below ? "down" : "up");
    requestAnimationFrame(() => coach && coach.classList.add("show"));
    coach.addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (!b) return; try { localStorage.setItem(COACH, "1"); } catch (x) {} hideCoach(); if (b.dataset.c === "go") setEditing(true); });
  }
  function hideCoach() { if (coach) { coach.remove(); coach = null; } }
  setTimeout(showCoach, 3500);

  // ---------- tabs → first visible widget of that group ----------
  function goto(tab) {
    const w = all().find((x) => x.dataset.tab === tab && !x.classList.contains("whid") && !x.hidden);
    if (!w) { toast("That section is hidden · tap Customize to show it"); return false; }
    w.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    return true;
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".tabs a[data-tab]"); if (!a) return;
    e.preventDefault(); if (goto(a.dataset.tab)) history.replaceState(null, "", "#" + a.dataset.tab);
  });
  document.querySelectorAll("#layoutBtn,#layoutBtn2,#layoutFab").forEach((b) => b && b.addEventListener("click", () => setEditing(!editing)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { if (menu) closeMenu(); else if (editing) setEditing(false); }
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && undoStack.length && !e.target.closest("input,textarea")) { e.preventDefault(); undo(); }
  });
  apply(); sortMode(false);
  // set(): used by Settings profiles, share codes and #layout= links (validated by normalize; follow card stays pinned on top)
  function setLayout(o) {
    if (!o || !Array.isArray(o.order)) return false;
    const prev = JSON.parse(JSON.stringify(L));
    L = { v: 2, order: o.order.slice(), pinned: [TOP].concat((o.pinned || []).filter((x) => x !== TOP)), hidden: (o.hidden || []).filter((x) => x !== TOP), size: Object.assign({}, o.size), height: Object.assign({}, o.height), preset: o.preset || null };
    Object.keys(L.size).forEach((k) => { const n = +L.size[k]; if (!(n >= 3 && n <= 12)) delete L.size[k]; });
    Object.keys(L.height).forEach((k) => { const n = +L.height[k]; if (!(n >= 160 && n <= 1600)) delete L.height[k]; });
    undoStack.push(JSON.stringify(prev)); save(); apply(true); return true;
  }
  window.SNEKLAYOUT = { goto, setEditing, applyPreset, undo, resetSize, set: setLayout, get: () => JSON.parse(JSON.stringify(L)), isEditing: () => editing };
})();
