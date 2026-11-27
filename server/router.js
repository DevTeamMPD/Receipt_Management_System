import { ApiError, supabase } from './supabase.js';
import { COOKIE, parseCookies, decodeSession, tokenExpiry, setCookie, clearCookie } from './session.js';
import { ocrStatus, parseImageDataUrl, OCR_CHOICES } from './ocr/handler.js';
import { applyOcrSetting } from './ocrSetting.js';
import { BRANCH_MAX, ORDER_SELECT, cleanBranchName, loadBranches, mapRow, sanitizeItems, sanitizePatch, sortBranches } from './orders.js';
import { BUCKET, OCR_FIELD_KEYS, dupCodeOf, findDuplicate, insertOrder, logEvent, logOcrRun, needsCheckFor, ocrDataColumns, readImage } from './orderCreate.js';
import { validate } from '../src/validation.js';
import { timingSafeEqual } from 'node:crypto';
import { MAX_ATTEMPTS, claimWaitingForGroup, processDueInbox, processNow } from './lineIngest.js';
import { branchFromGroupName, lineClient, lineConfigured } from './line.js';

const EDIT_LOG_WINDOW_MS = 5 * 60 * 1000;
const PENDING = 'review_status=in.(needs_review,needs_check)&jst_status=eq.none';
const CONFIRMED = 'review_status=eq.confirmed&jst_status=eq.none';

const ok = (body, status = 200) => ({ status, body });
const asVersion = v => { if (!Number.isInteger(v) || v < 1) throw new ApiError(422, 'ไม่พบเลขเวอร์ชันของใบ กรุณาโหลดใหม่'); return v; };
const asId = id => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, 'ไม่พบใบนี้'); return id; };

async function authenticate(ctx) {
  let sess = decodeSession(parseCookies(ctx.req.headers.cookie)[COOKIE]);
  if (!sess) throw new ApiError(401, 'ต้องเข้าสู่ระบบ');
  const { db, secure } = ctx;
  let refreshed = false;
  const refresh = async () => {
    const d = await db.refresh(sess.refresh_token);
    sess = { access_token: d.access_token, refresh_token: d.refresh_token };
    ctx.cookies.push(setCookie(sess, secure));
    refreshed = true;
  };
  if (tokenExpiry(sess.access_token) - ctx.now.getTime() < 60_000) await refresh();
  const load = () => db.rest(sess.access_token, 'GET', 'receipt_users?select=user_id,email,display_name,role,active&limit=1');
  let rows;
  try { rows = await load(); } catch (e) {
    if (e.status === 401 && !refreshed) { await refresh(); rows = await load(); } else throw e;
  }
  const p = rows?.[0];
  if (!p || !p.active) throw new ApiError(403, 'บัญชีนี้ไม่มีสิทธิ์ใช้ระบบ ติดต่อผู้ดูแล', { code: 'not_allowed' });
  return { token: sess.access_token, user: { id: p.user_id, email: p.email, name: p.display_name || p.email, role: p.role } };
}

const configOf = async (ctx, token) => {
  const choice = await applyOcrSetting(ctx, token);
  return { branches: await loadBranches(ctx.db, token, ctx.env), ocr: { ...ocrStatus(ctx.env), source: choice ? 'setting' : 'env' } };
};

async function login(ctx) {
  const { email, password } = ctx.body || {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password || email.length > 200 || password.length > 200) throw new ApiError(422, 'กรอกอีเมลและรหัสผ่าน');
  const d = await ctx.db.passwordLogin(email.trim(), password);
  const rows = await ctx.db.rest(d.access_token, 'GET', 'receipt_users?select=user_id,email,display_name,role,active&limit=1');
  const p = rows?.[0];
  if (!p || !p.active) { await ctx.db.logout(d.access_token); throw new ApiError(403, 'บัญชีนี้ไม่มีสิทธิ์ใช้ระบบ ติดต่อผู้ดูแล', { code: 'not_allowed' }); }
  ctx.cookies.push(setCookie({ access_token: d.access_token, refresh_token: d.refresh_token }, ctx.secure));
  return ok({ user: { id: p.user_id, email: p.email, name: p.display_name || p.email, role: p.role }, ...(await configOf(ctx, d.access_token)) });
}

