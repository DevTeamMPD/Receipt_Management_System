import { test, expect } from '@playwright/test';
import { handle } from '../server/router.js';
import { ANON, FUTURE, NOW, URL_, fakeSupabase } from './helpers/fakeSupabase.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GOOD = { docType: 'order_form', billNumber: 'OD-1', orderDateText: '24/11/69', customerName: 'ทดสอบ หนึ่ง', phone: '0812345678', address: '1 ซอยทดสอบ', subDistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postcode: '10260', shipDateText: '', items: [{ product: 'ตู้', size: '', color: 'ขาว' }], remark: '', total: '1,290', posNumber: 'P1', posTotal: '1290', uncertain: [] };

const baseEnv = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, OCR_PROVIDER: 'mock', OCR_ALLOW_MOCK: '1', OCR_RETRY_DELAY_MS: '0' };
const json = { 'content-type': 'application/json', host: 'app.test' };

function client(env = baseEnv, sb = fakeSupabase()) {
  let cookie = '';
  const call = async (method, path, body, extra = {}) => {
    const out = await handle({ method, path, headers: { ...json, ...(cookie ? { cookie } : {}), ...(extra.headers || {}) }, body, env: { ...env, ...(extra.env || {}) }, fetchImpl: sb.fetchImpl, now: NOW });
    const set = out.cookies.find(c => c.startsWith('rd_session='));
    if (set) cookie = set.split(';')[0];
    return out;
  };
  return { call, sb, setCookie: c => { cookie = c; }, get cookie() { return cookie; } };
}
const login = c => c.call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'pw' });
const upload = (c, extra = {}) => c.call('POST', '/api/orders', { image: PNG, branch: 'สยาม' }, extra);

test('requests without a session are rejected and the cookie is cleared', async () => {
  const c = client();
  const out = await c.call('GET', '/api/orders');
  expect(out.status).toBe(401);
  expect(out.cookies[0]).toContain('Max-Age=0');
});

test('login: wrong password, a user outside the allowlist, and a valid staff member', async () => {
  const c = client();
  expect((await c.call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'bad' })).status).toBe(401);
  const out = await c.call('POST', '/api/auth/login', { email: 'outsider@example.com', password: 'pw' });
  expect(out.status).toBe(403);
  expect(out.body.code).toBe('not_allowed');
  expect(out.cookies).toHaveLength(0);
  const ok = await login(c);
  expect(ok.status).toBe(200);
  expect(ok.body.user.email).toBe('staff@example.com');
  expect(ok.body.branches).toContain('สยาม');
  const cookie = ok.cookies[0];
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(JSON.stringify(ok.body)).not.toContain('access_token');
  expect((await c.call('GET', '/api/auth/me')).body.user.name).toBe('พนักงาน');
});

