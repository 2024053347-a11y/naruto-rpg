const CACHE_NAME = 'naruto-rpg-v8';
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

  // 只拦截 GET 请求
  if (event.request.method !== 'GET') return;

  // 忽略动态 API 和 Auth 路由
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/auth/')) {
    return;
  }

  // 忽略外部扩展或代理 API (比如 /v1/models)
  if (url.pathname.includes('/v1/') || 
      url.pathname.includes('/models') || 
      url.pathname.includes('/messages') || 
      url.pathname.includes('/chat/completions')) {
    return;
  }

  // 忽略带特殊协议的请求 (比如 chrome-extension://)
  if (!url.protocol.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      // 网络优先策略：先尝试网络，失败时回退到缓存
      return fetch(event.request).then((response) => {
        // 只缓存成功的请求，并且排除非跨域的透明响应
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone).catch(err => {
              console.warn('[SW] Cache put error:', err);
            });
          });
        }
        return response;
      }).catch((err) => {
        console.warn('[SW] Network fetch failed, fallback to cache', err);
        return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});
