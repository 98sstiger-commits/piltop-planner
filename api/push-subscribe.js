// 학부모가 리포트 앱에서 "알림 받기"를 켜면 브라우저가 만들어주는
// 구독 정보(endpoint/키)를 저장합니다. 같은 기기에서 다시 구독해도
// endpoint가 그대로면 upsert로 덮어써서 중복이 쌓이지 않게 합니다.
const SB_URL = 'https://zmtldohklivkzpfdyflc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptdGxkb2hrbGl2a3pwZmR5ZmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjgxMDQsImV4cCI6MjA4ODU0NDEwNH0.cv1WrvDzNedVZABWyRCS9ARRxf4Si9qgeUqEvhpHWlo';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { studentId, subscription, unsubscribe } = req.body || {};
    if (!subscription?.endpoint) return res.status(400).json({ error: 'subscription required' });

    if (unsubscribe || req.method === 'DELETE') {
      await fetch(`${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, {
        method: 'DELETE',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      });
      return res.status(200).json({ success: true });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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
      const errText = await r.text();
      console.error('push-subscribe save error:', errText);
      return res.status(500).json({ error: 'save failed' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('push-subscribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
