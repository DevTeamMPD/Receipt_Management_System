import { test, expect } from '@playwright/test';
import { parseDateText, parseAmount, parsePhone, normalizeExtraction } from '../server/ocr/normalize.js';
import { geminiProvider, typhoonProvider, parseJsonLoose, OcrError } from '../server/ocr/providers.js';
import { runOcr, ocrStatus } from '../server/ocr/handler.js';

const NOW = new Date('2026-11-25T00:00:00Z');
const good = {
  docType: 'order_form', billNumber: 'OD-1', orderDateText: '24/11/69', customerName: 'ทดสอบ หนึ่ง', phone: '0812345678', address: '1 ซอยทดสอบ',
  subDistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postcode: '10260', shipDateText: '', items: [{ product: 'ตู้', size: '', color: 'ขาว' }],
  remark: '', total: '1,290', posNumber: 'P1', posTotal: '1290', uncertain: [],
};
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const fakeFetch = (responses, calls = []) => async (url, init) => {
  calls.push({ url, init, body: JSON.parse(init.body) });
  const r = responses.shift();
  return { ok: r.status === undefined || r.status < 400, status: r.status ?? 200, json: async () => r.json };
};

test('dates: Buddhist short/long years, Thai digits, impossible and implausible dates', () => {
  expect(parseDateText('14/7/69', NOW)).toBe('2026-07-14');
  expect(parseDateText('24/11/2569', NOW)).toBe('2026-11-24');
  expect(parseDateText('๒๔/๑๑/๖๙', NOW)).toBe('2026-11-24');
  expect(parseDateText('2026-11-24', NOW)).toBe('2026-11-24');
  expect(parseDateText('31/2/69', NOW)).toBe('');
  expect(parseDateText('1/1/50', NOW)).toBe('');
  expect(parseDateText('', NOW)).toBe('');
});

test('amounts and phone numbers are cleaned', () => {
  expect(parseAmount('15,350.00')).toBe('15350');
  expect(parseAmount('฿ 1,290 บาท')).toBe('1290');
  expect(parseAmount('abc')).toBe('');
  expect(parsePhone('081-234-5678')).toBe('0812345678');
  expect(parsePhone('+66 81 234 5678')).toBe('0812345678');
});

test('a clean extraction has no uncertain fields and high confidence', () => {
  const r = normalizeExtraction(good, NOW);
  expect(r.orderDate).toBe('2026-11-24');
  expect(r.total).toBe('1290');
  expect(r.uncertain).toEqual([]);
  expect(r.confidence).toBe(98);
});

test('rule failures and model-declared doubts become uncertain fields; confidence comes from the rules', () => {
  const r = normalizeExtraction({ ...good, phone: '08123', postcode: '102', orderDateText: '99/9/99', uncertain: ['customerName', 'orderDateText', 'bogus'] }, NOW);
  expect(r.uncertain.sort()).toEqual(['customerName', 'orderDate', 'phone', 'postcode'].sort());
  expect(r.confidence).toBe(98 - 9 * 4);
  const other = normalizeExtraction({ ...good, docType: 'receipt_only' }, NOW);
  expect(other.confidence).toBeLessThanOrEqual(50);
});

test('JSON in fences or surrounded by text can be parsed; garbage is rejected', () => {
  expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  expect(parseJsonLoose('here you go {"a":2} thanks')).toEqual({ a: 2 });
  expect(() => parseJsonLoose('no json')).toThrow(OcrError);
});

test('Gemini request carries the key in a header, the image inline and a response schema', async () => {
  const calls = [];
  const f = fakeFetch([{ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } }], calls);
  const out = await geminiProvider({ base64: 'QUJD', mime: 'image/jpeg' }, { GEMINI_API_KEY: 'k-secret', GEMINI_MODEL: 'm-1' }, f);
  expect(out.raw.billNumber).toBe('OD-1');
  expect(calls[0].url).toContain('/models/m-1:generateContent');
  expect(calls[0].url).not.toContain('k-secret');
  expect(calls[0].init.headers['x-goog-api-key']).toBe('k-secret');
  const parts = calls[0].body.contents[0].parts;
  expect(parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'QUJD' });
  expect(calls[0].body.generationConfig.responseMimeType).toBe('application/json');
  expect(calls[0].body.generationConfig.responseSchema.properties.items.type).toBe('ARRAY');
  expect(calls[0].body.generationConfig).not.toHaveProperty('temperature');
});

