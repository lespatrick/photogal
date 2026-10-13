// Service Worker for photogal PWA
const CACHE_NAME = 'photogal-cache-v1';
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
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Avoid intercepting API mutations or non-GET requests
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Network-first for dynamic API routes, cache-first for static media
  if (url.pathname.startsWith('/api/media/')) {
    event.respondWith(
      caches.open('photogal-media-v1').then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) return cachedResponse;
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return cachedResponse || new Response('Offline', { status: 503 });
        }
      })
    );
    return;
  }

  // Default network-first strategy for pages
  event.respondWith(
    fetch(event.request).catch(async () => {
      const match = await caches.match(event.request);
      return match || new Response('Offline', { status: 503 });
    })
  );
});
