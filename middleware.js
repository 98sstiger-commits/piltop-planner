export const config = { matcher: '/admin.html' };

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

export default function middleware(request) {
  const pass = process.env.ADMIN_PASS || '필탑admin1';
  const cookies = parseCookies(request.headers.get('cookie'));
  if (cookies.piltop_admin === pass) return;

  const url = new URL(request.url);
  const loginUrl = new URL('/admin-login.html', request.url);
  loginUrl.searchParams.set('next', url.pathname);
  return Response.redirect(loginUrl, 302);
}
