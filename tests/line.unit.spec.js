import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { branchFromGroupName, verifyLineSignature } from '../server/line.js';
import { MAX_ATTEMPTS, handleLineWebhook, processDueInbox, resetLineServiceSession } from '../server/lineIngest.js';
import { handle } from '../server/router.js';
import { fakeSupabase, URL_, ANON, NOW } from './helpers/fakeSupabase.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SECRET = 'line-secret';
const ORDER = {
  docType: 'order_form', formTitle: 'ใบส่งซื้อสินค้า Bebeplay', billNumber: 'OD-L1', orderDateText: '13 พ.ค. 69', customerName: 'ลูกค้า ไลน์', phone: '0812345678', address: '1 ซอยทดสอบ',
  subDistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postcode: '10260', shipDateText: '', items: [{ product: 'คอกกั้นเด็ก', size: 'L', color: 'ฟ้า' }],
  remark: '', total: '15,350', posNumber: '', posTotal: '', uncertain: [],
};
const env = {
  SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', OCR_RETRY_DELAY_MS: '0',
  LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_SERVICE_EMAIL: 'staff@example.com', LINE_SERVICE_PASSWORD: 'pw', CRON_SECRET: 'cron-secret',
};

// Supabase จำลอง + LINE + Gemini จำลอง (gemini = 'order' | 'other' | 'otherForm' | 'busy')
function world({ groups = { G1: 'Sales บางนา', G2: 'ทีมขาย' }, gemini = 'order', lineContent = 200 } = {}) {
  resetLineServiceSession();
  const sb = fakeSupabase();
  const state = { gemini, lineCalls: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api-data.line.me/')) {
      state.lineCalls.push(u);
      if (lineContent !== 200) return { ok: false, status: lineContent, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => PNG };
    }
    if (u.startsWith('https://api.line.me/')) {
      state.lineCalls.push(u);
      expect(init.headers.authorization).toBe('Bearer line-token');
      const g = /group\/([^/]+)\/summary/.exec(u);
      if (g) return { ok: true, status: 200, json: async () => ({ groupName: groups[g[1]] || '' }) };
      return { ok: true, status: 200, json: async () => ({ displayName: 'แอน (Sales)' }) };
    }
    if (u.includes('generativelanguage')) {
      if (state.gemini === 'busy') return { ok: false, status: 503, json: async () => ({}) };
      const raw = state.gemini === 'order' ? ORDER : state.gemini === 'otherForm' ? { ...ORDER, formTitle: 'ใบเสร็จรับเงิน ร้านตัวอย่าง' } : { ...ORDER, docType: 'other' };
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(raw) }] } }] }) };
    }
    return sb.fetchImpl(url, init);
  };
  return { sb, state, fetchImpl };
}

const sign = body => createHmac('sha256', SECRET).update(body).digest('base64');
const imageEvent = (id, groupId = 'G1') => ({ type: 'message', timestamp: NOW.getTime(), source: { type: 'group', groupId, userId: 'U1' }, message: { id, type: 'image', contentProvider: { type: 'line' } } });
async function post(w, events, { signature, envOver = {} } = {}) {
  const raw = Buffer.from(JSON.stringify({ destination: 'x', events }));
  const tasks = [];
  const out = await handleLineWebhook({ rawBody: raw, headers: { 'x-line-signature': signature ?? sign(raw) }, env: { ...env, ...envOver }, fetchImpl: w.fetchImpl, now: NOW, defer: p => tasks.push(p) });
  await Promise.all(tasks);
  return out;
}

test('signature check uses the raw bytes and the channel secret', () => {
  const body = Buffer.from('{"events":[]}');
  expect(verifyLineSignature(body, sign(body), SECRET)).toBe(true);
  expect(verifyLineSignature(Buffer.from('{"events": []}'), sign(body), SECRET)).toBe(false);
  expect(verifyLineSignature(body, sign(body), 'other')).toBe(false);
  expect(verifyLineSignature(body, '', SECRET)).toBe(false);
});

