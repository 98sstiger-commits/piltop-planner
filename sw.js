// Service Worker - 캐시 없이 네트워크만 사용
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 모든 요청을 그냥 네트워크로 통과
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request));
});
