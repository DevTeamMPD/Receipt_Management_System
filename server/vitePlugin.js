import { ocrStatus, runOcr } from './ocr/handler.js';
import { OcrError } from './ocr/providers.js';

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) { reject(new OcrError('รูปใหญ่เกินไป', 413)); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new OcrError('ข้อมูลที่ส่งมาไม่ถูกต้อง', 400)); } });
  req.on('error', reject);
});

const send = (res, status, data) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(data)); };

// API ฝั่งเซิร์ฟเวอร์สำหรับตอน dev: คีย์ผู้ให้บริการอยู่ใน env ของเซิร์ฟเวอร์เท่านั้น ไม่ถูกส่งไปที่เบราว์เซอร์
// ตอนขึ้นระบบจริงให้ย้ายตรรกะใน server/ocr ไปไว้ใน Edge Function (ดู README)
export function ocrPlugin(env) {
  return {
    name: 'receipt-desk-ocr',
    configureServer(server) {
      server.middlewares.use('/api/ocr/status', (req, res) => send(res, 200, ocrStatus(env)));
      server.middlewares.use('/api/ocr', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ได้เฉพาะ POST' });
        try { send(res, 200, await runOcr(await readBody(req), env)); }
        catch (e) { send(res, e instanceof OcrError ? e.status : 500, { error: e instanceof OcrError ? e.message : 'อ่านรูปไม่สำเร็จ' }); }
      });
    },
  };
}
