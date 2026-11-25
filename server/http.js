import { handle } from './router.js';

const readJson = req => new Promise((resolve, reject) => {
  if (req.body !== undefined) { // Vercel แปลง JSON ให้แล้ว
    resolve(typeof req.body === 'string' ? (req.body ? JSON.parse(req.body) : undefined) : req.body);
    return;
  }
  const chunks = [];
  let size = 0;
  req.on('data', c => { size += c.length; if (size > 12 * 1024 * 1024) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on('end', () => { try { const t = Buffer.concat(chunks).toString('utf8'); resolve(t ? JSON.parse(t) : undefined); } catch (e) { reject(Object.assign(e, { status: 400 })); } });
  req.on('error', reject);
});

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
      let body;
      if (req.method !== 'GET') body = await readJson(req);
      const out = await handle({ method: req.method, path: url.pathname, headers: req.headers, body, env });
      send(out.status, out.body, out.cookies);
    } catch (e) {
      send(e.status === 413 ? 413 : 400, { error: e.status === 413 ? 'ข้อมูลใหญ่เกินไป' : 'ข้อมูลที่ส่งมาไม่ถูกต้อง' });
    }
  };
}
