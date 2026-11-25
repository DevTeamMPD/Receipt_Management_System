// ติดต่อ Supabase ด้วยสิทธิ์ของผู้ใช้ที่ล็อกอิน (ไม่ใช้คีย์ service role) — ฐานข้อมูลตรวจสิทธิ์ซ้ำด้วย RLS
export class ApiError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const DB_ERRORS = {
  '23514': [422, 'ข้อมูลยังไม่ครบหรือไม่ถูกรูปแบบ'],
  '23505': [409, 'ข้อมูลซ้ำกับที่มีอยู่'],
  '42501': [403, 'ไม่มีสิทธิ์ทำรายการนี้'],
  '22P02': [422, 'ข้อมูลไม่ถูกรูปแบบ'],
  '22007': [422, 'วันที่ไม่ถูกต้อง'],
};

export function supabase(env, fetchImpl = fetch) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const anon = env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new ApiError(503, 'ยังไม่ได้ตั้งค่า SUPABASE_URL และ SUPABASE_ANON_KEY ในเซิร์ฟเวอร์');
  const baseHeaders = token => ({ apikey: anon, authorization: `Bearer ${token || anon}` });

  async function parse(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return text; }
  }
  async function failure(res, data) {
    if (res.status === 401 || data?.code === 'PGRST301' || data?.code === 'PGRST303') return new ApiError(401, 'ต้องเข้าสู่ระบบใหม่');
    if (data?.code === 'P0001' && data.message === 'version_conflict') return new ApiError(409, 'ใบนี้ถูกแก้โดยคนอื่นแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
    if (data?.code === 'P0001' && data.message === 'locked') return new ApiError(409, 'ใบนี้ยืนยันหรือปิดไปแล้ว แก้ไขไม่ได้', { code: 'locked' });
    const mapped = DB_ERRORS[data?.code];
    if (mapped) return new ApiError(mapped[0], mapped[1], { code: data.code });
    return new ApiError(502, 'ฐานข้อมูลตอบกลับผิดพลาด', { code: data?.code || String(res.status) });
  }

  return {
    async passwordLogin(email, password) {
      const res = await fetchImpl(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await parse(res);
      if (!res.ok || !data?.access_token) throw new ApiError(res.status === 400 || res.status === 401 ? 401 : 502, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      return data;
    },
    async refresh(refreshToken) {
      const res = await fetchImpl(`${url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
      const data = await parse(res);
      if (!res.ok || !data?.access_token) throw new ApiError(401, 'ต้องเข้าสู่ระบบใหม่');
      return data;
    },
    async logout(token) {
      try { await fetchImpl(`${url}/auth/v1/logout`, { method: 'POST', headers: baseHeaders(token) }); } catch { /* ออกจากระบบฝั่งเราอยู่แล้ว */ }
    },
    async rest(token, method, path, { body, prefer } = {}) {
      const res = await fetchImpl(`${url}/rest/v1/${path}`, {
        method, headers: { ...baseHeaders(token), 'content-type': 'application/json', ...(prefer ? { prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await parse(res);
      if (!res.ok) throw await failure(res, data);
      return data;
    },
    rpc(token, name, args) { return this.rest(token, 'POST', `rpc/${name}`, { body: args }); },
    async upload(token, bucket, path, bytes, contentType) {
      const res = await fetchImpl(`${url}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { ...baseHeaders(token), 'content-type': contentType, 'x-upsert': 'false' }, body: bytes });
      if (!res.ok) throw new ApiError(502, 'บันทึกรูปไม่สำเร็จ', { code: `storage_${res.status}` });
    },
    async sign(token, bucket, paths, expiresIn = 3600) {
      if (!paths.length) return {};
      const res = await fetchImpl(`${url}/storage/v1/object/sign/${bucket}`, { method: 'POST', headers: { ...baseHeaders(token), 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn, paths }) });
      const data = await parse(res);
      if (!res.ok || !Array.isArray(data)) return {};
      return Object.fromEntries(data.filter(d => d.signedURL).map(d => [d.path, `${url}/storage/v1${d.signedURL}`]));
    },
  };
}
