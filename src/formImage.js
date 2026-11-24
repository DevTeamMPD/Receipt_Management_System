import { money, thaiDate } from './data.js';

const escape = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

// วาดภาพ "ใบสั่งซื้อตัวอย่าง" จากข้อมูลสมมติ ไม่ใช่เอกสารลูกค้าจริง
export function formImage(o) {
  const hand = (size = 13) => `font-family="'Segoe Script','Comic Sans MS',cursive" fill="#1d3f8f" font-size="${size}"`;
  const label = 'font-size="10" fill="#566275"';
  const rows = [
    ['เลขที่บิล', o.billNumber], ['วันที่สั่งซื้อ', thaiDate(o.orderDate)], ['ชื่อลูกค้า', o.customerName], ['เบอร์โทร', o.phone],
    ['ที่อยู่', o.address], ['แขวง/เขต', `${o.subDistrict} ${o.district}`], ['จังหวัด', `${o.province} ${o.postcode}`],
  ].map(([k, v], i) => `<text x="22" y="${96 + i * 30}" ${label}>${escape(k)}</text><text x="92" y="${96 + i * 30}" ${hand()}>${escape(v)}</text><line x1="88" y1="${101 + i * 30}" x2="352" y2="${101 + i * 30}" stroke="#c5ccd8"/>`).join('');
  const items = o.items.slice(0, 5).map((it, i) => `<rect x="22" y="${322 + i * 24}" width="12" height="12" fill="none" stroke="#566275"/><path d="M24 ${328 + i * 24} l3 4 l7 -9" stroke="#1d3f8f" stroke-width="2" fill="none"/><text x="42" y="${332 + i * 24}" ${hand(12)}>${escape([it.product, it.size, it.color].filter(Boolean).join(' · '))}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="520" viewBox="0 0 520 520">
<rect width="520" height="520" fill="#dfe5ee"/>
<g transform="rotate(-1.2 190 260)"><rect x="12" y="12" width="360" height="496" fill="#fff" stroke="#b9c2d0"/>
<text x="22" y="42" font-size="18" font-weight="bold" fill="#1f2a37">ใบสั่งซื้อสินค้า</text>
<text x="22" y="60" font-size="10" fill="#8a94a3">SAMPLE · ข้อมูลสมมติ ไม่ใช่เอกสารจริง</text>
${rows}
<text x="22" y="306" font-size="11" font-weight="bold" fill="#1f2a37">รายการสินค้า</text>${items}
<text x="22" y="476" font-size="12" font-weight="bold" fill="#1f2a37">รวมยอดเงิน</text><text x="110" y="476" ${hand(16)}>${escape(o.total)}</text><text x="190" y="476" font-size="11" fill="#566275">บาท</text></g>
<g transform="rotate(1.5 450 200)"><rect x="392" y="24" width="112" height="300" fill="#fffef9" stroke="#c9cdd6"/>
<text x="448" y="48" text-anchor="middle" font-family="monospace" font-size="12" font-weight="bold" fill="#333">RECEIPT</text>
<text x="448" y="64" text-anchor="middle" font-family="monospace" font-size="8" fill="#666">${escape(o.posNumber)}</text>
<line x1="402" y1="76" x2="494" y2="76" stroke="#bbb" stroke-dasharray="3 3"/>
<text x="402" y="96" font-family="monospace" font-size="8" fill="#555">ITEM 1 ...... 0.00</text><text x="402" y="110" font-family="monospace" font-size="8" fill="#555">ITEM 2 ...... 0.00</text>
<line x1="402" y1="122" x2="494" y2="122" stroke="#bbb" stroke-dasharray="3 3"/>
<text x="402" y="142" font-family="monospace" font-size="9" font-weight="bold" fill="#333">TOTAL</text><text x="494" y="142" text-anchor="end" font-family="monospace" font-size="9" font-weight="bold" fill="#333">${escape(money(o.posTotal))}</text></g>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