test('Gemini default model is current and temperature is only sent when configured', async () => {
  const calls = [];
  const ok = () => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } });
  await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k' }, fakeFetch([ok()], calls));
  expect(calls[0].url).toContain('/models/gemini-3.8-flash:generateContent');
  await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', GEMINI_TEMPERATURE: '0.2' }, fakeFetch([ok()], calls));
  expect(calls[1].body.generationConfig.temperature).toBe(0.2);
});

test('Gemini errors become clear Thai messages with the right status', async () => {
  const env = { GEMINI_API_KEY: 'k' };
  await expect(geminiProvider({ base64: 'QQ==', mime: 'image/png' }, {}, fakeFetch([]))).rejects.toMatchObject({ status: 503 });
  await expect(geminiProvider({ base64: 'QQ==', mime: 'image/png' }, env, fakeFetch([{ status: 429 }]))).rejects.toMatchObject({ status: 429, message: expect.stringContaining('โควตา') });
  await expect(geminiProvider({ base64: 'QQ==', mime: 'image/png' }, env, fakeFetch([{ status: 403 }]))).rejects.toThrow('คีย์');
  await expect(geminiProvider({ base64: 'QQ==', mime: 'image/png' }, env, fakeFetch([{ json: { candidates: [] } }]))).rejects.toThrow('ไม่ได้ตอบ');
});

test('Typhoon makes an OCR call with the image, then a structuring call with the OCR text', async () => {
  const calls = [];
  const f = fakeFetch([{ json: { choices: [{ message: { content: 'บิล OD-1 ...' } }] } }, { json: { choices: [{ message: { content: JSON.stringify(good) } }] } }], calls);
  const out = await typhoonProvider({ dataUrl: png }, { TYPHOON_API_KEY: 'tk' }, f);
  expect(out.raw.customerName).toBe('ทดสอบ หนึ่ง');
  expect(out.rawText).toBe('บิล OD-1 ...');
  expect(calls[0].init.headers.authorization).toBe('Bearer tk');
  expect(calls[0].body.messages[0].content[1].image_url.url).toBe(png);
  expect(calls[1].body.messages[1].content).toContain('บิล OD-1 ...');
});

test('runOcr validates the image, picks the provider and never leaks the key or the image', async () => {
  const f = fakeFetch([{ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } }]);
  const env = { OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'k-secret' };
  const out = await runOcr({ image: png }, env, f, NOW);
  expect(out.provider).toBe('gemini');
  expect(out.demo).toBe(false);
  expect(out.orderDate).toBe('2026-11-24');
  expect(JSON.stringify(out)).not.toContain('k-secret');
  expect(JSON.stringify(out)).not.toContain('iVBOR');
  await expect(runOcr({ image: 'data:text/plain;base64,QUJD' }, env, f)).rejects.toMatchObject({ status: 400 });
  await expect(runOcr({}, env, f)).rejects.toMatchObject({ status: 400 });
  await expect(runOcr({ image: `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}` }, env, f)).rejects.toMatchObject({ status: 413 });
  await expect(runOcr({ image: png }, { OCR_PROVIDER: 'nope' }, f)).rejects.toMatchObject({ status: 500 });
});