async function logout(ctx) {
  const sess = decodeSession(parseCookies(ctx.req.headers.cookie)[COOKIE]);
  if (sess) await ctx.db.logout(sess.access_token);
  ctx.cookies.push(clearCookie(ctx.secure));
  return ok({ ok: true });
}

const me = async ctx => ok({ user: ctx.auth.user, ...(await configOf(ctx, ctx.auth.token)) });

async function listOrders(ctx) {
  const rows = await ctx.db.rest(ctx.auth.token, 'GET', `receipt_orders?${ORDER_SELECT}&order=created_at.desc&limit=300`);
  const urls = await ctx.db.sign(ctx.auth.token, BUCKET, rows.map(r => r.image_path).filter(Boolean));
  const codeById = Object.fromEntries(rows.map(r => [r.id, r.code]));
  return ok({ orders: rows.map(r => mapRow(r, urls[r.image_path] || '', codeById)) });
}

async function createOrder(ctx) {
  await applyOcrSetting(ctx);
  const b = ctx.body || {};
  if (!(await loadBranches(ctx.db, ctx.auth.token, ctx.env)).includes(b.branch)) throw new ApiError(422, 'เลือกสาขาให้ถูกต้อง');
  let img;
  try { img = parseImageDataUrl(b.image); } catch (e) { throw new ApiError(e.status || 400, e.message); }
  const status = ocrStatus(ctx.env);
  const run = status.provider !== 'none' ? await readImage(ctx, b.image) : null;
  const { order } = await insertOrder(ctx, { bytes: img.bytes, mime: img.mime, branch: b.branch, source: 'upload', senderName: ctx.auth.user.name, run });
  return ok({ order, ocrError: run?.ocrError || '' }, 201);
}

