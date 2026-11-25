// ย่อรูปและลบ EXIF (วาดใหม่บน canvas) ก่อนส่งให้เซิร์ฟเวอร์ — รูปที่ส่งต้องไม่เกินประมาณ 3MB (ขีดจำกัดของ Vercel ~4.5MB)
const MAX_DATA_URL = 3_200_000;

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
  let out = '';
  for (const [size, quality] of [[1600, 0.85], [1600, 0.7], [1400, 0.7], [1200, 0.65], [1000, 0.6]]) {
    out = draw(size, quality);
    if (out.length <= MAX_DATA_URL) break;
  }
  bitmap.close?.();
  if (out.length > MAX_DATA_URL) throw new Error('รูปใหญ่เกินไป ลองถ่ายใหม่ให้ไฟล์เล็กลง');
  return out;
}
