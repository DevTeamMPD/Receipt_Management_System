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

function httpError(provider, status) {
  if (status === 429) return new OcrError(`โควตา ${provider} เต็มชั่วคราว ลองใหม่ภายหลังหรือให้คนพิมพ์เอง`, 429);
  if (status === 503) return new OcrError(`${provider} กำลังมีผู้ใช้งานหนาแน่น ลองใหม่อีกครั้งในอีกสักครู่ หรือให้คนพิมพ์เอง`, 503);
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
// OCR_TIMEOUT_MS = รอต่อหนึ่งคำขอ (ค่าเริ่มต้น 20 วิ), OCR_BUDGET_MS = รวมทุกคำขอ/ทุกรุ่น (ค่าเริ่มต้น 40 วิ)
const slowMessage = provider => `${provider} ตอบช้าเกินไป เก็บรูปไว้แล้ว กรอกข้อมูลจากรูปเอง หรือลองใหม่ภายหลัง`;
function budget(env) {
  const perCall = Number(env.OCR_TIMEOUT_MS ?? 20_000);
  const deadline = Date.now() + Number(env.OCR_BUDGET_MS ?? 40_000);
  return {
    signal(provider) {
      const left = deadline - Date.now();
      if (left < 1000) throw new OcrError(slowMessage(provider), 504);
      return AbortSignal.timeout(Math.min(perCall, left));
    },
    hasTimeFor(ms) { return deadline - Date.now() > ms + 1000; },
  };
}
async function fetchWithin(fetchImpl, provider, b, url, init) {
  try { return await fetchImpl(url, { ...init, signal: b.signal(provider) }); } catch (e) {
    if (e instanceof OcrError) throw e;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new OcrError(slowMessage(provider), 504);
    throw new OcrError(`ติดต่อ ${provider} ไม่ได้ (${e?.code || e?.name || 'network'})`, 502);
  }
}

// เรียกครั้งเดียวต่อหนึ่งรุ่น; ถ้า Google ตอบ 503 (ผู้ใช้หนาแน่น) หรือ 500 ลองใหม่สูงสุด 3 ครั้งแบบหน่วงเวลา
async function geminiCall(model, { base64, mime }, env, fetchImpl, b) {
  const delays = [Number(env.OCR_RETRY_DELAY_MS ?? 1000), Number(env.OCR_RETRY_DELAY_MS ?? 1000) * 2.5];
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetchWithin(fetchImpl, 'Gemini', b, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
        // ไม่ส่ง temperature เป็นค่าเริ่มต้น (รุ่น Gemini 3 ขึ้นไปแนะนำให้ใช้ค่ามาตรฐาน) ตั้ง GEMINI_TEMPERATURE ได้ถ้าต้องการ
        generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, ...(env.GEMINI_TEMPERATURE ? { temperature: Number(env.GEMINI_TEMPERATURE) } : {}) },
      }),
    });
    if (res.ok) return res;
    if ((res.status === 503 || res.status === 500) && attempt < delays.length && b.hasTimeFor(delays[attempt])) { await sleep(delays[attempt]); continue; }
    throw httpError('Gemini', res.status);
  }
}

export async function geminiProvider({ base64, mime }, env, fetchImpl = fetch) {
  if (!env.GEMINI_API_KEY) throw new OcrError('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในเซิร์ฟเวอร์', 503);
  const models = [env.GEMINI_MODEL || 'gemini-3.8-flash', env.GEMINI_FALLBACK_MODEL].filter(Boolean);
  const b = budget(env);
  let res;
  let used = models[0];
  for (const [i, model] of models.entries()) {
    try { res = await geminiCall(model, { base64, mime }, env, fetchImpl, b); used = model; break; }
    catch (e) { if (i === models.length - 1 || !(e instanceof OcrError) || ![503, 429, 504].includes(e.status) || !b.hasTimeFor(0)) throw e; /* ลองรุ่นสำรองถ้ายังมีเวลา */ }
  }
  const data = await res.json();
  const out = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!out) throw new OcrError('Gemini ไม่ได้ตอบข้อมูลกลับมา (รูปอาจไม่ชัดหรือถูกกรอง)', 502);
  return { raw: parseJsonLoose(out), rawText: out, model: used };
}

// Typhoon OCR คืนเป็นข้อความ จึงต้องมีขั้นที่สองเพื่อดึงฟิลด์ (ยังไม่ได้ทดสอบกับ API จริง)
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
    temperature: 0,
  });
  return { raw: parseJsonLoose(structured), rawText: ocrText, model: env.TYPHOON_OCR_MODEL || 'typhoon-ocr' };
}

export const providers = { mock: mockProvider, gemini: geminiProvider, typhoon: typhoonProvider };
