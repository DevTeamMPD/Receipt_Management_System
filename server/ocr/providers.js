import { PROMPT, GEMINI_SCHEMA } from './schema.js';

export class OcrError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// ดึง JSON ก้อนแรกออกจากข้อความของโมเดล (กรณีมี ```json ครอบหรือมีคำอธิบายปน)
export function parseJsonLoose(textValue) {
  const s = String(textValue || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new OcrError('โมเดลตอบกลับในรูปแบบที่อ่านไม่ได้', 502);
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw new OcrError('โมเดลตอบกลับในรูปแบบที่อ่านไม่ได้', 502); }
}

const busyMessage = provider => `${provider} ไม่ว่าง (มีผู้ใช้งานหนาแน่น) เก็บรูปไว้แล้ว กดอ่านรูปใหม่ภายหลัง หรือกรอกข้อมูลจากรูปเอง`;
const quotaMessage = provider => `โควตา ${provider} เต็มชั่วคราว เก็บรูปไว้แล้ว กดอ่านรูปใหม่ภายหลัง หรือกรอกข้อมูลจากรูปเอง`;

function httpError(provider, status) {
  if (status === 429) return new OcrError(quotaMessage(provider), 429);
  if (status === 503 || status === 500) return new OcrError(busyMessage(provider), 503);
  if (status === 404) return new OcrError(`ไม่พบรุ่นโมเดลของ ${provider} ที่ตั้งไว้ (ตรวจ GEMINI_MODELS)`, 404);
  if (status === 401 || status === 403) return new OcrError(`คีย์ ${provider} ไม่ถูกต้องหรือไม่มีสิทธิ์`, 502);
  if (status === 400) return new OcrError(`${provider} ปฏิเสธคำขอ (รูปอาจใหญ่เกินไปหรือรุ่นโมเดลไม่ถูกต้อง)`, 502);
  return new OcrError(`${provider} ตอบกลับผิดพลาด (${status})`, 502);
}

