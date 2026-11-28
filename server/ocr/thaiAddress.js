// ตรวจ/แก้ แขวง-ตำบล · เขต-อำเภอ · จังหวัด ที่ OCR อ่านจากลายมือ โดยยึดรหัสไปรษณีย์เป็นหลัก:
// รหัสไปรษณีย์จำกัดพื้นที่เหลือไม่กี่ตำบล แล้วเทียบคำที่อ่านได้กับชื่อจริงในพื้นที่นั้น (อ่านเพี้ยนเล็กน้อยก็ยังจับคู่ได้)
// ไม่มั่นใจ = ไม่เดาเงียบ ๆ: คงคำที่อ่านได้ไว้ แล้วคืนชื่อช่องใน uncertain ให้คนตรวจกับรูป
import ROWS from './thaiPostcodes.js';

const AREAS = []; // { t: ตำบล, a: อำเภอ, p: จังหวัด, zips: [รหัส] }
const BY_ZIP = new Map();
const PROVINCES = new Set();
for (const row of ROWS) {
  const [p, a, tambons] = row.split('|');
  PROVINCES.add(p);
  for (const part of tambons.split(',')) {
    const [t, zips] = part.split('=');
    const area = { t, a, p, zips: zips.split('/') };
    AREAS.push(area);
    for (const z of area.zips) { if (!BY_ZIP.has(z)) BY_ZIP.set(z, []); BY_ZIP.get(z).push(area); }
  }
}

// ---------- เทียบคำ ----------
const PREFIX = { sub: /^(แขวง|ตำบล|ต\.)/, dist: /^(เขต|อำเภอ|อ\.)/, prov: /^(จังหวัด|จ\.)/ };
const PROVINCE_ALIAS = { กทม: 'กรุงเทพมหานคร', กรุงเทพ: 'กรุงเทพมหานคร', 'กรุงเทพฯ': 'กรุงเทพมหานคร', 'กรุงเทพมหานครฯ': 'กรุงเทพมหานคร', bangkok: 'กรุงเทพมหานคร', bkk: 'กรุงเทพมหานคร', โคราช: 'นครราชสีมา' };
const squash = v => String(v ?? '').normalize('NFC').toLowerCase().replace(/[\s​]/g, '');
// ตัดคำนำหน้า (ต./อ./จ.) และเครื่องหมาย · "เเ" (สระเอสองตัว) = "แ" · นิคหิต+สระอา = สระอำ
const tidy = v => v.replace(/เเ/g, 'แ').replace(/ํา/g, 'ำ').replace(/[.,\-()]/g, '');
function key(value, kind) {
  let s = squash(value);
  const cut = s.replace(PREFIX[kind], '');
  if (cut) s = cut;
  s = tidy(s);
  return (kind === 'prov' && PROVINCE_ALIAS[s]) || s;
}
const NAME_KEY = new Map();
const nameKey = name => { if (!NAME_KEY.has(name)) NAME_KEY.set(name, tidy(squash(name))); return NAME_KEY.get(name); };

// สระบน/ล่างและวรรณยุกต์ตกหล่นง่ายในลายมือ → นับครึ่งเดียว · พยัญชนะที่ลายมือคล้ายกันก็นับครึ่ง
const MARK = /[ัิ-ฺ็-๎]/;
const LOOKALIKE = new Map();
for (const [i, group] of ['กถภ', 'ขชซ', 'คดตศ', 'บป', 'ผฝพฟ', 'นมฆ', 'ลส', 'อฮ', 'รธ', 'ณญ', 'ฎฏ', 'ไใ'].entries()) for (const ch of group) LOOKALIKE.set(ch, i);
const weight = ch => (MARK.test(ch) ? 0.5 : 1);
const swap = (x, y) => (x === y ? 0 : (MARK.test(x) && MARK.test(y)) || (LOOKALIKE.has(x) && LOOKALIKE.get(x) === LOOKALIKE.get(y)) ? 0.5 : 1);

function distance(a, b) {
  let prev = [0];
  for (let j = 0; j < b.length; j += 1) prev.push(prev[j] + weight(b[j]));
  for (let i = 0; i < a.length; i += 1) {
    const cur = [prev[0] + weight(a[i])];
    for (let j = 0; j < b.length; j += 1) cur.push(Math.min(prev[j] + swap(a[i], b[j]), prev[j + 1] + weight(a[i]), cur[j] + weight(b[j])));
    prev = cur;
  }
  return prev[b.length];
}
const size = s => [...s].reduce((n, ch) => n + weight(ch), 0);

