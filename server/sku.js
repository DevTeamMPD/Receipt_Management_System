import { skuKey } from '../src/sku.js';

// ความจำ SKU (ตาราง receipt_sku_memory): สินค้า + ขนาด + สี → SKU ล่าสุดที่คนกรอก
// ยังไม่มีตาราง (ยังไม่รัน db/receipt_desk_sku_v1.sql) = ช่อง SKU ยังกรอก/บันทึกได้ แค่ยังไม่จำ
const TABLE = 'receipt_sku_memory';
const PAGE = 1000; // เพดานแถวต่อคำขอของ Supabase
const missing = e => e.code === 'PGRST205' || e.code === '42P01';

export async function loadSkuMemory(ctx) {
  const out = {};
  try {
    for (let page = 0; page < 10; page += 1) {
      const rows = await ctx.db.rest(ctx.auth.token, 'GET', `${TABLE}?select=combo_key,sku&order=combo_key.asc&limit=${PAGE}&offset=${page * PAGE}`);
      for (const r of rows || []) out[r.combo_key] = r.sku;
      if (!rows || rows.length < PAGE) break;
    }
  } catch (e) {
    if (e.status === 401) throw e;
    if (!missing(e)) console.warn('sku memory load failed', e.code || e.status);
  }
  return out;
}

// จำเฉพาะคู่ (ชุดสินค้า → SKU) ที่เพิ่ง "เปลี่ยน" ในการบันทึกครั้งนี้ — การแก้ช่องอื่นของใบเก่าต้องไม่เอา SKU เก่ากลับมาทับของใหม่
export async function rememberSkus(ctx, before, after) {
  const had = new Set((before || []).map(i => `${skuKey(i)}=${i.sku || ''}`));
  const rows = new Map();
  for (const i of after || []) {
    const k = skuKey(i);
    if (k && i.sku && !had.has(`${k}=${i.sku}`)) rows.set(k, { combo_key: k, product: i.product, size: i.size, color: i.color, sku: i.sku });
  }
  if (!rows.size) return 0;
  try {
    await ctx.db.rest(ctx.auth.token, 'POST', `${TABLE}?on_conflict=combo_key`, { body: [...rows.values()], prefer: 'resolution=merge-duplicates,return=minimal' });
    return rows.size;
  } catch (e) {
    if (!missing(e)) console.warn('sku memory save failed', e.code || e.status); // การบันทึกใบสำเร็จไปแล้ว ไม่ให้ล้มเพราะความจำ
    return 0;
  }
}
