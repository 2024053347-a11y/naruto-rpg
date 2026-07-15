const CACHE_PREFIX = 'naruto-rpg-';
const CACHE_NAME = `${CACHE_PREFIX}v15`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
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

  // 仅缓存静态 GET；认证/API 响应含用户数据，POST 等方法也不受 Cache API 支持。
  if (event.request.method !== 'GET' ||
      url.pathname.includes('/api/') ||
      url.pathname.includes('/auth/') ||
      url.pathname.includes('/v1/chat/completions') ||
      url.pathname.includes('/v1/messages') ||
      url.pathname.includes('/api/ai-proxy')) {
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
