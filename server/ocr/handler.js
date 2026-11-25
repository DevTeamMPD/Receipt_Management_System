import { providers, OcrError } from './providers.js';
import { normalizeExtraction } from './normalize.js';

const MAX_BYTES = 8 * 1024 * 1024;

// OCR_PROVIDER ไม่ตั้ง = ไม่ใช้ OCR (ระบบยังใช้งานได้ ให้คนพิมพ์เอง)
export function ocrStatus(env) {
  const provider = env.OCR_PROVIDER || 'none';
  const needsKey = { gemini: 'GEMINI_API_KEY', typhoon: 'TYPHOON_API_KEY' }[provider];
  return {
    provider,
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
  const { raw, rawText, model } = await providers[status.provider]({ base64, mime, dataUrl: `data:${mime};base64,${base64}` }, env, fetchImpl);
  return { provider: status.provider, model: model || '', demo: status.demo, rawText, ...normalizeExtraction(raw, now) };
}
