import { test, expect } from '@playwright/test';
import { parseDateText, parseAmount, parsePhone, normalizeExtraction } from '../server/ocr/normalize.js';
import { geminiModels, geminiProvider, typhoonProvider, parseJsonLoose, OcrError } from '../server/ocr/providers.js';
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
  // ชื่อเดือนไทย (เคสจริง: โมเดลคืน "13, พ.ค. 69" แล้วช่องวันที่ว่าง)
  expect(parseDateText('13, พ.ค. 69', NOW)).toBe('2026-05-13');
  expect(parseDateText('13 พ.ค. 69', NOW)).toBe('2026-05-13');
  expect(parseDateText('13/พ.ค./69', NOW)).toBe('2026-05-13');
  expect(parseDateText('1 มกราคม 2569', NOW)).toBe('2026-01-01');
  expect(parseDateText('3 ธค 68', NOW)).toBe('2025-12-03');
  expect(parseDateText('13 ไม่ใช่เดือน 69', NOW)).toBe('');
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
  expect(calls[0].url).toContain('/models/gemini-flash-lite-latest:generateContent');
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

test('Gemini skips a busy/missing model to the next one right away, and gives the busy pass one more try', async () => {
  const ok = { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } };
  const env = { GEMINI_API_KEY: 'k', OCR_RETRY_DELAY_MS: '0' };
  let calls = [];
  // รุ่นเดียว: ไม่ว่าง → รออีกรอบ → สำเร็จ
  let out = await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, env, fakeFetch([{ status: 503 }, ok], calls));
  expect(out.raw.billNumber).toBe('OD-1');
  expect(calls).toHaveLength(2);
  // ไม่ว่างทั้งสองรอบ → ข้อความบอกว่าไม่ว่าง (ไม่ใช่ "ตอบช้า")
  calls = [];
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, env, fakeFetch([{ status: 503 }, { status: 503 }], calls))).rejects.toMatchObject({ status: 503, message: expect.stringContaining('ไม่ว่าง') });
  expect(calls).toHaveLength(2);
  // หลายรุ่น: รุ่นแรกไม่ว่าง/ไม่มี → ไปรุ่นถัดไปทันที ไม่ลองรุ่นเดิมซ้ำ · ผลบอกรุ่นที่ตอบจริง
  for (const first of [503, 404, 429]) {
    calls = [];
    out = await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { ...env, GEMINI_MODELS: 'big-m, lite-m' }, fakeFetch([{ status: first }, ok], calls));
    expect(calls.map(c => c.url.match(/models\/([^:]+)/)[1])).toEqual(['big-m', 'lite-m']);
    expect(out.model).toBe('lite-m');
  }
  // ไม่ตั้ง GEMINI_MODELS = GEMINI_MODEL แล้ว GEMINI_FALLBACK_MODEL (ไม่ซ้ำ)
  expect(geminiModels({ GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODEL: 'b' })).toEqual(['a', 'b']);
  expect(geminiModels({ GEMINI_MODEL: 'a', GEMINI_FALLBACK_MODEL: 'a' })).toEqual(['a']);
  expect(geminiModels({ GEMINI_MODELS: ' x , y ,,x', GEMINI_MODEL: 'a' })).toEqual(['x', 'y']);
  expect(geminiModels({})).toEqual(['gemini-flash-lite-latest']);
});

test('a slow first model is cut off early enough that the backup still gets its turn', async () => {
  const ok = { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } };
  const seen = [];
  const f = (url, init) => {
    seen.push(url);
    if (url.includes('slow-m')) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return Promise.resolve({ ok: true, status: 200, json: async () => ok.json });
  };
  const t0 = Date.now();
  const out = await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', GEMINI_MODELS: 'slow-m,lite-m', OCR_BUDGET_MS: '2500', OCR_FALLBACK_RESERVE_MS: '1500' }, f);
  expect(out.model).toBe('lite-m');
  expect(Date.now() - t0).toBeLessThan(2000);
});

test('Gemini does not retry on errors that retrying cannot fix', async () => {
  const calls = [];
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', OCR_RETRY_DELAY_MS: '0' }, fakeFetch([{ status: 403 }], calls))).rejects.toMatchObject({ status: 502 });
  expect(calls).toHaveLength(1);
});

test('Gemini asks for low thinking by default (fast enough for extraction) and drops it if the model rejects it', async () => {
  const ok = { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } };
  const cfg = call => JSON.parse(call.init.body).generationConfig;
  let calls = [];
  await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k' }, fakeFetch([ok], calls));
  expect(cfg(calls[0]).thinkingConfig).toEqual({ thinkingLevel: 'low' });
  calls = [];
  await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', GEMINI_THINKING_LEVEL: 'default' }, fakeFetch([ok], calls));
  expect(cfg(calls[0]).thinkingConfig).toBeUndefined();
  calls = [];
  const out = await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k' }, fakeFetch([{ status: 400 }, ok], calls));
  expect(out.raw.billNumber).toBe('OD-1');
  expect(calls).toHaveLength(2);
  expect(cfg(calls[1]).thinkingConfig).toBeUndefined();
  calls = [];
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k' }, fakeFetch([{ status: 400 }, { status: 400 }], calls))).rejects.toMatchObject({ status: 502 });
  expect(calls).toHaveLength(2);
});

