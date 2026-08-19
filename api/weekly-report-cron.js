const SB_URL = 'https://zmtldohklivkzpfdyflc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptdGxkb2hrbGl2a3pwZmR5ZmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjgxMDQsImV4cCI6MjA4ODU0NDEwNH0.cv1WrvDzNedVZABWyRCS9ARRxf4Si9qgeUqEvhpHWlo';

async function sb(path, opts = {}) {
  const r = await fetch(SB_URL + '/rest/v1/' + path, {
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  return r.json();
}

// 매주 금요일 18:00(KST) — vercel.json의 crons 설정으로 호출됩니다.
// [설정] 탭에서 "주간 리포트 자동 발송"을 켠 독서실의 학부모 연락처로
// 주간 리포트 링크를 문자 발송합니다. (알리고 키가 설정돼 있어야 실제 발송됩니다)
export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
  }

  const base = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  const results = [];

  try {
    const rooms = await sb('study_rooms?auto_report_enabled=eq.true&select=*');
    for (const room of rooms || []) {
      const students = await sb(`planner_students?room_id=eq.${room.id}&parent_phone=not.is.null&select=id,name,parent_phone`);
      for (const student of students || []) {
        try {
          const link = `${base}/report.html?id=${student.id}&type=weekly`;
          const message = `[${room.academy_name || '필탑학원'}] ${student.name} 학생의 이번 주 학습 리포트가 도착했습니다.\n${link}`;
          if (room.notify_channel === 'sms' && room.aligo_api_key && room.aligo_user_id && room.aligo_sender) {
            const body = new URLSearchParams({
              key: room.aligo_api_key,
              user_id: room.aligo_user_id,
              sender: room.aligo_sender,
              receiver: student.parent_phone.replace(/-/g, ''),
              msg: message,
              msg_type: 'LMS',
            });
            const r = await fetch('https://apis.aligo.in/send/', { method: 'POST', body });
            const data = await r.json();
            results.push({ student: student.name, sent: data.result_code === '1' });
          } else {
            results.push({ student: student.name, sent: false, reason: 'no channel configured' });
          }
        } catch (e) {
          results.push({ student: student.name, sent: false, reason: e.message });
        }
      }
    }
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('weekly-report-cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
