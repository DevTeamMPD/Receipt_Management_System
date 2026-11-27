import { test, expect } from '@playwright/test';
import { installApi } from './helpers/installApi.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const item = (page, name) => page.getByRole('button', { name: new RegExp(name) });
const confirmBtn = page => page.getByRole('button', { name: 'ยืนยันข้อมูลถูกต้อง' });
const saved = page => page.getByRole('status').filter({ hasText: 'บันทึกอัตโนมัติแล้ว' });

async function open(page, opts) {
  const api = await installApi(page, opts);
  await page.goto('/');
  return api;
}

test('shows the login screen, rejects bad credentials and people outside the allowlist, then lets staff in', async ({ page }) => {
  await open(page, { login: false });
  await expect(page.getByRole('form', { name: 'เข้าสู่ระบบ' })).toBeVisible();
  await expect(page.locator('.order-list')).toHaveCount(0);
  const submit = async (email, password) => {
    await page.getByLabel('อีเมล').fill(email);
    await page.getByLabel('รหัสผ่าน').fill(password);
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  };
  await submit('staff@example.com', 'wrong');
  await expect(page.getByRole('alert')).toContainText('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  await submit('outsider@example.com', 'pw');
  await expect(page.getByRole('alert')).toContainText('ไม่มีสิทธิ์ใช้ระบบ');
  await submit('staff@example.com', 'pw');
  await expect(page.locator('.order-list li')).toHaveCount(2);
});

test('a returning session skips login, and logging out brings it back', async ({ page }) => {
  await open(page);
  await expect(page.getByText('สมชาย ตัวอย่าง').first()).toBeVisible();
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page.getByRole('form', { name: 'เข้าสู่ระบบ' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('form', { name: 'เข้าสู่ระบบ' })).toBeVisible();
});

test('the empty state explains what to do', async ({ page }) => {
  await open(page, { seed: false });
  await expect(page.getByText('ยังไม่มีใบสั่งซื้อ')).toBeVisible();
  await expect(page.getByText('กด "อัปโหลดใบสั่งซื้อ" เพื่อเริ่ม')).toBeVisible();
});

test('no demo leftovers: no sample banner, no simulate button, nothing stored in the browser', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('button', { name: /จำลอง/ })).toHaveCount(0);
  await expect(page.getByText('ข้อมูลตัวอย่าง')).toHaveCount(0);
  await expect(page.getByText(/คิวจำลอง|ระบบทดลอง|โหมดสาธิต/)).toHaveCount(0);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter(k => k.startsWith('receipt-desk-demo'))).toEqual([]);
});

test('edits are saved automatically through the API and survive a reload', async ({ page }) => {
  const api = await open(page);
  await page.getByLabel('ชื่อลูกค้า').fill('ลูกค้าทดสอบ');
  await expect(saved(page)).toBeVisible();
  expect(api.sb.db.orders.find(o => o.id === api.rows.todo.id).customer_name).toBe('ลูกค้าทดสอบ');
  await page.reload();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('ลูกค้าทดสอบ');
});

test('invalid data shows what to fix, focuses the first problem and does not open the confirm dialog', async ({ page }) => {
  await open(page);
  await item(page, 'วิภา').click();
  await confirmBtn(page).click();
  await expect(page.getByText('เบอร์โทรต้องมี 10 หลัก ขึ้นต้นด้วย 0')).toBeVisible();
  await expect(page.getByLabel('เบอร์โทร')).toBeFocused();
  await expect(page.getByText('ต้องแก้อีก 1 จุดก่อนยืนยัน')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('OCR ไม่แน่ใจ ตรวจกับรูป').first()).toBeVisible();
});

test('amount mismatch with the receipt is a warning, not a blocker', async ({ page }) => {
  await open(page);
  await expect(page.getByText('ยอดไม่ตรงกับใบเสร็จ').first()).toBeVisible();
  await expect(page.getByText(/ต่างกัน ฿300.00/)).toBeVisible();
  await confirmBtn(page).click();
  await expect(page.getByRole('dialog')).toContainText('฿15,350.00');
  await expect(page.getByRole('dialog')).toContainText('ยอดไม่ตรงกับใบเสร็จ');
});

