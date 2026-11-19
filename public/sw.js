/* Ahadi service worker: makes the app installable and keeps the shell usable on flaky connections.
   - Static assets: cache first.
   - Public pages (home, event pages, help, legal): network first, fall back to the cached copy.
   - Private pages (organizer and admin dashboards, personal pledge links, My pledges, payments, receipts,
     support conversations) are NEVER stored on the device: on a shared phone they must not survive a logout.
   - API calls and money actions: never cached (always network).
   The cache name changed from ahadi-v1, so copies of private pages saved by older versions are deleted. */
const CACHE = 'ahadi-v2';
const PUBLIC_PAGE = (p) => p === '/' || p === '/help' || p === '/privacy' || p === '/terms' || p === '/login' || /^\/e\/[^/]+\/?$/.test(p);
const SHELL = ['/', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.endsWith('.svg')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
    return;
  }

  if (req.mode === 'navigate') {
    if (!PUBLIC_PAGE(url.pathname)) return; // private page: straight to the network, never stored
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/'))),
    );
  }
});

// Logout: the page asks us to forget every stored page.
self.addEventListener('message', (e) => {
  if (e.data === 'ahadi:clear') e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
});
