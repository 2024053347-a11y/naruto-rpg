const CACHE_NAME = 'naruto-rpg-v6';
const STATIC_ASSETS = [];  // 不再主动缓存，改为运行时按需缓存

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/v1/chat/completions') ||
      url.pathname.includes('/v1/messages') ||
      url.pathname.includes('/messages') ||
      url.pathname.includes('/models')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // 网络优先策略：先尝试网络，失败时回退到缓存
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(() => {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});
