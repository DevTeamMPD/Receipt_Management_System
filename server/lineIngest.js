import { ApiError, supabase } from './supabase.js';
import { tokenExpiry } from './session.js';
import { branchesFrom } from './orders.js';
import { BUCKET, EXT, insertOrder, logOcrRun, readImage } from './orderCreate.js';
import { branchFromGroupName, lineClient, lineConfigured, verifyLineSignature } from './line.js';
import { ocrStatus } from './ocr/handler.js';
import { isBebeplayOrderForm } from './ocr/normalize.js';

// รับรูปใบสั่งซื้อจากกลุ่ม LINE (บอทเงียบ ไม่ตอบในกลุ่ม)
// webhook: ตรวจลายเซ็น → จดรูปลงกล่องรับรูป → ตอบ 200 ทันที → งานเบื้องหลังโหลดรูป + OCR
// OCR บอกว่าเป็นใบส่งซื้อสินค้า Bebeplay (ดูหัวกระดาษ) → สร้างใบ · ไม่ใช่ → ทิ้งรูป · OCR ล้ม → ลองใหม่ (cron) ครบ MAX_ATTEMPTS แล้วสร้างใบแบบ "อ่านไม่สำเร็จ" กันใบจริงหาย

export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 2 * 60 * 1000;
const STUCK_AFTER_MS = 5 * 60 * 1000;

// บัญชีระบบของ LINE ล็อกอินด้วยรหัสผ่าน (ไม่ใช้คีย์ service role) — เก็บ token ไว้ใช้ซ้ำระหว่างคำขอบนเครื่องเดิม
let cached = null;
export const resetLineServiceSession = () => { cached = null; };
async function serviceAuth(env, db, now) {
  if (!env.LINE_SERVICE_EMAIL || !env.LINE_SERVICE_PASSWORD) throw new ApiError(503, 'ยังไม่ได้ตั้งค่า LINE_SERVICE_EMAIL / LINE_SERVICE_PASSWORD');
  if (cached && cached.email === env.LINE_SERVICE_EMAIL && cached.exp - now.getTime() > 120_000) return cached.auth;
  const d = await db.passwordLogin(env.LINE_SERVICE_EMAIL, env.LINE_SERVICE_PASSWORD);
  const p = (await db.rest(d.access_token, 'GET', 'receipt_users?select=user_id,email,display_name,role,active&limit=1'))?.[0];
  if (!p || !p.active) throw new ApiError(503, 'บัญชีระบบของ LINE ยังไม่อยู่ในรายชื่อผู้ใช้ระบบ (receipt_users)');
  const auth = { token: d.access_token, user: { id: p.user_id, email: p.email, name: p.display_name || 'LINE OA', role: p.role } };
  cached = { email: env.LINE_SERVICE_EMAIL, exp: tokenExpiry(d.access_token), auth };
  return auth;
}

async function serviceContext({ env, fetchImpl, now }) {
  const db = supabase(env, fetchImpl);
  return { env, fetchImpl, now, db, auth: await serviceAuth(env, db, now), line: lineClient(env, fetchImpl) };
}

async function ensureGroup(ctx, groupId) {
  const { db, auth, line, env } = ctx;
  const found = (await db.rest(auth.token, 'GET', `receipt_line_groups?select=*&group_id=eq.${encodeURIComponent(groupId)}&limit=1`))?.[0];
  if (found) return found;
  const name = await line.groupName(groupId);
  const row = { group_id: groupId, group_name: name, branch: branchFromGroupName(name, branchesFrom(env)) };
  const saved = await db.rest(auth.token, 'POST', 'receipt_line_groups', { body: row, prefer: 'resolution=ignore-duplicates,return=representation' });
  if (!row.branch) console.warn('line group not mapped to a branch', JSON.stringify({ group: groupId.slice(-6) }));
  return saved?.[0] || row;
}

