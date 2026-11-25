import { nodeHandler } from './http.js';

// API ตอน dev: ใช้ตรรกะเดียวกับที่รันบน Vercel (ดู api/index.js) คีย์อยู่ใน env ของเซิร์ฟเวอร์เท่านั้น
export function apiPlugin(env) {
  return {
    name: 'receipt-desk-api',
    configureServer(server) { server.middlewares.use('/api', nodeHandler(env)); },
  };
}
