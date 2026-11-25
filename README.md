# Receipt Desk

ต้นแบบ UI สำหรับ Sale ออฟฟิศ ตรวจใบสั่งซื้อที่ Sales ส่งมาทาง LINE: เลือกใบจากรายการด้านซ้าย เทียบรูปกับฟอร์มด้านขวา แก้ข้อมูลที่ OCR อ่านพลาด แล้วยืนยันส่งต่อเข้าคิว JST

## Preview

![Receipt Desk desktop UI](docs/ui-preview.png)

## Run

Requires Node.js 20.19+ or 22.12+ (validated with Node.js 24).

```sh
npm ci
npm run dev
```

```sh
npm run build
npm run preview
```

## UI features

- รายการใบสั่งซื้อ (ซ้าย) + รายละเอียด (ขวา): รูปต้นฉบับคู่ฟอร์ม จัดกลุ่มเป็น ข้อมูลบิล / ลูกค้า / ที่อยู่จัดส่ง / รายการสินค้า / หมายเหตุ
- แท็บ รอตรวจ / ส่งต่อแล้ว / ทั้งหมด พร้อมค้นหาและกรองสาขา
- บันทึกอัตโนมัติทุกครั้งที่แก้ (ไม่มีปุ่มบันทึก) ใน localStorage
- ช่องที่ OCR ไม่แน่ใจถูกไฮไลต์ ช่องที่ไม่ผ่านกฎบอกวิธีแก้ และพาไปที่ช่องแรกที่ผิด
- ตรวจข้อมูล: เบอร์โทร 10 หลัก, รหัสไปรษณีย์ 5 หลัก, ช่องบังคับ, วันที่ถูกต้อง, ยอด > 0
- เตือนเมื่อยอดในใบสั่งซื้อไม่ตรงกับใบเสร็จที่แนบ (ไม่บล็อกการส่ง)
- วันที่แบบไทย (วัน / เดือน / ปี พ.ศ.) เก็บเป็น ค.ศ. ภายใน
- ยืนยันก่อนเข้าคิวจำลอง ล็อกใบที่เข้าคิวแล้ว และเปิดใบถัดไปให้อัตโนมัติ
- ซูมรูป ดูข้อความ OCR ต้นฉบับ (ไม่เปลี่ยนตามที่แก้) จำลองใบใหม่โดยไม่ทับข้อมูลที่กำลังแก้
- โทนน้ำเงินเทา ตัวอักษรอย่างน้อย 14px ความต่างสีผ่าน WCAG AA และมือถือแสดงทีละส่วน (รายการ → รายละเอียด)
- ปุ่ม "มุมมองมือถือ" ที่หัวหน้าจอ: บนจอใหญ่จะแสดงเป็นเลเอาต์มือถือ (กรอบกว้างแบบโทรศัพท์) กดอีกครั้งเพื่อกลับ และจำค่าไว้ในเบราว์เซอร์

## OCR (อัปโหลดรูป → อ่านข้อมูล)

กดปุ่ม **อัปโหลดใบสั่งซื้อ** เลือกรูป แล้วระบบอ่านข้อมูลลงฟอร์มให้ ช่องที่ไม่แน่ใจจะถูกไฮไลต์เหลือง คนตรวจและแก้ก่อนส่งต่อเหมือนเดิม (ยังไม่ดึงรูปจาก LINE และยังไม่ส่งเข้า JST จริง)

```sh
cp .env.example .env     # ใส่ OCR_PROVIDER และคีย์ (ไฟล์ .env ไม่ถูก commit)
npm run dev
```

| `OCR_PROVIDER` | ทำอะไร | ต้องใส่ใน `.env` |
|---|---|---|
| `mock` (ค่าเริ่มต้น) | **โหมดสาธิต ไม่ได้อ่านรูปจริง** คืนข้อมูลสมมติเพื่อทดลองขั้นตอน | — |
| `gemini` | ส่งรูปให้ Gemini API คืน JSON ตาม schema | `GEMINI_API_KEY` (`GEMINI_MODEL` ไม่บังคับ ค่าเริ่มต้น `gemini-2.5-flash` — ตรวจรุ่นและโควตาที่ AI Studio) |
| `typhoon` | OCR ด้วย Typhoon แล้วดึงฟิลด์ด้วยโมเดลข้อความ (ทดลอง) | `TYPHOON_API_KEY` |