test('secure cookies behind https; cross-site and non-JSON writes are refused', async () => {
  const c = client();
  const ok = await c.call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'pw' }, { headers: { 'x-forwarded-proto': 'https' } });
  expect(ok.cookies[0]).toContain('; Secure');
  expect((await upload(c, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
  expect((await upload(c, { headers: { origin: 'https://app.test' } })).status).toBe(201);
  expect((await upload(c, { headers: { 'content-type': 'text/plain' } })).status).toBe(415);
});

test('an expired access token is refreshed transparently with a new cookie', async () => {
  const sb = fakeSupabase();
  const c = client(baseEnv, sb);
  const expired = sb.issue(sb.users['staff@example.com'], Math.floor(NOW.getTime() / 1000) - 10);
  c.setCookie(`rd_session=${Buffer.from(JSON.stringify({ a: expired.access_token, r: expired.refresh_token })).toString('base64url')}`);
  const out = await c.call('GET', '/api/auth/me');
  expect(out.status).toBe(200);
  expect(out.cookies.some(x => x.startsWith('rd_session='))).toBe(true);
});

test('upload stores the image, reads it with OCR, saves the order and audits it — using only the user token', async () => {
  const c = client();
  await login(c);
  const out = await upload(c);
  expect(out.status).toBe(201);
  const o = out.body.order;
  expect(o.code).toBe('RCP-0001');
  expect(o.customerName).toMatch(/ลูกค้าสาธิต/);
  expect(o.ocrProvider).toBe('mock');
  expect(o.imageUrl).toContain('/storage/v1/object/sign/receipt-images/');
  expect(o.version).toBe(1);
  expect(c.sb.db.files).toHaveLength(1);
  expect(c.sb.db.events.map(e => e.action)).toEqual(['created']);
  expect(c.sb.db.runs[0]).toMatchObject({ provider: 'mock', ok: true });
  // ทุกคำขอไปฐานข้อมูลใช้ anon key เป็น apikey และ token ของผู้ใช้เป็นสิทธิ์ (ไม่มี service role)
  for (const call of c.sb.calls.filter(x => x.path.startsWith('/rest/') || x.path.startsWith('/storage/'))) {
    expect(call.apikey).toBe(ANON);
    expect(call.auth).not.toBe(ANON);
  }
});

test('with OCR switched off the photo is stored and the order waits for manual entry', async () => {
  const c = client({ ...baseEnv, OCR_PROVIDER: '' });
  await login(c);
  const out = await upload(c);
  expect(out.status).toBe(201);
  expect(out.body.order).toMatchObject({ ocrStatus: 'skipped', status: 'review', customerName: '', ocrProvider: '' });
  expect(c.sb.db.runs).toHaveLength(0);
});

test('when the OCR provider fails the order is still created for manual entry and the failure is logged', async () => {
  const sb = fakeSupabase();
  const failingGoogle = async (url, init) => (String(url).includes('googleapis.com') ? { ok: false, status: 429, json: async () => ({}), text: async () => '' } : sb.fetchImpl(url, init));
  const c = { ...client({ ...baseEnv, OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, sb) };
  // ใช้ fetch ที่ผสม: ส่วน Google ล้มเหลว ส่วน Supabase ใช้ตัวจำลอง
  let cookie = '';
  const call = async (method, path, body) => {
    const out = await handle({ method, path, headers: { ...json, ...(cookie ? { cookie } : {}) }, body, env: { ...baseEnv, OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }, fetchImpl: failingGoogle, now: NOW });
    const set = out.cookies.find(x => x.startsWith('rd_session='));
    if (set) cookie = set.split(';')[0];
    return out;
  };
  await call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'pw' });
  const out = await call('POST', '/api/orders', { image: PNG, branch: 'บางนา' });
  expect(out.status).toBe(201);
  expect(out.body.ocrError).toContain('โควตา');
  expect(out.body.order).toMatchObject({ ocrStatus: 'failed', status: 'check' });
  expect(sb.db.runs[0]).toMatchObject({ provider: 'gemini', ok: false, http_status: 429, error_code: 'http_429' });
  expect(sb.db.files).toHaveLength(1);
});

test('uploading validates the branch and the image', async () => {
  const c = client();
  await login(c);
  expect((await c.call('POST', '/api/orders', { image: PNG, branch: 'ไม่มีสาขานี้' })).status).toBe(422);
  expect((await c.call('POST', '/api/orders', { image: 'data:text/plain;base64,QUJD', branch: 'สยาม' })).status).toBe(400);
  expect((await c.call('POST', '/api/orders', { branch: 'สยาม' })).status).toBe(400);
  expect(c.sb.db.files).toHaveLength(0);
});

test('the same bill number and total is flagged as a possible duplicate', async () => {
  const c = client();
  await login(c);
  const first = (await upload(c)).body.order;
  const second = (await upload(c)).body.order;
  expect(first.duplicateOf).toBe('');
  expect(second.duplicateOf).toBe(first.code);
  expect(second.status).toBe('check');
});

test('editing: whitelist, normalisation, optimistic locking, and no edits after confirmation', async () => {
  const c = client();
  await login(c);
  const o = (await upload(c)).body.order;
  const patch = (fields, version = o.version, items) => c.call('PATCH', `/api/orders/${o.id}`, { version, fields, items });
  expect((await patch({ code: 'hack' })).status).toBe(422);
  expect((await patch({ total: '-5' })).status).toBe(422);
  expect((await patch({ orderDate: '2026-02-31' })).status).toBe(422);
  const saved = await patch({ phone: '081-234-5678', customerName: '  สมหญิง  ' }, 1, [{ product: 'เก้าอี้', size: '', color: '' }]);
  expect(saved.status).toBe(200);
  expect(saved.body.version).toBe(2);
  const stored = c.sb.db.orders[0];
  expect(stored.phone).toBe('0812345678');
  expect(stored.customer_name).toBe('สมหญิง');
  expect(c.sb.db.items.filter(i => i.order_id === o.id)).toHaveLength(1);
  const stale = await patch({ remark: 'x' }, 1);
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('conflict');
  expect((await patch({ remark: 'x' }, 2)).status).toBe(200);
  expect(c.sb.db.events.filter(e => e.action === 'edited')).toHaveLength(1); // รวมการแก้ถี่ ๆ เป็นหนึ่งบันทึก
});

