import { handle } from '../../server/router.js';
import { NOW, fakeSupabase, makeRow } from './fakeSupabase.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ต่อหน้าเว็บเข้ากับตัวจัดเส้นทาง API จริงของเรา โดยจำลองเฉพาะ Supabase ด้านหลัง (เก็บคุกกี้เองเหมือนเบราว์เซอร์)
export async function installApi(page, { seed = true, login = true, env = {} } = {}) {
  const sb = fakeSupabase();
  const fullEnv = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon-key', OCR_PROVIDER: 'mock', OCR_ALLOW_MOCK: '1', OCR_RETRY_DELAY_MS: '0', ...env };
  let cookie = '';
  const hooks = { fail: [] };
  const rows = {};
  if (seed) {
    rows.todo = makeRow({ customer_name: 'สมชาย ตัวอย่าง', bill_number: 'OD-A1', total: 15350, pos_number: 'POS-1', pos_total: 15050 });
    rows.check = makeRow({ customer_name: 'วิภา ตัวอย่าง', branch: 'ลาดพร้าว', bill_number: 'OD-B2', total: 2890, phone: '081000002', review_status: 'needs_check', ocr_confidence: 72, ocr_uncertain: ['phone', 'address'] });
    rows.confirmed = makeRow({ customer_name: 'อรทัย ตัวอย่าง', branch: 'รังสิต', bill_number: 'OD-C3', total: 1290, review_status: 'confirmed' });
    sb.db.orders.push(rows.confirmed, rows.check, rows.todo); // ฐานข้อมูลจำลองคืนใหม่สุดก่อน → ใบ 'todo' อยู่บนสุดของแท็บรอตรวจ
    sb.db.items.push({ order_id: rows.todo.id, position: 0, product: 'คอกกั้นเด็ก', size: 'L 6 ฟุต', color: 'ฟ้า' }, { order_id: rows.todo.id, position: 1, product: 'เบาะ PU', size: '', color: 'ขาว' });
  }
  const call = async (method, path, body, headers = {}) => {
    const out = await handle({ method, path, headers: { 'content-type': 'application/json', host: 'app.test', ...(cookie ? { cookie } : {}), ...headers }, body, env: fullEnv, fetchImpl: sb.fetchImpl, now: NOW });
    for (const c of out.cookies) cookie = c.includes('Max-Age=0') ? '' : c.split(';')[0];
    return out;
  };
  if (login) await call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'pw' });

  await page.route('**/storage/v1/object/sign/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    const failIdx = hooks.fail.findIndex(f => f.method === req.method());
    if (failIdx >= 0) { const f = hooks.fail.splice(failIdx, 1)[0]; return route.fulfill({ status: f.status, contentType: 'application/json', body: JSON.stringify({ error: 'ระบบขัดข้องชั่วคราว' }) }); }
    let body;
    try { body = req.postDataJSON(); } catch { body = undefined; }
    const out = await call(req.method(), url.pathname, body, { ...req.headers(), host: url.host, cookie: undefined, ...(cookie ? { cookie } : {}) });
    return route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
  return { sb, rows, call, failNext: (method, status = 500) => hooks.fail.push({ method, status }), getCookie: () => cookie };
}
