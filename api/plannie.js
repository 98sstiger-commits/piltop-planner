// index.html(학생 플래니)도 report.html과 같은 이유로 메신저 링크
// 미리보기에 항상 "플래니"라는 고정 제목만 보였습니다. /index.html
// 요청을 대신 받아서 URL의 ?id= 값으로 학생 이름을 조회한 뒤 정적
// 파일의 제목/설명 태그를 그 이름으로 바꿔서 돌려줍니다 — 실제 화면
// (스크립트 동작)은 원본 index.html과 완전히 동일하고, 메타 태그만
// 다릅니다.
import fs from 'fs';
import path from 'path';

const SB_URL = 'https://zmtldohklivkzpfdyflc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptdGxkb2hrbGl2a3pwZmR5ZmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjgxMDQsImV4cCI6MjA4ODU0NDEwNH0.cv1WrvDzNedVZABWyRCS9ARRxf4Si9qgeUqEvhpHWlo';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default async function handler(req, res) {
  let html;
  try {
    html = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
  } catch (err) {
    console.error('index.html 읽기 실패:', err);
    return res.status(500).send('Internal Server Error');
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (id) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/planner_students?id=eq.${encodeURIComponent(id)}&select=name`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      });
      const rows = await r.json();
      const name = Array.isArray(rows) && rows[0]?.name;
      if (name) {
        const safeName = escapeHtml(name);
        html = html
          .replace('<title>플래니</title>', `<title>${safeName} 학생 플래니</title>`)
          .replace('content="플래니"', `content="${safeName} 학생 플래니"`)
          .replace('content="필탑학원 자기주도학습 플래니"', `content="${safeName} 학생의 플래니를 확인해보세요"`);
      }
    } catch (err) {
      console.error('plannie 메타 태그용 학생 이름 조회 실패:', err);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(html);
}