test('confirming locks the order, moves it to the JST tab and opens the next order; then it can be marked as done in JST', async ({ page }) => {
  const api = await open(page);
  await confirmBtn(page).click();
  await expect(page.getByRole('dialog')).toContainText('สมชาย ตัวอย่าง');
  await page.getByRole('dialog').getByRole('button', { name: 'กลับไปตรวจ' }).click();
  await confirmBtn(page).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ยืนยัน', exact: true }).click();
  await expect(page.getByText(/ยืนยันแล้ว — รอลงใน JST/)).toBeVisible();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('วิภา ตัวอย่าง'); // เปิดใบถัดไปให้
  expect(api.sb.db.orders.find(o => o.id === api.rows.todo.id).review_status).toBe('confirmed');
  await page.getByRole('tab', { name: /รอลง JST/ }).click();
  await expect(page.locator('.order-list li')).toHaveCount(2);
  await item(page, 'สมชาย').click();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'ทำเครื่องหมายว่าลง JST แล้ว' }).click();
  await page.getByRole('tab', { name: /เสร็จสิ้น/ }).click();
  await expect(page.locator('.order-list li')).toHaveCount(1);
  await expect(page.getByText('ลง JST แล้ว').first()).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: /เสร็จสิ้น/ }).click();
  await expect(page.locator('.order-list li')).toHaveCount(1);
});

test('a confirmed order can be reopened for editing before it is done in JST', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: /รอลง JST/ }).click();
  await page.getByRole('button', { name: 'ย้อนกลับไปแก้ไข' }).click();
  await page.getByRole('tab', { name: /รอตรวจ/ }).click();
  await item(page, 'อรทัย').click();
  await expect(page.getByLabel('ชื่อลูกค้า')).not.toHaveAttribute('readonly', '');
});

test('rejecting needs a reason and ends the order', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'ปฏิเสธใบนี้' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'ปฏิเสธใบนี้' })).toBeDisabled();
  await dialog.getByLabel('เหตุผล').fill('รูปซ้ำกับใบก่อนหน้า');
  await dialog.getByRole('button', { name: 'ปฏิเสธใบนี้' }).click();
  await expect(page.getByText(/ปฏิเสธแล้ว/).first()).toBeVisible();
  await page.getByRole('tab', { name: /เสร็จสิ้น/ }).click();
  await item(page, 'สมชาย').click();
  await expect(page.getByText('รูปซ้ำกับใบก่อนหน้า')).toBeVisible();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveAttribute('readonly', '');
});

