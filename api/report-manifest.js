// 학부모가 리포트 링크를 홈 화면에 앱으로 설치할 때, 아이콘 이름이
// "리포트" 같은 공용 이름이 아니라 "OOO 학생 학습리포트"로 뜨게
// 해주는 학생별 매니페스트입니다. report.html이 이 주소를
// <link rel="manifest">로 걸어두고, start_url도 그 학생의 리포트
// 주소로 고정해서 설치한 아이콘을 누르면 항상 그 학생 리포트로
// 바로 열리게 합니다.
export default async function handler(req, res) {
  const SB_URL = 'https://zmtldohklivkzpfdyflc.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InptdGxkb2hrbGl2a3pwZmR5ZmxjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjgxMDQsImV4cCI6MjA4ODU0NDEwNH0.cv1WrvDzNedVZABWyRCS9ARRxf4Si9qgeUqEvhpHWlo';
  const id = typeof req.query?.id === 'string' ? req.query.id : '';
  let name = '학생';
  try {
    const r = await fetch(`${SB_URL}/rest/v1/planner_students?id=eq.${encodeURIComponent(id)}&select=name`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]?.name) name = rows[0].name;
  } catch (e) {
    // 실패해도 기본 이름으로 계속 진행
  }
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