const PARTIAL = 0.8; // เขียนย่อ/ชื่อเดิม เช่น "เมือง" = เมืองนนทบุรี · "อยุธยา" = พระนครศรีอยุธยา · "บางนา" = บางนาเหนือ/บางนาใต้
// ความเหมือนของคำที่อ่านได้ (ผ่าน key แล้ว) กับชื่อจริง: 1 = ตรงกัน
export function similarity(read, name) {
  const b = nameKey(name);
  if (!read || !b) return 0;
  if (read === b) return 1;
  const s = 1 - distance(read, b) / Math.max(size(read), size(b));
  return read.length >= 3 && (b.startsWith(read) || b.endsWith(read)) ? Math.max(s, PARTIAL) : s;
}

const OK = 0.6; // ต่ำกว่านี้ = ไม่ถือว่าเป็นคำเดียวกัน
const SURE = 0.8; // ตั้งแต่ค่านี้ = แก้ให้โดยไม่ต้องไฮไลต์
const GAP = 0.1; // ต้องชนะตัวเลือกอันดับสองอย่างน้อยเท่านี้
const CLEAR = [0.65, 0.3]; // เหมือนปานกลางแต่ทิ้งห่างอันดับสองมาก ก็ไม่ต้องไฮไลต์
const uniq = list => [...new Set(list)];
const digitsOff = (a, b) => distance(a, b); // ตัวเลขผิด/ขาด/เกิน กี่หลัก

// เลือกชื่อที่เหมือนคำที่อ่านได้ที่สุดจากรายชื่อ (ต้องเหมือนพอและชนะอันดับสองชัดเจน)
function pick(read, names) {
  const scored = names.map(name => ({ name, s: similarity(read, name) })).sort((x, y) => y.s - x.s);
  const [best, next] = scored;
  if (!best || best.s < OK || (next && best.s - next.s < GAP)) return null;
  return best;
}

// ค้นทั้งประเทศจากชื่อ (ใช้เมื่อรหัสไปรษณีย์ไม่มี/ผิด หรือชื่อไม่เข้ากับรหัสเลย) — ต้องตรงชัดเจนจึงจะเชื่อ
function findByNames(sub, dist, prov, zip) {
  if (!sub || (!dist && !prov)) return null;
  const memo = new Map();
  const sim = (read, name) => { const k = `${read}|${name}`; if (!memo.has(k)) memo.set(k, similarity(read, name)); return memo.get(k); };
  let best = null; let next = null;
  const subSize = size(sub);
  for (const area of AREAS) {
    const tSize = area.size ??= size(nameKey(area.t));
    if (Math.abs(subSize - tSize) > 0.25 * Math.max(subSize, tSize) && !nameKey(area.t).includes(sub)) continue; // ยาวต่างกันเกินกว่าจะเหมือนถึง 0.75
    const sT = sim(sub, area.t);
    if (sT < 0.75) continue;
    const parts = [[0.5, sT]];
    if (dist) parts.push([0.3, sim(dist, area.a)]);
    if (prov) parts.push([0.2, sim(prov, area.p)]);
    let score = parts.reduce((n, [w, s]) => n + w * s, 0) / parts.reduce((n, [w]) => n + w, 0);
    const near = zip ? area.zips.find(z => digitsOff(zip, z) <= 1) : null;
    if (near) score = Math.min(1, score + 0.1); // รหัสที่อ่านได้เกือบตรงกับรหัสของตำบลนี้ = หลักฐานเพิ่ม
    const hit = { area, score, near };
    if (!best || score > best.score) { next = best; best = hit; } else if (!next || score > next.score) next = hit;
  }
  if (!best || best.score < 0.85 || (next && best.score - next.score < 0.05)) return null;
  return best;
}