test('a wrongly pulled order can be deleted from the list after confirming; locked orders have no delete button', async ({ page }) => {
  const api = await open(page);
  await expect(page.locator('.order-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'ลบ ' + api.rows.check.code }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'ลบใบนี้?' })).toBeVisible();
  await expect(dialog).toContainText('วิภา ตัวอย่าง');
  await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
  await expect(page.locator('.order-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'ลบ ' + api.rows.check.code }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ลบใบนี้' }).click();
  await expect(page.getByText(`ลบ ${api.rows.check.code} แล้ว`)).toBeVisible();
  await expect(page.locator('.order-list li')).toHaveCount(1);
  expect(api.sb.db.orders.find(o => o.id === api.rows.check.id)).toBeUndefined();
  await page.getByRole('tab', { name: /รอลง JST/ }).click();
  await expect(page.getByRole('button', { name: 'ลบ ' + api.rows.confirmed.code })).toHaveCount(0);
});

test('when someone else changed the order, the user is told and can reload', async ({ page }) => {
  const api = await open(page);
  api.sb.db.orders.find(o => o.id === api.rows.todo.id).version += 1; // คนอื่นแก้ไปแล้ว
  api.sb.db.orders.find(o => o.id === api.rows.todo.id).customer_name = 'ชื่อที่คนอื่นแก้';
  await page.getByLabel('ชื่อลูกค้า').fill('ชื่อของฉัน');
  await expect(page.getByText('ใบนี้ถูกแก้โดยคนอื่นแล้ว กรุณาโหลดใหม่')).toBeVisible();
  await page.getByRole('button', { name: 'โหลดใหม่' }).click();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('ชื่อที่คนอื่นแก้');
  await expect(saved(page)).toBeVisible();
});

test('a failed save is shown and can be retried without losing the edit', async ({ page }) => {
  const api = await open(page);
  api.failNext('PATCH');
  await page.getByLabel('ชื่อลูกค้า').fill('แก้ตอนเน็ตเสีย');
  await expect(page.getByText(/บันทึกไม่สำเร็จ/)).toBeVisible();
  await page.getByRole('button', { name: 'ลองใหม่' }).click();
  await expect(saved(page)).toBeVisible();
  expect(api.sb.db.orders.find(o => o.id === api.rows.todo.id).customer_name).toBe('แก้ตอนเน็ตเสีย');
});

test('items can be added and removed and are saved', async ({ page }) => {
  const api = await open(page);
  await expect(page.getByLabel('สินค้า 2')).toBeVisible();
  await page.getByRole('button', { name: 'ลบรายการ 2' }).click();
  await page.getByRole('button', { name: 'เพิ่มรายการสินค้า' }).click();
  await page.getByLabel('สินค้า 2').fill('สินค้าใหม่');
  await expect(saved(page)).toBeVisible();
  expect(api.sb.db.items.filter(i => i.order_id === api.rows.todo.id).map(i => i.product)).toEqual(['คอกกั้นเด็ก', 'สินค้าใหม่']);
});

test('Thai date field stores a Gregorian date and rejects impossible dates', async ({ page }) => {
  const api = await open(page);
  const day = page.getByLabel('วันที่สั่งซื้อ วัน');
  await day.fill('31');
  await page.getByLabel('วันที่สั่งซื้อ เดือน').selectOption('2');
  await confirmBtn(page).click();
  await expect(page.getByText('กรอกวันที่สั่งซื้อให้ครบและถูกต้อง')).toBeVisible();
  await day.fill('28');
  await expect(page.getByText('กรอกวันที่สั่งซื้อให้ครบและถูกต้อง')).toHaveCount(0);
  await expect(saved(page)).toBeVisible();
  expect(api.sb.db.orders.find(o => o.id === api.rows.todo.id).order_date).toBe('2026-02-28');
});

test('search, branch and tab filters work together and can be reset', async ({ page }) => {
  await open(page);
  await page.getByRole('combobox', { name: 'กรองสาขา' }).selectOption('ลาดพร้าว');
  await expect(page.locator('.order-list li')).toHaveCount(1);
  await expect(page.locator('.order-list li')).toContainText('วิภา');
  await page.getByRole('textbox', { name: 'ค้นหาใบสั่งซื้อ' }).fill('ไม่มีคนนี้');
  await expect(page.getByText('ไม่พบใบสั่งซื้อในมุมมองนี้')).toBeVisible();
  await page.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
  await expect(page.locator('.order-list li')).toHaveCount(2);
});

test('uploading a photo creates an order with the photo, OCR result and highlighted doubts', async ({ page }) => {
  const api = await open(page);
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /อัปโหลดและอ่านใบสั่งซื้อ/ })).toBeDisabled();
  await dialog.getByLabel('รูปใบสั่งซื้อ').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: PNG });
  await dialog.getByLabel('สาขาที่ส่งมา').selectOption('บางนา');
  await dialog.getByRole('button', { name: /อัปโหลดและอ่านใบสั่งซื้อ/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.order-list li').first()).toContainText('Sales · บางนา');
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue(/ลูกค้าสาธิต/);
  await expect(page.getByRole('img', { name: /รูปใบสั่งซื้อ RCP-/ })).toBeVisible();
  expect(api.sb.db.files).toHaveLength(1);
  expect(api.sb.db.events.map(e => e.action)).toEqual(['created']);
  await page.getByRole('button', { name: 'ดูข้อความ OCR ดิบ' }).click();
  await expect(page.getByRole('dialog')).toContainText('docType');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.order-list li')).toHaveCount(3);
});

test('a failed read can be retried from the banner and only fills the blank fields', async ({ page }) => {
  const { makeRow } = await import('./helpers/fakeSupabase.js');
  const api = await installApi(page, { seed: false });
  const row = makeRow({ ocr_status: 'failed', review_status: 'needs_check', image_path: 'img/retry.png', bill_number: '', total: null, customer_name: 'พิมพ์ไว้แล้ว', phone: '', address: '', sub_district: '', district: '', province: '', postcode: '', order_date: null, ocr_confidence: null, ocr_raw_text: null });
  api.sb.db.orders.push(row);
  api.sb.db.blobs = { 'img/retry.png': PNG };
  await page.goto('/');
  await expect(page.getByText('อ่านรูปอัตโนมัติไม่สำเร็จ')).toBeVisible();
  await page.getByRole('button', { name: 'อ่านรูปใหม่' }).click();
  await expect(page.getByText('อ่านรูปอัตโนมัติไม่สำเร็จ')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /อ่านรูป RCP-\d+ แล้ว/ })).toBeVisible();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('พิมพ์ไว้แล้ว');
  await expect(page.getByLabel('เลขที่บิล')).not.toHaveValue('');
});

