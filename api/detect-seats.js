export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageUrl, imageBase64, mediaType: bodyMediaType } = req.body || {};
    if (!imageUrl && !imageBase64) throw new Error('imageUrl 또는 imageBase64가 필요합니다');
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    let base64, mediaType;
    if (imageBase64) {
      // 관리자가 도면의 일부 영역만 잘라서 보낸 경우 (브라우저에서 canvas로 잘라 base64로 전송)
      mediaType = bodyMediaType || 'image/png';
      if (!allowed.includes(mediaType)) {
        throw new Error('jpg/png/gif/webp 형식의 도면 이미지만 자동 인식할 수 있어요');
      }
      base64 = imageBase64;
      if (base64.length * 3 / 4 > 5 * 1024 * 1024) {
        throw new Error('선택한 영역의 이미지 용량이 너무 커요 (5MB 이하로 다시 시도해주세요)');
      }
    } else {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('도면 이미지를 불러오지 못했어요');
      mediaType = (imgRes.headers.get('content-type') || 'image/png').split(';')[0];
      if (!allowed.includes(mediaType)) {
        throw new Error('jpg/png/gif/webp 형식의 도면 이미지만 자동 인식할 수 있어요');
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length > 5 * 1024 * 1024) throw new Error('도면 이미지 용량이 너무 커요 (5MB 이하로 업로드해주세요)');
      base64 = buf.toString('base64');
    }

    const prompt = `첨부된 이미지는 독서실/스터디룸의 평면 배치도입니다. 책상(좌석)이 사각형 아이콘으로 표시되어 있습니다.

이 도면에서 개별 좌석(책상) 하나하나의 위치를 찾아, 이미지 전체 크기를 기준으로 한 퍼센트 좌표(0~100)로 알려주세요.

규칙:
- 칸막이를 사이에 두고 마주보는 책상(2인 마주보기 형태)이면 양쪽을 각각 별개의 좌석 1개씩으로 셉니다.
- x, y는 좌석 사각형의 좌상단 모서리 기준 퍼센트 좌표입니다 (이미지 왼쪽 끝=0, 오른쪽 끝=100 / 위쪽 끝=0, 아래쪽 끝=100).
- width, height는 좌석 사각형 하나의 가로/세로 크기를 이미지 전체 대비 퍼센트로 표시합니다.
- 텍스트, 화살표, 범례, 안내 문구, 벽, 기둥, 통로는 좌석이 아니므로 제외합니다.
- 보이는 좌석을 최대한 빠짐없이 정확하게 찾아주세요.

설명이나 백틱 없이 JSON 배열만 반환하세요:
[{"x":12.3,"y":5.1,"width":6.5,"height":7.2}, ...]`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    const text = data.content?.map(c => c.text || '').join('') || '';
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('좌석을 인식하지 못했어요: ' + text.slice(0, 200));
    const raw = JSON.parse(text.slice(start, end + 1));

    const seats = raw
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

    if (!seats.length) throw new Error('도면에서 좌석을 찾지 못했어요');

    return res.status(200).json({ success: true, seats });
  } catch (err) {
    console.error('detect-seats error:', err);
    return res.status(200).json({ success: false, error: err.message });
  }
}