const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// อ่านรูปใหม่ให้ใบที่ OCR ล้มเหลว/ข้ามไปตอนอัปโหลด — เติมเฉพาะช่องที่ยังว่าง (ไม่ทับสิ่งที่คนพิมพ์ไว้แล้ว)
async function retryOcr(ctx) {
  await applyOcrSetting(ctx);
  const { db, auth, env } = ctx;
  const id = asId(ctx.params.id);
  const version = asVersion(ctx.body?.version);
  const status = ocrStatus(env);
  if (status.provider === 'none' || !status.configured) throw new ApiError(503, 'ยังไม่ได้ตั้งค่า OCR ในเซิร์ฟเวอร์');
  const cur = (await db.rest(auth.token, 'GET', `receipt_orders?${ORDER_SELECT}&id=eq.${id}&limit=1`))?.[0];
  if (!cur) throw new ApiError(404, 'ไม่พบใบนี้');
  if (cur.version !== version) throw new ApiError(409, 'ใบนี้ถูกแก้โดยคนอื่นแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
  if (!['needs_review', 'needs_check'].includes(cur.review_status) || cur.jst_status !== 'none') throw new ApiError(409, 'อ่านรูปใหม่ได้เฉพาะใบที่ยังรอตรวจ', { code: 'locked' });
  if (!['failed', 'skipped'].includes(cur.ocr_status)) throw new ApiError(409, 'ใบนี้อ่านรูปสำเร็จไปแล้ว', { code: 'conflict' });
  if (!cur.image_path) throw new ApiError(409, 'ใบนี้ไม่มีรูป');

  const bytes = await db.download(auth.token, BUCKET, cur.image_path);
  const mime = MIME_BY_EXT[cur.image_path.split('.').pop().toLowerCase()] || 'image/jpeg';
  const run = await readImage(ctx, `data:${mime};base64,${bytes.toString('base64')}`);
  await logOcrRun(ctx, id, status.provider, run);
  await logEvent(ctx, id, 'ocr_retried', { ok: !!run.x });
  const urls = await db.sign(auth.token, BUCKET, [cur.image_path]);
  if (!run.x) return ok({ order: mapRow(cur, urls[cur.image_path] || ''), ocrError: run.ocrError });

  const { x } = run;
  const dupId = await findDuplicate(ctx, x, id);
  const fill = Object.fromEntries(Object.entries(ocrDataColumns(x)).filter(([k, v]) => v !== '' && v !== null && (cur[k] === '' || cur[k] === null || cur[k] === undefined)));
  const patch = {
    ...fill,
    ocr_status: 'done', ocr_provider: x.provider || status.provider, ocr_model: x.model || null, ocr_confidence: x.confidence, ocr_uncertain: x.uncertain,
    ocr_original: Object.fromEntries(OCR_FIELD_KEYS.map(k => [k, x[k]])), ocr_raw_text: x.rawText || null, duplicate_of: dupId,
    review_status: needsCheckFor(x, dupId) ? 'needs_check' : 'needs_review',
  };
  const rows = await db.rest(auth.token, 'PATCH', `receipt_orders?id=eq.${id}&version=eq.${version}&${PENDING}`, { body: patch, prefer: 'return=representation' });
  if (!rows?.length) throw new ApiError(409, 'ใบนี้ถูกแก้หรือเปลี่ยนสถานะไปแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
  let items = cur.receipt_order_items || [];
  if (!items.length && x.items.length) {
    items = x.items.map((i, n) => ({ order_id: id, position: n, product: i.product, size: i.size, color: i.color }));
    await db.rest(auth.token, 'POST', 'receipt_order_items', { body: items });
  }
  const order = mapRow({ ...rows[0], receipt_order_items: items }, urls[cur.image_path] || '', dupId ? { [dupId]: await dupCodeOf(ctx, dupId) } : {});
  return ok({ order, ocrError: '', filled: Object.keys(fill).length + (items.length && !cur.receipt_order_items?.length ? 1 : 0) });
}

async function saveOrder(ctx) {
  const id = asId(ctx.params.id);
  const b = ctx.body || {};
  const fields = sanitizePatch(b.fields || {});
  const items = b.items === undefined ? null : sanitizeItems(b.items);
  const version = await ctx.db.rpc(ctx.auth.token, 'receipt_save_order', { p_id: id, p_version: asVersion(b.version), p_fields: fields, p_items: items });
  const last = await ctx.db.rest(ctx.auth.token, 'GET', `receipt_events?select=action,actor,created_at&order_id=eq.${id}&order=created_at.desc&limit=1`).catch(() => []);
  const recent = last?.[0]?.action === 'edited' && last[0].actor === ctx.auth.user.id && ctx.now.getTime() - new Date(last[0].created_at).getTime() < EDIT_LOG_WINDOW_MS;
  if (!recent) await logEvent(ctx, id, 'edited', { fields: [...Object.keys(b.fields || {}), ...(items ? ['items'] : [])] });
  return ok({ version });
}

const TRANSITIONS = {
  confirm: { from: PENDING, event: 'confirmed', set: ctx => ({ review_status: 'confirmed', reviewed_by: ctx.auth.user.id, reviewed_at: ctx.now.toISOString() }) },
  reject: {
    from: PENDING, event: 'rejected',
    set: ctx => {
      const reason = typeof ctx.body?.reason === 'string' ? ctx.body.reason.trim().slice(0, 300) : '';
      if (!reason) throw new ApiError(422, 'ใส่เหตุผลที่ปฏิเสธ');
      return { review_status: 'rejected', reject_reason: reason, reviewed_by: ctx.auth.user.id, reviewed_at: ctx.now.toISOString() };
    },
  },
  reopen: { from: CONFIRMED, event: 'reopened', set: () => ({ review_status: 'needs_review', reviewed_by: null, reviewed_at: null }) },
  'jst-done': { from: CONFIRMED, event: 'jst_marked_done', set: () => ({ jst_status: 'succeeded' }) },
};

async function transition(ctx) {
  const id = asId(ctx.params.id);
  const t = TRANSITIONS[ctx.params.action];
  const version = asVersion(ctx.body?.version);
  const set = t.set(ctx);
  if (ctx.params.action === 'confirm') {
    const cur = await ctx.db.rest(ctx.auth.token, 'GET', `receipt_orders?${ORDER_SELECT}&id=eq.${id}&limit=1`);
    if (!cur?.length) throw new ApiError(404, 'ไม่พบใบนี้');
    if (cur[0].version !== version) throw new ApiError(409, 'ใบนี้ถูกแก้โดยคนอื่นแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
    const errors = validate(mapRow(cur[0]));
    if (Object.keys(errors).length) throw new ApiError(422, 'ข้อมูลยังไม่ครบหรือไม่ถูกต้อง', { fields: errors });
  }
  const rows = await ctx.db.rest(ctx.auth.token, 'PATCH', `receipt_orders?id=eq.${id}&version=eq.${version}&${t.from}`, { body: set, prefer: 'return=representation' });
  if (!rows?.length) throw new ApiError(409, 'ใบนี้ถูกแก้หรือเปลี่ยนสถานะไปแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
  await logEvent(ctx, id, t.event, ctx.params.action === 'reject' ? { reason_given: true } : {});
  const r = rows[0];
  return ok({ order: { id: r.id, status: mapRow(r).status, version: r.version, rejectReason: r.reject_reason || '' } });
}

// ลบใบที่ดึงมาผิด: ได้เฉพาะใบที่ยังรอตรวจ (ฐานข้อมูลบังคับซ้ำด้วย policy) — บันทึกเหตุการณ์ก่อน แล้วค่อยลบแถวและรูป
async function deleteOrder(ctx) {
  const id = asId(ctx.params.id);
  const version = asVersion(ctx.body?.version);
  const cur = await ctx.db.rest(ctx.auth.token, 'GET', `receipt_orders?select=id,code,bill_number,customer_name,image_path,version,review_status,jst_status&id=eq.${id}&limit=1`);
  if (!cur?.length) throw new ApiError(404, 'ไม่พบใบนี้');
  const o = cur[0];
  if (o.version !== version) throw new ApiError(409, 'ใบนี้ถูกแก้โดยคนอื่นแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
  if (!['needs_review', 'needs_check'].includes(o.review_status) || o.jst_status !== 'none') throw new ApiError(409, 'ลบได้เฉพาะใบที่ยังรอตรวจ', { code: 'locked' });
  await logEvent(ctx, id, 'deleted', { code: o.code, bill_number: o.bill_number, customer_name: o.customer_name });
  const rows = await ctx.db.rest(ctx.auth.token, 'DELETE', `receipt_orders?id=eq.${id}&version=eq.${version}&${PENDING}`, { prefer: 'return=representation' });
  if (!rows?.length) throw new ApiError(409, 'ใบนี้ถูกแก้หรือเปลี่ยนสถานะไปแล้ว กรุณาโหลดใหม่', { code: 'conflict' });
  if (o.image_path) { try { await ctx.db.remove(ctx.auth.token, BUCKET, [o.image_path]); } catch (e) { console.error('image cleanup failed', o.image_path, e.code || e.status); } }
  return ok({ id, code: o.code });
}

// Vercel Cron เรียกพร้อม Authorization: Bearer <CRON_SECRET> — เก็บตกรูปจาก LINE ที่ OCR ล้ม/ค้าง
async function lineInboxCron(ctx) {
  const secret = ctx.env.CRON_SECRET;
  const given = Buffer.from(String(ctx.req.headers.authorization || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) throw new ApiError(401, 'ไม่มีสิทธิ์');
  return ok(await processDueInbox({ env: ctx.env, fetchImpl: ctx.fetchImpl, now: ctx.now }));
}

// ---- กลุ่ม LINE ที่บอทอยู่ (ดูได้ทุกคน · ผูกสาขาได้เฉพาะ admin)
const LINE_STATS_DAYS = 30;
const PROCESS_NOW = 3;
const asGroupId = id => { if (!/^[A-Za-z0-9]{1,64}$/.test(id)) throw new ApiError(404, 'ไม่พบกลุ่มนี้'); return id; };

function groupView(g, inbox) {
  const mine = inbox.filter(r => r.group_id === g.group_id);
  const count = fn => mine.filter(fn).length;
  return {
    id: g.group_id, name: g.group_name || '', branch: g.branch || null, active: g.active !== false, addedAt: g.created_at || null,
    stats: {
      orders: count(r => r.status === 'order'),
      ignored: count(r => r.status === 'ignored'),
      waiting: count(r => !r.branch && r.status === 'pending'),
      working: count(r => r.branch && (['pending', 'processing'].includes(r.status) || (r.status === 'failed' && r.attempts < MAX_ATTEMPTS))),
      failed: count(r => r.status === 'failed' && r.attempts >= MAX_ATTEMPTS),
    },
    lastPhotoAt: mine.reduce((m, r) => (!m || r.created_at > m ? r.created_at : m), null),
  };
}

const statsSince = ctx => new Date(ctx.now.getTime() - LINE_STATS_DAYS * 86_400_000).toISOString();
const inboxStats = (ctx, groupFilter = '') => ctx.db.rest(ctx.auth.token, 'GET', `receipt_line_inbox?select=group_id,status,branch,attempts,created_at${groupFilter}&created_at=gte.${encodeURIComponent(statsSince(ctx))}&order=created_at.desc&limit=5000`);
const requireAdmin = (ctx, what) => { if (ctx.auth.user.role !== 'admin') throw new ApiError(403, `${what}ได้เฉพาะผู้ดูแล (admin)`); };

async function lineGroups(ctx) {
  const { db, auth } = ctx;
  const [groups, inbox, branches] = await Promise.all([
    db.rest(auth.token, 'GET', 'receipt_line_groups?select=group_id,group_name,branch,active,created_at&order=created_at.asc'),
    inboxStats(ctx),
    loadBranches(db, auth.token, ctx.env),
  ]);
  return ok({ groups: (groups || []).map(g => groupView(g, inbox || [])), branches, canEdit: auth.user.role === 'admin', lineConfigured: lineConfigured(ctx.env), statsDays: LINE_STATS_DAYS });
}

// เพิ่มสาขาใหม่ (ไม่ซ้ำ) — คืนรายชื่อที่เพิ่มจริง · ยังไม่มีตาราง = แจ้งให้รออัปเดตฐานข้อมูล
async function addBranches(ctx, names) {
  try {
    const rows = await ctx.db.rest(ctx.auth.token, 'POST', 'receipt_branches?on_conflict=name', { body: names.map(name => ({ name, active: true })), prefer: 'resolution=merge-duplicates,return=representation' });
    return (rows || []).map(r => r.name);
  } catch (e) {
    if (e.code === 'PGRST205' || e.code === '42P01') throw new ApiError(503, 'ยังเพิ่มสาขาใหม่ไม่ได้ ต้องอัปเดตฐานข้อมูลก่อน (receipt_desk_branches_v1.sql)');
    throw e;
  }
}

// ผูกกลุ่มที่ยังไม่มีสาขาจากชื่อกลุ่ม แล้วดึงรูปที่รออยู่ — คืน [{id, branch}] และจำนวนรูปที่เริ่มดึง
async function autoMapGroups(ctx, branches) {
  const { db, auth } = ctx;
  const open = await db.rest(auth.token, 'GET', 'receipt_line_groups?select=group_id,group_name&branch=is.null&active=eq.true');
  const mapped = [];
  const ids = [];
  for (const g of open || []) {
    const branch = branchFromGroupName(g.group_name, branches);
    if (!branch) continue;
    const rows = await db.rest(auth.token, 'PATCH', `receipt_line_groups?group_id=eq.${encodeURIComponent(g.group_id)}&branch=is.null`, { body: { branch }, prefer: 'return=representation' });
    if (!rows?.length) continue;
    mapped.push({ id: g.group_id, branch });
    ids.push(...await claimWaitingForGroup(ctx, g.group_id, branch));
  }
  return { mapped, ids };
}
const startPulling = (ctx, ids) => { if (ids.length && ctx.defer) ctx.defer(processNow({ env: ctx.env, fetchImpl: ctx.fetchImpl, now: ctx.now, ids: ids.slice(0, PROCESS_NOW) })); };

async function setLineGroup(ctx) {
  const { db, auth, env } = ctx;
  requireAdmin(ctx, 'ผูกกลุ่มกับสาขา');
  const id = asGroupId(ctx.params.groupId);
  const raw = ctx.body?.branch;
  const branch = raw === null || raw === undefined || raw === '' ? null : cleanBranchName(raw);
  if (branch !== null && (!branch || branch.length > BRANCH_MAX)) throw new ApiError(422, `ชื่อสาขาต้องยาว 1–${BRANCH_MAX} ตัวอักษร`);
  let created = false;
  if (branch && !(await loadBranches(db, auth.token, env)).includes(branch)) {
    if (!ctx.body?.create) throw new ApiError(422, 'ไม่มีสาขานี้ในรายการ', { code: 'unknown_branch' });
    created = (await addBranches(ctx, [branch])).length > 0;
  }
  const patch = { branch };
  if (lineConfigured(env)) { const name = await lineClient(env, ctx.fetchImpl).groupName(id); if (name) patch.group_name = name; } // ชื่อกลุ่มล่าสุดจาก LINE
  const rows = await db.rest(auth.token, 'PATCH', `receipt_line_groups?group_id=eq.${encodeURIComponent(id)}`, { body: patch, prefer: 'return=representation' });
  if (!rows?.length) throw new ApiError(404, 'ไม่พบกลุ่มนี้');
  const ids = branch ? await claimWaitingForGroup(ctx, id, branch) : [];
  startPulling(ctx, ids);
  console.info('line group mapped', JSON.stringify({ group: id.slice(-6), branch, queued: ids.length, created }));
  const inbox = await inboxStats(ctx, `&group_id=eq.${encodeURIComponent(id)}`);
  return ok({ group: groupView(rows[0], inbox || []), queued: ids.length, created, branches: await loadBranches(db, auth.token, env) });
}

// วางรายชื่อสาขาหลายบรรทัด → เพิ่มที่ยังไม่มี แล้วผูกกลุ่มที่ชื่อกลุ่มมีชื่อสาขาอยู่ให้อัตโนมัติ
async function addBranchList(ctx) {
  requireAdmin(ctx, 'เพิ่มสาขา');
  const list = Array.isArray(ctx.body?.names) ? ctx.body.names : [];
  const names = sortBranches(list.map(cleanBranchName).filter(Boolean));
  if (!names.length) throw new ApiError(422, 'ใส่ชื่อสาขาอย่างน้อย 1 ชื่อ (บรรทัดละ 1 สาขา)');
  if (names.length > 200) throw new ApiError(422, 'เพิ่มได้ครั้งละไม่เกิน 200 สาขา');
  const tooLong = names.find(n => n.length > BRANCH_MAX);
  if (tooLong) throw new ApiError(422, `ชื่อสาขายาวเกิน ${BRANCH_MAX} ตัวอักษร: ${tooLong.slice(0, 20)}…`);
  const before = await loadBranches(ctx.db, ctx.auth.token, ctx.env);
  await addBranches(ctx, names);
  const branches = await loadBranches(ctx.db, ctx.auth.token, ctx.env);
  const { mapped, ids } = await autoMapGroups(ctx, branches);
  startPulling(ctx, ids);
  return ok({ added: names.filter(n => !before.includes(n)), branches, autoMapped: mapped, queued: ids.length });
}

// ซ่อน/แสดงสาขาในตัวเลือก (ใบเก่าและกลุ่มที่ผูกไว้ไม่เปลี่ยน)
async function setBranchActive(ctx) {
  requireAdmin(ctx, 'ซ่อนสาขา');
  const name = cleanBranchName(decodeURIComponent(ctx.params.name || ''));
  if (typeof ctx.body?.active !== 'boolean') throw new ApiError(422, 'ระบุ active เป็น true/false');
  let rows;
  try {
    rows = await ctx.db.rest(ctx.auth.token, 'PATCH', `receipt_branches?name=eq.${encodeURIComponent(name)}`, { body: { active: ctx.body.active }, prefer: 'return=representation' });
  } catch (e) {
    if (e.code === 'PGRST205' || e.code === '42P01') throw new ApiError(503, 'ยังแก้รายชื่อสาขาไม่ได้ ต้องอัปเดตฐานข้อมูลก่อน (receipt_desk_branches_v1.sql)');
    throw e;
  }
  if (!rows?.length) throw new ApiError(404, 'ไม่พบสาขานี้');
  return ok({ branches: await loadBranches(ctx.db, ctx.auth.token, ctx.env) });
}

// ผู้ดูแลเลือกตัวอ่าน OCR เริ่มต้น (อีกตัวเป็นสำรองอัตโนมัติถ้ามีคีย์) — มีผลกับรูปถัดไปทันที ไม่ต้อง deploy ใหม่
async function setOcrProvider(ctx) {
  requireAdmin(ctx, 'เปลี่ยนตัวอ่าน OCR');
  const provider = ctx.body?.provider;
  if (!OCR_CHOICES.includes(provider)) throw new ApiError(422, 'เลือกตัวอ่าน OCR ให้ถูกต้อง');
  if (!ocrStatus(ctx.env).available[provider]) throw new ApiError(422, `ยังไม่ได้ใส่คีย์ของ ${provider} ในเซิร์ฟเวอร์ เลือกตัวนี้ไม่ได้`);
  try {
    await ctx.db.rest(ctx.auth.token, 'POST', 'receipt_settings?on_conflict=key', { body: { key: 'ocr_provider', value: provider }, prefer: 'resolution=merge-duplicates,return=minimal' });
  } catch (e) {
    if (e.code === 'PGRST205' || e.code === '42P01') throw new ApiError(503, 'ยังเปลี่ยนตัวอ่าน OCR ไม่ได้ ต้องอัปเดตฐานข้อมูลก่อน (receipt_desk_settings_v1.sql)');
    throw e;
  }
  console.info('ocr provider set', JSON.stringify({ provider }));
  return ok({ ocr: { ...ocrStatus({ ...ctx.env, OCR_PROVIDER: provider }), source: 'setting' } });
}

const ROUTES = [
  ['GET', /^\/api\/cron\/line-inbox$/, lineInboxCron, { public: true }],
  ['POST', /^\/api\/auth\/login$/, login, { public: true }],
  ['POST', /^\/api\/auth\/logout$/, logout, { public: true }],
  ['GET', /^\/api\/auth\/me$/, me],
  ['GET', /^\/api\/orders$/, listOrders],
  ['POST', /^\/api\/orders$/, createOrder],
  ['PATCH', /^\/api\/orders\/(?<id>[^/]+)$/, saveOrder],
  ['POST', /^\/api\/orders\/(?<id>[^/]+)\/(?<action>confirm|reject|reopen|jst-done)$/, transition],
  ['POST', /^\/api\/orders\/(?<id>[^/]+)\/ocr$/, retryOcr],
  ['DELETE', /^\/api\/orders\/(?<id>[^/]+)$/, deleteOrder],
  ['GET', /^\/api\/line\/groups$/, lineGroups],
  ['PATCH', /^\/api\/line\/groups\/(?<groupId>[^/]+)$/, setLineGroup],
  ['POST', /^\/api\/branches$/, addBranchList],
  ['PATCH', /^\/api\/branches\/(?<name>[^/]+)$/, setBranchActive],
  ['PUT', /^\/api\/settings\/ocr$/, setOcrProvider],
];

function sameOrigin(headers) {
  if (!headers.origin) return true;
  try { return new URL(headers.origin).host === (headers['x-forwarded-host'] || headers.host); } catch { return false; }
}

// รับคำขอที่ไม่ผูกกับเฟรมเวิร์ก คืน { status, body, cookies } — ใช้ร่วมกันทั้ง Vite (dev) และ Vercel (ใช้งานจริง)
export async function handle({ method, path, headers = {}, body, env, fetchImpl = fetch, now = new Date(), defer = null }) {
  const cookies = [];
  const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : headers['x-forwarded-proto'] === 'https';
  try {
    let hit;
    for (const [m, re, fn, opts] of ROUTES) {
      const match = m === method && re.exec(path);
      if (match) { hit = { fn, opts: opts || {}, params: match.groups || {} }; break; }
    }
    if (!hit) return { status: 404, body: { error: 'ไม่พบหน้านี้' }, cookies };
    if (method !== 'GET') {
      if (!sameOrigin(headers)) throw new ApiError(403, 'คำขอไม่ได้มาจากหน้าเว็บของระบบ');
      if (!String(headers['content-type'] || '').includes('application/json')) throw new ApiError(415, 'ต้องส่งเป็น JSON');
    }
    const ctx = { req: { headers }, env, now, fetchImpl, secure, params: hit.params, body, cookies, auth: null, defer };
    let dbInstance; // สร้างเมื่อใช้งานจริง เพื่อให้คำขอที่ไม่ได้ล็อกอินได้ 401 ก่อน แม้ยังไม่ได้ตั้งค่า Supabase
    Object.defineProperty(ctx, 'db', { get: () => (dbInstance ||= supabase(env, fetchImpl)) });
    if (!hit.opts.public) ctx.auth = await authenticate(ctx);
    const out = await hit.fn(ctx);
    return { ...out, cookies };
  } catch (e) {
    if (e instanceof ApiError) {
      const out = { status: e.status, body: { error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.fields ? { fields: e.fields } : {}) }, cookies };
      if (e.status === 401) out.cookies = [clearCookie(secure)];
      return out;
    }
    console.error('unhandled', e?.message ? String(e.message).slice(0, 120) : 'error');
    return { status: 500, body: { error: 'เกิดข้อผิดพลาดในระบบ' }, cookies };
  }
}
