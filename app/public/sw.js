/**
 * Sharma Travels Admin's app shell.
 *
 * THIS IS CRM INFRASTRUCTURE, NOT KAAFIL'S. It is here because the boundary it
 * marks is a real one and we would rather you see it than trip over it.
 *
 * Kaafil makes your DATA survive: a write queues to a durable outbox in
 * IndexedDB, a read comes back from the snapshot store, and both outlive a
 * reload. It does nothing about your APPLICATION — the HTML document, the JS,
 * the CSS, the fonts. Those come off the network like any other page. Without
 * a service worker, a manager who is offline and reloads the tab gets the
 * browser's dinosaur, and every queued write is sitting safely in IndexedDB
 * behind a page that will not open.
 *
 * The kit ships no service worker and registers nothing, deliberately: caching
 * build output is a decision about YOUR deploy and revalidation strategy, and
 * a design system that guessed at it would be wrong for most of its hosts.
 *
 * Strategy: network-first for every same-origin GET, falling back to cache.
 *  - Online, you always get fresh code. A service worker that served stale
 *    modules from cache would have you debugging a build from an hour ago,
 *    which is a far worse failure than the one it prevents.
 *  - Offline, every document and module served since the last online load
 *    comes back from cache, so a reload opens the app instead of the dinosaur.
 *  - It works under `vite dev` as well as `vite build`. A hand-maintained
 *    precache list of hashed filenames would not: in dev there are no hashed
 *    bundles at all, just dozens of individually-served modules.
 *
 * A production CRM would generate something better than this from a config
 * line — `vite-plugin-pwa`, `next-pwa`, anything on Workbox — and get
 * precache-manifest generation and revision hashing for free. Reach for one of
 * those rather than copying this file.
 */

const CACHE = 'sharma-travels-shell-v1';

self.addEventListener('install', () => {
  // Nothing is precached: the cache fills from real traffic on the first
  // online load. That is what keeps this file honest under `vite dev`, where
  // the module graph is served URL by URL and no static list could describe it.
  self.skipWaiting();
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
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NEVER cache an API response. /api proxies to the CRM server, which mints
  // Kaafil sessions and share tokens; Kaafil's own traffic goes straight to
  // engine.kaafil.in and is cross-origin, so it is already excluded above.
  // The kit has a read cache and a write queue with conflict reconciliation
  // behind it — a second, dumber cache in front would hand stale rows to a
  // reconciler with no way to know they are stale.
  if (url.pathname.startsWith('/api')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Opaque and error responses are not worth keeping; caching a 404 is
        // how an app heals into a permanently broken state.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit !== undefined) return hit;
        // A navigation to a route that was never visited online still has to
        // open — the router resolves the path once the document is up.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell !== undefined) return shell;
        }
        throw new Error('offline and not cached');
      }),
  );
});
