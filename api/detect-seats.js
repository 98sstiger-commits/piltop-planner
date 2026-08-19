export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) throw new Error('imageUrl이 필요합니다');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error('도면 이미지를 불러오지 못했어요');
    const mediaType = (imgRes.headers.get('content-type') || 'image/png').split(';')[0];
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(mediaType)) {
      throw new Error('jpg/png/gif/webp 형식의 도면 이미지만 자동 인식할 수 있어요');
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) throw new Error('도면 이미지 용량이 너무 커요 (5MB 이하로 업로드해주세요)');
    const base64 = buf.toString('base64');
    const imageBlock = { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    // 정밀도를 최우선으로 두는 기능이라 가장 성능이 좋은 모델을 씁니다.
    const MODEL = 'claude-opus-5';

    const detectPrompt = `첨부된 이미지는 독서실/스터디룸의 평면 배치도입니다. 책상(좌석)이 사각형 아이콘으로 표시되어 있습니다.

먼저 도면을 꼼꼼히 관찰하고 아래 순서로 분석하세요 (분석 과정도 답변에 그대로 적어주세요):
1. 좌석들이 몇 개의 블록/구역으로 나뉘어 있는지, 각 블록이 몇 행 × 몇 열의 격자인지 파악합니다.
2. 칸막이를 사이에 두고 마주보는 2인 마주보기 책상이 있다면, 양쪽을 각각 별개의 좌석 1개씩으로 셀 것을 확인합니다.
3. 같은 블록 안의 좌석들은 보통 크기가 균일하므로, 한 블록 내 좌석들의 width/height가 서로 크게 어긋나지 않는지 스스로 점검합니다.
4. 이미지 가장자리·모서리·구석에 있어 놓치기 쉬운 좌석이 없는지 다시 한 번 확인합니다.
5. 텍스트, 화살표, 범례, 안내 문구, 벽, 기둥, 통로, 문은 좌석이 아니므로 제외합니다.

분석이 끝나면, 이미지 전체 크기를 기준으로 한 퍼센트 좌표(0~100)로 개별 좌석 하나하나의 위치를 알려주세요.
- x, y는 좌석 사각형의 좌상단 모서리 기준 퍼센트 좌표입니다 (이미지 왼쪽 끝=0, 오른쪽 끝=100 / 위쪽 끝=0, 아래쪽 끝=100).
- width, height는 좌석 사각형 하나의 가로/세로 크기를 이미지 전체 대비 퍼센트로 표시합니다.

분석 내용을 먼저 서술한 다음, 맨 마지막에 아래 구분선과 함께 최종 결과 JSON 배열만 출력하세요 (그 뒤에는 아무것도 쓰지 마세요):
===SEATS===
[{"x":12.3,"y":5.1,"width":6.5,"height":7.2}, ...]`;

    const firstText = await callClaude(MODEL, [
      { role: 'user', content: [imageBlock, { type: 'text', text: detectPrompt }] },
    ], 12000);

    const firstSeats = parseSeats(firstText);
    if (!firstSeats.length) throw new Error('도면에서 좌석을 찾지 못했어요');

    // ── 2차 검증: 1차 결과를 같은 이미지와 다시 대조해서 놓친 자리·중복·오차를 교정합니다.
    let finalSeats = firstSeats;
    try {
      const listForReview = firstSeats
        .map((s, i) => `${i + 1}. x=${s.x.toFixed(1)}, y=${s.y.toFixed(1)}, width=${s.width.toFixed(1)}, height=${s.height.toFixed(1)}`)
        .join('\n');
      const verifyPrompt = `같은 평면 배치도 이미지입니다. 아래는 방금 좌석 위치를 1차로 인식한 결과예요 (이미지 전체 대비 퍼센트 좌표):

${listForReview}

이 목록을 이미지와 하나하나 대조해서 다음을 꼼꼼히 검토하고 교정해주세요:
- 실제로는 좌석이 아닌데 잘못 포함된 항목이 없는지 (중복 인식, 벽·기둥·통로·텍스트를 좌석으로 착각한 경우)
- 이미지에는 있는데 목록에서 빠진 좌석이 없는지 (특히 가장자리·구석·다른 좌석에 가려 잘 안 보이는 좌석)
- 각 좌석의 x/y/width/height가 실제 이미지 상 위치·크기와 정확히 일치하는지 (같은 블록 안의 좌석들은 크기가 균일해야 정상입니다)

검토 과정을 먼저 서술한 다음, 맨 마지막에 아래 구분선과 함께 최종 확정된 좌석 목록 JSON 배열만 출력하세요 (문제가 없었다면 원래 목록을 그대로 반환해도 됩니다. 그 뒤에는 아무것도 쓰지 마세요):
===SEATS===
[{"x":12.3,"y":5.1,"width":6.5,"height":7.2}, ...]`;

      const secondText = await callClaude(MODEL, [
        { role: 'user', content: [imageBlock, { type: 'text', text: verifyPrompt }] },
      ], 12000);
      const verified = parseSeats(secondText);
      if (verified.length) finalSeats = verified;
    } catch (verifyErr) {
      console.error('detect-seats verify pass failed, using first-pass result:', verifyErr);
    }

    return res.status(200).json({ success: true, seats: finalSeats });
  } catch (err) {
    console.error('detect-seats error:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
}

async function callClaude(model, messages, maxTokens) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.content?.map(c => c.text || '').join('') || '';
}

function parseSeats(text) {
  const marker = text.lastIndexOf('===SEATS===');
  const scope = marker !== -1 ? text.slice(marker) : text;
  const start = scope.indexOf('[');
  const end = scope.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  let raw;
  try {
    raw = JSON.parse(scope.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map(s => ({
      x: Number(s.x), y: Number(s.y),
      width: Number(s.width), height: Number(s.height),
    }))
    .filter(s => [s.x, s.y, s.width, s.height].every(n => Number.isFinite(n)))
    .map(s => ({
      x: Math.max(0, Math.min(100, s.x)),
      y: Math.max(0, Math.min(100, s.y)),
      width: Math.max(1, Math.min(50, s.width)),
      height: Math.max(1, Math.min(50, s.height)),
    }))
    .slice(0, 200);
}