// โหมดสาธิต: ไม่ได้อ่านรูปจริง คืนข้อมูลสมมติเพื่อทดลอง flow
export async function mockProvider({ base64 }) {
  const templates = [
    { docType: 'order_form', billNumber: 'OD-DEMO-A1', orderDateText: '24/11/69', customerName: 'ลูกค้าสาธิต หนึ่ง', phone: '0800000011', address: '10/1 ซอยสาธิต ถนนตัวอย่าง', subDistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postcode: '10260', shipDateText: '', items: [{ product: 'คอกกั้นเด็ก', size: 'L 6 ฟุต', color: 'ฟ้า' }], remark: '', total: '8900', posNumber: 'POS-DEMO-1', posTotal: '8900', uncertain: [] },
    { docType: 'order_form', billNumber: 'OD-DEMO-B2', orderDateText: '24/11/2569', customerName: 'ลูกค้าสาธิต สอง', phone: '08100002', address: '22 ซอยสาธิต 2', subDistrict: 'ลาดพร้าว', district: 'ลาดพร้าว', province: 'กรุงเทพมหานคร', postcode: '1023', shipDateText: '28/11/69', items: [{ product: 'ตู้ Tidy 3 ตอน', size: '', color: 'ขาว' }, { product: 'เก้าอี้เปลไกว 2in1', size: '', color: 'น้ำตาล' }], remark: 'โทรก่อนส่ง', total: '5,490', posNumber: 'POS-DEMO-2', posTotal: '5190', uncertain: ['phone', 'postcode'] },
    { docType: 'order_form', billNumber: 'OD-DEMO-C3', orderDateText: '25/11/69', customerName: 'ลูกค้าสาธิต สาม', phone: '0800000033', address: '5 ซอยสาธิต 3', subDistrict: 'สวนใหญ่', district: 'เมืองนนทบุรี', province: 'นนทบุรี', postcode: '11000', shipDateText: '', items: [], remark: '', total: '1290', posNumber: '', posTotal: '', uncertain: ['address'] },
  ];
  const raw = templates[base64.length % templates.length];
  return { raw, rawText: JSON.stringify(raw, null, 2), model: 'mock' };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// งบเวลา: Vercel ตัดฟังก์ชันที่ 60 วินาที จึงต้องเลิกรอโมเดลก่อนถึงตอนนั้น แล้วเก็บรูปไว้ให้คนกรอกเอง
// OCR_BUDGET_MS = รวมทุกคำขอ/ทุกรุ่น (ค่าเริ่มต้น 48 วิ — เหลือเวลาให้บันทึกรูปและข้อมูล)
// OCR_TIMEOUT_MS = เพดานต่อหนึ่งคำขอ (ค่าเริ่มต้น = ทั้งงบ) Gemini อ่านใบจริงใช้ราว 25–35 วิ ตัดที่ 20 วิจะไม่มีวันสำเร็จ
const slowMessage = provider => `${provider} ตอบช้าเกินไป เก็บรูปไว้แล้ว กรอกข้อมูลจากรูปเอง หรือลองใหม่ภายหลัง`;
function budget(env) {
  const total = Number(env.OCR_BUDGET_MS ?? 48_000);
  const perCall = Number(env.OCR_TIMEOUT_MS ?? total);
  const deadline = Date.now() + total;
  return {
    // reserveMs = เวลาที่กันไว้ให้รุ่นถัดไป (รุ่นแรกช้า/ค้าง ต้องไม่กินเวลาจนรุ่นสำรองไม่ได้ลอง)
    signal(provider, reserveMs = 0) {
      const left = deadline - Date.now();
      if (left < 1000) throw new OcrError(slowMessage(provider), 504);
      const cap = Math.min(perCall, left);
      return AbortSignal.timeout(Math.max(Math.min(cap, 1000), cap - reserveMs));
    },
    hasTimeFor(ms) { return deadline - Date.now() > ms + 1000; },
  };
}
async function fetchWithin(fetchImpl, provider, b, url, init, reserveMs = 0) {
  try { return await fetchImpl(url, { ...init, signal: b.signal(provider, reserveMs) }); } catch (e) {
    if (e instanceof OcrError) throw e;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new OcrError(slowMessage(provider), 504);
    throw new OcrError(`ติดต่อ ${provider} ไม่ได้ (${e?.code || e?.name || 'network'})`, 502);
  }
}

// การ "คิด" ของ Gemini 3 กินเวลาส่วนใหญ่ แต่งานดึงข้อมูลจากใบไม่ต้องคิดลึก จึงตั้ง low เป็นค่าเริ่มต้น
// GEMINI_THINKING_LEVEL = minimal | low | medium | high | default (default = ไม่ส่ง ใช้ค่าของรุ่น)
function thinkingConfig(env) {
  const level = String(env.GEMINI_THINKING_LEVEL || 'low').trim().toLowerCase();
  return level === 'default' ? null : { thinkingLevel: level };
}

// ยิงรุ่นเดียวครั้งเดียว (ไม่ลองซ้ำรุ่นเดิม — รุ่นที่ไม่ว่างมักไม่ว่างต่อ ข้ามไปรุ่นถัดไปเร็วกว่า)
// ถ้ารุ่นไม่รองรับการตั้งระดับการคิด (400) ลองใหม่หนึ่งครั้งโดยไม่ส่งค่านั้น
async function geminiCall(model, { base64, mime }, env, fetchImpl, b, reserveMs) {
  let thinking = thinkingConfig(env);
  for (;;) {
    const t0 = Date.now();
    const res = await fetchWithin(fetchImpl, 'Gemini', b, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
        // ไม่ส่ง temperature เป็นค่าเริ่มต้น (รุ่น Gemini 3 ขึ้นไปแนะนำให้ใช้ค่ามาตรฐาน) ตั้ง GEMINI_TEMPERATURE ได้ถ้าต้องการ
        generationConfig: {
          responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA,
          ...(env.GEMINI_TEMPERATURE ? { temperature: Number(env.GEMINI_TEMPERATURE) } : {}),
          ...(thinking ? { thinkingConfig: thinking } : {}),
        },
      }),
    }, reserveMs).catch(e => { console.warn('ocr gemini', JSON.stringify({ model, ms: Date.now() - t0, error: e.status })); throw e; });
    // บันทึกเฉพาะรุ่น/สถานะ/เวลา (ไม่มีข้อมูลลูกค้า) ไว้ดูใน Vercel logs ว่าช้าหรือล้มที่ขั้นไหน
    console.info('ocr gemini', JSON.stringify({ model, status: res.status, ms: Date.now() - t0, thinking: thinking?.thinkingLevel || 'default' }));
    if (res.ok) return res;
    if (res.status === 400 && thinking) { thinking = null; continue; }
    throw httpError('Gemini', res.status);
  }
}