test('without OCR_TIMEOUT_MS one Gemini call may use the whole budget (real reads take 25–35s, more than the old 20s cap)', async () => {
  const ok = { json: { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] } };
  const slowOk = (url, init) => new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve({ ok: true, status: 200, json: async () => ok.json }), 300);
    init.signal.addEventListener('abort', () => { clearTimeout(t); reject(init.signal.reason); });
  });
  const out = await geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', OCR_BUDGET_MS: '2000' }, slowOk);
  expect(out.raw.billNumber).toBe('OD-1');
  await expect(geminiProvider({ base64: 'QUJD', mime: 'image/png' }, { GEMINI_API_KEY: 'k', OCR_BUDGET_MS: '2000', OCR_TIMEOUT_MS: '100' }, slowOk)).rejects.toMatchObject({ status: 504 });
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

test('retry OCR fills only the blank fields of a failed order, keeps what staff typed, and logs the run', async () => {
  const { handle } = await import('../server/router.js');
  const { fakeSupabase, URL_, ANON, NOW: now } = await import('./helpers/fakeSupabase.js');
  const sb = fakeSupabase();
  let geminiUp = false;
  const ok = { candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] };
  const f = async (url, init) => {
    if (String(url).includes('generativelanguage')) return geminiUp ? { ok: true, status: 200, json: async () => ok } : { ok: false, status: 503, json: async () => ({}) };
    return sb.fetchImpl(url, init);
  };
  const env = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', OCR_RETRY_DELAY_MS: '0' };
  const headers = { 'content-type': 'application/json', host: 'app.test' };
  const login = await handle({ method: 'POST', path: '/api/auth/login', headers, body: { email: 'staff@example.com', password: 'pw' }, env, fetchImpl: f, now });
  const h = { ...headers, cookie: login.cookies[0].split(';')[0] };
  const call = (method, path, body) => handle({ method, path, headers: h, body, env, fetchImpl: f, now });

  const created = await call('POST', '/api/orders', { image: png, branch: 'สยาม' });
  expect(created.body.order.ocrStatus).toBe('failed');
  expect(created.body.ocrError).toContain('ไม่ว่าง');
  const id = created.body.order.id;
  const saved = await call('PATCH', `/api/orders/${id}`, { version: created.body.order.version, fields: { customerName: 'พิมพ์เอง' } });

  // Gemini ยังไม่ว่าง → บอกเหตุผล ใบไม่เปลี่ยน
  let r = await call('POST', `/api/orders/${id}/ocr`, { version: saved.body.version });
  expect(r.status).toBe(200);
  expect(r.body.ocrError).toContain('ไม่ว่าง');
  expect(r.body.order.ocrStatus).toBe('failed');

  geminiUp = true;
  r = await call('POST', `/api/orders/${id}/ocr`, { version: saved.body.version });
  expect(r.status).toBe(200);
  expect(r.body.ocrError).toBe('');
  expect(r.body.order).toMatchObject({ ocrStatus: 'done', customerName: 'พิมพ์เอง', billNumber: good.billNumber, phone: '0812345678' });
  expect(r.body.order.items.length).toBe(good.items.length);
  expect(sb.db.runs.map(x => x.ok)).toEqual([false, false, true]);
  expect(sb.db.events.filter(e => e.action === 'ocr_retried').map(e => e.details.ok)).toEqual([false, true]);

  // อ่านสำเร็จแล้วกดซ้ำไม่ได้ · เวอร์ชันเก่าถูกปฏิเสธ
  expect((await call('POST', `/api/orders/${id}/ocr`, { version: r.body.order.version })).status).toBe(409);
  expect((await call('POST', `/api/orders/${id}/ocr`, { version: 1 })).status).toBe(409);
});

test('demo provider is refused unless explicitly allowed, and OCR can be switched off', async () => {
  await expect(runOcr({ image: png }, { OCR_PROVIDER: 'mock' }, fakeFetch([]))).rejects.toMatchObject({ status: 503, message: expect.stringContaining('สาธิต') });
  const out = await runOcr({ image: png }, { OCR_PROVIDER: 'mock', OCR_ALLOW_MOCK: '1' }, fakeFetch([]), NOW);
  expect(out.demo).toBe(true);
  expect(out.model).toBe('mock');
  await expect(runOcr({ image: png }, {}, fakeFetch([]))).rejects.toMatchObject({ status: 503 });
});
