const isRealDate = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

const required = (value, message) => (String(value ?? '').trim() ? '' : message);

// คืนค่าเป็น { ชื่อฟิลด์: ข้อความที่บอกวิธีแก้ } เฉพาะช่องที่ยังไม่ผ่าน
export function validate(r) {
  const e = {
    billNumber: required(r.billNumber, 'กรอกเลขที่บิล'),
    customerName: required(r.customerName, 'กรอกชื่อลูกค้า'),
    address: required(r.address, 'กรอกที่อยู่'),
    subDistrict: required(r.subDistrict, 'กรอกแขวง/ตำบล'),
    district: required(r.district, 'กรอกเขต/อำเภอ'),
    province: required(r.province, 'กรอกจังหวัด'),
  };
  if (!isRealDate(r.orderDate)) e.orderDate = 'กรอกวันที่สั่งซื้อให้ครบและถูกต้อง';
  if (!/^0\d{9}$/.test(String(r.phone || '').replace(/[\s-]/g, ''))) e.phone = 'เบอร์โทรต้องมี 10 หลัก ขึ้นต้นด้วย 0';
  if (!/^\d{5}$/.test(String(r.postcode || '').trim())) e.postcode = 'รหัสไปรษณีย์ต้องมี 5 หลัก';
  const total = Number(r.total);
  if (!String(r.total || '').trim() || !Number.isFinite(total) || total <= 0) e.total = 'ยอดเงินต้องเป็นตัวเลขมากกว่า 0';
  if (r.shipDate && !isRealDate(r.shipDate)) e.shipDate = 'วันที่จัดส่งไม่ถูกต้อง (หรือเว้นว่างไว้)';
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v));
}

// คำเตือนที่ไม่บล็อกการส่ง แต่ให้คนตรวจเห็น
export function warnings(r) {
  const out = [];
  const total = Number(r.total);
  const pos = Number(r.posTotal);
  if (Number.isFinite(total) && Number.isFinite(pos) && r.posTotal && Math.abs(total - pos) > 0.004) {
    out.push({ key: 'total', diff: total - pos });
  }
  return out;
}

export const fieldOrder = ['billNumber', 'orderDate', 'total', 'customerName', 'phone', 'address', 'subDistrict', 'district', 'province', 'postcode', 'shipDate'];
