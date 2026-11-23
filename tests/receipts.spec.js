import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('edits persist after saving and incoming rows preserve edits', async ({ page }) => {
  const merchant = page.getByRole('textbox', { name: 'ร้านค้า RCP-0024', exact: true });
  await merchant.fill('ร้านทดสอบ');
  await page.getByRole('button', { name: 'จำลองใบเสร็จใหม่' }).click();
  await expect(merchant).toHaveValue('ร้านทดสอบ');
  await expect(page.locator('tbody tr').first()).toContainText('RCP-0025');
  await page.getByRole('button', { name: 'บันทึกฉบับร่าง' }).click();
  await page.reload();
  await expect(merchant).toHaveValue('ร้านทดสอบ');
  await expect(page.locator('tbody tr')).toHaveCount(5);
});

test('search, branch and status filters can be combined and reset', async ({ page }) => {
  await page.getByRole('combobox', { name: 'กรองสาขา' }).selectOption('ลาดพร้าว');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('RCP-0023');
  await page.getByRole('textbox', { name: 'ค้นหาใบเสร็จ' }).fill('ไม่มีร้านนี้');
  await expect(page.getByText('ไม่พบใบเสร็จที่ค้นหา')).toBeVisible();
  await page.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('tab', { name: 'คิว JST' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('RCP-0021');
});

test('JST requires confirmation, rejects invalid amounts and locks queued rows', async ({ page }) => {
  const row = page.locator('tbody tr').filter({ hasText: 'RCP-0024' });
  const amount = page.getByRole('spinbutton', { name: 'ยอดสุทธิ RCP-0024' });
  await amount.fill('-1');
  await expect(row.getByRole('button', { name: 'ส่งเข้า JST' })).toBeDisabled();
  await amount.fill('2200');
  await row.getByRole('button', { name: 'ส่งเข้า JST' }).click();
  await expect(page.getByRole('dialog')).toContainText('2,200.00');
  await page.getByRole('button', { name: 'กลับไปตรวจ' }).click();
  await expect(row.getByRole('button', { name: 'ส่งเข้า JST' })).toBeEnabled();
  await row.getByRole('button', { name: 'ส่งเข้า JST' }).click();
  await page.getByRole('button', { name: 'ยืนยันเข้าคิวจำลอง' }).click();
  await expect(row.getByRole('button', { name: 'อยู่ในคิวแล้ว' })).toBeDisabled();
  await expect(amount).toHaveAttribute('readonly', '');
  await page.reload();
  await expect(row.getByRole('button', { name: 'อยู่ในคิวแล้ว' })).toBeDisabled();
});

test('OCR original stays unchanged and image modal is keyboard dismissible', async ({ page }) => {
  const row = page.locator('tbody tr').filter({ hasText: 'RCP-0024' });
  await page.getByRole('textbox', { name: 'ร้านค้า RCP-0024', exact: true }).fill('ชื่อที่แก้ใหม่');
  await row.getByRole('button', { name: 'ดูข้อความ OCR ดิบ' }).click();
  await expect(page.getByRole('dialog')).toContainText('บริษัท ออฟฟิศเมท (ไทย) จำกัด');
  await expect(page.getByRole('dialog')).not.toContainText('ชื่อที่แก้ใหม่');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'ขยายใบเสร็จ RCP-0024', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: 'ภาพใบเสร็จตัวอย่างขนาดใหญ่' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('mobile contains horizontal overflow inside the table', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.table-scroll').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/receipt-mobile.png', fullPage: true });
});

test('desktop renders without JavaScript errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.screenshot({ path: '/tmp/receipt-desktop.png', fullPage: false });
  expect(errors).toEqual([]);
});