export async function handleLineWebhook({ rawBody, headers = {}, env, fetchImpl = fetch, now = new Date(), defer = p => p }) {
  if (!lineConfigured(env)) return { status: 503, body: { error: 'ยังไม่ได้ตั้งค่า LINE' } };
  if (!verifyLineSignature(rawBody, headers['x-line-signature'], env.LINE_CHANNEL_SECRET)) return { status: 401, body: { error: 'ลายเซ็นไม่ถูกต้อง' } };
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); } catch { return { status: 400, body: { error: 'ข้อมูลไม่ถูกต้อง' } }; }
  const events = Array.isArray(payload?.events) ? payload.events : [];
  if (!events.length) return { status: 200, body: { ok: true } }; // ปุ่ม Verify ใน LINE Developers ส่งรายการว่าง

  const ctx = await serviceContext({ env, fetchImpl, now });
  const queued = [];
  for (const ev of events) {
    const groupId = ev?.source?.type === 'group' ? ev.source.groupId : null;
    if (!groupId) continue;
    try {
      if (ev.type === 'join') { await ensureGroup(ctx, groupId); continue; }
      if (ev.type === 'leave') { await ctx.db.rest(ctx.auth.token, 'PATCH', `receipt_line_groups?group_id=eq.${encodeURIComponent(groupId)}`, { body: { active: false } }); continue; }
      const m = ev.message;
      if (ev.type !== 'message' || m?.type !== 'image' || (m.contentProvider?.type && m.contentProvider.type !== 'line')) continue;
      const group = await ensureGroup(ctx, groupId);
      if (!group.active || !group.branch) continue; // ยังไม่ผูกสาขา — ไม่รับรูป (ไม่เก็บรูปลูกค้าที่ยังไม่รู้ว่าเป็นของสาขาไหน)
      const inserted = await ctx.db.rest(ctx.auth.token, 'POST', 'receipt_line_inbox', {
        body: { message_id: String(m.id), group_id: groupId, branch: group.branch, sender_user_id: ev.source.userId || null, sent_at: Number.isFinite(ev.timestamp) ? new Date(ev.timestamp).toISOString() : null },
        prefer: 'resolution=ignore-duplicates,return=representation',
      });
      if (inserted?.[0]) queued.push(inserted[0].id); // ไม่มีแถว = LINE ส่ง webhook ซ้ำ รับไปแล้ว
    } catch (e) { console.error('line event failed', ev?.type, e.code || e.status || e.message); }
  }
  if (queued.length) defer(Promise.allSettled(queued.map(id => processInboxItem(ctx, id))));
  return { status: 200, body: { ok: true, queued: queued.length } };
}

const mimeOf = path => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[String(path).split('.').pop().toLowerCase()] || 'image/jpeg';

