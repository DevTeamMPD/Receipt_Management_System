import { waitUntil } from '@vercel/functions';
import { handle } from './router.js';
import { handleLineWebhook } from './lineIngest.js';

const LINE_WEBHOOK = '/api/line/webhook';

// ไบต์ดิบของ body — webhook ของ LINE ต้องตรวจลายเซ็นจากไบต์จริง (ตั้ง NODEJS_HELPERS=0 บน Vercel ให้ body ไม่ถูกแปลงก่อน)
const readRaw = req => new Promise((resolve, reject) => {
  if (Buffer.isBuffer(req.body)) { resolve(req.body); return; }
  if (typeof req.body === 'string') { resolve(Buffer.from(req.body)); return; }
  if (req.body !== undefined) { resolve(null); return; } // ถูกแปลงเป็นออบเจกต์แล้ว ไม่มีไบต์ดิบ
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const readJson = async req => {
  if (req.body !== undefined && !Buffer.isBuffer(req.body) && typeof req.body !== 'string') return req.body; // Vercel แปลง JSON ให้แล้ว
  const raw = await readRaw(req);
  try { const t = raw ? raw.toString('utf8') : ''; return t ? JSON.parse(t) : undefined; } catch (e) { throw Object.assign(e, { status: 400 }); }
};

// งานที่ทำต่อหลังตอบแล้ว (OCR ของรูปจาก LINE) — บน Vercel ใช้ waitUntil ให้ฟังก์ชันไม่ถูกปิดก่อนงานเสร็จ
const defer = p => {
  const tracked = Promise.resolve(p).catch(e => console.error('background task failed', e?.message || e));
  try { waitUntil(tracked); } catch { /* นอก Vercel: ปล่อยให้ทำงานต่อเอง */ }
  return tracked;
};

// อะแดปเตอร์ Node (req, res) → ใช้ได้ทั้ง Vite middleware และ Vercel function
export function nodeHandler(env) {
  return async (req, res) => {
    const send = (status, body, cookies = []) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      if (cookies.length) res.setHeader('set-cookie', cookies);
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.originalUrl || req.url, 'http://local');
      if (req.method === 'POST' && url.pathname === LINE_WEBHOOK) {
        const raw = await readRaw(req);
        if (!raw) { console.error('LINE webhook: raw body unavailable — set NODEJS_HELPERS=0'); send(500, { error: 'raw body unavailable' }); return; }
        const out = await handleLineWebhook({ rawBody: raw, headers: req.headers, env, defer });
        send(out.status, out.body);
        return;
      }
      let body;
      if (req.method !== 'GET') body = await readJson(req);
      const out = await handle({ method: req.method, path: url.pathname, headers: req.headers, body, env, defer });
      send(out.status, out.body, out.cookies);
    } catch (e) {
      send(e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'ข้อมูลที่ส่งมาไม่ถูกต้อง' });
    }
  };
}
