import { ApiError } from './supabase.js';

const DEFAULT_BRANCHES = ['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต'];
export const branchesFrom = env => (env.RECEIPT_BRANCHES ? env.RECEIPT_BRANCHES.split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_BRANCHES);
export const sortBranches = list => [...new Set(list)].sort((a, b) => a.localeCompare(b, 'th'));
export const BRANCH_MAX = 60;
export const cleanBranchName = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

// สาขาที่เปิดใช้ (ตาราง receipt_branches) — ยังไม่มีตาราง/ยังว่าง/อ่านไม่ได้ = ใช้ค่าจาก env แทน
export async function loadBranches(db, token, env) {
  try {
    const rows = await db.rest(token, 'GET', 'receipt_branches?select=name&active=eq.true');
    if (rows?.length) return sortBranches(rows.map(r => r.name));
  } catch (e) {
    if (e.status === 401) throw e;
    if (e.code !== 'PGRST205' && e.code !== '42P01') console.warn('branches load failed', e.code || e.status);
  }
  return branchesFrom(env);
}

const isRealDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

const TEXT = {
  billNumber: ['bill_number', 100], customerName: ['customer_name', 200], address: ['address', 400], subDistrict: ['sub_district', 100],
  district: ['district', 100], province: ['province', 100], remark: ['remark', 1000],
};

// ตรวจและแปลงข้อมูลที่แก้จากหน้าเว็บ (ฟิลด์ที่ไม่รู้จักถูกปฏิเสธ) — ระหว่างพิมพ์เก็บค่าที่ยังไม่ครบได้ ตรวจครบตอนกดยืนยัน
export function sanitizePatch(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new ApiError(422, 'ข้อมูลที่ส่งมาไม่ถูกต้อง');
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (TEXT[k]) {
      if (typeof v !== 'string' || v.length > TEXT[k][1] * 2) throw new ApiError(422, `ข้อมูล ${k} ไม่ถูกต้อง`);
      out[TEXT[k][0]] = v.trim().slice(0, TEXT[k][1]);
    } else if (k === 'phone') {
      if (typeof v !== 'string') throw new ApiError(422, 'เบอร์โทรไม่ถูกต้อง');
      out.phone = v.replace(/\D/g, '').slice(0, 15);
    } else if (k === 'postcode') {
      if (typeof v !== 'string') throw new ApiError(422, 'รหัสไปรษณีย์ไม่ถูกต้อง');
      out.postcode = v.replace(/\D/g, '').slice(0, 5);
    } else if (k === 'orderDate' || k === 'shipDate') {
      if (typeof v !== 'string' || (v !== '' && !isRealDate(v))) throw new ApiError(422, 'วันที่ไม่ถูกต้อง');
      out[k === 'orderDate' ? 'order_date' : 'ship_date'] = v;
    } else if (k === 'total') {
      if (typeof v !== 'string' || (v !== '' && !(/^\d{1,11}(\.\d{1,2})?$/.test(v)))) throw new ApiError(422, 'ยอดเงินไม่ถูกต้อง');
      out.total = v;
    } else throw new ApiError(422, `แก้ไขฟิลด์ ${k} ไม่ได้`);
  }
  return out;
}

export function sanitizeItems(items) {
  if (!Array.isArray(items) || items.length > 50) throw new ApiError(422, 'รายการสินค้าไม่ถูกต้อง');
  return items.map(i => {
    const t = k => (typeof i?.[k] === 'string' ? i[k].trim().slice(0, 200) : '');
    return { product: t('product'), size: t('size'), color: t('color') };
  });
}

export const ORDER_SELECT = 'select=*,receipt_order_items(position,product,size,color,sku)&receipt_order_items.order=position.asc';

export function statusOf(r) {
  if (r.review_status === 'rejected') return 'rejected';
  if (r.jst_status === 'succeeded') return 'done';
  if (r.review_status === 'confirmed') return 'confirmed';
  return r.review_status === 'needs_check' || r.ocr_status === 'failed' ? 'check' : 'review';
}

const num = v => (v == null ? '' : String(Number(v)));

export function mapRow(r, imageUrl = '', codeById = {}) {
  return {
    id: r.id, code: r.code, billNumber: r.bill_number || '', orderDate: r.order_date || '', customerName: r.customer_name || '', phone: r.phone || '',
    address: r.address || '', subDistrict: r.sub_district || '', district: r.district || '', province: r.province || '', postcode: r.postcode || '',
    shipDate: r.ship_date || '', remark: r.remark || '', total: num(r.total), posNumber: r.pos_number || '', posTotal: num(r.pos_total),
    items: (r.receipt_order_items || []).slice().sort((a, b) => a.position - b.position).map(i => ({ product: i.product, size: i.size, color: i.color })),
    branch: r.branch, source: r.source || 'upload', sender: r.sender_name || '', receivedAt: r.received_at, confidence: r.ocr_confidence, uncertain: r.ocr_uncertain || [],
    ocrProvider: r.ocr_provider || '', ocrStatus: r.ocr_status, ocrRaw: r.ocr_raw_text || '', ocrOriginal: r.ocr_original || null,
    duplicateOf: (r.duplicate_of && codeById[r.duplicate_of]) || '', rejectReason: r.reject_reason || '', status: statusOf(r), version: r.version, imageUrl,
  };
}