// รับค่าที่อ่านได้ → คืนค่าที่ตรวจ/แก้แล้ว + ช่องที่ควรให้คนตรวจ
export function resolveThaiAddress({ subDistrict = '', district = '', province = '', postcode = '' } = {}) {
  const out = { subDistrict, district, province, postcode };
  const flag = new Set();
  const sub = key(subDistrict, 'sub');
  const dist = key(district, 'dist');
  const prov = key(province, 'prov');
  const done = () => ({ ...out, uncertain: [...flag] });
  const useArea = area => { out.subDistrict = area.t; out.district = area.a; out.province = area.p; };

  const pool = BY_ZIP.get(postcode);
  if (!pool) {
    // ไม่มีรหัส/รหัสไม่ครบ/ไม่มีรหัสนี้ในประเทศ → ลองหาพื้นที่จากชื่อ แล้วเติมรหัสเฉพาะเมื่อรหัสที่อ่านได้เกือบตรง (ผิด/ขาดหลักเดียว)
    const hit = findByNames(sub, dist, prov, postcode);
    if (hit) { useArea(hit.area); if (hit.near) out.postcode = hit.near; }
    if (out.postcode) flag.add('postcode');
    return done();
  }

  // ---------- รหัสไปรษณีย์ใช้ได้: จำกัดตัวเลือกเหลือเฉพาะพื้นที่ของรหัสนี้ ----------
  const provNames = uniq(pool.map(c => c.p));
  const provBest = provNames.length === 1 ? { name: provNames[0], s: similarity(prov, provNames[0]) } : pick(prov, provNames);
  // จังหวัดที่อ่านได้ชัดว่าเป็นจังหวัดอื่น = ขัดกับรหัส (อาจอ่านรหัสผิด) ห้ามทับ
  const elsewhere = prov && (!provBest || provBest.s < OK) && [...PROVINCES].some(p => !provNames.includes(p) && similarity(prov, p) >= 0.85);
  const scope = provBest && !elsewhere ? pool.filter(c => c.p === provBest.name) : pool;

  // แขวง/ตำบล: ให้คะแนนคู่กับเขต/อำเภอ (ชื่อตำบลซ้ำข้ามอำเภอได้)
  let tambon = null; let oldName = false;
  if (sub) {
    const scored = scope.map(c => ({ c, sT: similarity(sub, c.t), s: dist ? 0.65 * similarity(sub, c.t) + 0.35 * similarity(dist, c.a) : similarity(sub, c.t) })).sort((x, y) => y.s - x.s);
    const best = scored[0];
    const rival = scored.find(x => x.c.t !== best.c.t);
    if (best.sT === 1 || (best.sT >= OK && (!rival || best.s - rival.s >= GAP))) tambon = { ...best, gap: rival ? best.s - rival.s : 1 };
    // ชื่อเดิมก่อนแบ่งแขวง (เช่น "บางนา" → บางนาเหนือ/บางนาใต้) เลือกไม่ได้แต่ก็ไม่ผิด: คงไว้ ไม่ไฮไลต์
    else if (best.sT === PARTIAL && rival?.sT === PARTIAL) oldName = true;
  }

  // เขต/อำเภอ: จากตำบลที่จับคู่ได้ → จากคำที่อ่านได้ → ถ้ารหัสนี้มีอำเภอเดียวก็ใช้อำเภอนั้น
  const distNames = uniq(scope.map(c => c.a));
  const distOfTambon = tambon && uniq(scope.filter(c => c.t === tambon.c.t).map(c => c.a));
  let distName = null;
  if (distOfTambon?.length === 1) distName = distOfTambon[0];
  else if (dist) distName = pick(dist, distOfTambon || distNames)?.name || null;
  if (!distName && distNames.length === 1) distName = distNames[0];

  // ตำบลไม่ตรงกับพื้นที่ของรหัสนี้พอดี → ถ้าชื่อทั้งชุดชี้ไปที่อื่นอย่างชัดเจน แปลว่ารหัสน่าจะอ่านผิด/เขียนผิด
  // (ถ้าในพื้นที่ของรหัสมีตำบลที่คล้ายอยู่แล้ว จะยอมเปลี่ยนก็ต่อเมื่อที่อื่นสะกดตรงเป๊ะ และรหัสต่างกันแค่หลักเดียว)
  const loose = !tambon || tambon.sT < 1 || (dist && similarity(dist, tambon.c.a) < OK);
  if (elsewhere || (sub && loose && !oldName)) {
    const hit = findByNames(sub, dist, prov, postcode);
    const better = hit && !hit.area.zips.includes(postcode) && (!tambon || (hit.near && similarity(sub, hit.area.t) === 1 && hit.score > tambon.s));
    if (better) {
      useArea(hit.area);
      if (hit.near) out.postcode = hit.near; // ต่างกันหลักเดียว → แก้รหัสตามชื่อ
      flag.add('postcode');
      return done();
    }
  }

  // จังหวัดกับรหัสขัดกันและตัดสินไม่ได้ → ไม่แตะอะไร ให้คนดูรูป
  if (elsewhere) { flag.add('province'); flag.add('postcode'); return done(); }
  if (provBest) {
    if (prov && provBest.s < 0.5) flag.add('province');
    out.province = provBest.name;
  } else if (tambon) out.province = tambon.c.p;
  if (distName) {
    if (dist && similarity(dist, distName) < OK) flag.add('district');
    out.district = distName;
  } else if (dist) flag.add('district');
  if (tambon) {
    if (tambon.sT < SURE && !(tambon.sT >= CLEAR[0] && tambon.gap >= CLEAR[1])) flag.add('subDistrict');
    out.subDistrict = tambon.c.t;
  } else if (sub && !oldName) flag.add('subDistrict');
  return done();
}
