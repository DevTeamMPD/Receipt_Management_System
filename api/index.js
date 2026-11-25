import { nodeHandler } from '../server/http.js';

// Vercel Function เดียวรับทุกเส้นทาง /api/* (vercel.json rewrite /api/(.*) มาที่นี่ — คำขอยังเห็น URL เดิม) ตั้งค่า env ใน Vercel — ดู README
export default nodeHandler(process.env);
