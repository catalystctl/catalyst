// Catalyst Service Worker v5 — caches static assets for faster loads
// API/WebSocket/plugin-asset requests are NEVER intercepted (pass through directly)
// v5: keep the cache version explicit when cache policy changes. Marketplace
// plugin frontend.mjs updates are not
// served from a stale cache-first JS entry.

const CACHE_NAME = 'catalyst-v5';

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
  
  // Skip non-http/https requests (chrome-extension://, blob://, data:, etc.)
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) {
    return;
  }
  
  const url = new URL(request.url);

  // NEVER intercept — pass through to network directly
  const shouldPassThrough =
    request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/plugins-assets/') ||
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

  // Only hashed build assets are safe to cache-first indefinitely. Public
  // branding files keep their URL across releases and must revalidate.
  const isHashedAsset = url.pathname.startsWith('/assets/') &&
    /-[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|avif)$/.test(url.pathname);

  if (isHashedAsset) {
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

// Handle messages from the main thread. Only the page on our own origin may
// ask to activate immediately; a message from any other window is ignored.
self.addEventListener('message', (event) => {
  if (event.origin !== self.location.origin) return;
  if (event.data === 'skipWaiting') self.skipWaiting();
});
