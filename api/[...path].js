import { nodeHandler } from '../server/http.js';

// Vercel Function: จัดการทุกเส้นทาง /api/* (ตั้งค่า env ใน Vercel — ดู README)
export default nodeHandler(process.env);
