// report.html은 정적 파일이라 카카오톡 같은 메신저가 링크를 미리보기로
// 펼칠 때(OG 태그 크롤링) 학생 이름을 알 수 없어 항상 "학습 리포트"라는
// 똑같은 제목만 보였습니다. 이 함수가 /report.html 요청을 대신 받아서,
// URL의 ?id= 값으로 학생 이름을 조회한 뒤 정적 파일의 제목/설명 태그를
// 그 이름으로 바꿔서 돌려줍니다 — 실제 화면(스크립트 동작)은 원본
// report.html과 완전히 동일하고, 메타 태그만 다릅니다.
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
    html = fs.readFileSync(path.join(process.cwd(), 'report.html'), 'utf8');
  } catch (err) {
    console.error('report.html 읽기 실패:', err);
    return res.status(500).send('Internal Server Error');
  }

  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (id) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/planner_students?id=eq.${encodeURIComponent(id)}&select=name`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        signal: AbortSignal.timeout(3000),
      });
      const rows = await r.json();
      const name = Array.isArray(rows) && rows[0]?.name;
      if (name) {
        const safeName = escapeHtml(name);
        html = html
          .replace('<title>학습 리포트</title>', `<title>${safeName} 학생 학습리포트</title>`)
          .replace('content="플래니 학습 리포트"', `content="${safeName} 학생 학습리포트"`)
          .replace('content="플래니에서 학습 리포트를 확인해보세요"', `content="${safeName} 학생의 오늘 학습 현황을 확인해보세요"`);
      }
    } catch (err) {
      console.error('report 메타 태그용 학생 이름 조회 실패:', err);
      // 조회에 실패해도 기본 제목이 그대로 붙은 원본을 보여주면 되므로 무시합니다.
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).send(html);
}
