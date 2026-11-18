import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/';
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bukuku-mobile-'));
const browser = await chromium.launch();
const errors = [];

async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.width + 1, `${label}: ${size.content}px exceeds ${size.width}px`);
}

async function onboard(page) {
  await page.goto(baseURL);
  await page.locator('#onboarding-owner').fill('Penguji Mobile');
  await page.getByRole('button', { name: 'Mulai Buku Kosong (Rp0)' }).click();
  await expect(page.getByTestId('total-wallet-balance')).toHaveText('Rp0');
}

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await onboard(page);
  await noOverflow(page, 'mobile home');
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'home-390.png'), fullPage: true });

  const nav = page.getByRole('navigation', { name: 'Navigasi seluler' });
  await nav.getByRole('button', { name: 'Catat', exact: true }).click();
  await expect(nav).toHaveCount(0);
  await expect(page.locator('.catat-detail-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
  await expect(page.getByRole('alert')).toContainText('Masukkan nominal');
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.locator('#catat-nominal-input').fill('150000');
  await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
  await expect(page.locator('.catat-detail-panel')).toBeVisible();
  await expect(page.locator('#catat-nominal-input')).toBeHidden();
  await page.locator('#catat-catatan').fill('Pendapatan uji mobile');
  await page.screenshot({ path: path.join(artifacts, 'catat-detail-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByText('Pendapatan uji mobile', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('Pendapatan uji mobile', { exact: true }).first()).toBeVisible();

  await nav.getByRole('button', { name: 'Catat', exact: true }).click();
  await page.getByRole('button', { name: 'Pindah', exact: true }).click();
  await page.locator('#catat-nominal-input').fill('20000');
  await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
  await page.locator('#catat-admin-fee').fill('-1');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('#catat-admin-fee').fill('2500');
  await page.locator('#catat-catatan').fill('Transfer uji mobile');
  await page.getByRole('button', { name: 'Kembali', exact: true }).click();
  await expect(page.locator('#catat-nominal-input')).toHaveValue('20000');
  await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
  await expect(page.locator('#catat-admin-fee')).toHaveValue('2500');
  await page.getByRole('button', { name: 'Simpan & tambah', exact: true }).click();
  await expect(page.locator('#catat-nominal-input')).toBeVisible();
  await expect(page.locator('#catat-nominal-input')).toHaveValue('0');
  await expect(page.getByText(/Tersimpan \(Rp20/)).toBeVisible();
  await page.getByRole('button', { name: 'Kembali ke beranda' }).click();
  await expect(page.getByTestId('total-wallet-balance')).toHaveText('Rp147.500');

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page, `home ${width}`);
    if (width < 1024) {
      const wallet = await page.locator('.home-wallets > div').first().boundingBox();
      assert.ok(wallet.width >= 200, `Wallet card too narrow at ${width}px`);
      assert.ok(await page.locator('.home-wallets').evaluate((el) => el.scrollWidth > el.clientWidth));
    }
    await page.getByRole('button', { name: 'Catat transaksi', exact: true }).click();
    if (width < 1024) {
      await expect(page.locator('.catat-detail-panel')).toBeHidden();
      await page.locator('#catat-nominal-input').fill('999999999999');
      await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
    } else {
      await expect(page.locator('.catat-detail-panel')).toBeVisible();
      await expect(page.locator('#catat-nominal-input')).toBeVisible();
    }
    await noOverflow(page, `catat ${width}`);
    await page.getByRole('button', { name: 'BukuKu', exact: true }).click();
    await page.screenshot({ path: path.join(artifacts, `home-${width}.png`), fullPage: true });
  }

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await nav.getByRole('button', { name: 'Laporan', exact: true }).click();
    await page.getByRole('button', { name: 'Buku Kas', exact: true }).click();
    await page.getByLabel('Pilih dompet buku kas').selectOption('all');
    await noOverflow(page, `Buku Kas ${width}`);
    const selector = await page.getByLabel('Pilih dompet buku kas').boundingBox();
    assert.ok(selector.x + selector.width <= width, 'Cash-book selector must stay onscreen');
    await page.getByRole('button', { name: 'Buka pengaturan' }).click();
    await page.getByRole('button', { name: 'Anggaran & Berulang', exact: true }).click();
    await page.getByLabel(/Pulsa/).fill('100000');
    await page.getByRole('button', { name: 'Simpan Target Anggaran' }).click();
    await noOverflow(page, `budgets ${width}`);
    for (const input of await page.locator('input[id^="budget-"]').all()) {
      const rect = await input.boundingBox();
      assert.ok(rect.x + rect.width <= width - 16, 'Budget input must stay inside its card');
    }
    await page.getByRole('button', { name: 'BukuKu', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole('button', { name: 'Akun', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Akun & sinkronisasi' })).toBeVisible();
  await page.getByRole('button', { name: 'Belum punya akun? Daftar' }).click();
  await page.getByLabel('Email', { exact: true }).fill('invalid');
  await page.getByLabel('Kata sandi', { exact: true }).fill('short');
  assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), false);
  await page.getByLabel('Email', { exact: true }).fill('test@example.invalid');
  await page.getByLabel('Kata sandi', { exact: true }).press('End');
  await page.getByLabel('Kata sandi', { exact: true }).press('s');
  assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), false);
  await noOverflow(page, 'account');
  await page.screenshot({ path: path.join(artifacts, 'account-390.png'), fullPage: true });
  await page.goBack();
  await expect(page.getByTestId('total-wallet-balance')).toBeVisible();
  await context.setOffline(true);
  await nav.getByRole('button', { name: 'Catat', exact: true }).click();
  await page.locator('#catat-nominal-input').fill('1000');
  await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
  await page.locator('#catat-catatan').fill('Catatan offline');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByText('Catatan offline', { exact: true }).first()).toBeVisible();
  if (process.env.TEST_PRODUCTION === '1') {
    const scope = await page.evaluate(() => navigator.serviceWorker.ready.then((registration) => registration.scope));
    assert.equal(scope, new URL(baseURL).href, 'Service worker must use the deployment subpath');
    await page.reload();
    await expect(page.getByText('Catatan offline', { exact: true }).first()).toBeVisible();
  }
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText('Catatan offline', { exact: true }).first()).toBeVisible();
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  console.log('PASS: onboarding, persistence, two-step entry, amount and fee errors, transfer, save-more, 320–1440px, account validation, history, offline entry.');
  console.log(`Screenshots: ${artifacts}`);
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => undefined);
    console.error((await page.locator('body').innerText()).slice(0, 6000));
  }
  console.error(`Screenshots: ${artifacts}`);
  throw error;
} finally {
  await browser.close();
}
