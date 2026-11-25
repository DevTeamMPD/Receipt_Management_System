import { providers, OcrError } from './providers.js';
import { normalizeExtraction } from './normalize.js';

const MAX_BYTES = 8 * 1024 * 1024;

export function ocrStatus(env) {
  const provider = env.OCR_PROVIDER || 'mock';
  const needsKey = { gemini: 'GEMINI_API_KEY', typhoon: 'TYPHOON_API_KEY' }[provider];
  return {
    provider,
    demo: provider === 'mock',
    configured: provider === 'mock' || (!!needsKey && !!env[needsKey]),
    known: provider in providers,
  };
}

export async function runOcr(body, env, fetchImpl = fetch, now = new Date()) {
  const status = ocrStatus(env);
  if (!status.known) throw new OcrError(`ไม่รู้จักผู้ให้บริการ OCR "${status.provider}"`, 500);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body?.image || ''));
  if (!m) throw new OcrError('ต้องส่งรูปเป็น JPEG, PNG หรือ WebP', 400);
  const [, mime, base64] = m;
  if (base64.length * 0.75 > MAX_BYTES) throw new OcrError('รูปใหญ่เกินไป (เกิน 8MB)', 413);
  const { raw, rawText } = await providers[status.provider]({ base64, mime, dataUrl: `data:${mime};base64,${base64}` }, env, fetchImpl);
  return { provider: status.provider, demo: status.demo, rawText, ...normalizeExtraction(raw, now) };
}
