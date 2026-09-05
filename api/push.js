// 입실·퇴실 무료 푸시 알림 관련 기능(학생별 매니페스트 생성 / 구독
// 저장·해지 / 발송)을 한 파일에 모아뒀습니다. Vercel 무료(Hobby)
// 플랜은 배포당 서버리스 함수 개수가 12개로 제한돼 있어서, 기능별로
// 파일을 따로 만들면 그 한도를 넘어 배포 자체가 조용히 실패합니다
// (실제로 이 문제로 배포가 실패했었습니다) — 그래서 일부러 GET/POST
// 요청과 action 값으로 안에서 나눠 처리하도록 합쳤습니다.
import webpush from 'web-push';

const SB_URL = 'https://zmtldohklivkzpfdyflc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptdGxkb2hrbGl2a3pwZmR5ZmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjgxMDQsImV4cCI6MjA4ODU0NDEwNH0.cv1WrvDzNedVZABWyRCS9ARRxf4Si9qgeUqEvhpHWlo';
const VAPID_PUBLIC_KEY = 'BCGfPyP79ACYK3rkwqOxVtYGkHOPcOGDB8JMXmLGwnzUKHC02Il1gR77o-Tw45bnsEhVCXe9Vz3LU9iuNy9R_Po';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleManifest(req, res);
    if (req.method === 'POST') {
      const action = req.body?.action;
      if (action === 'send') return await handleSend(req, res);
      return await handleSubscribe(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('push handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// 홈 화면에 앱으로 설치할 때 아이콘 이름이 "OOO 학생 학습리포트"로
// 뜨도록 하는 학생별 매니페스트. start_url도 그 학생 리포트 주소로
// 고정해서, 설치한 아이콘을 누르면 항상 그 학생 리포트로 바로 열립니다.
async function handleManifest(req, res) {
  const id = typeof req.query?.id === 'string' ? req.query.id : '';
  let name = '학생';
  try {
    const r = await fetch(`${SB_URL}/rest/v1/planner_students?id=eq.${encodeURIComponent(id)}&select=name`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]?.name) name = rows[0].name;
  } catch (e) {}
  const manifest = {
    name: `${name} 학생 학습리포트`,
    short_name: `${name} 리포트`,
    start_url: `/report.html?id=${encodeURIComponent(id)}`,
    display: 'standalone',
    background_color: '#F5F4F1',
    theme_color: '#1A4731',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
  };
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.status(200).json(manifest);
}

// 학부모가 리포트 앱에서 "알림 받기"를 켜면 브라우저가 만들어주는
// 구독 정보(endpoint/키)를 저장합니다.
async function handleSubscribe(req, res) {
  const { studentId, subscription, unsubscribe } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });

  if (unsubscribe) {
    await fetch(`${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, {
      method: 'DELETE',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    return res.status(200).json({ success: true });
  }
  if (!studentId) return res.status(400).json({ error: 'studentId required' });

  const r = await fetch(`${SB_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      student_id: studentId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys?.p256dh,
      auth: subscription.keys?.auth,
    }),
  });
  if (!r.ok) {
    console.error('push subscribe save error:', await r.text());
    return res.status(500).json({ error: 'save failed' });
  }
  return res.status(200).json({ success: true });
}

// 학생이 입실/퇴실할 때, 그 학생 리포트를 구독한 학부모 기기들에게
// 웹 푸시 알림을 보냅니다. 구독한 기기가 없으면 조용히 아무 것도
// 하지 않습니다 — 체크인 화면 동작을 절대 막으면 안 되기 때문입니다.
async function handleSend(req, res) {
  const { studentId, title, body } = req.body || {};
  if (!studentId || !title) return res.status(400).json({ error: 'studentId, title required' });

  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPrivateKey) {
    return res.status(200).json({ success: false, skipped: true, reason: 'VAPID_PRIVATE_KEY not configured' });
  }
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, vapidPrivateKey);

  const subsRes = await fetch(
    `${SB_URL}/rest/v1/push_subscriptions?student_id=eq.${encodeURIComponent(studentId)}&select=id,endpoint,p256dh,auth`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
  );
  const subs = await subsRes.json();
  if (!Array.isArray(subs) || !subs.length) return res.status(200).json({ success: true, sent: 0 });

  const payload = JSON.stringify({ title, body: body || '' });
  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload
      ).catch(async (err) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await fetch(`${SB_URL}/rest/v1/push_subscriptions?id=eq.${s.id}`, {
            method: 'DELETE',
            headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
          }).catch(() => {});
        }
        throw err;
      })
    )
  );
  const sent = results.filter((r) => r.status === 'fulfilled').length;
  return res.status(200).json({ success: true, sent, total: subs.length });
}
