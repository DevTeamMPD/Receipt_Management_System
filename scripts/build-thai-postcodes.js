#!/usr/bin/env node
// สร้าง server/ocr/thaiPostcodes.js (ตำบล → รหัสไปรษณีย์) จากชุดข้อมูลเปิดสองชุด แล้วรวมรหัสของตำบลเดียวกันเข้าด้วยกัน
// (แต่ละชุดเก็บรหัสเดียวต่อตำบล และเลือกไม่ตรงกันในตำบลที่มีที่ทำการไปรษณีย์ย่อย เช่น จอหอ 30000/30310 — รวมแล้วครอบคลุมกว่า)
//   1) kongvut/thai-province-data (MIT) — api/latest/sub_district_with_district_and_province.json
//   2) Sellsuki/thai-address-database (ISC · ข้อมูลจาก earthchie/jquery.Thailand.js, MIT) — database/db.json ในแพ็กเกจ npm
// ใช้: node scripts/build-thai-postcodes.js <ไฟล์ชุดที่ 1> <ไฟล์ชุดที่ 2>
import { readFile, writeFile } from 'node:fs/promises';

const [mainPath, extraPath] = process.argv.slice(2);
if (!mainPath || !extraPath) { console.error('ใช้: node scripts/build-thai-postcodes.js <sub_district_with_district_and_province.json> <db.json>'); process.exit(1); }

const areas = new Map(); // "จังหวัด|อำเภอ|ตำบล" → Set(รหัส) เรียงตามลำดับที่เจอ (ชุดที่ 1 ก่อน)
const add = (p, a, t, z) => {
  if (!/^\d{5}$/.test(z) || !p || !a || !t) return;
  const k = `${p}|${a}|${t}`;
  if (!areas.has(k)) areas.set(k, new Set());
  areas.get(k).add(z);
};

for (const x of JSON.parse(await readFile(mainPath, 'utf8'))) {
  if (x.deleted_at || x.district?.deleted_at) continue;
  add(x.district.province.name.th.trim(), x.district.name.th.trim(), x.name.th.trim(), String(x.zip_code));
}
const known = areas.size;

// ชุดที่ 2 บีบอัดด้วยตารางคำ: ตัวเลข = ดัชนีใน lookup · ตัวอักษร A–Z, a–z = ดัชนีใน words
const extra = JSON.parse(await readFile(extraPath, 'utf8'));
const lookup = extra.lookup.split('|');
const words = extra.words.split('|');
const expand = v => (typeof v === 'number' ? lookup[v] : v).replace(/[A-Z]/gi, m => { const c = m.charCodeAt(0); return words[c < 97 ? c - 65 : 26 + c - 97]; });
let added = 0;
for (const [p, districts] of extra.data) {
  for (const [a, tambons] of districts) {
    for (const [t, zips] of tambons) {
      const k = `${expand(p)}|${expand(a)}|${expand(t)}`;
      if (!areas.has(k)) continue; // เพิ่มเฉพาะรหัสของตำบลที่ชุดที่ 1 มี (ชื่อสะกดต่างกันไม่เอา กันชื่อซ้ำซ้อน)
      for (const z of [].concat(zips)) { const before = areas.get(k).size; add(expand(p), expand(a), expand(t), String(z)); added += areas.get(k).size - before; }
    }
  }
}

const byDistrict = new Map();
for (const [k, zips] of areas) {
  const [p, a, t] = k.split('|');
  const dk = `${p}|${a}`;
  if (!byDistrict.has(dk)) byDistrict.set(dk, []);
  byDistrict.get(dk).push(`${t}=${[...zips].join('/')}`);
}
const lines = [...byDistrict].map(([dk, tambons]) => `  ${JSON.stringify(`${dk}|${tambons.join(',')}`)},`);
const out = `// สร้างโดย scripts/build-thai-postcodes.js — อย่าแก้มือ (แก้ที่สคริปต์แล้วสร้างใหม่)
// ที่มา: kongvut/thai-province-data (MIT © Kongvut Sangkla) รวมกับรหัสไปรษณีย์จาก Sellsuki/thai-address-database (ISC · ข้อมูลจาก earthchie/jquery.Thailand.js, MIT)
// หนึ่งบรรทัด = หนึ่งอำเภอ: "จังหวัด|อำเภอ|ตำบล=รหัส[/รหัสอื่น],ตำบล=รหัส,…"
export default [
${lines.join('\n')}
];
`;
await writeFile(new URL('../server/ocr/thaiPostcodes.js', import.meta.url), out);
console.log(`ตำบล ${known} · อำเภอ ${byDistrict.size} · รหัสไปรษณีย์ ${new Set([...areas.values()].flatMap(z => [...z])).size} · รหัสที่เพิ่มจากชุดที่ 2: ${added}`);
