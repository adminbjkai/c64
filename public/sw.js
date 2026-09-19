// c64 service worker — offline app shell.
//
// Strategy: cache-first for the app's own static files (/public/*, /dist/*,
// icons), network-first for the HTML document so a new deploy is picked up
// on the next online visit. Only same-origin GET requests are ever handled;
// there is no user content to cache because the app never sends any.
//
// VERSION is stamped from package.json by scripts/sync-version.mjs. Bumping
// it retires the previous cache on activation.

const VERSION = '1.2.0';
const CACHE = `c64-${VERSION}`;
const SHELL = ['/', '/public/styles.css', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/healthz') return;

  const isDocument = req.mode === 'navigate' || url.pathname === '/';
  if (isDocument) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
