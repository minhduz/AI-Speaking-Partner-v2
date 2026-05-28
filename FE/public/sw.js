const CACHE_NAME = 'speakup-v7';

// App shell — pre-cached on install
const SHELL_ASSETS = [
  '/',
  '/login',
  '/register',
  '/home',
  '/chat',
  '/flashcards',
  '/profile',
  '/settings',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.svg',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
];

// ── Install: pre-cache app shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll fails silently per-item so we use individual adds to avoid
      // one missing asset blocking the entire install
      Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
    )
  );
  // Skip the waiting phase immediately so the new SW activates ASAP
  self.skipWaiting();
});

// ── Activate: remove stale caches ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all clients immediately (no page reload needed)
  self.clients.claim();
});

// ── Fetch strategy ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Bypass service worker caching completely in local development to avoid Turbopack chunk mismatch
  const isDev =
    self.location.hostname === 'localhost' ||
    self.location.hostname === '127.0.0.1' ||
    self.location.hostname.startsWith('192.168.');

  if (isDev) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. API & Next.js internals → always Network Only (never cache)
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/lessons') ||
    url.pathname.startsWith('/_next/') ||
    url.pathname.startsWith('/__nextjs')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // 3. Static assets (_next/static, icons, manifest) → Cache First
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp|woff|woff2|ttf)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return response;
        })
      )
    );
    return;
  }

  // 4. HTML pages → Stale-While-Revalidate
  //    Serve cached shell immediately, update cache in background.
  //    Falls back to cached version if offline.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        return fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => {
            // Offline fallback — return cached version or /login shell
            return cached || cache.match('/login') || new Response('Offline', { status: 503 });
          });
      })
    )
  );
});

// ── Background sync placeholder (future: queue mic recordings offline) ─
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
});
