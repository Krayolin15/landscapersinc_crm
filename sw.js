/* =============================================================================
   Service worker — makes Landscapers Inc. HQ open instantly and work offline.
   Vendored libraries, images, fonts: cache-first (they never change in place),
   kept in their own cache so a new release does not download them again.
   App code (index.html, js/, css/) and the data pack: NETWORK-first with the
   cached copy as the offline fallback — so every deploy reaches every phone on
   its next load and modules from two different releases are never mixed.
   Document-vault files (data/vault/) are never cached here: the app keeps its
   own copy of each opened file in IndexedDB.
   Supabase API calls are never cached here (the app keeps its own offline
   copy in IndexedDB and replays queued changes when back online).
   ========================================================================== */

const VERSION = 'lsihq-v1.4.0';
const VENDOR = 'lsihq-vendor-1';   // bump only when a file in vendor/ or assets/ is replaced
const IMMUTABLE = p => p.includes('/vendor/') || p.includes('/assets/');
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/tokens.css', './css/base.css', './css/animations.css', './css/layout.css', './css/components.css', './css/apps.css',
  './js/settings.js', './js/boot.js', './js/main.js'
];
const VENDOR_FILES = [
  './assets/landscapers-logo.jpg', './assets/icons/favicon.svg', './assets/icons/icon-192.png',
  './vendor/lucide.min.js', './vendor/supabase.min.js', './vendor/chart.umd.min.js', './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js', './vendor/xlsx.full.min.js', './vendor/jszip.min.js', './vendor/confetti.browser.min.js',
  './vendor/signature_pad.umd.min.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css'
];

self.addEventListener('install', e => {
  e.waitUntil(Promise.all([
    caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => null),
    // libraries load on demand (js/core/lazy.js); having them here keeps that working offline
    caches.open(VENDOR).then(async c => { for (const f of VENDOR_FILES) if (!(await c.match(f))) await c.add(f).catch(() => null); })
  ]).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== VENDOR).map(k => caches.delete(k)))),
    // start fetching the page while the worker is still waking up
    self.registration.navigationPreload ? self.registration.navigationPreload.enable().catch(() => null) : null
  ]).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('jit.si')) return;
  if (url.origin === location.origin && url.pathname.includes('/data/vault/')) return; // large documents: straight to the network
  if (url.origin === location.origin && url.pathname.includes('/data/seed/')) {
    // the data pack is asked for with ?v=… (a time for the manifest, the pack version for the rest);
    // keep ONE copy per file, so those queries never pile up in the cache
    const key = url.origin + url.pathname;
    e.respondWith(fetch(e.request, { cache: 'no-cache' })
      .then(r => { if (r && r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(key, copy)); } return r; })
      .catch(() => caches.match(key)));
    return;
  }
  const keep = (r, cache = VERSION) => { if (r && r.ok) { const copy = r.clone(); caches.open(cache).then(c => c.put(e.request, copy)); } return r; };
  if ((url.origin === location.origin && IMMUTABLE(url.pathname)) || url.hostname.includes('fonts.g')) {
    // cache-first
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => keep(r, VENDOR))));
    return;
  }
  if (url.origin === location.origin) {
    // network-first; offline -> last cached copy (navigation falls back to the app shell)
    const fallback = () => caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    if (e.request.mode === 'navigate') {
      e.respondWith((async () => {
        try { const pre = await e.preloadResponse; if (pre) return keep(pre); } catch { /* no preload */ }
        return fetch(e.request, { cache: 'no-cache' }).then(r => keep(r)).catch(fallback);
      })());
      return;
    }
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => keep(r)).catch(fallback));
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => { const c = list[0]; if (c) { c.focus(); if (e.notification.data && e.notification.data.link) c.navigate(e.notification.data.link); } else self.clients.openWindow('./'); }));
});
