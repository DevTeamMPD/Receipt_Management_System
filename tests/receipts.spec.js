import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.evaluate(() => localStorage.clear()); await page.reload(); });

const item = (page, name) => page.getByRole('button', { name: new RegExp(name) });
const send = page => page.getByRole('button', { name: 'ยืนยันและส่งต่อเข้า JST' });

test('edits are saved automatically and survive a reload', async ({ page }) => {
  const name = page.getByLabel('ชื่อลูกค้า');
  await name.fill('ลูกค้าทดสอบ');
  await expect(page.getByRole('status').filter({ hasText: 'บันทึกอัตโนมัติแล้ว' })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('ลูกค้าทดสอบ');
});

test('new simulated order is added on top without overwriting an edit in progress', async ({ page }) => {
  await item(page, 'วิภา').click();
  await page.getByLabel('ชื่อลูกค้า').fill('แก้ไว้ก่อน');
  await page.getByRole('button', { name: 'จำลองใบสั่งซื้อใหม่' }).click();
  await expect(page.locator('.order-list li').first()).toContainText('RCP-0025');
  await item(page, 'แก้ไว้ก่อน').click();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('แก้ไว้ก่อน');
  await expect(page.locator('.order-list li')).toHaveCount(4);
});

test('search, branch and tab filters work together and can be reset', async ({ page }) => {
  await page.getByRole('combobox', { name: 'กรองสาขา' }).selectOption('ลาดพร้าว');
  await expect(page.locator('.order-list li')).toHaveCount(1);
  await expect(page.locator('.order-list li')).toContainText('RCP-0023');
  await page.getByRole('textbox', { name: 'ค้นหาใบสั่งซื้อ' }).fill('ไม่มีคนนี้');
  await expect(page.getByText('ไม่พบใบสั่งซื้อที่ค้นหา')).toBeVisible();
  await page.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
  await expect(page.locator('.order-list li')).toHaveCount(4);
  await page.getByRole('tab', { name: /ส่งต่อแล้ว/ }).click();
  await expect(page.locator('.order-list li')).toHaveCount(1);
  await expect(page.locator('.order-list li')).toContainText('RCP-0021');
});

test('invalid data shows what to fix, focuses the first problem and blocks sending', async ({ page }) => {
  await item(page, 'วิภา').click();
  await send(page).click();
  await expect(page.getByText('เบอร์โทรต้องมี 10 หลัก ขึ้นต้นด้วย 0')).toBeVisible();
  await expect(page.getByLabel('เบอร์โทร')).toBeFocused();
  await expect(page.getByText('ต้องแก้อีก 1 จุดก่อนส่งต่อ')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('เบอร์โทร').fill('0812345678');
  await expect(page.getByText('เบอร์โทรต้องมี 10 หลัก ขึ้นต้นด้วย 0')).toHaveCount(0);
  await expect(page.getByText('บันทึกอัตโนมัติแล้ว')).toBeVisible();
});

test('amount mismatch with the receipt is a warning, not a blocker', async ({ page }) => {
  await expect(page.getByText('ยอดไม่ตรงกับใบเสร็จ').first()).toBeVisible();
  await expect(page.getByText('ต่างกัน ฿300.00')).toBeVisible();
  await send(page).click();
  await expect(page.getByRole('dialog')).toContainText('ยอดไม่ตรงกับใบเสร็จ');
  await expect(page.getByRole('dialog')).toContainText('฿15,350.00');
});

test('sending needs confirmation, locks the order, opens the next one and persists', async ({ page }) => {
  await send(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('สมชาย ตัวอย่างหนึ่ง');
  await dialog.getByRole('button', { name: 'กลับไปตรวจ' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('สมชาย ตัวอย่างหนึ่ง');
  await send(page).click();
  await page.getByRole('button', { name: 'ยืนยันเข้าคิวจำลอง' }).click();
  await expect(page.getByText('RCP-0024 เข้าคิวจำลองแล้ว')).toBeVisible();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue('วิภา ตัวอย่างสอง');
  await page.getByRole('tab', { name: /ส่งต่อแล้ว/ }).click();
  await expect(page.locator('.order-list li')).toHaveCount(2);
  await item(page, 'สมชาย').click();
  await expect(page.getByRole('button', { name: 'อยู่ในคิวแล้ว' })).toBeDisabled();
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveAttribute('readonly', '');
  await page.reload();
  await page.getByRole('tab', { name: /ส่งต่อแล้ว/ }).click();
  await expect(page.locator('.order-list li')).toHaveCount(2);
});

test('items can be added and removed', async ({ page }) => {
  await expect(page.getByLabel('สินค้า 4')).toBeVisible();
  await page.getByRole('button', { name: 'ลบรายการ 4' }).click();
  await expect(page.getByLabel('สินค้า 4')).toHaveCount(0);
  await page.getByRole('button', { name: 'เพิ่มรายการสินค้า' }).click();
  await page.getByLabel('สินค้า 4').fill('สินค้าใหม่');
  await page.reload();
  await expect(page.getByLabel('สินค้า 4')).toHaveValue('สินค้าใหม่');
});

test('Thai date field stores a Gregorian date and rejects impossible dates', async ({ page }) => {
  const day = page.getByLabel('วันที่สั่งซื้อ วัน');
  await day.fill('31');
  await page.getByLabel('วันที่สั่งซื้อ เดือน').selectOption('2');
  await send(page).click();
  await expect(page.getByText('กรอกวันที่สั่งซื้อให้ครบและถูกต้อง')).toBeVisible();
  await day.fill('28');
  await expect(page.getByText('กรอกวันที่สั่งซื้อให้ครบและถูกต้อง')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('วันที่สั่งซื้อ วัน')).toHaveValue('28');
  await expect(page.getByLabel('วันที่สั่งซื้อ ปี พ.ศ.')).toHaveValue('2569');
});

test('raw OCR text stays unchanged by edits and dialogs close with Escape', async ({ page }) => {
  await page.getByLabel('ชื่อลูกค้า').fill('ชื่อที่แก้ใหม่');
  await page.getByRole('button', { name: 'ดูข้อความ OCR ดิบ' }).click();
  await expect(page.getByRole('dialog')).toContainText('สมชาย ตัวอย่างหนึ่ง');
  await expect(page.getByRole('dialog')).not.toContainText('ชื่อที่แก้ใหม่');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /ขยายรูปใบสั่งซื้อ RCP-0024/ }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'ภาพใบสั่งซื้อตัวอย่างขนาดใหญ่' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('mobile shows list then detail without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await expect(page.getByRole('tab', { name: /รอตรวจ/ })).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await item(page, 'วิภา').click();
  await expect(page.getByLabel('เบอร์โทร')).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await page.getByRole('button', { name: 'กลับไปรายการ' }).click();
  await expect(page.getByRole('tab', { name: /รอตรวจ/ })).toBeVisible();
});

test('renders without JavaScript errors and keeps readable text sizes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.reload();
  await expect(page.locator('.order-list li')).toHaveCount(3);
  const tiny = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).length);
  expect(tiny).toBe(0);
  expect(errors).toEqual([]);
});

test('layout toggle shows the phone layout on a desktop screen and remembers it', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'มุมมองมือถือ' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect((await page.locator('.frame').boundingBox()).width).toBeGreaterThan(1000);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect((await page.locator('.frame').boundingBox()).width).toBeLessThanOrEqual(420);
  await expect(page.locator('.detail-pane')).toBeHidden();
  await page.getByRole('button', { name: /วิภา/ }).click();
  await expect(page.getByLabel('เบอร์โทร')).toBeVisible();
  await expect(page.locator('.list-pane')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'มุมมองมือถือ' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'มุมมองมือถือ' }).click();
  await expect(page.locator('.detail-pane')).toBeVisible();
  await expect(page.locator('.list-pane')).toBeVisible();
  expect((await page.locator('.frame').boundingBox()).width).toBeGreaterThan(1000);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = async (page, branch) => {
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('รูปใบสั่งซื้อ').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: PNG });
  if (branch) await dialog.getByLabel('สาขาที่ส่งมา').selectOption(branch);
  await dialog.getByRole('button', { name: 'อ่านใบสั่งซื้อ' }).click();
};

