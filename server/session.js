// คุกกี้เซสชัน: เก็บ access/refresh token ของ Supabase แบบ HttpOnly (JavaScript ในเบราว์เซอร์อ่านไม่ได้)
export const COOKIE = 'rd_session';
const MAX_AGE = 60 * 60 * 24 * 14;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function encodeSession(session) {
  return Buffer.from(JSON.stringify({ a: session.access_token, r: session.refresh_token }), 'utf8').toString('base64url');
}

export function decodeSession(value) {
  try {
    const o = JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
    return o && typeof o.a === 'string' && typeof o.r === 'string' ? { access_token: o.a, refresh_token: o.r } : null;
  } catch { return null; }
}

export function tokenExpiry(jwt) {
  try { return JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')).exp * 1000; } catch { return 0; }
}

export const setCookie = (session, secure) => `${COOKIE}=${encodeSession(session)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
export const clearCookie = secure => `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
