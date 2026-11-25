export const statusLabels = {
  review: 'รอตรวจ',
  check: 'ต้องตรวจเพิ่ม',
  confirmed: 'ยืนยันแล้ว · รอลง JST',
  done: 'ลง JST แล้ว',
  rejected: 'ปฏิเสธ',
};

export const isPending = status => status === 'review' || status === 'check';

export const monthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function thaiDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  return `${Number(m[3])} ${monthNames[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

export const money = n => Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// เวลาที่รับ: วันนี้แสดงเฉพาะเวลา วันอื่นแสดงวันที่ด้วย (เขตเวลาไทย)
export function formatReceived(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const tz = { timeZone: 'Asia/Bangkok' };
  const time = d.toLocaleTimeString('th-TH', { ...tz, hour: '2-digit', minute: '2-digit' });
  const day = x => x.toLocaleDateString('en-CA', tz);
  return day(d) === day(now) ? time : `${d.toLocaleDateString('th-TH', { ...tz, day: 'numeric', month: 'short' })} ${time}`;
}
