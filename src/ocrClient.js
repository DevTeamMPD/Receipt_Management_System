// ฝั่งเบราว์เซอร์: ย่อรูป (ลบ EXIF ด้วยการวาดใหม่) แล้วส่งให้เซิร์ฟเวอร์อ่าน — คีย์ผู้ให้บริการอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น
export async function getOcrStatus() {
  const res = await fetch('/api/ocr/status');
  if (!res.ok) throw new Error('status');
  return res.json();
}

export async function prepareImage(file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('เปิดไฟล์รูปนี้ไม่ได้ ลองใช้ไฟล์ JPG หรือ PNG'); }
  const draw = (max, quality) => {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  };
  // ocr = ความละเอียดสูงพอสำหรับตัวอักษรเล็กบนใบเสร็จ, thumb = เล็กกว่าเพื่อเก็บใน localStorage
  const images = { ocr: draw(1600, 0.85), thumb: draw(1000, 0.6) };
  bitmap.close?.();
  return images;
}

export async function runOcr(imageDataUrl) {
  let res;
  try {
    res = await fetch('/api/ocr', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: imageDataUrl }) });
  } catch { throw new Error('ติดต่อเซิร์ฟเวอร์ OCR ไม่ได้'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'อ่านรูปไม่สำเร็จ');
  return data;
}