- คีย์อยู่ฝั่งเซิร์ฟเวอร์ (Vite dev server, `server/`) ไม่ถูกส่งไปที่เบราว์เซอร์ เบราว์เซอร์ย่อรูป (ลบ EXIF) แล้วส่งเฉพาะรูป ไม่ส่งชื่อผู้ส่งหรือข้อมูลอื่น
- ระบบแปลงวันที่ พ.ศ./ค.ศ. (รวมปีย่อ `69`), เบอร์โทร และยอดเงินเอง แล้วประเมินความมั่นใจจากกฎตรวจ (ไม่เชื่อค่าความมั่นใจที่โมเดลบอก); ช่องที่ไม่ผ่านกฎหรือโมเดลบอกว่าไม่แน่ใจ → "ตรวจกับรูป"
- ตรวจใบซ้ำ: เลขที่บิลและยอดตรงกับใบที่มีอยู่ → แจ้ง "อาจเป็นใบซ้ำ"
- **ชั้นฟรีของผู้ให้บริการอาจนำข้อมูลไปพัฒนาผลิตภัณฑ์** ใบสั่งซื้อมีข้อมูลลูกค้า (ความเสี่ยงที่เจ้าของโปรเจกต์รับไว้แล้ว ดู Decision Log D6) รูปที่อัปโหลดถูกเก็บใน localStorage ของเบราว์เซอร์นี้ ใช้เฉพาะเครื่องที่ไว้ใจได้
- `npm run build` / `vite preview` **ไม่มี API OCR** (เป็นแค่ middleware ตอน dev) ตอนขึ้นระบบจริงให้ย้ายตรรกะใน `server/ocr` ไปไว้ใน Supabase Edge Function หรือเซิร์ฟเวอร์จริง
- โค้ดของ Gemini และ Typhoon ทดสอบด้วย fetch จำลองเท่านั้น **ยังไม่เคยเรียก API จริง** ต้องลองด้วยคีย์จริงก่อนเชื่อถือ

### เปรียบเทียบผู้ให้บริการ (bake-off)

```sh
# โฟลเดอร์ที่มี ชื่อ.jpg คู่กับ ชื่อ.expected.json (ค่าที่คนตรวจแล้ว ชื่อฟิลด์เหมือนระเบียนในแอป)
node --env-file=.env scripts/ocr-bakeoff.js ./samples --providers=gemini,typhoon
```

พิมพ์เฉพาะคะแนนต่อฟิลด์ (ไม่พิมพ์ข้อมูลลูกค้า) เป้าของฟิลด์สำคัญ — เลขที่บิล ยอด เบอร์โทร ที่อยู่ รหัสไปรษณีย์ — คือถูก ≥ 90% ก่อนคนตรวจ อย่า commit รูปหรือไฟล์เฉลยที่มีข้อมูลลูกค้าจริงเข้า repo

## Demo boundaries

This is a prototype, not a production integration. Apart from the optional OCR call above, no requests are sent to LINE, Supabase or JST. All sample receipts, OCR confidence values, timestamps, users and LINE groups are sample data. Receipt images are generated SVG illustrations, not actual customer documents. The JST action only queues a local demo record and never claims external completion. Every edit and queue operation is saved automatically in this browser. Clear localStorage key `receipt-desk-demo-v2` to reset the demo. The seeded customers, phone numbers and addresses are invented. Uploading a real order photo sends it to the configured OCR provider (see above) and keeps a copy in this browser, so use it only on a trusted machine.

Google Fonts is optional; system fonts are used when it cannot load. Do not use real customer data in this prototype on a shared browser.

## Tests

```sh
npx playwright install chromium
npm test
```

If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test` instead of downloading a browser.

Unit tests cover date/amount/phone parsing, the OCR response normaliser, Gemini and Typhoon request/response handling (mocked fetch) and key/image leakage. Playwright covers the upload flow in demo mode, OCR failures, missing keys and duplicates, plus auto-save, filtering, incoming-row preservation, validation messages and focus, amount-mismatch warning, JST confirmation/locking/next-order flow, item editing, Thai date input, original OCR preservation, mobile list/detail navigation, the phone-layout toggle and minimum text size.

## Next integration steps

Add Supabase Auth/RLS and private Storage, server-side validation and idempotent queue submission, a verified LINE webhook, OCR worker, and the confirmed JST integration. UI state and localStorage are not authorization or concurrency controls.
