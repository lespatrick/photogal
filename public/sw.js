// Service Worker for photogal PWA
const CACHE_NAME = 'photogal-cache-v1';
const MEDIA_CACHE_NAME = 'photogal-media-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const PRESERVED_CACHES = new Set([CACHE_NAME, MEDIA_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => !PRESERVED_CACHES.has(key)).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Avoid intercepting API mutations or non-GET requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Only cache thumbnails and previews, NEVER originals (large files) or zip archives
  if (url.pathname.startsWith('/api/media/') && !url.pathname.includes('/original/')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(MEDIA_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(MEDIA_CACHE_NAME);
          const cachedResponse = await cache.match(event.request);
          return cachedResponse || new Response('Offline', { status: 503 });
        })
    );
    return;
  }

  // Never intercept dynamic data endpoints or streaming archives
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first strategy strictly for HTML navigation
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const match = await caches.match(event.request);
        return match || caches.match('/') || new Response('Offline', { status: 503 });
      })
    );
  }
});

