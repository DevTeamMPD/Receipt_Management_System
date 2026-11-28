// จำ SKU ตามชุด สินค้า + ขนาด + สี — ใช้ร่วมกันทั้งหน้าเว็บและเซิร์ฟเวอร์
// คีย์ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่าง (OCR เว้นวรรคไม่เหมือนกันทุกครั้ง เช่น "L 6 ฟุต" / "L 6ฟุต")
const squash = v => String(v ?? '').normalize('NFC').toLowerCase().replace(/[\s​]/g, '');

export function skuKey(item) {
  const product = squash(item?.product);
  return product ? `${product}|${squash(item?.size)}|${squash(item?.color)}` : '';
}

// เติม SKU ที่จำไว้ให้รายการที่ยังว่าง (ไม่ทับ SKU ที่มีอยู่) — skip(item) = true คือรายการที่ไม่ให้เติม
export function fillSkus(items, memory, skip = () => false) {
  let filled = 0;
  const out = items.map(it => {
    const sku = it.sku ? '' : memory?.[skuKey(it)];
    if (!sku || skip(it)) return it;
    filled += 1;
    return { ...it, sku };
  });
  return { items: filled ? out : items, filled };
}