test('a group maps to a branch only when exactly one branch name is in the group name', () => {
  const b = ['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต'];
  expect(branchFromGroupName('Sales บางนา', b)).toBe('บางนา');
  expect(branchFromGroupName('ทีมขาย', b)).toBe(null);
  expect(branchFromGroupName('สยาม + บางนา', b)).toBe(null);
});

test('webhook rejects a bad signature and accepts LINE\'s empty verify call', async () => {
  const w = world();
  expect((await post(w, [imageEvent('m1')], { signature: 'bad' })).status).toBe(401);
  expect((await post(w, [])).status).toBe(200);
  expect(w.sb.db.receipt_line_inbox || []).toHaveLength(0);
});

test('an order-form photo from a mapped group becomes an order with the LINE sender, once', async () => {
  const w = world();
  const out = await post(w, [imageEvent('m1')]);
  expect(out).toMatchObject({ status: 200, body: { queued: 1 } });
  const order = w.sb.db.orders[0];
  expect(order).toMatchObject({ source: 'line', branch: 'บางนา', sender_name: 'แอน (Sales)', customer_name: 'ลูกค้า ไลน์', ocr_status: 'done', order_date: '2026-05-13', image_path: expect.stringMatching(/^line\//) });
  expect(w.sb.db.receipt_line_inbox[0]).toMatchObject({ status: 'order', order_id: order.id, attempts: 1 });
  expect(w.sb.db.events.at(-1)).toMatchObject({ action: 'created', details: { source: 'line' } });
  // LINE ส่ง webhook ซ้ำ → ไม่สร้างใบซ้ำ
  await post(w, [imageEvent('m1')]);
  expect(w.sb.db.orders).toHaveLength(1);
});

test('a photo that is not an order form is dropped and its image deleted', async () => {
  const w = world({ gemini: 'other' });
  await post(w, [imageEvent('m2')]);
  expect(w.sb.db.orders).toHaveLength(0);
  expect(w.sb.db.receipt_line_inbox[0]).toMatchObject({ status: 'ignored', image_path: null });
  expect(w.sb.db.removed).toEqual([expect.stringMatching(/^line\//)]);
});

test('an order form whose header is not "ใบส่งซื้อสินค้า Bebeplay" is dropped too', async () => {
  const w = world({ gemini: 'otherForm' });
  await post(w, [imageEvent('m8')]);
  expect(w.sb.db.orders).toHaveLength(0);
  expect(w.sb.db.receipt_line_inbox[0]).toMatchObject({ status: 'ignored', image_path: null, last_error: expect.stringContaining('ใบเสร็จรับเงิน') });
});

test('when OCR is busy the photo is retried by cron, and after the last try it still becomes an order', async () => {
  const w = world({ gemini: 'busy' });
  await post(w, [imageEvent('m3')]);
  expect(w.sb.db.receipt_line_inbox[0]).toMatchObject({ status: 'failed', attempts: 1, last_error: expect.stringContaining('ไม่ว่าง') });
  expect(w.sb.db.orders).toHaveLength(0);
  const cron = headers => handle({ method: 'GET', path: '/api/cron/line-inbox', headers: { host: 'app.test', ...headers }, env, fetchImpl: w.fetchImpl, now: NOW });
  expect((await cron({})).status).toBe(401);
  expect((await cron({ authorization: 'Bearer wrong' })).status).toBe(401);
  for (let i = 1; i < MAX_ATTEMPTS; i += 1) expect((await cron({ authorization: 'Bearer cron-secret' })).status).toBe(200);
  expect(w.sb.db.receipt_line_inbox[0]).toMatchObject({ status: 'order', attempts: MAX_ATTEMPTS });
  expect(w.sb.db.orders[0]).toMatchObject({ source: 'line', ocr_status: 'failed', review_status: 'needs_check' });
  // ครบแล้วไม่ทำซ้ำ
  expect((await processDueInbox({ env, fetchImpl: w.fetchImpl, now: NOW })).results).toEqual(['skipped']);
  expect(w.sb.db.orders).toHaveLength(1);
});

test('a group not tied to a branch: photos are noted (message id only, no download) until someone maps the group', async () => {
  const w = world();
  await post(w, [{ type: 'join', timestamp: NOW.getTime(), source: { type: 'group', groupId: 'G1' } }, imageEvent('m4', 'G2')]);
  expect(w.sb.db.receipt_line_groups).toEqual([
    expect.objectContaining({ group_id: 'G1', group_name: 'Sales บางนา', branch: 'บางนา' }),
    expect.objectContaining({ group_id: 'G2', group_name: 'ทีมขาย', branch: null }),
  ]);
  expect(w.sb.db.receipt_line_inbox).toEqual([expect.objectContaining({ message_id: 'm4', group_id: 'G2', branch: null, status: 'pending', image_path: null })]);
  expect(w.state.lineCalls.some(u => u.includes('api-data'))).toBe(false);
  expect(w.sb.db.orders).toHaveLength(0);
  // cron ไม่แตะรูปที่ยังไม่ผูกสาขา
  expect((await processDueInbox({ env, fetchImpl: w.fetchImpl, now: new Date(NOW.getTime() + 10 * 60_000) })).processed).toBe(0);
  // ไม่ใช่กลุ่ม (แชทส่วนตัว) / ไม่ใช่รูป → ไม่รับเข้ากล่องรูป
  await post(w, [{ ...imageEvent('m5'), source: { type: 'user', userId: 'U1' } }, { ...imageEvent('m6'), message: { id: 'm6', type: 'text', text: 'hi' } }]);
  expect(w.sb.db.receipt_line_inbox).toHaveLength(1);
});

test('a group the bot was already in shows up on its first activity (e.g. a text message), and re-joining reactivates it', async () => {
  const w = world({ groups: { G1: 'Sales บางนา', G9: 'Sales รังสิต' } });
  const text = (id, groupId) => ({ type: 'message', timestamp: NOW.getTime(), source: { type: 'group', groupId, userId: 'U1' }, message: { id, type: 'text', text: 'สวัสดี' } });
  await post(w, [text('t1', 'G9'), text('t2', 'G9'), { type: 'memberJoined', timestamp: NOW.getTime(), source: { type: 'group', groupId: 'G1' }, joined: { members: [] } }]);
  expect(w.sb.db.receipt_line_groups).toEqual([
    expect.objectContaining({ group_id: 'G9', group_name: 'Sales รังสิต', branch: 'รังสิต', active: true }),
    expect.objectContaining({ group_id: 'G1', branch: 'บางนา' }),
  ]);
  expect(w.state.lineCalls.filter(u => u.includes('/group/G9/summary'))).toHaveLength(1); // ข้อความที่สองไม่ถามชื่อกลุ่มซ้ำ
  expect(w.sb.db.receipt_line_inbox || []).toHaveLength(0);
  await post(w, [{ type: 'leave', timestamp: NOW.getTime(), source: { type: 'group', groupId: 'G9' } }]);
  expect(w.sb.db.receipt_line_groups[0].active).toBe(false);
  await post(w, [{ type: 'join', timestamp: NOW.getTime(), source: { type: 'group', groupId: 'G9' } }]);
  expect(w.sb.db.receipt_line_groups[0].active).toBe(true);
});

test('LINE groups page: everyone sees the groups; only an admin maps a branch, which then pulls the waiting photos', async () => {
  const w = world();
  await post(w, [imageEvent('m1', 'G1'), imageEvent('w1', 'G2'), imageEvent('w2', 'G2')]);
  const tasks = [];
  let cookie = '';
  const call = async (method, path, body) => {
    const out = await handle({ method, path, headers: { 'content-type': 'application/json', host: 'app.test', ...(cookie ? { cookie } : {}) }, body, env, fetchImpl: w.fetchImpl, now: NOW, defer: p => tasks.push(p) });
    const set = out.cookies.find(c => c.startsWith('rd_session='));
    if (set) cookie = set.split(';')[0];
    return out;
  };
  expect((await call('GET', '/api/line/groups')).status).toBe(401);
  await call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'pw' });
  const list = await call('GET', '/api/line/groups');
  expect(list.body).toMatchObject({ canEdit: false, lineConfigured: true, statsDays: 30 });
  expect(list.body.groups).toEqual([
    expect.objectContaining({ id: 'G1', name: 'Sales บางนา', branch: 'บางนา', active: true, stats: expect.objectContaining({ orders: 1, waiting: 0 }) }),
    expect.objectContaining({ id: 'G2', name: 'ทีมขาย', branch: null, stats: expect.objectContaining({ orders: 0, waiting: 2 }), lastPhotoAt: expect.any(String) }),
  ]);
  // พนักงานทั่วไปผูกสาขาไม่ได้
  expect((await call('PATCH', '/api/line/groups/G2', { branch: 'สยาม' })).status).toBe(403);

  w.sb.users['staff@example.com'].role = 'admin';
  expect((await call('PATCH', '/api/line/groups/G2', { branch: 'ไม่มีสาขานี้' })).status).toBe(422);
  expect((await call('PATCH', '/api/line/groups/NOPE', { branch: 'สยาม' })).status).toBe(404);
  const out = await call('PATCH', '/api/line/groups/G2', { branch: 'สยาม' });
  expect(out).toMatchObject({ status: 200, body: { queued: 2, group: { id: 'G2', branch: 'สยาม' } } });
  await Promise.all(tasks);
  expect(w.sb.db.orders.filter(o => o.branch === 'สยาม')).toHaveLength(2);
  expect(w.sb.db.receipt_line_inbox.filter(r => r.group_id === 'G2').map(r => r.status)).toEqual(['order', 'order']);
  // เลิกผูกสาขาได้ (รูปใหม่จะรอผูกอีกครั้ง)
  expect((await call('PATCH', '/api/line/groups/G2', { branch: null })).body.group.branch).toBe(null);
});

test('an image LINE no longer has is marked failed for good, not retried', async () => {
  const w = world({ lineContent: 404 });
  await post(w, [imageEvent('m7')]);
  expect(w.sb.db.receipt_line_inbox[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: expect.stringContaining('LINE') });
  expect(w.sb.db.orders).toHaveLength(0);
});

test('the dev server routes /api/line/webhook to the LINE handler with the raw body', async ({ request }) => {
  // dev server ไม่มีคีย์ LINE → 503 จากตัวจัดการ LINE (ไม่ใช่ 415/404 ของ router ปกติ)
  const res = await request.post('/api/line/webhook', { headers: { 'content-type': 'application/json', 'x-line-signature': 'x' }, data: '{"events":[]}' });
  expect(res.status()).toBe(503);
  expect((await request.get('/api/cron/line-inbox')).status()).toBe(401);
});

test('group names match a branch ignoring spaces/case, and the longer branch name wins when one contains another', () => {
  const b = ['พระราม 2', 'เซ็นทรัล พระราม 2', 'Mega บางนา', 'บางนา'];
  expect(branchFromGroupName('Sales เซ็นทรัลพระราม 2', b)).toBe('เซ็นทรัล พระราม 2');
  expect(branchFromGroupName('ทีม mega  บางนา', b)).toBe('Mega บางนา');
  expect(branchFromGroupName('สาขาพระราม 2 ใหม่', b)).toBe('พระราม 2');
  expect(branchFromGroupName('บางนา + พระราม 2', b)).toBe(null);
});

test('branches live in the database: an admin pastes a list, groups named after a branch are mapped and their waiting photos pulled', async () => {
  const w = world({ groups: { G1: 'Sales บางนา', G2: 'ทีมขาย ซีคอน', G3: 'เมกา + ซีคอน' } });
  await post(w, [imageEvent('w1', 'G2'), imageEvent('w2', 'G3')]);
  const tasks = [];
  let cookie = '';
  const call = async (method, path, body) => {
    const out = await handle({ method, path, headers: { 'content-type': 'application/json', host: 'app.test', ...(cookie ? { cookie } : {}) }, body, env, fetchImpl: w.fetchImpl, now: NOW, defer: p => tasks.push(p) });
    const set = out.cookies.find(c => c.startsWith('rd_session='));
    if (set) cookie = set.split(';')[0];
    return out;
  };
  const login = await call('POST', '/api/auth/login', { email: 'staff@example.com', password: 'pw' });
  expect(login.body.branches).toEqual(expect.arrayContaining(['บางนา', 'สยาม'])); // ยังไม่มีตาราง → ใช้ค่าเริ่มต้น
  // ยังไม่มีตาราง: พนักงานทั่วไปถูกห้าม · admin ได้คำอธิบายว่าต้องอัปเดตฐานข้อมูล
  expect((await call('POST', '/api/branches', { names: ['ซีคอน'] })).status).toBe(403);
  w.sb.users['staff@example.com'].role = 'admin';
  expect((await call('POST', '/api/branches', { names: ['ซีคอน'] })).status).toBe(503);

  w.sb.db.receipt_branches = ['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต'].map(name => ({ name, active: true }));
  expect((await call('POST', '/api/branches', { names: [] })).status).toBe(422);
  const out = await call('POST', '/api/branches', { names: ['  ซีคอน ', 'เมกา', 'ซีคอน', 'บางนา'] });
  expect(out.status).toBe(200);
  expect(out.body.added).toEqual(['ซีคอน', 'เมกา'].sort((a, b) => a.localeCompare(b, 'th')));
  expect(out.body.branches).toEqual(expect.arrayContaining(['ซีคอน', 'เมกา', 'สยาม']));
  expect(out.body.autoMapped).toEqual([{ id: 'G2', branch: 'ซีคอน' }]); // G3 มีสองสาขาในชื่อ = กำกวม ไม่ผูก
  expect(out.body.queued).toBe(1);
  await Promise.all(tasks);
  expect(w.sb.db.orders).toEqual([expect.objectContaining({ branch: 'ซีคอน', source: 'line' })]);
  expect(w.sb.db.receipt_line_groups.find(g => g.group_id === 'G3').branch).toBe(null);

  // พิมพ์ชื่อสาขาใหม่ตอนผูกกลุ่ม: ต้องยืนยันว่าจะสร้าง
  expect((await call('PATCH', '/api/line/groups/G3', { branch: 'เมกาบางนา' })).body.code).toBe('unknown_branch');
  const made = await call('PATCH', '/api/line/groups/G3', { branch: 'เมกาบางนา', create: true });
  expect(made.body).toMatchObject({ created: true, group: { branch: 'เมกาบางนา' } });
  expect(made.body.branches).toContain('เมกาบางนา');
  // อัปโหลดใบด้วยสาขาจากฐานข้อมูลได้ · ซ่อนสาขาแล้วหายจากตัวเลือก
  expect((await call('GET', '/api/auth/me')).body.branches).toContain('ซีคอน');
  const hide = await call('PATCH', `/api/branches/${encodeURIComponent('เมกา')}`, { active: false });
  expect(hide.body.branches).not.toContain('เมกา');
  expect((await call('PATCH', `/api/branches/${encodeURIComponent('ไม่มี')}`, { active: false })).status).toBe(404);
  // ซ่อนครบทุกสาขา = ไม่มีสาขาเลย (ไม่ย้อนกลับไปใช้ 4 สาขาเริ่มต้น)
  for (const b of w.sb.db.receipt_branches.filter(r => r.active)) await call('PATCH', `/api/branches/${encodeURIComponent(b.name)}`, { active: false });
  expect((await call('GET', '/api/auth/me')).body.branches).toEqual([]);
  expect((await call('POST', '/api/branches', { names: ['ซีคอน'] })).body.branches).toEqual(['ซีคอน']); // เพิ่มชื่อเดิม = แสดงกลับ
});