// ลำดับรุ่นที่ลอง: GEMINI_MODELS (คั่นด้วยจุลภาค) ทับทั้งชุดได้ · ไม่ตั้ง = GEMINI_MODEL แล้ว GEMINI_FALLBACK_MODEL
// Flash-Lite เป็นค่าเริ่มต้น: รุ่น Flash ตัวใหม่มักตอบ 503 (ผู้ใช้หนาแน่น) ส่วน Flash-Lite ตอบใน ~2 วินาที
export function geminiModels(env) {
  const list = env.GEMINI_MODELS ? String(env.GEMINI_MODELS).split(',') : [env.GEMINI_MODEL || 'gemini-flash-lite-latest', env.GEMINI_FALLBACK_MODEL];
  return [...new Set(list.map(m => String(m || '').trim()).filter(Boolean))];
}

// สถานะที่ "ลองรุ่นอื่นแล้วอาจได้": ไม่ว่าง (503) · โควตาเต็ม (429) · ไม่มีรุ่นนี้ (404) · รอนานเกิน (504)
const SKIPPABLE = new Set([503, 429, 404, 504]);

// เลือกข้อความที่บอกสาเหตุจริงเมื่อทุกรุ่นล้ม — เคยขึ้น "ตอบช้าเกินไป" ทั้งที่จริงคือทุกรุ่นตอบ 503
function finalError(errors) {
  const has = s => errors.some(e => e.status === s);
  if (has(429)) return new OcrError(quotaMessage('Gemini'), 429);
  if (has(503)) return new OcrError(busyMessage('Gemini'), 503);
  return errors[errors.length - 1];
}

export async function geminiProvider({ base64, mime }, env, fetchImpl = fetch) {
  if (!env.GEMINI_API_KEY) throw new OcrError('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในเซิร์ฟเวอร์', 503);
  const models = geminiModels(env);
  const b = budget(env);
  const errors = [];
  // ไล่ทุกรุ่นหนึ่งรอบ ถ้าทุกรุ่นแค่ไม่ว่าง/โควตาเต็ม และยังมีเวลา ลองอีกรอบหลังหน่วงสั้น ๆ
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [i, model] of models.entries()) {
      if (!b.hasTimeFor(0)) break;
      // รุ่นที่ไม่ใช่ตัวสุดท้าย: กันเวลาไว้ให้รุ่นสำรอง (ค่าเริ่มต้น 12 วิ — Flash-Lite อ่านใบจริง ~2 วิ)
      const reserve = i < models.length - 1 ? Number(env.OCR_FALLBACK_RESERVE_MS ?? 12_000) : 0;
      try {
        const res = await geminiCall(model, { base64, mime }, env, fetchImpl, b, reserve);
        const data = await res.json();
        const out = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        if (!out) throw new OcrError('Gemini ไม่ได้ตอบข้อมูลกลับมา (รูปอาจไม่ชัดหรือถูกกรอง)', 502);
        // fallback = ตอบโดยรุ่นสำรอง (รุ่นที่ไม่ใช่ตัวแรก) — อ่านลายมือ/ช่องติ๊กแม่นน้อยกว่า ให้คนตรวจช่องลายมือทุกช่อง
        return { raw: parseJsonLoose(out), rawText: out, model, fallback: i > 0 };
      } catch (e) {
        if (!(e instanceof OcrError) || !SKIPPABLE.has(e.status)) throw e;
        errors.push(e);
      }
    }
    // เฉพาะ "ไม่ว่าง" ที่รอแป๊บเดียวแล้วอาจหาย — โควตาเต็ม/ไม่มีรุ่น/ช้าเกิน ลองซ้ำไปก็ไม่ช่วย
    const retryable = errors.length && errors.every(e => e.status === 503);
    const delay = Number(env.OCR_RETRY_DELAY_MS ?? 1500);
    if (pass > 0 || !retryable || !b.hasTimeFor(delay + 5000)) break;
    await sleep(delay);
  }
  throw errors.length ? finalError(errors) : new OcrError(slowMessage('Gemini'), 504);
}

