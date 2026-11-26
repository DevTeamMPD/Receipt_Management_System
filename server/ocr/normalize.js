import { validate } from '../../src/validation.js';

const thaiDigits = s => s.replace(/[๐-๙]/g, d => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d)));
const text = v => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

// ชื่อเดือนไทยแบบย่อและเต็ม (ฟอร์มมักเขียน "13 พ.ค. 69") — ตัดจุด/ช่องว่างก่อนเทียบ
const THAI_MONTHS = [
  ['มค', 'มกราคม'], ['กพ', 'กุมภาพันธ์'], ['มีค', 'มีนาคม'], ['เมย', 'เมษายน'], ['พค', 'พฤษภาคม'], ['มิย', 'มิถุนายน'],
  ['กค', 'กรกฎาคม'], ['สค', 'สิงหาคม'], ['กย', 'กันยายน'], ['ตค', 'ตุลาคม'], ['พย', 'พฤศจิกายน'], ['ธค', 'ธันวาคม'],
];
function thaiMonth(word) {
  const w = word.replace(/[.\s]/g, '');
  const i = THAI_MONTHS.findIndex(([short, full]) => w === short || w === full);
  return i < 0 ? 0 : i + 1;
}

// อ่านวันที่ที่เขียนบนฟอร์ม (พ.ศ. แบบเต็ม/ย่อ หรือ ค.ศ. · เดือนเป็นตัวเลขหรือชื่อเดือนไทย) แล้วคืนค่า YYYY-MM-DD (ค.ศ.) หรือ '' ถ้าอ่านไม่ได้/ไม่สมเหตุสมผล
export function parseDateText(value, now = new Date()) {
  const t = thaiDigits(text(value));
  let m = /^(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})$/.exec(t);
  let d; let mo; let y;
  const named = /^(\d{1,2})\s*[,/\-]?\s*([ก-๙.\s]+?)\s*[,/\-]?\s*(\d{2,4})$/.exec(t);
  if (m) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); }
  else if (named && thaiMonth(named[2])) { d = Number(named[1]); mo = thaiMonth(named[2]); y = Number(named[3]); }
  else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else return '';
  if (y < 100) y += 2500; // ฟอร์มไทยเขียนปีย่อเป็น พ.ศ. เช่น 69 = 2569
  if (y >= 2400) y -= 543;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  const yr = now.getUTCFullYear();
  if (y < yr - 3 || y > yr + 1) return '';
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseAmount(value) {
  const t = thaiDigits(text(value)).replace(/[,฿\s]|บาท/g, '');
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return '';
  return String(Number(t));
}

export function parsePhone(value) {
  let d = thaiDigits(text(value)).replace(/\D/g, '');
  if (d.startsWith('66') && d.length === 11) d = `0${d.slice(2)}`;
  return d;
}

const NAME_MAP = { orderDateText: 'orderDate', shipDateText: 'shipDate' };

// แปลงผลดิบจากโมเดลเป็นระเบียนที่แอปใช้ และประเมินความมั่นใจจากกฎตรวจ (ไม่เชื่อค่าความมั่นใจที่โมเดลบอกเอง)
// ช่องที่มาจากลายมือหรือการติ๊ก — ถ้าอ่านด้วยรุ่นสำรอง ให้ไฮไลต์ทุกช่องนี้ไว้ตรวจกับรูป
export const HANDWRITTEN_FIELDS = ['customerName', 'phone', 'address', 'subDistrict', 'district', 'postcode', 'total', 'items'];

export function normalizeExtraction(raw, now = new Date(), { alsoUncertain = [] } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rec = {
    billNumber: text(r.billNumber),
    orderDate: parseDateText(r.orderDateText, now),
    customerName: text(r.customerName),
    phone: parsePhone(r.phone),
    address: text(r.address),
    subDistrict: text(r.subDistrict),
    district: text(r.district),
    province: text(r.province),
    postcode: thaiDigits(text(r.postcode)).replace(/\D/g, ''),
    shipDate: parseDateText(r.shipDateText, now),
    items: (Array.isArray(r.items) ? r.items : []).map(i => ({ product: text(i?.product), size: text(i?.size), color: text(i?.color) })).filter(i => i.product || i.size || i.color),
    remark: text(r.remark),
    total: parseAmount(r.total),
    posNumber: text(r.posNumber),
    posTotal: parseAmount(r.posTotal),
  };
  const docType = ['order_form', 'receipt_only', 'other'].includes(r.docType) ? r.docType : 'other';
  const declared = (Array.isArray(r.uncertain) ? r.uncertain : []).map(k => NAME_MAP[text(k)] || text(k));
  const failed = Object.keys(validate(rec));
  // วันที่ที่เขียนไว้แต่แปลงไม่ได้ ถือว่าไม่แน่ใจ (ช่องจัดส่งเว้นว่างได้)
  if (text(r.shipDateText) && !rec.shipDate) failed.push('shipDate');
  const known = new Set(Object.keys(rec));
  const uncertain = [...new Set([...declared, ...failed, ...alsoUncertain])].filter(k => known.has(k));
  let confidence = Math.max(35, 98 - 9 * uncertain.length);
  if (docType !== 'order_form') confidence = Math.min(confidence, 50);
  return { ...rec, docType, formTitle: text(r.formTitle), uncertain, confidence };
}

// ใบที่รับจากกลุ่ม LINE ต้องเป็นใบสั่งซื้อของ Bebeplay เท่านั้น — หัวกระดาษต้องมีทั้ง "ใบส่ง/สั่งซื้อสินค้า" และชื่อ Bebeplay
// (กันใบเสร็จร้านอื่น/ใบสั่งซื้อของแบรนด์อื่นที่ถูกส่งเข้ากลุ่ม)
const squash = v => String(v || '').toLowerCase().replace(/[\s\u200b.\-_]/g, '');
export function isBebeplayOrderForm(x) {
  if (!x || x.docType !== 'order_form') return false;
  const t = squash(x.formTitle);
  return /ใบ(ส่ง|สั่ง)ซื้อ/.test(t) && /(bebeplay|เบเบ้เพลย์|บีบีเพลย์)/.test(t);
}
