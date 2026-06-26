export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, school, grade, career, careerField, u1, d1, u2, d2, schoolSched, examSched } = req.body;

    const isHigh = school?.includes('고');
    const gradeCtx = isHigh
      ? ({ '1': '고1 — 고교 적응, 내신 기초 확립, 세특 시작, 비교과 준비', '2': '고2 — 내신 최적화, 세특 심화, 수능 기초, 비교과 마무리', '3': '고3 — 수시/정시 전략 실행, 수능 완성, 원서 준비' }[grade] || '고등학생')
      : ({ '1': '중1 — 중학 적응, 기초 학습 습관 형성, 진로 탐색 시작', '2': '중2 — 학습 심화, 진로 탐색, 고교 선택 준비', '3': '중3 — 고교 진학 준비, 내신 집중, 진로 결정' }[grade] || '중학생');

    const careerInfo = career || careerField || '미정';
    const univInfo = [u1, d1].filter(Boolean).join(' / ') || '미정';
    const today = new Date();
    const startMonth = today.getMonth() + 1;
    const year = today.getFullYear();

    const examSummary = [...(schoolSched || []), ...(examSched || [])]
      .filter(e => e.type === 'school-exam' || e.type === 'suneung')
      .map(e => `${e.date}: ${e.name}`)
      .join('\n');

    const prompt = `당신은 대한민국 최고의 대입 전문 컨설턴트입니다.
다음 학생을 위한 ${year}년 ${startMonth}월부터 12월까지의 월별 맞춤 학습 플래너를 JSON으로 생성해주세요.

학생 정보:
- 이름: ${name}
- 학교: ${school}, ${grade}학년 (${gradeCtx})
- 진로/희망직업: ${careerInfo}
- 희망대학/학과: ${univInfo}

시험 및 입시 일정:
${examSummary || '(학사일정 없음)'}

생성 규칙:
1. keyword: 이달의 핵심 학습 목표 (20자 이내, 구체적이고 실천 가능하게)
2. note: 이달 실천 팁 (25자 이내)
3. tags: 최대 3개 [{"type":"study"/"exam"/"prep"/"suneung"/"career", "label":"6자이내"}]
4. weeklyHint: 이달 주간 학습 포인트 (20자 이내)
5. careerTip: 진로 연계 이달의 한마디 (25자 이내) — 진로 미정이면 진로 탐색 방법 제안
6. subjectGuide: 이달 집중 교과 과목별 가이드 (각 15자 이내, 2~3개)
   예: ["수학: 수열·극한 집중", "영어: 구문독해 완성", "국어: 문학 작품 분석"]
7. extracurricular: 이달 비교과 활동 제안 (20자 이내) — 교내 활동만, 수상경력 절대 언급 금지
8. 시험 전달은 집중 준비 강조
9. 학년과 진로에 완전히 맞는 현실적 내용

JSON 배열만 반환 (설명, 백틱, 주석 없이):
[{"month":${startMonth},"keyword":"","note":"","tags":[{"type":"study","label":""}],"weeklyHint":"","careerTip":"","subjectGuide":[],"extracurricular":""},...]
month는 ${startMonth}에서 12까지.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    const text = data.content?.map(c => c.text || '').join('') || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const plan = JSON.parse(clean);
    const result = {};
    plan.forEach(m => { result[m.month] = m; });

    return res.status(200).json({ success: true, plan: result });
  } catch (err) {
    console.error('Generate plan error:', err);
    return res.status(500).json({ error: err.message });
  }
}
