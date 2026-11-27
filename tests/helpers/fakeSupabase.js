// Supabase จำลองสำหรับเทสต์: ตรวจ token ทุกคำขอ จดทุกการเรียกไว้ใน calls
import { handle } from '../../server/router.js';

export const URL_ = 'https://proj.supabase.co';
export const ANON = 'anon-key';
export const NOW = new Date('2026-11-25T10:00:00Z');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
export const jwt = (sub, expSec) => `${b64({ alg: 'HS256' })}.${b64({ sub, exp: expSec })}.sig`;
export const FUTURE = Math.floor(NOW.getTime() / 1000) + 3600;

export function fakeSupabase() {
  const users = { 'staff@example.com': { id: 'u-staff', pw: 'pw', allowed: true }, 'outsider@example.com': { id: 'u-out', pw: 'pw', allowed: false } };
  const tokens = {}; // token -> user id
  const refreshTokens = {};
  const db = { orders: [], items: [], events: [], runs: [], files: [] };
  const calls = [];
  let seq = 0;
  const issue = (u, expSec = FUTURE) => { const a = jwt(u.id, expSec); const r = `r-${u.id}-${Object.keys(refreshTokens).length}`; tokens[a] = u; refreshTokens[r] = u; return { access_token: a, refresh_token: r, user: { id: u.id } }; };
  const res = (status, json) => ({ ok: status < 400, status, text: async () => (json === undefined ? '' : JSON.stringify(json)) });
  const matches = (row, params) => [...params].every(([k, v]) => {
    if (['select', 'order', 'limit', 'receipt_order_items.order'].includes(k)) return true;
    if (v === 'is.null') return row[k] == null;
    if (v === 'not.is.null') return row[k] != null;
    if (!(k in row)) return true;
    if (v.startsWith('gte.')) return String(row[k]) >= v.slice(4);
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('neq.')) return String(row[k]) !== v.slice(4);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    return true;
  });
  const withItems = o => ({ ...o, receipt_order_items: db.items.filter(i => i.order_id === o.id) });

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const auth = (init.headers?.authorization || '').replace('Bearer ', '');
    const body = typeof init.body === 'string' && init.body.startsWith('{') || typeof init.body === 'string' && init.body.startsWith('[') ? JSON.parse(init.body) : init.body;
    calls.push({ method, path: u.pathname, auth, apikey: init.headers?.apikey });
    if (u.hostname !== 'proj.supabase.co') return res(404, {});
    if (u.pathname === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'password') {
        const usr = users[body.email];
        return usr && usr.pw === body.password ? res(200, issue(usr)) : res(400, { error: 'invalid_grant' });
      }
      const usr = refreshTokens[body.refresh_token];
      return usr ? res(200, issue(usr)) : res(401, {});
    }
    if (u.pathname === '/auth/v1/logout') return res(204);
    const usr = tokens[auth];
    if (u.pathname.startsWith('/rest/v1/')) {
      if (!usr) return res(401, { code: 'PGRST301', message: 'JWT expired' });
      const t = u.pathname.replace('/rest/v1/', '');
      if (!usr.allowed) return t === 'receipt_users' ? res(200, []) : res(200, []);
      if (t === 'receipt_users') return res(200, [{ user_id: usr.id, email: 'staff@example.com', display_name: 'พนักงาน', role: usr.role || 'office_sales', active: true }]);
      if (t === 'receipt_orders') {
        if (method === 'GET') { const rows = db.orders.filter(o => matches(o, u.searchParams)).map(withItems); return res(200, u.searchParams.has('id') || u.searchParams.has('bill_number') ? rows : rows.slice().reverse()); }
        if (method === 'POST') {
          seq += 1;
          const row = { ...body, seq, code: `RCP-${String(seq).padStart(4, '0')}`, version: 1, created_at: NOW.toISOString(), received_at: NOW.toISOString(), jst_status: 'none', reject_reason: null };
          db.orders.push(row);
          return res(201, [row]);
        }
        if (method === 'PATCH') {
          const hit = db.orders.filter(o => matches(o, u.searchParams));
          hit.forEach(o => { Object.assign(o, body); o.version += 1; });
          return res(200, hit);
        }
        if (method === 'DELETE') {
          const hit = db.orders.filter(o => matches(o, u.searchParams));
          db.orders = db.orders.filter(o => !hit.includes(o));
          db.items = db.items.filter(i => !hit.some(o => o.id === i.order_id));
          db.events.forEach(e => { if (hit.some(o => o.id === e.order_id)) e.order_id = null; });
          return res(200, hit);
        }
      }
      const KEYS = { receipt_line_groups: 'group_id', receipt_line_inbox: 'message_id' };
      if (KEYS[t]) {
        const rows = (db[t] ||= []);
        if (method === 'GET') return res(200, rows.filter(r => matches(r, u.searchParams)));
        if (method === 'POST') {
          const out = [];
          for (const r of [].concat(body)) {
            if (rows.some(x => x[KEYS[t]] === r[KEYS[t]])) continue;
            const row = t === 'receipt_line_inbox'
              ? { id: `10000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, status: 'pending', attempts: 0, image_path: null, sender_name: null, order_id: null, last_error: null, created_at: NOW.toISOString(), updated_at: NOW.toISOString(), ...r }
              : { active: true, branch: null, group_name: '', ...r };
            rows.push(row); out.push(row);
          }
          return res(201, out);
        }
        if (method === 'PATCH') {
          const hit = rows.filter(r => matches(r, u.searchParams));
          hit.forEach(r => Object.assign(r, body, { updated_at: NOW.toISOString() }));
          return res(200, hit);
        }
      }
      if (t === 'receipt_order_items' && method === 'POST') { db.items.push(...[].concat(body)); return res(201, null); }
      if (t === 'receipt_events') {
        if (method === 'POST') { db.events.push({ ...body, created_at: NOW.toISOString() }); return res(201, null); }
        return res(200, db.events.filter(e => e.order_id === u.searchParams.get('order_id')?.slice(3)).slice(-1));
      }
      if (t === 'receipt_ocr_runs' && method === 'POST') { db.runs.push(body); return res(201, null); }
      if (t === 'rpc/receipt_save_order') {
        const o = db.orders.find(x => x.id === body.p_id);
        if (!o || o.version !== body.p_version) return res(400, { code: 'P0001', message: 'version_conflict' });
        if (!['needs_review', 'needs_check'].includes(o.review_status)) return res(400, { code: 'P0001', message: 'locked' });
        Object.assign(o, body.p_fields); o.version += 1;
        if (body.p_items) { db.items = db.items.filter(i => i.order_id !== o.id).concat(body.p_items.map((i, n) => ({ ...i, order_id: o.id, position: n }))); }
        return res(200, o.version);
      }
    }
    if (u.pathname.startsWith('/storage/v1/object/sign/')) {
      if (!usr?.allowed) return res(403, {});
      return res(200, body.paths.map(p => ({ path: p, signedURL: `/object/sign/receipt-images/${p}?token=t` })));
    }
    if (u.pathname === '/storage/v1/object/receipt-images' && method === 'DELETE') {
      if (!usr?.allowed) return res(403, {});
      db.removed = (db.removed || []).concat(body.prefixes); return res(200, []);
    }
    if (u.pathname.startsWith('/storage/v1/object/authenticated/receipt-images/')) {
      if (!usr?.allowed) return res(403, {});
      const bytes = db.blobs?.[u.pathname.replace('/storage/v1/object/authenticated/receipt-images/', '')];
      return bytes ? { ok: true, status: 200, arrayBuffer: async () => bytes } : res(404, {});
    }
    if (u.pathname.startsWith('/storage/v1/object/receipt-images/')) {
      if (!usr?.allowed) return res(403, {});
      db.files.push(u.pathname);
      db.blobs = { ...(db.blobs || {}), [u.pathname.replace('/storage/v1/object/receipt-images/', '')]: init.body };
      return res(200, {});
    }
    return res(404, {});
  };
  return { fetchImpl, db, calls, issue, users };
}


// แถวใบสั่งซื้อในรูปแบบที่ฐานข้อมูลคืนมา (snake_case)
let counter = 0;
export function makeRow(over = {}) {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`, seq: counter, code: `RCP-${String(counter).padStart(4, '0')}`,
    branch: 'สยาม', source: 'upload', sender_name: 'พิมพ์ชนก', received_at: NOW.toISOString(), image_path: `img/${counter}.jpg`,
    ocr_status: 'done', review_status: 'needs_review', jst_status: 'none', reject_reason: null,
    bill_number: `OD-${counter}`, order_date: '2026-11-24', total: 1290, customer_name: `ลูกค้า ${counter}`, phone: '0812345678',
    address: '1 ซอยทดสอบ', sub_district: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postcode: '10260', ship_date: null, remark: '',
    pos_number: '', pos_total: null, ocr_provider: 'gemini', ocr_confidence: 96, ocr_uncertain: [], ocr_original: null, ocr_raw_text: '{"raw":true}',
    duplicate_of: null, version: 1, created_at: NOW.toISOString(), ...over,
  };
}
