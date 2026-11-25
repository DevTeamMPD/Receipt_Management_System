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
