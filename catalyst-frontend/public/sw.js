// Catalyst Service Worker — caches static assets for faster loads
// API/WebSocket requests are NEVER intercepted (pass through directly)

const CACHE_NAME = 'catalyst-v1';

// Assets to cache immediately on install
const PRECACHE_ASSETS = ['/index.html', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // NEVER intercept — pass through to network directly
  const shouldPassThrough =
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/docs') ||
    url.pathname.includes('.sock') ||
    (request.headers && request.headers.get('upgrade') === 'websocket') ||
    url.pathname === '/health';

  if (shouldPassThrough) return;

  // For HTML pages — network-first so users always see fresh content
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/index.html')),
        ),
    );
    return;
  }

  // For static assets (JS, CSS, fonts, images) — cache-first for near-instant loads
  const isStaticAsset =
    /\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|avif)$/.test(url.pathname) ||
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/background') ||
    url.pathname.startsWith('/logo');

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      }),
    );
    return;
  }

  // All other GET requests — network only, no caching
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