test('confirm validates on the server, locks the order, and reopen / JST mark / reject follow the rules', async () => {
  const c = client();
  await login(c);
  const o = (await upload(c)).body.order;
  const act = (a, version, extra) => c.call('POST', `/api/orders/${o.id}/${a}`, { version, ...extra });
  const bad = await c.call('PATCH', `/api/orders/${o.id}`, { version: 1, fields: { phone: '0812' } });
  expect(bad.status).toBe(200);
  const refused = await act('confirm', 2);
  expect(refused.status).toBe(422);
  expect(refused.body.fields.phone).toBeTruthy();
  await c.call('PATCH', `/api/orders/${o.id}`, { version: 2, fields: { phone: '0812345678' } });
  expect((await act('confirm', 2)).status).toBe(409); // version เก่า
  const done = await act('confirm', 3);
  expect(done.status).toBe(200);
  expect(done.body.order.status).toBe('confirmed');
  expect((await c.call('PATCH', `/api/orders/${o.id}`, { version: 4, fields: { remark: 'x' } })).body.code).toBe('locked');
  expect((await act('reject', 4, { reason: 'x' })).status).toBe(409);
  expect((await act('reopen', 4)).body.order.status).toBe('review');
  const again = await act('confirm', 5);
  expect(again.status).toBe(200);
  expect((await act('jst-done', 6)).body.order.status).toBe('done');
  expect((await act('reopen', 7)).status).toBe(409);
  expect(c.sb.db.events.map(e => e.action)).toEqual(['created', 'edited', 'confirmed', 'reopened', 'confirmed', 'jst_marked_done']);
});

test('reject needs a reason and ends the review', async () => {
  const c = client();
  await login(c);
  const o = (await upload(c)).body.order;
  expect((await c.call('POST', `/api/orders/${o.id}/reject`, { version: 1, reason: '  ' })).status).toBe(422);
  const out = await c.call('POST', `/api/orders/${o.id}/reject`, { version: 1, reason: 'รูปซ้ำ' });
  expect(out.body.order).toMatchObject({ status: 'rejected', rejectReason: 'รูปซ้ำ' });
  expect((await c.call('PATCH', `/api/orders/${o.id}`, { version: 2, fields: { remark: 'x' } })).status).toBe(409);
});

test('list returns orders with signed image URLs and logout clears the session', async () => {
  const c = client();
  await login(c);
  await upload(c);
  const list = await c.call('GET', '/api/orders');
  expect(list.body.orders).toHaveLength(1);
  expect(list.body.orders[0].imageUrl).toContain('token=');
  const out = await c.call('POST', '/api/auth/logout', {});
  expect(out.cookies[0]).toContain('Max-Age=0');
});

test('unknown routes and malformed ids do not reach the database', async () => {
  const c = client();
  await login(c);
  const before = c.sb.calls.length;
  expect((await c.call('GET', '/api/nope')).status).toBe(404);
  expect((await c.call('PATCH', '/api/orders/not-a-uuid', { version: 1, fields: {} })).status).toBe(404);
  expect(c.sb.calls.length - before).toBeLessThanOrEqual(1); // เหลือแค่การตรวจสิทธิ์ผู้ใช้
});

test('delete removes a pending order and its image, keeps the audit event, and refuses locked or stale orders', async () => {
  const c = client();
  await login(c);
  const o = (await upload(c)).body.order;
  const row = c.sb.db.orders.find(x => x.id === o.id);
  expect((await c.call('DELETE', `/api/orders/${o.id}`, { version: 99 })).body.code).toBe('conflict');
  const out = await c.call('DELETE', `/api/orders/${o.id}`, { version: o.version });
  expect(out.status).toBe(200);
  expect(out.body.code).toBe(o.code);
  expect(c.sb.db.orders.find(x => x.id === o.id)).toBeUndefined();
  expect(c.sb.db.items.filter(i => i.order_id === o.id)).toHaveLength(0);
  expect(c.sb.db.removed).toEqual([row.image_path]);
  const ev = c.sb.db.events.find(e => e.action === 'deleted');
  expect(ev.order_id).toBeNull();
  expect(ev.details).toMatchObject({ code: o.code });
  expect((await c.call('DELETE', `/api/orders/${o.id}`, { version: 1 })).status).toBe(404);

  const o2 = (await upload(c)).body.order;
  await c.call('POST', `/api/orders/${o2.id}/reject`, { version: 1, reason: 'ซ้ำ' });
  const locked = await c.call('DELETE', `/api/orders/${o2.id}`, { version: 2 });
  expect(locked.status).toBe(409);
  expect(locked.body.code).toBe('locked');
  expect(c.sb.db.orders.find(x => x.id === o2.id)).toBeDefined();
});

// ---------- SKU ของรายการสินค้า + ความจำ SKU ----------
const itemsOf = (c, id) => c.sb.db.items.filter(i => i.order_id === id).sort((a, b) => a.position - b.position);

