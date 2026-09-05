// 학생이 입실/퇴실할 때, 그 학생 리포트를 구독한 학부모 기기들에게
// 웹 푸시 알림을 보냅니다. 카카오톡/문자와 완전히 별개의 무료 채널이라,
// 구독한 기기가 하나도 없으면(설치·알림허용 안 함) 조용히 아무 일도
// 하지 않습니다 — 체크인 화면 동작을 절대 막으면 안 되기 때문입니다.
import webpush from 'web-push';

const SB_URL = 'https://zmtldohklivkzpfdyflc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptdGxkb2hrbGl2a3pwZmR5ZmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjgxMDQsImV4cCI6MjA4ODU0NDEwNH0.cv1WrvDzNedVZABWyRCS9ARRxf4Si9qgeUqEvhpHWlo';
const VAPID_PUBLIC_KEY = 'BCGfPyP79ACYK3rkwqOxVtYGkHOPcOGDB8JMXmLGwnzUKHC02Il1gR77o-Tw45bnsEhVCXe9Vz3LU9iuNy9R_Po';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { studentId, title, body } = req.body || {};
    if (!studentId || !title) return res.status(400).json({ error: 'studentId, title required' });

    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPrivateKey) {
      // 아직 서버에 VAPID 개인키가 설정되지 않은 상태 — 조용히 건너뜁니다.
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
          // 410/404는 브라우저에서 이미 삭제된(만료된) 구독 — 정리합니다.
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
  } catch (err) {
    console.error('send-push error:', err);
    return res.status(500).json({ error: err.message });
  }
}
