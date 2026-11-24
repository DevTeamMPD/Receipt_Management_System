// ข้อมูลตัวอย่างทั้งหมดเป็นข้อมูลสมมติ ไม่ใช่ลูกค้าหรือเอกสารจริง
export const STORAGE_KEY = 'receipt-desk-demo-v2';

export const branches = ['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต'];

export const statusLabels = {
  review: 'รอตรวจ',
  check: 'ต้องตรวจเพิ่ม',
  queued: 'อยู่ในคิว (จำลอง)',
};

export const seeds = [
  {
    id: 'RCP-0024', billNumber: 'OD-261124-001', orderDate: '2026-11-24',
    customerName: 'สมชาย ตัวอย่างหนึ่ง', phone: '0800000001',
    address: '99/1 ซอยทดสอบ 1 ถนนตัวอย่าง', subDistrict: 'บางนา', district: 'บางนา', province: 'กรุงเทพมหานคร', postcode: '10260',
    shipDate: '',
    items: [
      { product: 'คอกกั้นเด็ก', size: 'L 6 ฟุต', color: 'ฟ้า ชมพู ขาว' },
      { product: 'เบาะ PU', size: 'L 6 ฟุต', color: 'มาการอง' },
      { product: 'ของเล่นซิงช้า', size: '', color: 'ฟ้า เทา' },
      { product: 'ของเล่นสไลเดอร์', size: '', color: 'ฟ้า เทา' },
    ],
    remark: 'เซตตามโปรโมชัน', total: '15350', posNumber: 'POS-0001', posTotal: '15050',
    branch: 'สยาม', sender: 'พิมพ์ชนก', time: '10:42', status: 'review', confidence: 96, uncertain: [],
  },
  {
    id: 'RCP-0023', billNumber: 'OD-261124-002', orderDate: '2026-11-24',
    customerName: 'วิภา ตัวอย่างสอง', phone: '081000002',
    address: '12/5 ซอยทดสอบ 2 ถนนตัวอย่าง', subDistrict: 'ลาดพร้าว', district: 'ลาดพร้าว', province: 'กรุงเทพมหานคร', postcode: '10230',
    shipDate: '2026-11-28',
    items: [{ product: 'เก้าอี้เปลไกว 2in1', size: '', color: 'น้ำตาล' }],
    remark: '', total: '2890', posNumber: 'POS-0002', posTotal: '2890',
    branch: 'ลาดพร้าว', sender: 'ธนกร', time: '10:38', status: 'check', confidence: 72, uncertain: ['phone', 'address'],
  },
  {
    id: 'RCP-0022', billNumber: 'OD-261124-003', orderDate: '2026-11-24',
    customerName: 'ประเสริฐ ตัวอย่างสาม', phone: '0800000003',
    address: '45 ซอยทดสอบ 3 ถนนตัวอย่าง', subDistrict: 'สวนใหญ่', district: 'เมืองนนทบุรี', province: 'นนทบุรี', postcode: '11000',
    shipDate: '',
    items: [
      { product: 'ตู้ Tidy 3 ตอน', size: '', color: 'ขาว' },
      { product: 'ชั้นวางหนังสือ 5 ชั้น Chubby bear', size: '', color: '' },
    ],
    remark: '', total: '4590', posNumber: 'POS-0003', posTotal: '4590',
    branch: 'บางนา', sender: 'ณัฐวุฒิ', time: '10:31', status: 'review', confidence: 94, uncertain: [],
  },
  {
    id: 'RCP-0021', billNumber: 'OD-261124-004', orderDate: '2026-11-24',
    customerName: 'อรทัย ตัวอย่างสี่', phone: '0800000004',
    address: '7/7 ซอยทดสอบ 4 ถนนตัวอย่าง', subDistrict: 'ประชาธิปัตย์', district: 'ธัญบุรี', province: 'ปทุมธานี', postcode: '12130',
    shipDate: '',
    items: [{ product: 'เตียงนอนไม้ Luna', size: '', color: 'สีไม้' }],
    remark: '', total: '1290', posNumber: 'POS-0004', posTotal: '1290',
    branch: 'รังสิต', sender: 'ศิริพร', time: '10:24', status: 'queued', confidence: 99, uncertain: [],
  },
];

export const original = r => seeds.find(s => s.id === r.id) || seeds[0];

const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const monthNames = months;

export function thaiDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

export const money = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ocrRawText(o) {
  return [
    'ใบสั่งซื้อสินค้า (ข้อมูลตัวอย่าง)',
    `เลขที่บิล ${o.billNumber}`,
    `วันที่สั่งซื้อ ${thaiDate(o.orderDate)}`,
    `ชื่อลูกค้า ${o.customerName}`,
    `โทร ${o.phone}`,
    `ที่อยู่ ${o.address}`,
    `แขวง/ตำบล ${o.subDistrict} เขต/อำเภอ ${o.district}`,
    `จังหวัด ${o.province} ${o.postcode}`,
    o.shipDate ? `วันที่ต้องการจัดส่งพิเศษ ${thaiDate(o.shipDate)}` : '',
    '',
    ...o.items.map(i => `- ${[i.product, i.size, i.color].filter(Boolean).join(' / ')}`),
    o.remark ? `หมายเหตุ ${o.remark}` : '',
    `รวมยอดเงิน ${o.total}`,
    '',
    `ใบเสร็จแนบ ${o.posNumber} ยอดชำระ ${o.posTotal}`,
  ].filter((line, i, a) => line !== '' || a[i - 1] !== '').join('\n');
}

export function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const ok = r => r && typeof r.id === 'string' && statusLabels[r.status] && branches.includes(r.branch)
      && ['billNumber', 'orderDate', 'customerName', 'phone', 'address', 'subDistrict', 'district', 'province', 'postcode', 'total', 'shipDate'].every(k => typeof r[k] === 'string')
      && Array.isArray(r.items) && r.items.every(i => i && typeof i.product === 'string' && typeof i.size === 'string' && typeof i.color === 'string');
    if (Array.isArray(data) && data.length && data.every(ok)) return data;
  } catch { /* ใช้ข้อมูลตัวอย่างเมื่ออ่านที่เก็บในเบราว์เซอร์ไม่ได้ */ }
  return seeds.map(r => ({ ...r, items: r.items.map(i => ({ ...i })), uncertain: [...r.uncertain] }));
}
