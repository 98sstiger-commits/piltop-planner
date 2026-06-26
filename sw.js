const CACHE = 'piltop-planner-v2';

// 설치 - 기본 파일만 캐시 (index.html URL 제외)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(['/univ-data.js', '/manifest.json', '/icon.svg']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// 활성화
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// fetch - API/외부 요청은 무조건 네트워크, 나머지는 캐시 우선
self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  // 네트워크만 사용 (캐시 안 함)
  if (
    url.includes('/api/') ||
    url.includes('supabase') ||
    url.includes('neis') ||
    url.includes('anthropic') ||
    url.includes('googleapis') ||
    url.includes('data.go.kr') ||
    url.includes('blob:')
  ) return;

  // index.html은 항상 네트워크 우선 (파라미터 보존)
  if (url.includes('index.html') || url.endsWith('/')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 나머지는 캐시 우선
  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
      .catch(() => new Response('offline', { status: 503 }))
  );
});
