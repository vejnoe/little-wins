const CACHE_NAME = 'wins-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './vendor/pwa-install.bundle.js',
  './manifest.json',
  './sfx/super-mario-world-coin.mp3'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Network-first: skip the browser's HTTP cache too, otherwise an installed
  // PWA can keep serving stale app.js even though it re-fetches on every load.
  // Fall back to the cache only when offline.
  e.respondWith(
    fetch(e.request, { cache: 'reload' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
