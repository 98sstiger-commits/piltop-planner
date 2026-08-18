export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { type, name, stats } = req.body || {};
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const label = type === 'monthly' ? '월간' : type === 'weekly' ? '주간' : '일간';
    const prompt = `당신은 학생을 따뜻하게 격려하는 학원 선생님입니다.
아래 ${label} 학습 데이터를 보고 학부모에게 보여줄 "${label} 한마디"를 작성해주세요.

학생: ${name}
데이터: ${JSON.stringify(stats)}

규칙:
- 2~3문장, 존댓말, 총 120자 이내
- 잘한 점을 먼저 구체적 수치와 함께 칭찬
- 개선하면 좋을 점을 부드럽게 제안 (있다면)
- 과장하지 말고 데이터에 근거해서만 작성
- 결과는 순수 텍스트만 반환 (따옴표, 설명, 백틱 금지)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const comment = (data.content?.map(c => c.text || '').join('') || '').trim();
    if (!comment) throw new Error('empty comment');

    return res.status(200).json({ success: true, comment });
  } catch (err) {
    console.error('generate-report-comment error:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
}
