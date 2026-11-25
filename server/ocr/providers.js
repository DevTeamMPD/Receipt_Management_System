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
  return { raw, rawText: JSON.stringify(raw, null, 2) };
}

export async function geminiProvider({ base64, mime }, env, fetchImpl = fetch) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new OcrError('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ในเซิร์ฟเวอร์', 503);
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA, temperature: 0 },
    }),
  });
  if (!res.ok) throw httpError('Gemini', res.status);
  const data = await res.json();
  const out = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!out) throw new OcrError('Gemini ไม่ได้ตอบข้อมูลกลับมา (รูปอาจไม่ชัดหรือถูกกรอง)', 502);
  return { raw: parseJsonLoose(out), rawText: out };
}

// Typhoon OCR คืนเป็นข้อความ จึงต้องมีขั้นที่สองเพื่อดึงฟิลด์ (ยังไม่ได้ทดสอบกับ API จริง)
export async function typhoonProvider({ dataUrl }, env, fetchImpl = fetch) {
  const key = env.TYPHOON_API_KEY;
  if (!key) throw new OcrError('ยังไม่ได้ตั้งค่า TYPHOON_API_KEY ในเซิร์ฟเวอร์', 503);
  const base = (env.TYPHOON_BASE_URL || 'https://api.opentyphoon.ai/v1').replace(/\/$/, '');
  const call = async body => {
    const res = await fetchImpl(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
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
  return { raw: parseJsonLoose(structured), rawText: ocrText };
}

export const providers = { mock: mockProvider, gemini: geminiProvider, typhoon: typhoonProvider };
