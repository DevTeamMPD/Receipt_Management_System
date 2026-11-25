#!/usr/bin/env node
// เปรียบเทียบผู้ให้บริการ OCR บนรูปใบสั่งซื้อตัวอย่าง (แผน OCR-4 ใน Decision Log)
//   node --env-file=.env scripts/ocr-bakeoff.js <โฟลเดอร์รูป> [--providers=gemini,typhoon]
// ในโฟลเดอร์: ชื่อ.jpg|png|webp คู่กับ ชื่อ.expected.json (ค่าที่คนตรวจแล้ว ใช้ชื่อฟิลด์เดียวกับระเบียนในแอป)
// ผลลัพธ์แสดงเฉพาะคะแนนต่อฟิลด์ — ไม่พิมพ์ข้อมูลลูกค้าออกหน้าจอ
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { runOcr } from '../server/ocr/handler.js';

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const FIELDS = ['billNumber', 'orderDate', 'total', 'customerName', 'phone', 'address', 'subDistrict', 'district', 'province', 'postcode', 'items'];
const CRITICAL = ['billNumber', 'total', 'phone', 'address', 'postcode'];

const dir = process.argv[2];
const providers = (process.argv.find(a => a.startsWith('--providers=')) || '--providers=gemini,typhoon').split('=')[1].split(',');
if (!dir) { console.error('ใช้: node --env-file=.env scripts/ocr-bakeoff.js <โฟลเดอร์รูป> [--providers=gemini,typhoon]'); process.exit(1); }

const norm = v => String(v ?? '').replace(/\s+/g, '').toLowerCase();
const same = {
  items: (a, b) => a.length === b.length && JSON.stringify(a.map(i => norm(i.product)).sort()) === JSON.stringify(b.map(i => norm(i.product)).sort()),
  total: (a, b) => Number(a) === Number(b),
};
const equal = (k, got, want) => (same[k] ? same[k](got || [], want || []) : norm(got) === norm(want));

const files = (await readdir(dir)).filter(f => MIME[extname(f).toLowerCase()]).sort();
if (!files.length) { console.error('ไม่พบไฟล์รูปในโฟลเดอร์'); process.exit(1); }

for (const provider of providers) {
  const env = { ...process.env, OCR_PROVIDER: provider };
  const score = Object.fromEntries(FIELDS.map(k => [k, 0]));
  let ok = 0; let failed = 0; let ms = 0;
  for (const f of files) {
    let expected;
    try { expected = JSON.parse(await readFile(join(dir, `${basename(f, extname(f))}.expected.json`), 'utf8')); } catch { console.error(`ข้าม ${f}: ไม่มีไฟล์ .expected.json`); continue; }
    const image = `data:${MIME[extname(f).toLowerCase()]};base64,${(await readFile(join(dir, f))).toString('base64')}`;
    const t0 = Date.now();
    try {
      const got = await runOcr({ image }, env);
      ms += Date.now() - t0; ok += 1;
      const wrong = [];
      for (const k of FIELDS) { if (equal(k, got[k], expected[k])) score[k] += 1; else wrong.push(k); }
      console.log(`${provider} · ${f}: ผิด ${wrong.length ? wrong.join(', ') : '— (ถูกทุกฟิลด์)'}`);
    } catch (e) { failed += 1; console.log(`${provider} · ${f}: ล้มเหลว — ${e.message}`); }
  }
  console.log(`\n## ${provider}: สำเร็จ ${ok}/${files.length} (ล้มเหลว ${failed}) · เฉลี่ย ${ok ? Math.round(ms / ok) : '-'} ms/รูป`);
  console.log('| ฟิลด์ | ถูก | % | ฟิลด์สำคัญ |\n|---|---|---|---|');
  for (const k of FIELDS) console.log(`| ${k} | ${score[k]}/${ok} | ${ok ? Math.round((100 * score[k]) / ok) : '-'}% | ${CRITICAL.includes(k) ? 'ใช่ (เป้า ≥ 90%)' : ''} |`);
  console.log('');
}
