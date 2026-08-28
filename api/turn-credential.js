// 실시간 공부모습(라이브 영상) 기능의 WebRTC 연결을 위한 TURN 서버 접속정보를
// 발급합니다. Metered.ca의 SECRET KEY는 여기(서버)에서만 쓰고 브라우저로
// 절대 내려보내지 않습니다 — 대신 짧게 만료되는 임시 자격증명만 내려줍니다.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const secretKey = process.env.METERED_SECRET_KEY;
  const domain = process.env.METERED_DOMAIN || 'piltop.metered.live';
  if (!secretKey) return res.status(200).json([{ urls: 'stun:stun.l.google.com:19302' }]);

  try {
    const createRes = await fetch(
      `https://${domain}/api/v1/turn/credential?secretKey=${secretKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiryInSeconds: 3600, label: 'live-view' }),
      }
    );
    const created = await createRes.json();
    if (!created?.apiKey) throw new Error('credential 발급 실패: ' + JSON.stringify(created));

    const iceRes = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${created.apiKey}`
    );
    const iceServers = await iceRes.json();
    return res.status(200).json(iceServers);
  } catch (err) {
    console.error('turn-credential error:', err);
    // 실패해도 기능 자체가 완전히 멈추지 않게 STUN만이라도 내려줍니다.
    return res.status(200).json([{ urls: 'stun:stun.l.google.com:19302' }]);
  }
}
