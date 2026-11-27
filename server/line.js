import { createHmac, timingSafeEqual } from 'node:crypto';

// ติดต่อ LINE Messaging API (บอทเงียบ — อ่านอย่างเดียว ไม่ส่งข้อความเข้ากลุ่ม)
const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

export class LineError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export const lineConfigured = env => !!(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN);

// LINE เซ็น body ดิบด้วย channel secret (HMAC-SHA256, base64) — ต้องตรวจจากไบต์จริง ห้ามตรวจจาก JSON ที่แปลงแล้ว
export function verifyLineSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let given;
  try { given = Buffer.from(String(signature), 'base64'); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function lineClient(env, fetchImpl = fetch) {
  const headers = { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
  const getJson = async url => {
    const res = await fetchImpl(url, { headers });
    if (!res.ok) throw new LineError(`LINE API ${res.status}`, res.status);
    return res.json();
  };
  return {
    // ไฟล์รูปที่ผู้ใช้ส่ง (LINE เก็บไว้ชั่วคราว ต้องโหลดทันทีที่ได้ webhook)
    async content(messageId) {
      const res = await fetchImpl(`${DATA_API}/message/${encodeURIComponent(messageId)}/content`, { headers });
      if (!res.ok) throw new LineError(`LINE content ${res.status}`, res.status);
      const type = String(res.headers?.get?.('content-type') || 'image/jpeg').split(';')[0].trim();
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: type };
    },
    async groupName(groupId) {
      try { return (await getJson(`${API}/group/${encodeURIComponent(groupId)}/summary`)).groupName || ''; } catch { return ''; }
    },
    async memberName(groupId, userId) {
      if (!userId) return '';
      try { return (await getJson(`${API}/group/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`)).displayName || ''; } catch { return ''; }
    },
  };
}

// จับคู่กลุ่มกับสาขาจากชื่อกลุ่ม (เช่น "Sales บางนา" → บางนา) — ไม่สนเว้นวรรค/ตัวพิมพ์ · ถ้าเจอหลายชื่อแต่ชื่อหนึ่งครอบชื่ออื่น
// (เช่น "เซ็นทรัล พระราม 2" ครอบ "พระราม 2") ใช้ชื่อที่ยาวกว่า · ไม่เจอหรือยังกำกวม = ยังไม่ผูก ให้ผู้ดูแลตั้งเอง
const squash = v => String(v || '').toLowerCase().replace(/\s+/g, '');
export function branchFromGroupName(name, branches) {
  const n = squash(name);
  const hits = [...new Set(branches)].filter(b => squash(b) && n.includes(squash(b)));
  const top = hits.filter(h => !hits.some(o => o !== h && squash(o).includes(squash(h))));
  return top.length === 1 ? top[0] : null;
}
