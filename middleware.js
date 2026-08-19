export const config = { matcher: '/admin.html' };

const REALM = 'Basic realm="필탑 플래너 관리자"';

export default function middleware(request) {
  const user = process.env.ADMIN_USER || 'piltop';
  const pass = process.env.ADMIN_PASS || '필탑admin1';

  const auth = request.headers.get('authorization');
  if (auth && auth.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6));
    const sep = decoded.indexOf(':');
    const u = decoded.slice(0, sep);
    const p = decoded.slice(sep + 1);
    if (u === user && p === pass) return;
  }

  return new Response('인증이 필요해요', {
    status: 401,
    headers: { 'WWW-Authenticate': REALM },
  });
}
