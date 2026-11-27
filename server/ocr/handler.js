import { providers, OcrError } from './providers.js';
import { HANDWRITTEN_FIELDS, normalizeExtraction } from './normalize.js';

const MAX_BYTES = 8 * 1024 * 1024;

// OCR_PROVIDER ไม่ตั้ง = ไม่ใช้ OCR (ระบบยังใช้งานได้ ให้คนพิมพ์เอง)
const KEY_OF = { gemini: 'GEMINI_API_KEY', typhoon: 'TYPHOON_API_KEY' };

// ผู้ให้บริการสำรอง: ตัวหลักล้ม (ไม่ว่าง/โควตาเต็ม/ช้า/ตอบผิดรูป) แล้วลองตัวนี้ต่อในคำขอเดียวกัน
// ค่าเริ่มต้น = Typhoon เมื่อมี TYPHOON_API_KEY และตัวหลักไม่ใช่ Typhoon · OCR_BACKUP=none ปิดได้
function backupOf(env, provider) {
  const name = String(env.OCR_BACKUP || 'typhoon').trim().toLowerCase();
  if (name === 'none' || name === provider || provider === 'mock' || provider === 'none') return null;
  return name in providers && KEY_OF[name] && env[KEY_OF[name]] ? name : null;
}

export function ocrStatus(env) {
  const provider = env.OCR_PROVIDER || 'none';
  const needsKey = KEY_OF[provider];
  return {
    provider,
    backup: backupOf(env, provider),
    demo: provider === 'mock',
    configured: provider !== 'none' && (provider === 'mock' || (!!needsKey && !!env[needsKey])),
    known: provider === 'none' || provider in providers,
  };
}

export function parseImageDataUrl(value) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''));
  if (!m) throw new OcrError('ต้องส่งรูปเป็น JPEG, PNG หรือ WebP', 400);
  const [, mime, base64] = m;
  if (base64.length * 0.75 > MAX_BYTES) throw new OcrError('รูปใหญ่เกินไป (เกิน 8MB)', 413);
  return { mime, base64, bytes: Buffer.from(base64, 'base64') };
}

export async function runOcr(body, env, fetchImpl = fetch, now = new Date()) {
  const status = ocrStatus(env);
  if (!status.known) throw new OcrError(`ไม่รู้จักผู้ให้บริการ OCR "${status.provider}"`, 500);
  if (status.provider === 'none') throw new OcrError('ยังไม่ได้ตั้งค่า OCR ในเซิร์ฟเวอร์', 503);
  // โหมดสาธิตสร้างข้อมูลสมมติ ต้องเปิดโดยตั้งใจเท่านั้น (ห้ามเปิดในระบบจริง)
  if (status.provider === 'mock' && env.OCR_ALLOW_MOCK !== '1') throw new OcrError('โหมดสาธิตถูกปิดในระบบนี้', 503);
  const { mime, base64 } = parseImageDataUrl(body?.image);
  const image = { base64, mime, dataUrl: `data:${mime};base64,${base64}` };
  const { provider, out } = await withBackup(status, image, env, fetchImpl);
  const { raw, rawText, model, fallback } = out;
  return { provider, model: model || '', fallback: !!fallback, demo: status.demo, rawText, ...normalizeExtraction(raw, now, { alsoUncertain: fallback ? HANDWRITTEN_FIELDS : [] }) };
}

// แบ่งงบเวลาเดียวกัน (Vercel ตัดที่ 60 วิ): ตัวหลักได้งบลบส่วนที่กันไว้ (ค่าเริ่มต้น 20 วิ — Typhoon อ่านจริง 10–17 วิ) ตัวสำรองได้เวลาที่เหลือจริง
// รูปผิดประเภท/ใหญ่เกิน (400/413) ไม่ส่งต่อ — ตัวสำรองก็อ่านไม่ได้เหมือนกัน
async function withBackup(status, image, env, fetchImpl) {
  const primary = status.provider;
  if (!status.backup) return { provider: primary, out: await providers[primary](image, env, fetchImpl) };
  const total = Number(env.OCR_BUDGET_MS ?? 48_000);
  const reserve = Number(env.OCR_BACKUP_RESERVE_MS ?? 20_000);
  const t0 = Date.now();
  try {
    return { provider: primary, out: await providers[primary](image, { ...env, OCR_BUDGET_MS: String(Math.max(1000, total - reserve)) }, fetchImpl) };
  } catch (e) {
    const left = total - (Date.now() - t0);
    if (!(e instanceof OcrError) || [400, 413].includes(e.status) || left < 5000) throw e;
    console.warn('ocr backup', JSON.stringify({ from: primary, to: status.backup, error: e.status, leftMs: left }));
    try {
      const out = await providers[status.backup](image, { ...env, OCR_BUDGET_MS: String(left) }, fetchImpl);
      // ตอบโดยตัวสำรอง = ให้คนตรวจช่องลายมือทุกช่อง (เหมือนรุ่นสำรองของ Gemini)
      return { provider: status.backup, out: { ...out, fallback: true } };
    } catch (e2) {
      console.warn('ocr backup failed', JSON.stringify({ to: status.backup, error: e2?.status || e2?.name }));
      throw e; // บอกสาเหตุของตัวหลัก (ตัวสำรองเป็นของเสริม)
    }
  }
}
