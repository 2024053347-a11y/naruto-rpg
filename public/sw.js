const CACHE_NAME = 'naruto-rpg-v14';
const IMMUTABLE_PREFIX = '/api/';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map(key => caches.delete(key))  // 清除所有旧缓存
      );
    })
  );
  self.clients.claim();
  // 通知所有客户端刷新
  self.clients.matchAll().then(clients => {
    clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
  });
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 不拦截 AI API 请求
  if (url.pathname.includes('/v1/chat/completions') ||
      url.pathname.includes('/v1/messages') ||
      url.pathname.includes('/api/ai-proxy') ||
      url.pathname.includes('/api/saves') ||
      url.pathname.includes('/api/admin')) {
    return;
  }

  // 网络优先：永远先请求网络，只有离线才回退缓存
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(event.request).then(cached =>
        cached || new Response('离线模式', { status: 503 })
      );
    })
  );
});

// 接收客户端消息
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
