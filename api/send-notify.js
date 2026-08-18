export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, channel, aligo } = req.body || {};
    if (!phone || !message) return res.status(400).json({ error: 'phone, message required' });

    // 알리고(문자) 키가 설정에 입력되지 않았으면 발송을 건너뜁니다.
    // admin.html [설정] 탭에서 API 키 / 발신번호를 입력하면 바로 동작합니다.
    if (channel !== 'sms' || !aligo?.key || !aligo?.user || !aligo?.sender) {
      return res.status(200).json({ success: false, skipped: true, reason: 'aligo credentials not configured' });
    }

    const body = new URLSearchParams({
      key: aligo.key,
      user_id: aligo.user,
      sender: aligo.sender,
      receiver: phone.replace(/-/g, ''),
      msg: message,
      msg_type: message.length > 45 ? 'LMS' : 'SMS',
    });

    const r = await fetch('https://apis.aligo.in/send/', { method: 'POST', body });
    const data = await r.json();
    return res.status(200).json({ success: data.result_code === '1', data });
  } catch (err) {
    console.error('send-notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