// Typhoon ขั้นจัดโครงสร้างบางครั้งตอบ docType เป็นภาษาไทย ("ใบส่งซื้อสินค้า") และตัดชื่อ Bebeplay ออกจากหัวกระดาษ
// (เจอจากการลองกับ API จริง 27 พ.ย. 2569) → ตัดสินสองช่องนี้จากข้อความ OCR ดิบอีกชั้น ไม่งั้นตัวกรอง LINE ทิ้งใบจริง
const DOC_TYPES = ['order_form', 'receipt_only', 'other'];
const squash = v => String(v || '').toLowerCase().replace(/[\s\u200b.\-_]/g, '');
const BRAND = /(bebeplay|เบเบ้เพลย์|บีบีเพลย์)/;
const ORDER_HEAD = /ใบ\s*(?:ส่ง|สั่ง)\s*ซื้อ(?:\s*สินค้า)?/;
export function fixTyphoonFields(raw, ocrText) {
  const r = { ...(raw || {}) };
  const text = String(ocrText || '').replace(/<[^>]+>/g, ' ');
  const head = text.slice(0, 600);
  const headTitle = ORDER_HEAD.exec(head)?.[0].replace(/\s+/g, '');
  if (!DOC_TYPES.includes(r.docType)) {
    const d = `${r.docType || ''}`;
    r.docType = ORDER_HEAD.test(d) || headTitle ? 'order_form' : /ใบเสร็จ|receipt/i.test(d) ? 'receipt_only' : 'other';
  } else if (r.docType !== 'order_form' && headTitle) r.docType = 'order_form';
  const title = squash(r.formTitle);
  if (headTitle && BRAND.test(squash(head)) && !(BRAND.test(title) && /ใบ(ส่ง|สั่ง)ซื้อ/.test(title))) {
    r.formTitle = `${headTitle} Bebeplay`;
  }
  return r;
}

// Typhoon OCR คืนเป็นข้อความ (มีตาราง HTML + ☑/☐) จึงต้องมีขั้นที่สองเพื่อดึงฟิลด์
// ขั้นที่สองใช้ json_object (ลองแล้วเร็วสุด ~2 วิ และไม่ห่อข้อความ)
export async function typhoonProvider({ dataUrl }, env, fetchImpl = fetch) {
  const key = env.TYPHOON_API_KEY;
  if (!key) throw new OcrError('ยังไม่ได้ตั้งค่า TYPHOON_API_KEY ในเซิร์ฟเวอร์', 503);
  const base = (env.TYPHOON_BASE_URL || 'https://api.opentyphoon.ai/v1').replace(/\/$/, '');
  const b = budget(env);
  const call = async body => {
    const res = await fetchWithin(fetchImpl, 'Typhoon', b, `${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    if (!res.ok) throw httpError('Typhoon', res.status);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || '';
  };
  const ocrText = await call({
    model: env.TYPHOON_OCR_MODEL || 'typhoon-ocr',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Extract all text from this image in reading order. Keep handwriting and printed text.' }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    max_tokens: 4096, temperature: 0,
  });
  if (!ocrText) throw new OcrError('Typhoon ไม่ได้ตอบข้อมูลกลับมา', 502);
  const structured = await call({
    model: env.TYPHOON_TEXT_MODEL || 'typhoon-v2.5-30b-a3b-instruct',
    messages: [{ role: 'system', content: PROMPT }, { role: 'user', content: `Text read from the photo by OCR:\n\n${ocrText}` }],
    response_format: { type: 'json_object' }, max_tokens: 2048, temperature: 0,
  });
  return { raw: fixTyphoonFields(parseJsonLoose(structured), ocrText), rawText: ocrText, model: env.TYPHOON_OCR_MODEL || 'typhoon-ocr' };
}

export const providers = { mock: mockProvider, gemini: geminiProvider, typhoon: typhoonProvider };
