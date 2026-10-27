/* Movable widgets: reorder (drag handle or ↑/↓), pin to top, resize (wide screens), hide/show, reset.
   Layout is saved only in this browser (localStorage "snek-layout"). Drag uses SortableJS (MIT). */
(function () {
  "use strict";
  const KEY = "snek-layout", SIZES = [4, 6, 8, 12], SIZE_NAMES = { 4: "⅓", 6: "½", 8: "⅔", 12: "Full" };
  const grid = document.getElementById("wgrid"); if (!grid) return;
  const all = () => [...grid.querySelectorAll(":scope > .w")];
  const byId = (id) => grid.querySelector(':scope > .w[data-w="' + id + '"]');
  const DEFAULT = all().map((w) => w.dataset.w);
  const DEFSIZE = {}; all().forEach((w) => (DEFSIZE[w.dataset.w] = +w.dataset.size || 12));
  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && v.v === 1 ? v : null; } catch (e) { return null; } };
  const blank = () => ({ v: 1, order: DEFAULT.slice(), pinned: [], hidden: [], size: {} });
  let L = load() || blank();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) {} };
  const toast = (m) => (window.SNEKAPP && window.SNEKAPP.toast ? window.SNEKAPP.toast(m) : null);
  const haptic = (n) => { try { window.FX && FX.haptic ? FX.haptic(n) : navigator.vibrate && navigator.vibrate(n); } catch (e) {} };

  function normalize() {
    const known = new Set(DEFAULT);
    let order = (L.order || []).filter((id, i, a) => known.has(id) && a.indexOf(id) === i);
    DEFAULT.forEach((id, i) => { if (!order.includes(id)) order.splice(Math.min(i, order.length), 0, id); }); // new widgets keep their default slot
    L.pinned = (L.pinned || []).filter((id) => known.has(id));
    L.hidden = (L.hidden || []).filter((id) => known.has(id));
    L.size = L.size || {};
    L.order = L.pinned.concat(order.filter((id) => !L.pinned.includes(id)));
  }
  function apply() {
    normalize();
    L.order.forEach((id) => { const w = byId(id); if (w) grid.appendChild(w); });
    all().forEach((w) => {
      const id = w.dataset.w, sz = L.size[id] || DEFSIZE[id];
      w.style.setProperty("--span", sz);
      w.classList.toggle("pinned", L.pinned.includes(id));
      w.classList.toggle("whid", L.hidden.includes(id));
      const c = w.querySelector(":scope > .wctl"); if (c) paintCtl(w, c);
    });
    renderTray();
  }
  const isDefault = () => JSON.stringify(L.order) === JSON.stringify(DEFAULT) && !L.pinned.length && !L.hidden.length && !Object.keys(L.size).length;

  // ---------- edit mode ----------
  let editing = false, sortable = null, bar = null;
  function ctlFor(w) {
    let c = w.querySelector(":scope > .wctl"); if (c) return c;
    c = document.createElement("div"); c.className = "wctl";
    c.innerHTML = '<span class="wh" aria-hidden="true" title="Drag to move">⠿</span><b class="wt"></b>' +
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
    c.querySelector('[data-a="up"]').disabled = pinned ? L.pinned.indexOf(id) === 0 : i <= 0 || vis[i - 1] && L.pinned.includes(vis[i - 1]);
    c.querySelector('[data-a="down"]').disabled = pinned ? L.pinned.indexOf(id) === np - 1 : i === vis.length - 1;
  }
  const shown = (id) => { const w = byId(id); return w && !L.hidden.includes(id) && !w.hidden; };
  const visibleOrder = () => L.order.filter(shown);
  function move(id, dir) {
    const vis = visibleOrder(), i = vis.indexOf(id), j = i + dir; if (j < 0 || j >= vis.length) return;
    const pin = L.pinned.includes(id); if (pin !== L.pinned.includes(vis[j])) return; // pinned and free widgets don't mix
    const a = L.order.indexOf(id), b = L.order.indexOf(vis[j]); L.order.splice(a, 1); L.order.splice(b, 0, id);
    if (pin) L.pinned = L.order.filter((x) => L.pinned.includes(x));
    save(); apply(); haptic(6);
    const w = byId(id); w.scrollIntoView({ block: "nearest", behavior: "smooth" }); const btn = w.querySelector('.wctl [data-a="' + (dir < 0 ? "up" : "down") + '"]'); if (btn && !btn.disabled) btn.focus(); else w.querySelector(".wctl .wb").focus();
  }
  function onCtl(e) {
    const b = e.target.closest(".wctl .wb"); if (!b || !editing) return;
    const w = b.closest(".w"), id = w.dataset.w, a = b.dataset.a;
    if (a === "up" || a === "down") return move(id, a === "up" ? -1 : 1);
    if (a === "pin") {
      if (L.pinned.includes(id)) { L.pinned = L.pinned.filter((x) => x !== id); toast("Unpinned " + w.dataset.title); }
      else { L.pinned.push(id); toast("Pinned " + w.dataset.title + " to the top"); }
      L.order = L.order.filter((x) => x !== id); L.order.splice(L.pinned.includes(id) ? L.pinned.length - 1 : L.pinned.length, 0, id);
    } else if (a === "size") {
      const cur = L.size[id] || DEFSIZE[id], nx = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length] || 12;
      if (nx === DEFSIZE[id]) delete L.size[id]; else L.size[id] = nx;
    } else if (a === "hide") { L.hidden.push(id); toast("Hidden " + w.dataset.title + " · tap it under Hidden to bring it back"); }
    save(); apply(); haptic(6);
  }
  function renderTray() {
    if (!bar) return;
    const t = bar.querySelector(".ltray"), hid = L.hidden.filter((id) => byId(id));
    t.innerHTML = hid.length ? '<span class="muted small">Hidden:</span> ' + hid.map((id) => '<button type="button" class="chip" data-show="' + id + '">+ ' + byId(id).dataset.title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</button>").join("") : "";
    t.hidden = !hid.length;
    bar.querySelector("#layoutReset").disabled = isDefault();
  }
  function makeBar() {
    bar = document.createElement("div"); bar.className = "lbar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Layout editor");
    bar.innerHTML = '<div class="lrow"><div class="grow"><b>Edit layout</b><div class="muted small">Drag ⠿ or use ↑ ↓ · Pin keeps a widget on top' + (innerWidth >= 900 ? " · ½ ⅔ changes width" : "") + '</div></div>' +
      '<button type="button" class="btn" id="layoutReset">Reset</button><button type="button" class="btn primary" id="layoutDone">Done</button></div><div class="ltray chips" hidden></div>';
    document.body.appendChild(bar);
    bar.addEventListener("click", (e) => {
      const s = e.target.closest("[data-show]");
      if (s) { L.hidden = L.hidden.filter((x) => x !== s.dataset.show); save(); apply(); const w = byId(s.dataset.show); if (w) w.scrollIntoView({ block: "center", behavior: "smooth" }); haptic(6); return; }
      if (e.target.closest("#layoutDone")) setEditing(false);
      if (e.target.closest("#layoutReset")) { if (!confirm("Reset the layout to the default order, sizes and visibility?")) return; L = blank(); save(); apply(); toast("Layout reset"); }
    });
  }
  function setEditing(on) {
    const anchor = all().find((w) => { const r = w.getBoundingClientRect(); return r.bottom > 90 && r.height > 0; }); // keep the widget you were looking at in view
    editing = on; document.body.classList.toggle("editing", on);
    all().forEach((w) => ctlFor(w));
    if (on) {
      if (!bar) makeBar(); bar.hidden = false; renderTray(); apply();
      if (window.Sortable && !sortable) sortable = Sortable.create(grid, {
        handle: ".wh", draggable: ".w", filter: ".pinned", preventOnFilter: false, animation: 160, ghostClass: "wghost", chosenClass: "wchosen",
        forceFallback: true, fallbackTolerance: 3, scroll: true, scrollSensitivity: 90, bubbleScroll: true,
        onMove: (ev) => !ev.related.classList.contains("pinned"),
        onStart: () => haptic(10),
        onEnd: () => { const now = all().map((w) => w.dataset.w); L.order = now; save(); apply(); haptic(6); },
      });
      if (sortable) sortable.option("disabled", false);
      toast("Edit layout: drag ⠿ or use ↑ ↓");
    } else {
      if (sortable) sortable.option("disabled", true);
      if (bar) bar.hidden = true;
      window.dispatchEvent(new Event("resize"));
      toast(isDefault() ? "Layout saved (default)" : "Layout saved in this browser");
    }
    document.querySelectorAll("#layoutBtn,#layoutBtn2").forEach((b) => b.setAttribute("aria-pressed", on));
    if (anchor && !anchor.classList.contains("whid")) requestAnimationFrame(() => anchor.scrollIntoView({ block: on ? "center" : "start" }));
  }

  // ---------- tabs → first visible widget of that group ----------
  function goto(tab) {
    const w = all().find((x) => x.dataset.tab === tab && !x.classList.contains("whid") && !x.hidden);
    if (!w) { toast("That section is hidden · ▦ Customize layout to show it"); return false; }
    w.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    return true;
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".tabs a[data-tab]"); if (!a) return;
    e.preventDefault(); if (goto(a.dataset.tab)) history.replaceState(null, "", "#" + a.dataset.tab);
  });
  grid.addEventListener("click", onCtl);
  document.querySelectorAll("#layoutBtn,#layoutBtn2").forEach((b) => b.addEventListener("click", () => setEditing(!editing)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && editing) setEditing(false); });
  apply();
  window.SNEKLAYOUT = { goto, setEditing, get: () => JSON.parse(JSON.stringify(L)), isEditing: () => editing };
})();