test('the full-size photo can be zoomed, panned, rotated and reset', async ({ page }) => {
  await installApi(page);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="#eee"/><text x="100" y="200" font-size="80">ใบสั่งซื้อ</text></svg>';
  await page.route('**/storage/v1/object/sign/**', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }));
  await page.goto('/');
  await page.getByRole('button', { name: /ขยายรูปใบสั่งซื้อ/ }).click();
  const dialog = page.getByRole('dialog');
  const level = dialog.locator('.zoom-level');
  await expect(level).toHaveText('100%');
  await expect(dialog.getByRole('button', { name: 'ซูมออก' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'ซูมเข้า' }).click();
  await expect(level).toHaveText('150%');
  const box = dialog.locator('.zoom-box');
  await box.focus();
  await page.keyboard.press('+');
  await expect(level).toHaveText('225%');
  await page.keyboard.press('ArrowRight');
  await expect(box.locator('img')).toHaveAttribute('style', /translate\(-40px, 0px\)/);
  await dialog.getByRole('button', { name: 'หมุนรูป 90 องศา' }).click();
  await expect(level).toHaveText('100%');
  await expect(box.locator('img')).toHaveAttribute('style', /rotate\(90deg\)/);
  await dialog.getByRole('button', { name: 'ซูมเข้า' }).click();
  await dialog.getByRole('button', { name: 'พอดีจอ' }).click();
  await expect(level).toHaveText('100%');
});

test('uploading without OCR configured keeps the photo and asks for manual entry', async ({ page }) => {
  const api = await open(page, { env: { OCR_PROVIDER: '' } });
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  await expect(page.getByRole('dialog')).toContainText('ยังไม่ได้ตั้งค่า OCR');
  await page.getByRole('dialog').getByLabel('รูปใบสั่งซื้อ').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('dialog').getByRole('button', { name: /อัปโหลดและอ่านใบสั่งซื้อ/ }).click();
  await expect(page.getByText('ใบนี้ไม่ได้ผ่าน OCR')).toBeVisible();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('');
  expect(api.sb.db.files).toHaveLength(1);
});

test('an upload failure shows the reason and adds nothing', async ({ page }) => {
  const api = await open(page);
  api.failNext('POST', 502);
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  await page.getByRole('dialog').getByLabel('รูปใบสั่งซื้อ').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('dialog').getByRole('button', { name: /อัปโหลดและอ่านใบสั่งซื้อ/ }).click();
  await expect(page.getByRole('alert')).toContainText('ระบบขัดข้องชั่วคราว');
  await expect(page.getByRole('dialog').getByRole('button', { name: /อัปโหลดและอ่านใบสั่งซื้อ/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.order-list li')).toHaveCount(2);
});

test('mobile shows list then detail without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect(page.getByRole('tab', { name: /รอตรวจ/ })).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await item(page, 'วิภา').click();
  await expect(page.getByLabel('เบอร์โทร')).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await page.getByRole('button', { name: 'กลับไปรายการ' }).click();
  await expect(page.getByRole('tab', { name: /รอตรวจ/ })).toBeVisible();
});

test('layout toggle shows the phone layout on a desktop screen and remembers it', async ({ page }) => {
  await open(page);
  const toggle = page.getByRole('button', { name: 'มุมมองมือถือ' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect((await page.locator('.frame').boundingBox()).width).toBeGreaterThan(1000);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await page.locator('.frame').boundingBox()).width).toBeLessThanOrEqual(420);
  await expect(page.locator('.detail-pane')).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'มุมมองมือถือ' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'มุมมองมือถือ' }).click();
  await expect(page.locator('.detail-pane')).toBeVisible();
});

test('renders without JavaScript errors and keeps readable text sizes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await open(page);
  await expect(page.locator('.order-list li')).toHaveCount(2);
  const tiny = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).length);
  expect(tiny).toBe(0);
  expect(errors).toEqual([]);
});