test('status reports whether the selected provider has its key; no provider means OCR is off', () => {
  expect(ocrStatus({})).toMatchObject({ provider: 'none', demo: false, configured: false, known: true });
  expect(ocrStatus({ OCR_PROVIDER: 'mock' })).toMatchObject({ demo: true, configured: true });
  expect(ocrStatus({ OCR_PROVIDER: 'gemini' })).toMatchObject({ configured: false });
  expect(ocrStatus({ OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' })).toMatchObject({ configured: true, demo: false });
});

test('Gemini retries when the model is busy (503), then falls back to the backup model', async () => {
  const ok = { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } };
  const env = { GEMINI_API_KEY: 'k', OCR_RETRY_DELAY_MS: '0' };
  let calls = [];
  const out = await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, env, fakeFetch([{ status: 503 }, { status: 503 }, ok], calls));
  expect(out.raw.billNumber).toBe('OD-1');
  expect(calls).toHaveLength(3);
  calls = [];
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, env, fakeFetch([{ status: 503 }, { status: 503 }, { status: 503 }], calls))).rejects.toMatchObject({ status: 503, message: expect.stringContaining('หนาแน่น') });
  expect(calls).toHaveLength(3);
  calls = [];
  await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { ...env, GEMINI_FALLBACK_MODEL: 'backup-m' }, fakeFetch([{ status: 503 }, { status: 503 }, { status: 503 }, ok], calls));
  expect(calls).toHaveLength(4);
  expect(calls[3].url).toContain('/models/backup-m:generateContent');
});

test('Gemini does not retry on errors that retrying cannot fix', async () => {
  const calls = [];
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', OCR_RETRY_DELAY_MS: '0' }, fakeFetch([{ status: 403 }], calls))).rejects.toMatchObject({ status: 502 });
  expect(calls).toHaveLength(1);
});

test('Gemini gives up within the time budget instead of hanging past the Vercel limit; the request carries an abort signal', async () => {
  const hang = calls => (url, init) => new Promise((_, reject) => { calls.push({ url }); init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
  let calls = [];
  const t0 = Date.now();
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', OCR_TIMEOUT_MS: '30', OCR_BUDGET_MS: '1200', GEMINI_FALLBACK_MODEL: 'backup-m' }, hang(calls)))
    .rejects.toMatchObject({ status: 504, message: expect.stringContaining('ช้าเกินไป') });
  expect(Date.now() - t0).toBeLessThan(1500);
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const ok = { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } };
  const seen = [];
  await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k' }, fakeFetch([ok], seen));
  expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
});

test('an OCR timeout still saves the order with the photo and reports the reason', async () => {
  const { handle } = await import('../server/router.js');
  const { fakeSupabase, URL_, ANON, NOW: now } = await import('./helpers/fakeSupabase.js');
  const sb = fakeSupabase();
  const slowGemini = async (url, init) => {
    if (String(url).includes('generativelanguage')) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return sb.fetchImpl(url, init);
  };
  const env = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', OCR_TIMEOUT_MS: '20', OCR_BUDGET_MS: '200', OCR_RETRY_DELAY_MS: '0' };
  const headers = { 'content-type': 'application/json', host: 'app.test' };
  const login = await handle({ method: 'POST', path: '/api/auth/login', headers, body: { email: 'staff@example.com', password: 'pw' }, env, fetchImpl: slowGemini, now });
  const cookie = login.cookies[0].split(';')[0];
  const out = await handle({ method: 'POST', path: '/api/orders', headers: { ...headers, cookie }, body: { image: png, branch: 'สยาม' }, env, fetchImpl: slowGemini, now });
  expect(out.status).toBe(201);
  expect(out.body.order.ocrStatus).toBe('failed');
  expect(out.body.ocrError).toContain('ช้าเกินไป');
  expect(sb.db.runs[0]).toMatchObject({ ok: false, http_status: 504 });
});

test('demo provider is refused unless explicitly allowed, and OCR can be switched off', async () => {
  await expect(runOcr({ image: png }, { OCR_PROVIDER: 'mock' }, fakeFetch([]))).rejects.toMatchObject({ status: 503, message: expect.stringContaining('สาธิต') });
  const out = await runOcr({ image: png }, { OCR_PROVIDER: 'mock', OCR_ALLOW_MOCK: '1' }, fakeFetch([]), NOW);
  expect(out.demo).toBe(true);
  expect(out.model).toBe('mock');
  await expect(runOcr({ image: png }, {}, fakeFetch([]))).rejects.toMatchObject({ status: 503 });
});
