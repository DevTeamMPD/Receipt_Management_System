import { randomUUID } from 'node:crypto';
import { ocrStatus, runOcr } from './ocr/handler.js';
import { OcrError } from './ocr/providers.js';
import { mapRow } from './orders.js';
import { loadSkuMemory } from './sku.js';
import { fillSkus } from '../src/sku.js';

// สร้างใบสั่งซื้อจากรูป — ใช้ร่วมกันทั้งการอัปโหลดจากหน้าเว็บและรูปจากกลุ่ม LINE (ctx.auth = ผู้ใช้หรือบัญชีระบบของ LINE)
export const BUCKET = 'receipt-images';
export const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function logEvent(ctx, orderId, action, details = {}) {
  try {
    await ctx.db.rest(ctx.auth.token, 'POST', 'receipt_events', { body: { order_id: orderId, actor: ctx.auth.user.id, actor_label: ctx.auth.user.email, action, details } });
  } catch (e) { console.error('audit log failed', action, e.code || e.status); }
}

// ช่องข้อมูลจากผล OCR (ใช้ทั้งตอนอัปโหลดและตอนกดอ่านรูปใหม่) — x = null คือไม่มีผล OCR
export function ocrDataColumns(x) {
  return {
    bill_number: x?.billNumber || '', order_date: x?.orderDate || null, total: x?.total ? Number(x.total) : null,
    customer_name: x?.customerName || '', phone: x?.phone || '', address: x?.address || '', sub_district: x?.subDistrict || '',
    district: x?.district || '', province: x?.province || '', postcode: x?.postcode || '', ship_date: x?.shipDate || null, remark: x?.remark || '',
    pos_number: x?.posNumber || '', pos_total: x?.posTotal ? Number(x.posTotal) : null,
  };
}
export const OCR_FIELD_KEYS = ['billNumber', 'orderDate', 'customerName', 'phone', 'address', 'subDistrict', 'district', 'province', 'postcode', 'shipDate', 'remark', 'total', 'posNumber', 'posTotal', 'items'];
export const needsCheckFor = (x, dupId) => x.uncertain.length > 0 || x.confidence < 80 || x.docType !== 'order_form' || !!dupId;

// อ่านรูปด้วย OCR พร้อมเก็บสถิติ (ไม่โยน error — ล้มเหลวคืน ocrError ให้คนกรอกเอง)
export async function readImage(ctx, image) {
  const t0 = Date.now();
  try { return { x: await runOcr({ image }, ctx.env, ctx.fetchImpl, ctx.now), latency: Date.now() - t0 }; } catch (e) {
    const httpStatus = e.status || 500;
    return { x: null, ocrError: e instanceof OcrError ? e.message : 'อ่านรูปไม่สำเร็จ', httpStatus, errCode: `http_${httpStatus}`, latency: Date.now() - t0 };
  }
}
export async function findDuplicate(ctx, x, excludeId) {
  if (!x?.billNumber || !x.total) return null;
  const dup = await ctx.db.rest(ctx.auth.token, 'GET', `receipt_orders?select=id&bill_number=eq.${encodeURIComponent(x.billNumber)}&total=eq.${encodeURIComponent(x.total)}${excludeId ? `&id=neq.${excludeId}` : ''}&limit=1`);
  return dup?.[0]?.id || null;
}
export async function logOcrRun(ctx, orderId, provider, r) {
  try {
    await ctx.db.rest(ctx.auth.token, 'POST', 'receipt_ocr_runs', { body: { order_id: orderId, provider: r.x?.provider || provider, model: r.x?.model || null, ok: !!r.x, http_status: r.httpStatus || null, error_code: r.errCode || null, latency_ms: r.latency } });
  } catch (e) { console.error('ocr run log failed', e.code || e.status); }
}
export async function dupCodeOf(ctx, dupId) {
  return dupId ? (await ctx.db.rest(ctx.auth.token, 'GET', `receipt_orders?select=code&id=eq.${dupId}&limit=1`))?.[0]?.code : '';
}

// รายการสินค้าจากผล OCR เป็นแถวของฐานข้อมูล พร้อม SKU ที่เคยกรอกไว้กับชุด สินค้า+ขนาด+สี เดียวกัน
export async function itemRowsFromOcr(ctx, orderId, ocrItems) {
  if (!ocrItems?.length) return [];
  const { items } = fillSkus(ocrItems, await loadSkuMemory(ctx));
  return items.map((i, n) => ({ order_id: orderId, position: n, product: i.product, size: i.size, color: i.color, sku: i.sku || null }));
}

// run = ผลจาก readImage (null = ไม่ได้ใช้ OCR) · imagePath = รูปที่เก็บไว้แล้ว (LINE) ไม่งั้นอัปโหลด bytes ให้
export async function insertOrder(ctx, { bytes, mime, imagePath, branch, source, senderName, run }) {
  const { db, auth, env } = ctx;
  const id = randomUUID();
  const path = imagePath || `${id}/${randomUUID()}.${EXT[mime] || 'jpg'}`;
  if (!imagePath) await db.upload(auth.token, BUCKET, path, bytes, mime);
  const status = ocrStatus(env);
  const x = run?.x || null;
  const dupId = await findDuplicate(ctx, x);
  const needsCheck = !!x && needsCheckFor(x, dupId);
  const row = {
    id, branch, source, sender_name: senderName || null, image_path: path,
    ocr_status: x ? 'done' : run ? 'failed' : 'skipped',
    review_status: run && (!x || needsCheck) ? 'needs_check' : 'needs_review',
    ...ocrDataColumns(x),
    ocr_provider: run ? (x?.provider || status.provider) : null, ocr_model: x?.model || null, ocr_confidence: x ? x.confidence : null,
    ocr_uncertain: x ? x.uncertain : [], ocr_original: x ? Object.fromEntries(OCR_FIELD_KEYS.map(k => [k, x[k]])) : null, ocr_raw_text: x?.rawText || null, duplicate_of: dupId, created_by: auth.user.id,
  };
  const [saved] = await db.rest(auth.token, 'POST', 'receipt_orders', { body: row, prefer: 'return=representation' });
  const items = await itemRowsFromOcr(ctx, id, x?.items);
  if (items.length) await db.rest(auth.token, 'POST', 'receipt_order_items', { body: items });
  if (run) await logOcrRun(ctx, id, status.provider, run);
  await logEvent(ctx, id, 'created', { source, ocr: row.ocr_status });
  const urls = await db.sign(auth.token, BUCKET, [path]);
  const order = mapRow({ ...saved, receipt_order_items: items }, urls[path] || '', dupId ? { [dupId]: await dupCodeOf(ctx, dupId) } : {});
  order.items = order.items.map(i => (i.sku ? { ...i, skuAuto: true } : i)); // SKU ตอนสร้างใบมาจากความจำทั้งหมด — ให้หน้าเว็บบอกคนตรวจ
  return { id, order };
}