test('LINE groups dialog lists the groups the bot is in and lets an admin map a branch', async ({ page }) => {
  const api = await installApi(page, { env: { LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_ACCESS_TOKEN: 't' } });
  api.sb.users['staff@example.com'].role = 'admin';
  api.sb.db.receipt_line_groups = [
    { group_id: 'Cmapped', group_name: 'Sales รังสิต', branch: 'รังสิต', active: true, created_at: '2026-11-20T03:00:00Z' },
    { group_id: 'Cwaiting', group_name: 'ทีมขายใหม่', branch: null, active: true, created_at: '2026-11-24T03:00:00Z' },
  ];
  api.sb.db.receipt_line_inbox = [
    { id: '10000000-0000-4000-8000-000000000001', message_id: 'a', group_id: 'Cmapped', branch: 'รังสิต', status: 'order', attempts: 1, created_at: '2026-11-25T08:00:00Z', updated_at: '2026-11-25T08:00:00Z' },
    { id: '10000000-0000-4000-8000-000000000002', message_id: 'b', group_id: 'Cwaiting', branch: null, status: 'pending', attempts: 0, created_at: '2026-11-25T09:00:00Z', updated_at: '2026-11-25T09:00:00Z' },
  ];
  await page.goto('/');
  await page.getByRole('button', { name: 'กลุ่ม LINE' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('heading', { name: 'กลุ่ม LINE ที่บอทอยู่' })).toBeVisible();
  await expect(dlg.locator('.lg-item')).toHaveCount(2);
  await expect(dlg.locator('.lg-item').first()).toContainText('ได้ใบ 1');
  await expect(dlg.locator('.lg-item').nth(1)).toContainText('ยังไม่ผูกสาขา');
  await expect(dlg.locator('.lg-item').nth(1)).toContainText('รอผูกสาขา 1 รูป');
  // ค้นหา/กรองเฉพาะกลุ่มที่ยังไม่ผูก
  await dlg.getByRole('button', { name: /ยังไม่ผูกสาขา 1/ }).click();
  await expect(dlg.locator('.lg-item')).toHaveCount(1);
  await dlg.getByRole('button', { name: /ทั้งหมด 2/ }).click();
  await dlg.getByLabel('ค้นหากลุ่มหรือสาขา').fill('รังสิต');
  await expect(dlg.locator('.lg-item')).toHaveCount(1);
  await dlg.getByLabel('ค้นหากลุ่มหรือสาขา').fill('');
  await dlg.getByLabel('สาขาของกลุ่ม ทีมขายใหม่').fill('สยาม');
  await dlg.locator('.lg-item').nth(1).getByRole('button', { name: 'ผูก', exact: true }).click();
  await expect(dlg.getByRole('status').filter({ hasText: 'ผูกกับสาขาสยามแล้ว' })).toContainText('กำลังดึงรูปที่รออยู่ 1 รูป');
  await expect(dlg.locator('.lg-item').nth(1)).toContainText('กำลังรับรูป');
  expect(api.sb.db.receipt_line_inbox[1].branch).toBe('สยาม');
});

test('an admin pastes a branch list; groups named after a branch are mapped, and the new branches show up in the app', async ({ page }) => {
  const api = await installApi(page, { env: { LINE_CHANNEL_SECRET: 's', LINE_CHANNEL_ACCESS_TOKEN: 't' } });
  api.sb.users['staff@example.com'].role = 'admin';
  api.sb.db.receipt_branches = ['สยาม', 'ลาดพร้าว', 'บางนา', 'รังสิต'].map(name => ({ name, active: true }));
  api.sb.db.receipt_line_groups = [
    { group_id: 'Cseacon', group_name: 'Sales ซีคอนสแควร์', branch: null, active: true, created_at: '2026-11-24T03:00:00Z' },
    { group_id: 'Cother', group_name: 'ทีมขายรวม', branch: null, active: true, created_at: '2026-11-24T04:00:00Z' },
  ];
  await page.goto('/');
  await page.getByRole('button', { name: 'กลุ่ม LINE' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByText(/สาขาทั้งหมด 4 สาขา/).click();
  await dlg.getByRole('textbox', { name: /วางรายชื่อ/ }).fill('ซีคอนสแควร์\nเมกา บางนา\nสยาม');
  await dlg.getByRole('button', { name: 'เพิ่มสาขา', exact: true }).click();
  await expect(dlg.getByRole('status').filter({ hasText: 'เพิ่ม 2 สาขา' })).toContainText('ผูกกลุ่มจากชื่อกลุ่มให้ 1 กลุ่ม');
  await expect(dlg.locator('.lg-item').first()).toContainText('กำลังรับรูป');
  await expect(dlg.getByLabel('สาขาของกลุ่ม Sales ซีคอนสแควร์')).toHaveValue('ซีคอนสแควร์');
  // ชื่อสาขาใหม่ตอนผูก: ปุ่มบอกว่าจะเพิ่มสาขา
  await dlg.getByLabel('สาขาของกลุ่ม ทีมขายรวม').fill('ทีมขายรวม');
  await dlg.locator('.lg-item').nth(1).getByRole('button', { name: 'เพิ่มสาขานี้และผูก' }).click();
  await expect(dlg.getByRole('status').filter({ hasText: 'เพิ่มสาขาทีมขายรวม และผูก' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('กรองสาขา').locator('option', { hasText: 'เมกา บางนา' })).toHaveCount(1);
});

test('non-admin staff see the LINE groups but cannot change the branch', async ({ page }) => {
  const api = await installApi(page);
  api.sb.db.receipt_line_groups = [{ group_id: 'Cwaiting', group_name: 'ทีมขายใหม่', branch: null, active: true, created_at: '2026-11-24T03:00:00Z' }];
  await page.goto('/');
  await page.getByRole('button', { name: 'กลุ่ม LINE' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.locator('.lg-item')).toContainText('ยังไม่ผูกสาขา');
  await expect(dlg.getByRole('combobox')).toHaveCount(0);
  await expect(dlg).toContainText('ผูกกลุ่มกับสาขาและเพิ่มสาขาได้เฉพาะผู้ดูแล');
  await expect(dlg.getByText(/สาขาทั้งหมด/)).toHaveCount(0);
  await expect(dlg).toContainText('ยังไม่ได้ตั้งค่า LINE');
});

test('when every branch is hidden, the upload form says to add branches first instead of offering the old defaults', async ({ page }) => {
  const api = await installApi(page);
  api.sb.db.receipt_branches = ['สยาม', 'ลาดพร้าว'].map(name => ({ name, active: false }));
  await page.goto('/');
  await expect(page.getByLabel('กรองสาขา').locator('option')).toHaveCount(1); // เหลือแค่ "ทุกสาขา"
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('ยังไม่มีสาขาในระบบ');
  await dlg.getByLabel('รูปใบสั่งซื้อ').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: PNG });
  await expect(dlg.getByRole('button', { name: /อัปโหลดและอ่านใบสั่งซื้อ/ })).toBeDisabled();
});

test('an admin picks the default OCR reader; the other becomes the backup and the upload form says so', async ({ page }) => {
  const api = await installApi(page, { env: { OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', TYPHOON_API_KEY: 't' } });
  api.sb.users['staff@example.com'].role = 'admin';
  api.sb.db.receipt_settings = [];
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่า OCR' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('radio', { name: /Gemini/ })).toBeChecked();
  await expect(dlg).toContainText('สำรอง: Typhoon');
  await expect(dlg).toContainText('ตอนนี้ใช้ค่าเริ่มต้นจากเซิร์ฟเวอร์');
  await dlg.getByRole('radio', { name: /Typhoon/ }).check();
  await dlg.getByRole('button', { name: 'บันทึก' }).click();
  await expect(dlg).toContainText('บันทึกแล้ว');
  expect(api.sb.db.receipt_settings).toEqual([expect.objectContaining({ key: 'ocr_provider', value: 'typhoon' })]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  await expect(page.getByRole('dialog')).toContainText('รูปจะถูกส่งไปที่ typhoon (สำรอง: gemini)');
  await page.keyboard.press('Escape');
  // ค่าที่เลือกอยู่ในฐานข้อมูล — เปิดใหม่ยังเป็น Typhoon
  await page.reload();
  await page.getByRole('button', { name: 'ตั้งค่า OCR' }).click();
  await expect(page.getByRole('dialog').getByRole('radio', { name: /Typhoon/ })).toBeChecked();
});

test('a reader without a key cannot be picked, and staff do not see the OCR setting', async ({ page }) => {
  const api = await installApi(page, { env: { OCR_PROVIDER: 'gemini', GEMINI_API_KEY: 'g' } });
  api.sb.users['staff@example.com'].role = 'admin';
  await page.goto('/');
  await page.getByRole('button', { name: 'ตั้งค่า OCR' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByRole('radio', { name: /Typhoon/ })).toBeDisabled();
  await expect(dlg).toContainText('ไม่มีตัวสำรอง');
  api.sb.users['staff@example.com'].role = 'office_sales';
  await page.reload();
  await expect(page.locator('.order-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'ตั้งค่า OCR' })).toHaveCount(0);
});
