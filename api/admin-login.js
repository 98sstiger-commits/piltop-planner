export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { password } = req.body || {};
    const correct = process.env.ADMIN_PASS || '필탑admin1';
    if (!password || password !== correct) {
      return res.status(200).json({ success: false });
    }
    res.setHeader(
      'Set-Cookie',
      `piltop_admin=${encodeURIComponent(correct)}; Path=/; Max-Age=2592000; SameSite=Lax; Secure; HttpOnly`
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('admin-login error:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
}
