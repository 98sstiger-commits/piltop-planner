// 이전 버전의 서비스워커가 fetch를 가로채다가 "Failed to fetch" 오류를
// 일으켜 페이지 로드/전환이 실패하는 문제가 있었습니다. 이제 아무 요청도
// 가로채지 않고, 실행되자마자 스스로 등록 해제해서 더 이상 활동하지
// 않도록 합니다. (fetch 이벤트 리스너 자체를 두지 않음 — 이게 핵심입니다.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then(clients => clients.forEach(client => client.navigate(client.url)))
  );
});
