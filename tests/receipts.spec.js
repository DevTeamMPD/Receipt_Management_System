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
