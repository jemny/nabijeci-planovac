/* Offline fallback: same-origin files network-first with a cache copy; external APIs untouched. */
const VERSION = 'np-v21';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const NET_TIMEOUT = 3500;   // weak signal in the car: after this, show the cached copy instead of a white screen

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const mine = keys.filter((k) => k.startsWith('np-'));          // only this app's caches, not other pages on the origin
    const fromCacheFirst = mine.includes('np-v1');                  // v1 served the app cache-first: those pages are stale
    await Promise.all(mine.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
    if (fromCacheFirst) (await self.clients.matchAll({ type: 'window' })).forEach((c) => c.navigate(c.url).catch(() => {}));
  })());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // OSRM, Photon, tiles: straight to network
  // network first (bypassing the HTTP cache) so new app versions and weekly data arrive immediately
  const req = e.request.mode === 'navigate' ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })
    : new Request(e.request, { cache: 'no-cache' });
  e.respondWith((async () => {
    const net = fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    });
    net.catch(() => {});      // a late failure after the timeout is handled by the cache branch
    try {
      return await Promise.race([net, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), NET_TIMEOUT))]);
    } catch (err) {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      return hit || net;   // nothing cached: keep waiting for the network
    }
  })());
});
