#!/usr/bin/env node
// ตรวจว่าคีย์ใน .env ใช้งานได้ไหม (ไม่พิมพ์คีย์ออกหน้าจอ):  npm run check-keys
const env = process.env;
const say = (ok, name, msg) => { console.log(`${ok ? '✅' : '❌'} ${name}: ${msg}`); return ok; };
const short = s => String(s || '').replace(/\s+/g, ' ').slice(0, 220);

async function checkGemini() {
  const key = env.GEMINI_API_KEY;
  if (!key) return say(false, 'Gemini', 'ยังไม่ได้ใส่ GEMINI_API_KEY ในไฟล์ .env (ข้ามการตรวจ)');
  const model = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const base = 'https://generativelanguage.googleapis.com/v1beta';
  let res;
  try {
    res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ตอบสั้น ๆ ว่า OK' }] }] }),
    });
  } catch { return say(false, 'Gemini', 'ติดต่อ generativelanguage.googleapis.com ไม่ได้ (ตรวจอินเทอร์เน็ต/ไฟร์วอลล์)'); }
  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    const text = (body?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    return say(true, 'Gemini', `ใช้ได้ (รุ่น ${model}) ตอบกลับว่า "${short(text)}"`);
  }
  const e = body.error || {};
  const detail = `[${res.status} ${e.status || ''}] ${short(e.message)}`;
  if (e.status === 'ACCESS_TOKEN_TYPE_UNSUPPORTED') return say(false, 'Gemini', `คีย์ชนิดนี้ (AQ.) ใช้ไม่ได้กับบัญชี/โปรเจกต์นี้ ลองสร้างคีย์ผ่าน Google Cloud Console หรือใช้บัญชี/โปรเจกต์อื่น ${detail}`);
  if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(`${e.message} ${JSON.stringify(e.details || '')}`)) return say(false, 'Gemini', `คีย์ไม่ถูกต้อง (คัดลอกไม่ครบ มีช่องว่างปน หรือคีย์ถูกลบแล้ว?) ${detail}`);
  if (res.status === 401 || res.status === 403) return say(false, 'Gemini', `คีย์ถูกปฏิเสธ (ไม่มีสิทธิ์หรือถูกจำกัด) ${detail}`);
  if (res.status === 503) return say(true, 'Gemini', `คีย์และชื่อรุ่นถูกต้อง แต่ Google บอกว่ารุ่น ${model} มีผู้ใช้หนาแน่นชั่วคราว — รอสักครู่แล้วรันใหม่ หรือตั้ง GEMINI_FALLBACK_MODEL เป็นรุ่นสำรอง ${detail}`);
  if (res.status === 429) return say(false, 'Gemini', `คีย์ใช้ได้ แต่โควตาเต็มชั่วคราว รอสักพักแล้วลองใหม่ ${detail}`);
  if (res.status === 404) {
    say(false, 'Gemini', `ไม่พบรุ่น "${model}" ให้ตั้ง GEMINI_MODEL เป็นรุ่นอื่น ${detail}`);
    try {
      const list = await (await fetch(`${base}/models?pageSize=100`, { headers: { 'x-goog-api-key': key } })).json();
      const names = (list.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /flash/i.test(m.name)).map(m => m.name.replace('models/', ''));
      if (names.length) console.log(`   รุ่น Flash ที่ใช้ได้กับคีย์นี้: ${names.join(', ')}`);
    } catch { /* ไม่แสดงรายชื่อรุ่น */ }
    return false;
  }
  say(false, 'Gemini', detail);
}

async function checkTyphoon() {
  const key = env.TYPHOON_API_KEY;
  if (!key) return say(false, 'Typhoon', 'ยังไม่ได้ใส่ TYPHOON_API_KEY ในไฟล์ .env (ข้ามการตรวจ)');
  const base = (env.TYPHOON_BASE_URL || 'https://api.opentyphoon.ai/v1').replace(/\/$/, '');
  const model = env.TYPHOON_TEXT_MODEL || 'typhoon-v2.5-30b-a3b-instruct';
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ตอบสั้น ๆ ว่า OK' }], max_tokens: 10, temperature: 0 }),
    });
  } catch { return say(false, 'Typhoon', 'ติดต่อ api.opentyphoon.ai ไม่ได้ (ตรวจอินเทอร์เน็ต/ไฟร์วอลล์)'); }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return say(true, 'Typhoon', `ใช้ได้ (ตรวจด้วยโมเดลข้อความ ${model}) — ชื่อโมเดล OCR (${env.TYPHOON_OCR_MODEL || 'typhoon-ocr'}) ต้องเช็กในเอกสารเอง`);
  const detail = `[${res.status}] ${short(body?.error?.message || body?.message || JSON.stringify(body))}`;
  if (res.status === 401 || res.status === 403) return say(false, 'Typhoon', `คีย์ถูกปฏิเสธ ${detail}`);
  if (res.status === 429) return say(false, 'Typhoon', `คีย์ใช้ได้ แต่ติดโควตา ${detail}`);
  say(false, 'Typhoon', `${detail} (ถ้าเป็นเรื่องชื่อโมเดล ให้ตั้ง TYPHOON_TEXT_MODEL)`);
}

console.log('กำลังตรวจคีย์ใน .env ... (ไม่แสดงคีย์ออกหน้าจอ)\n');
const results = [await checkGemini(), await checkTyphoon()];
console.log(results.some(Boolean) ? '\nมีผู้ให้บริการที่ใช้ได้แล้ว ✅ ตั้ง OCR_PROVIDER ใน .env เป็นตัวที่ผ่าน แล้วรัน: npm run dev' : '\nยังไม่มีตัวที่ใช้ได้ ❌ แก้ตามข้อความด้านบนแล้วรัน npm run check-keys อีกครั้ง');
process.exitCode = results.some(Boolean) ? 0 : 1;