test('uploading a photo reads it, adds a new order on top and keeps the image after reload (demo provider)', async ({ page, request }) => {
  test.skip((await (await request.get('/api/ocr/status')).json()).provider !== 'mock', 'ต้องรันกับโหมดสาธิต');
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  await expect(page.getByRole('dialog')).toContainText('ไม่ได้อ่านรูปจริง');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'อ่านใบสั่งซื้อ' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await upload(page, 'บางนา');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.order-list li').first()).toContainText('RCP-0025');
  await expect(page.locator('.order-list li').first()).toContainText('Sales · บางนา');
  await expect(page.getByLabel('ชื่อลูกค้า')).toHaveValue(/ลูกค้าสาธิต/);
  await expect(page.getByText('ข้อมูลจากโหมดสาธิต')).toBeVisible();
  await expect(page.getByRole('img', { name: 'รูปใบสั่งซื้อ RCP-0025' })).toHaveAttribute('src', /^data:image\/jpeg/);
  await page.getByRole('button', { name: 'ดูข้อความ OCR ดิบ' }).click();
  await expect(page.getByRole('dialog')).toContainText('docType');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('img', { name: 'รูปใบสั่งซื้อ RCP-0025' })).toBeVisible();
});

test('uploading the same photo twice flags the second order as a possible duplicate', async ({ page, request }) => {
  test.skip((await (await request.get('/api/ocr/status')).json()).provider !== 'mock', 'ต้องรันกับโหมดสาธิต');
  await upload(page);
  await upload(page);
  await expect(page.locator('.order-list li').first()).toContainText('RCP-0026');
  await expect(page.getByText('อาจเป็นใบซ้ำ')).toBeVisible();
  await expect(page.getByText('เลขที่บิลและยอดตรงกับ RCP-0025')).toBeVisible();
  await expect(page.locator('.order-list li').first()).toContainText('อาจซ้ำ');
});

test('an OCR failure shows the reason, adds nothing, and lets the user retry', async ({ page }) => {
  await page.route('**/api/ocr', route => route.request().method() === 'POST' ? route.fulfill({ status: 429, json: { error: 'โควตา Gemini เต็มชั่วคราว ลองใหม่ภายหลังหรือให้คนพิมพ์เอง' } }) : route.continue());
  await upload(page);
  await expect(page.getByRole('alert')).toContainText('โควตา Gemini เต็มชั่วคราว');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'อ่านใบสั่งซื้อ' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('.order-list li')).toHaveCount(3);
});

test('a provider without its key is reported before any photo is sent', async ({ page }) => {
  await page.route('**/api/ocr/status', route => route.fulfill({ json: { provider: 'gemini', demo: false, configured: false, known: true } }));
  await page.getByRole('button', { name: 'อัปโหลดใบสั่งซื้อ' }).click();
  await expect(page.getByRole('dialog')).toContainText('ยังไม่ได้ใส่คีย์ของ gemini');
  await page.getByRole('dialog').getByLabel('รูปใบสั่งซื้อ').setInputFiles({ name: 'order.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('dialog').getByRole('button', { name: 'อ่านใบสั่งซื้อ' })).toBeDisabled();
});
