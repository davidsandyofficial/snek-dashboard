// Caches only the app shell so the dashboard opens offline/instantly.
// Network-first for every shell file, so a fresh deploy always wins when online.
// Market/API data and snapshot.json are never served from this cache.
const CACHE = "snek-shell-v2";
const SHELL = ["./", "index.html", "assets/style.css", "assets/app.js", "assets/snapshot.js",
  "assets/vendor/lightweight-charts.standalone.production.js", "assets/vendor/d3-hierarchy.min.js",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png", "manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.endsWith("snapshot.json")) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