// ทำงานกับรูปหนึ่งรูปในกล่องรับรูป — เรียกได้ซ้ำอย่างปลอดภัย (จองแถวด้วยเงื่อนไขสถานะ/จำนวนครั้ง)
export async function processInboxItem(ctx, id) {
  const { db, auth, line, now } = ctx;
  const row = (await db.rest(auth.token, 'GET', `receipt_line_inbox?select=*&id=eq.${id}&limit=1`))?.[0];
  if (!row) return 'missing';
  const age = now.getTime() - new Date(row.updated_at || row.created_at || now).getTime();
  const eligible = (row.status === 'pending') || (row.status === 'failed' && row.attempts < MAX_ATTEMPTS) || (row.status === 'processing' && age > STUCK_AFTER_MS);
  if (!eligible) return 'skipped';
  const attempt = row.attempts + 1;
  const claimed = await db.rest(auth.token, 'PATCH', `receipt_line_inbox?id=eq.${id}&status=eq.${row.status}&attempts=eq.${row.attempts}`, { body: { status: 'processing', attempts: attempt }, prefer: 'return=representation' });
  if (!claimed?.length) return 'busy';
  const finish = body => db.rest(auth.token, 'PATCH', `receipt_line_inbox?id=eq.${id}`, { body });

  try {
    let imagePath = row.image_path;
    let bytes;
    let mime = mimeOf(imagePath);
    let senderName = row.sender_name;
    if (!senderName && row.sender_user_id) senderName = await line.memberName(row.group_id, row.sender_user_id);
    if (!imagePath) {
      let content;
      try { content = await line.content(row.message_id); } catch (e) {
        // LINE ลบไฟล์แล้ว/ไม่พบ — ลองใหม่ไม่ช่วย
        await finish({ status: 'failed', attempts: MAX_ATTEMPTS, last_error: `ดาวน์โหลดรูปจาก LINE ไม่ได้ (${e.status || 'network'})` });
        return 'failed';
      }
      mime = EXT[content.mime] ? content.mime : 'image/jpeg';
      bytes = content.bytes;
      imagePath = `line/${row.id}.${EXT[mime]}`;
      await db.upload(auth.token, BUCKET, imagePath, bytes, mime);
      await finish({ image_path: imagePath, sender_name: senderName || null });
    } else {
      bytes = await db.download(auth.token, BUCKET, imagePath);
    }

    const run = ocrStatus(ctx.env).configured ? await readImage(ctx, `data:${mime};base64,${bytes.toString('base64')}`) : null;
    const x = run?.x;
    if (x && !isBebeplayOrderForm(x)) {
      await logOcrRun(ctx, null, ocrStatus(ctx.env).provider, run);
      try { await db.remove(auth.token, BUCKET, [imagePath]); } catch (e) { console.error('line image cleanup failed', e.code || e.status); }
      const why = x.docType === 'order_form' ? `หัวกระดาษไม่ใช่ใบส่งซื้อสินค้า Bebeplay ("${x.formTitle || 'ไม่มีหัวกระดาษ'}")` : `ไม่ใช่ใบสั่งซื้อ (${x.docType})`;
      await finish({ status: 'ignored', image_path: null, last_error: why.slice(0, 300) });
      return 'ignored';
    }
    if (run && !x && attempt < MAX_ATTEMPTS) {
      await logOcrRun(ctx, null, ocrStatus(ctx.env).provider, run);
      await finish({ status: 'failed', last_error: String(run.ocrError || 'อ่านรูปไม่สำเร็จ').slice(0, 300) });
      return 'retry';
    }
    // เป็นใบสั่งซื้อ หรือ OCR ล้มครบจำนวนครั้ง (สร้างใบให้คนตรวจเอง ไม่ทิ้งใบจริง)
    const { id: orderId } = await insertOrder(ctx, { imagePath, mime, branch: row.branch, source: 'line', senderName: senderName || 'LINE', run });
    await finish({ status: 'order', order_id: orderId, last_error: x ? null : String(run?.ocrError || '').slice(0, 300) || null });
    return 'order';
  } catch (e) {
    console.error('line inbox item failed', e.code || e.status || e.message);
    await finish({ status: 'failed', last_error: String(e.message || 'error').slice(0, 300) }).catch(() => {});
    return 'failed';
  }
}

// cron: เก็บตกรูปที่ OCR ล้ม/ค้าง — ทีละไม่กี่รูปให้จบใน 60 วินาที
export async function processDueInbox({ env, fetchImpl = fetch, now = new Date(), limit = 2 }) {
  if (!lineConfigured(env)) return { processed: 0 };
  const ctx = await serviceContext({ env, fetchImpl, now });
  const retryBefore = new Date(now.getTime() - RETRY_AFTER_MS).toISOString();
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  const filter = `or=(and(status.in.(pending,failed),attempts.lt.${MAX_ATTEMPTS},updated_at.lt.${retryBefore}),and(status.eq.processing,updated_at.lt.${stuckBefore}))`;
  const rows = await ctx.db.rest(ctx.auth.token, 'GET', `receipt_line_inbox?select=id&${filter}&order=created_at.asc&limit=${limit}`);
  const results = await Promise.all((rows || []).map(r => processInboxItem(ctx, r.id)));
  return { processed: results.length, results };
}
