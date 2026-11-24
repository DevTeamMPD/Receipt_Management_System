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

## Demo boundaries

This is a frontend prototype, not a production integration. All receipts, OCR confidence values, timestamps, users and LINE groups are sample data. Receipt images are generated SVG illustrations, not actual customer documents. No requests are sent to LINE, Supabase, OCR services or JST. The JST action only queues a local demo record and never claims external completion. Every edit and queue operation is saved automatically in this browser. Clear localStorage key `receipt-desk-demo-v2` to reset the demo. The sample customers, phone numbers and addresses are invented; never enter real customer data.

Google Fonts is optional; system fonts are used when it cannot load. Do not enter real confidential receipt data into this prototype on a shared browser.

## Tests

```sh
npx playwright install chromium
npm test
```

If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test` instead of downloading a browser.

Tests cover auto-save, filtering, incoming-row preservation, validation messages and focus, amount-mismatch warning, JST confirmation/locking/next-order flow, item editing, Thai date input, original OCR preservation, mobile list/detail navigation, the phone-layout toggle and minimum text size.

## Next integration steps

Add Supabase Auth/RLS and private Storage, server-side validation and idempotent queue submission, a verified LINE webhook, OCR worker, and the confirmed JST integration. UI state and localStorage are not authorization or concurrency controls.
