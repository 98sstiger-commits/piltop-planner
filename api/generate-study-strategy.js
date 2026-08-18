export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, examLabel, subjects } = req.body || {};
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
    if (!Array.isArray(subjects) || !subjects.length) throw new Error('subjects가 필요합니다');

    const subjectLines = subjects.map(s =>
      `- ${s.name}: ${s.myRank}등/${s.totalStudents}명 (${s.grade}등급, ${s.category}, 다음 등급 컷까지 ${s.gapToNextGrade ?? '-'}명)`
    ).join('\n');

    const prompt = `당신은 학생의 내신 성적을 분석해 학습 전략을 짜주는 입시 전문 선생님입니다.
학생 이름: ${name || '학생'}
시험: ${examLabel || '이번 시험'}

과목별 성적 (5등급 상대평가 기준):
${subjectLines}

각 과목마다 다음을 반영해 2문장 이내의 짧고 구체적인 코멘트를 작성하세요:
- category가 "전략"(다음 등급 컷에 가까움)이면: 등급을 올리기 위해 지금 집중해야 할 이유를 구체적 수치와 함께 강조
- category가 "위험"(현재 등급 컷 근처라 밀릴 위험)이면: 등급 하락을 막기 위해 반드시 지켜야 함을 강조
- category가 "안정"이면: 무리하게 더 투자하지 않아도 되는 과목임을 알려주고, 시간을 다른 과목에 돌리라고 제안
- category가 "유지"면: 꾸준히 하면 되는 과목임을 알려줌

그리고 전체 요약(summary)에는 다음 시험까지 가장 우선순위로 시간을 투자해야 할 과목 1~2개를 콕 집어 제안하고, 격려하는 말투로 3문장 이내로 작성하세요.

과장하지 말고 주어진 숫자에 근거해서만 작성하세요. 결과는 아래 JSON 형식으로만 반환하세요 (설명, 백틱 금지):
{"subjectComments":{"과목명":"코멘트"},"summary":"전체 요약"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const text = data.content?.map(c => c.text || '').join('') || '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('응답을 해석하지 못했어요');
    const result = JSON.parse(text.slice(start, end + 1));

    return res.status(200).json({ success: true, subjectComments: result.subjectComments || {}, summary: result.summary || '' });
  } catch (err) {
    console.error('generate-study-strategy error:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
}