test('a SKU typed on an item is saved and remembered, and the next order with the same product, size and colour gets it automatically', async () => {
  const c = client();
  c.sb.db.receipt_sku_memory = [];
  await login(c);
  const first = (await upload(c)).body.order;
  expect(first.items[0]).toMatchObject({ sku: '' });
  const [it] = first.items;
  expect((await c.call('PATCH', `/api/orders/${first.id}`, { version: first.version, fields: {}, items: [{ ...it, sku: ' BP-PLAY-L6-BL ' }] })).status).toBe(200);
  expect(itemsOf(c, first.id)[0].sku).toBe('BP-PLAY-L6-BL');
  expect(c.sb.db.receipt_sku_memory).toEqual([expect.objectContaining({ product: it.product, size: it.size, color: it.color, sku: 'BP-PLAY-L6-BL' })]);

  // ใบใหม่ (รูปเดิม → โหมดสาธิตให้สินค้าชุดเดิม): SKU ถูกเติมและบันทึกตั้งแต่สร้างใบ พร้อมบอกหน้าเว็บว่าระบบเติมให้
  const second = (await upload(c)).body.order;
  expect(second.items[0]).toMatchObject({ product: it.product, sku: 'BP-PLAY-L6-BL', skuAuto: true });
  expect(itemsOf(c, second.id)[0].sku).toBe('BP-PLAY-L6-BL');
  // รายการ + ความจำส่งให้หน้าเว็บใช้เติมใบที่ค้างอยู่
  const list = (await c.call('GET', '/api/orders')).body;
  expect(Object.values(list.skus)).toEqual(['BP-PLAY-L6-BL']);
  expect(list.orders.find(o => o.id === second.id).items[0].sku).toBe('BP-PLAY-L6-BL');
});

test('SKU memory ignores spacing and letter case, keeps the newest SKU, and old orders do not bring an old SKU back', async () => {
  const c = client();
  c.sb.db.receipt_sku_memory = [];
  await login(c);
  const a = (await upload(c)).body.order;
  const b = (await upload(c)).body.order;
  const row = { product: 'คอกกั้นเด็ก', size: 'L 6 ฟุต (1.9x1.9 เมตร)', color: 'ฟ้า ชมพู ขาว' };
  await c.call('PATCH', `/api/orders/${a.id}`, { version: a.version, fields: {}, items: [{ ...row, sku: 'OLD-1' }] });
  // เว้นวรรค/ตัวพิมพ์ต่างกัน = ชุดเดียวกัน · SKU ใหม่ทับของเก่า
  await c.call('PATCH', `/api/orders/${b.id}`, { version: b.version, fields: {}, items: [{ product: ' คอกกั้นเด็ก', size: 'l 6ฟุต (1.9X1.9 เมตร)', color: 'ฟ้า  ชมพู ขาว', sku: 'NEW-2' }] });
  expect(c.sb.db.receipt_sku_memory).toHaveLength(1);
  expect(c.sb.db.receipt_sku_memory[0].sku).toBe('NEW-2');
  // แก้ช่องอื่นของใบเก่า (SKU เดิมไม่ได้เปลี่ยน) ต้องไม่ทำให้ระบบกลับไปจำ OLD-1
  const a2 = await c.call('PATCH', `/api/orders/${a.id}`, { version: a.version + 1, fields: { remark: 'โทรก่อนส่ง' }, items: [{ ...row, sku: 'OLD-1' }, { product: 'เบาะ PU', size: '', color: '', sku: '' }] });
  expect(a2.status).toBe(200);
  expect(c.sb.db.receipt_sku_memory[0].sku).toBe('NEW-2');
  // ลบ SKU ออกจากรายการ ไม่ได้ลบความจำ
  await c.call('PATCH', `/api/orders/${a.id}`, { version: a2.body.version, fields: {}, items: [{ ...row, sku: '' }] });
  expect(itemsOf(c, a.id)[0].sku).toBeFalsy();
  expect(c.sb.db.receipt_sku_memory[0].sku).toBe('NEW-2');
});

test('before the SKU memory table exists, SKUs can still be typed and saved; nothing is auto-filled and nothing fails', async () => {
  const c = client();
  await login(c);
  const o = (await upload(c)).body.order;
  const saved = await c.call('PATCH', `/api/orders/${o.id}`, { version: o.version, fields: {}, items: [{ ...o.items[0], sku: 'X-1' }] });
  expect(saved.status).toBe(200);
  expect(itemsOf(c, o.id)[0].sku).toBe('X-1');
  const next = (await upload(c)).body.order;
  expect(next.items[0].sku).toBe('');
  expect((await c.call('GET', '/api/orders')).body.skus).toEqual({});
});
