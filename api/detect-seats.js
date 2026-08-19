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
    const imageBlock = { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

    // 정밀도가 가장 중요한 1차 인식은 가장 성능이 좋은 모델로, 시간에 쫓기는
    // 2차 검증은 조금 더 빠른 모델로 나눠서 씁니다 (전체가 서버리스 함수
    // 시간 제한 안에 반드시 끝나야 하기 때문에 — 복잡한 도면일수록 중요합니다).
    const DETECT_MODEL = 'claude-opus-5';
    const VERIFY_MODEL = 'claude-sonnet-5';
    const DETECT_TIMEOUT_MS = 35000;
    const VERIFY_TIMEOUT_MS = 12000;

    const detectPrompt = `첨부된 이미지는 독서실/스터디룸의 평면 배치도입니다. 책상(좌석)이 사각형 아이콘으로 표시되어 있습니다.

아래 사항을 짧게(3~5문장) 점검한 다음, 개별 좌석 하나하나의 위치를 이미지 전체 크기 기준 퍼센트 좌표(0~100)로 알려주세요:
- 좌석이 몇 개 블록/구역으로 나뉘어 있고 대략 몇 개인지
- 칸막이를 사이에 두고 마주보는 2인 마주보기 책상은 양쪽을 각각 별개의 좌석으로 셌는지
- 같은 블록 안 좌석들의 크기가 균일한지, 가장자리·구석에 놓친 좌석은 없는지
- 텍스트, 화살표, 범례, 벽, 기둥, 통로, 문은 좌석이 아니므로 제외

x, y는 좌석 사각형 좌상단 모서리 기준 퍼센트 좌표(왼쪽/위쪽=0, 오른쪽/아래쪽=100), width/height는 이미지 전체 대비 퍼센트입니다.

점검 내용을 간단히 적은 다음, 맨 마지막에 아래 구분선과 함께 최종 결과 JSON 배열만 출력하세요 (그 뒤에는 아무것도 쓰지 마세요):
===SEATS===
[{"x":12.3,"y":5.1,"width":6.5,"height":7.2}, ...]`;

    const firstText = await callClaude(DETECT_MODEL, [
      { role: 'user', content: [imageBlock, { type: 'text', text: detectPrompt }] },
    ], 12000, DETECT_TIMEOUT_MS);

    const firstSeats = parseSeats(firstText);
    if (!firstSeats.length) throw new Error('도면에서 좌석을 찾지 못했어요');

    // ── 2차 검증(최선을 다해 시도, 시간이 부족하면 1차 결과를 그대로 씁니다) ──
    let finalSeats = firstSeats;
    try {
      const listForReview = firstSeats
        .map((s, i) => `${i + 1}. x=${s.x.toFixed(1)}, y=${s.y.toFixed(1)}, width=${s.width.toFixed(1)}, height=${s.height.toFixed(1)}`)
        .join('\n');
      const verifyPrompt = `같은 평면 배치도 이미지입니다. 아래는 방금 좌석 위치를 1차로 인식한 결과예요 (이미지 전체 대비 퍼센트 좌표):

${listForReview}

이 목록을 이미지와 대조해서 다음을 짧게 점검하고 교정해주세요:
- 실제로는 좌석이 아닌데 잘못 포함된 항목(중복 인식, 벽·기둥·통로·텍스트 오검출)
- 이미지에는 있는데 목록에서 빠진 좌석(특히 가장자리·구석)
- 좌표/크기가 실제 위치·크기와 크게 어긋나는 항목

점검 내용을 간단히 적은 다음, 맨 마지막에 아래 구분선과 함께 최종 확정된 좌석 목록 JSON 배열만 출력하세요 (문제가 없었다면 원래 목록을 그대로 반환해도 됩니다. 그 뒤에는 아무것도 쓰지 마세요):
===SEATS===
[{"x":12.3,"y":5.1,"width":6.5,"height":7.2}, ...]`;

      const secondText = await callClaude(VERIFY_MODEL, [
        { role: 'user', content: [imageBlock, { type: 'text', text: verifyPrompt }] },
      ], 8000, VERIFY_TIMEOUT_MS);
      const verified = parseSeats(secondText);
      if (verified.length) finalSeats = verified;
    } catch (verifyErr) {
      console.error('detect-seats verify pass skipped (timeout or error), using first-pass result:', verifyErr);
    }

    return res.status(200).json({ success: true, seats: finalSeats });
  } catch (err) {
    console.error('detect-seats error:', err);
    const message = err.name === 'AbortError'
      ? '도면 분석이 시간 내에 끝나지 않았어요 — 도면이 너무 복잡하면 구역을 나눠서 각각 업로드해보세요'
      : err.message;
    return res.status(200).json({ success: false, error: message });
  }
}

async function callClaude(model, messages, maxTokens, timeoutMs) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
      signal: controller.signal,
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.content?.map(c => c.text || '').join('') || '';
  } finally {
    if (timer) clearTimeout(timer);
  }
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
