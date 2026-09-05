/* 학부모 리포트 앱의 푸시 알림 전용 서비스워커입니다.
   화면 캐싱은 전혀 하지 않고(그래서 report.html이 항상 최신으로
   보이는 기존 동작에 영향 없음), 딱 두 가지만 합니다:
   1) 서버가 보낸 푸시가 도착하면 알림 팝업을 띄우고, 아직 안 읽은
      알림 개수만큼 앱 아이콘에 숫자 뱃지를 올립니다.
   2) 사용자가 리포트를 열면(report.html이 메시지를 보내면) 알림을
      다 지우고 뱃지도 0으로 되돌립니다. */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = { title: '플래니 알림', body: '' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}
  event.waitUntil((async () => {
    // 태그를 매번 다르게 줘서, 짧은 시간에 입실→퇴실처럼 여러 개가
    // 와도 서로 덮어쓰지 않고 각각 쌓이게 합니다(뱃지 숫자가 정확히
    // 늘어나야 하므로).
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon.svg',
      tag: 'plannie-' + Date.now(),
    });
    try {
      const notifs = await self.registration.getNotifications();
      if ('setAppBadge' in navigator) await navigator.setAppBadge(notifs.length);
    } catch (e) {}
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { all[0].focus(); return; }
    self.clients.openWindow('/report.html');
  })());
});

self.addEventListener('message', (event) => {
  if (event.data !== 'clear-badge') return;
  event.waitUntil((async () => {
    try {
      const notifs = await self.registration.getNotifications();
      notifs.forEach((n) => n.close());
      if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
    } catch (e) {}
  })());
});
