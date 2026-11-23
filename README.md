# Receipt Desk

ต้นแบบ UI ระบบตรวจใบเสร็จจาก Sales ใน LINE: หนึ่งใบเสร็จต่อหนึ่งแถว พร้อมรูป ข้อมูล OCR ที่แก้ไขได้ และปุ่ม JST

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

- ตารางรูป / แหล่งที่มา / ฟอร์ม OCR / สถานะและการส่ง JST
- ค้นหา กรองตามสาขาและสถานะ ซูมรูป ดูข้อความ OCR ต้นฉบับ
- แก้ร้านค้า เลขใบเสร็จ วันที่ ยอดเงิน และบันทึกใน localStorage
- ตรวจข้อมูลและยืนยันก่อนเข้าคิวจำลอง ล็อกรายการที่เข้าคิวแล้ว
- จำลองรายการใหม่ที่ด้านบน โดยไม่ทับข้อมูลที่กำลังแก้
- รองรับมือถือด้วยตารางเลื่อนแนวนอน

## Demo boundaries

This is a frontend prototype, not a production integration. All receipts, OCR confidence values, timestamps, users and LINE groups are sample data. Receipt images are generated SVG illustrations, not actual customer documents. No requests are sent to LINE, Supabase, OCR services or JST. The JST action only queues a local demo record and never claims external completion. Saving a draft or confirming a queue operation saves all current rows in this browser. Clear localStorage key `receipt-desk-demo-v1` to reset the demo.

Google Fonts is optional; system fonts are used when it cannot load. Do not enter real confidential receipt data into this prototype on a shared browser.

## Tests

```sh
npx playwright install chromium
npm test
```

If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm test` instead of downloading a browser.

Tests cover editing/persistence, filtering, incoming-row preservation, JST confirmation and duplicate prevention, validation, original OCR preservation, and mobile overflow.

## Next integration steps

Add Supabase Auth/RLS and private Storage, server-side validation and idempotent queue submission, a verified LINE webhook, OCR worker, and the confirmed JST integration. UI state and localStorage are not authorization or concurrency controls.
