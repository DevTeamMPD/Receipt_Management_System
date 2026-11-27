import { ocrStatus, OCR_CHOICES } from './ocr/handler.js';

// ตัวอ่าน OCR เริ่มต้นที่ผู้ดูแลเลือกในหน้าเว็บ (ตาราง receipt_settings คีย์ ocr_provider) ทับค่า env OCR_PROVIDER
// ยังไม่มีตาราง/ยังไม่เคยเลือก/อ่านไม่ได้ = ใช้ OCR_PROVIDER จาก env เหมือนเดิม · เลือกตัวที่ไม่มีคีย์ = ไม่ใช้ (กันระบบอ่านไม่ได้ทั้งหมด)
export async function loadOcrChoice(db, token, env) {
  try {
    const v = (await db.rest(token, 'GET', 'receipt_settings?select=value&key=eq.ocr_provider&limit=1'))?.[0]?.value;
    return OCR_CHOICES.includes(v) && ocrStatus(env).available[v] ? v : null;
  } catch (e) {
    if (e.status === 401) throw e;
    if (e.code !== 'PGRST205' && e.code !== '42P01') console.warn('ocr setting load failed', e.code || e.status);
    return null;
  }
}

// ใส่ค่าที่เลือกลง ctx.env ครั้งเดียวต่อคำขอ — ทุกที่ที่เรียก ocrStatus(ctx.env)/readImage ต่อจากนี้ใช้ตัวที่เลือก
export async function applyOcrSetting(ctx, token = ctx.auth?.token) {
  if (ctx.ocrChoice !== undefined) return ctx.ocrChoice;
  const choice = await loadOcrChoice(ctx.db, token, ctx.env);
  ctx.ocrChoice = choice;
  if (choice) ctx.env = { ...ctx.env, OCR_PROVIDER: choice };
  return choice;
}
