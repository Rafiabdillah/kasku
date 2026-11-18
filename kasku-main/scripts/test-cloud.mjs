import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const fixturePath = process.env.BUKUKU_CLOUD_FIXTURE;
if (!fixturePath) throw new Error('Set BUKUKU_CLOUD_FIXTURE to a temporary synthetic account fixture. Never use customer accounts.');
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
const config = JSON.parse(await fs.readFile(new URL('../cloud-firebase-config.json', import.meta.url), 'utf8'));
assert.equal(fixture.projectId, config.projectId);
const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000/';
const browser = await chromium.launch();
const key = 'bukuku_ledger_snapshot_v2';
const timeouts = { timeout: 45000 };
const errors = [];
const primary = fixture.accounts.primary;
const firestoreURL = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents/bukukuUsers/${primary.uid}/books/main`;

async function database(page) {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name))?.db, key);
}
async function account(page) {
  const mobile = await page.getByRole('button', { name: 'Akun dan status sinkronisasi' }).isVisible();
  if (mobile) await page.getByRole('button', { name: 'Akun dan status sinkronisasi' }).click();
  else await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'Akun', exact: true }).click();
}
async function login(page, credentials) {
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Masuk ke akun', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keluar akun', exact: true })).toBeVisible(timeouts);
}
async function addTransaction(page, description, amount, mobile) {
  await page.getByRole('button', { name: 'Catat', exact: true }).click();
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await page.locator('#catat-nominal-input').fill(String(amount));
  if (mobile) await page.getByRole('button', { name: 'Lanjut ke detail' }).click();
  await page.getByRole('button', { name: 'Pendapatan Usaha', exact: true }).click();
  await page.locator('#catat-catatan').fill(description);
  await page.getByRole('button', { name: mobile ? 'Simpan' : 'Simpan & lihat daftar', exact: true }).click();
  await expect.poll(async () => (await database(page)).journals.some((j) => j.description === description)).toBe(true);
}
async function token(credentials) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: credentials.email, password: credentials.password, returnSecureToken: true }),
  });
  assert.equal(response.status, 200, 'Synthetic account login failed');
  return (await response.json()).idToken;
}

try {
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const laptopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const phone = await phoneContext.newPage();
  const laptop = await laptopContext.newPage();
  for (const page of [phone, laptop]) page.on('pageerror', (error) => errors.push(error.message));
  await phone.goto(baseURL);
  await phone.locator('#onboarding-owner').fill('Synthetic Cloud Test');
  await phone.getByRole('button', { name: 'Mulai Buku Kosong (Rp0)' }).click();
  await addTransaction(phone, 'Phone initial', 100000, true);
  const local = await database(phone);
  const deviceB = { ...local, journals: [], journalLines: [], cloudLink: undefined, settings: {
    ...local.settings, ownerName: 'Device B', pinEnabled: false, pinHash: 'device-b-local-pin', pinSalt: 'device-b-local-salt', spreadsheetId: 'device-b-sheet',
  } };
  await laptopContext.addInitScript(({ key, db }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), db }));
  }, { key, db: deviceB });
  await account(phone);
  await login(phone, primary);
  await expect(phone.getByRole('button', { name: 'Hubungkan buku ke akun ini' })).toBeVisible();
  assert.equal((await database(phone)).cloudLink, undefined, 'Login must not automatically upload');
  await phone.getByRole('button', { name: 'Hubungkan buku ke akun ini' }).click();
  await expect(phone.getByRole('button', { name: 'Setuju, unggah buku ke akun' })).toBeVisible(timeouts);
  await phone.getByRole('button', { name: 'Setuju, unggah buku ke akun' }).click();
  await expect.poll(async () => (await database(phone)).cloudLink?.revision, timeouts).toBe(1);
  console.log('PASS: explicit first-upload consent and owner write.');

  await laptop.goto(baseURL);
  await account(laptop);
  await login(laptop, primary);
  await laptop.getByRole('button', { name: 'Hubungkan buku ke akun ini' }).click();
  await expect(laptop.getByRole('button', { name: 'Gunakan buku dari akun' })).toBeVisible(timeouts);
  await laptop.getByRole('button', { name: 'Gunakan buku dari akun' }).click();
  await laptop.getByRole('button', { name: 'Ya, lanjutkan' }).click();
  await expect.poll(async () => (await database(laptop)).cloudLink?.revision, timeouts).toBe(1);
  let downloaded = await database(laptop);
  assert.equal(downloaded.journals[0].description, 'Phone initial');
  assert.equal(downloaded.settings.pinHash, 'device-b-local-pin');
  assert.equal(downloaded.settings.pinSalt, 'device-b-local-salt');
  assert.equal(downloaded.settings.spreadsheetId, 'device-b-sheet');
  console.log('PASS: second-device download preserves local PIN and Sheets settings.');

  await addTransaction(laptop, 'Laptop online', 50000, false);
  await expect.poll(async () => (await database(phone)).journals.some((j) => j.description === 'Laptop online'), timeouts).toBe(true);
  await expect.poll(async () => (await database(phone)).cloudLink?.revision, timeouts).toBe((await database(laptop)).cloudLink.revision);
  console.log('PASS: automatic laptop-to-phone synchronization.');

  await phoneContext.setOffline(true);
  await addTransaction(phone, 'Phone queued edit', 10000, true);
  await phoneContext.setOffline(false);
  await expect.poll(async () => (await database(laptop)).journals.some((j) => j.description === 'Phone queued edit'), timeouts).toBe(true);
  const beforeConflict = (await database(laptop)).cloudLink.revision;
  console.log('PASS: offline-only change automatically uploads when internet returns.');

  await phoneContext.setOffline(true);
  await addTransaction(phone, 'Phone offline edit', 30000, true);
  await addTransaction(laptop, 'Laptop divergent edit', 40000, false);
  await expect.poll(async () => (await database(laptop)).cloudLink?.revision, timeouts).toBe(beforeConflict + 1);
  await phoneContext.setOffline(false);
  await account(phone);
  await expect(phone.getByRole('button', { name: 'Gunakan versi akun', exact: true })).toBeVisible(timeouts);
  assert.ok((await database(phone)).journals.some((j) => j.description === 'Phone offline edit'));
  assert.ok(!(await database(laptop)).journals.some((j) => j.description === 'Phone offline edit'));
  await phone.getByRole('button', { name: 'Gunakan versi akun', exact: true }).click();
  await phone.getByRole('button', { name: 'Ya, lanjutkan' }).click();
  await expect.poll(async () => (await database(phone)).journals.some((j) => j.description === 'Laptop divergent edit'), timeouts).toBe(true);
  assert.ok(!(await database(phone)).journals.some((j) => j.description === 'Phone offline edit'));
  const recovery = await phone.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('bukuku_ledger_idb', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('snapshots').objectStore('snapshots').get('cloud-recovery');
        request.onsuccess = () => resolve(typeof request.result === 'string' ? JSON.parse(request.result) : request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
  assert.ok(recovery.db.journals.some((j) => j.description === 'Phone offline edit'));
  console.log('PASS: divergent offline edits blocked; chosen remote version applied with local recovery.');

  const beforeLocalChoice = (await database(laptop)).cloudLink.revision;
  await phoneContext.setOffline(true);
  await addTransaction(phone, 'Phone chosen local', 7000, true);
  await addTransaction(laptop, 'Laptop recovery only', 8000, false);
  await expect.poll(async () => (await database(laptop)).cloudLink?.revision, timeouts).toBe(beforeLocalChoice + 1);
  await phoneContext.setOffline(false);
  await account(phone);
  await expect(phone.getByRole('button', { name: 'Gunakan versi perangkat ini', exact: true })).toBeVisible(timeouts);
  await phone.getByRole('button', { name: 'Gunakan versi perangkat ini', exact: true }).click();
  await phone.getByRole('button', { name: 'Ya, lanjutkan' }).click();
  await expect.poll(async () => (await database(laptop)).journals.some((j) => j.description === 'Phone chosen local'), timeouts).toBe(true);
  assert.ok(!(await database(laptop)).journals.some((j) => j.description === 'Laptop recovery only'));
  const downloadEvent = phone.waitForEvent('download');
  await phone.getByRole('button', { name: 'Unduh salinan sebelum pergantian terakhir' }).click();
  const download = await downloadEvent;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  assert.ok(backup.journals.some((j) => j.description === 'Laptop recovery only'));
  console.log('PASS: choosing local version syncs to laptop and downloads the replaced cloud version as recovery.');

  const ownerToken = await token(primary);
  const otherToken = await token(fixture.accounts.other);
  const unverifiedToken = await token(fixture.accounts.unverified);
  for (const [label, bearer] of [['anonymous', null], ['other account', otherToken], ['unverified account', unverifiedToken]]) {
    const response = await fetch(firestoreURL, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
    assert.equal(response.status, 403, `${label} must not read another book`);
  }
  const unverifiedURL = firestoreURL.replace(primary.uid, fixture.accounts.unverified.uid);
  assert.equal((await fetch(unverifiedURL, { headers: { Authorization: `Bearer ${unverifiedToken}` } })).status, 403);
  const ownerRead = await fetch(firestoreURL, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(ownerRead.status, 200);
  const document = await ownerRead.json();
  const payload = document.fields.payload.stringValue;
  assert.ok(!/pinHash|pinSalt|spreadsheetId|cloudLink/.test(payload));
  const forbiddenWrite = await fetch(firestoreURL, {
    method: 'PATCH', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: document.fields }),
  });
  assert.equal(forbiddenWrite.status, 403, 'Owner cannot bypass revision/timestamp rules');
  const staleRevision = await fetch(`https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [{
      update: { name: document.name, fields: {
        version: document.fields.version, revision: document.fields.revision, payload: document.fields.payload,
      } },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
    }] }),
  });
  assert.equal(staleRevision.status, 403, 'A valid server timestamp must not allow a stale revision');
  console.log('PASS: production rules deny anonymous, other UID, unverified UID and stale revision writes; cloud contains no PIN.');

  await phone.getByRole('button', { name: 'Keluar akun', exact: true }).click();
  await phone.getByRole('button', { name: 'Ya, lanjutkan' }).click();
  await expect(phone.getByRole('button', { name: 'Masuk ke akun', exact: true })).toBeVisible(timeouts);
  await login(phone, fixture.accounts.other);
  await expect(phone.getByText('Buku ini tertaut ke akun lain.', { exact: false })).toBeVisible(timeouts);
  assert.equal((await database(phone)).cloudLink.uid, primary.uid);
  await expect(phone.getByRole('button', { name: 'Setuju, unggah buku ke akun' })).toHaveCount(0);
  await phone.reload();
  await expect(phone.getByRole('button', { name: 'Keluar akun', exact: true })).toBeVisible(timeouts);
  assert.equal((await database(phone)).cloudLink.uid, primary.uid);
  console.log('PASS: logout retains local data, account mismatch blocks mixing books, login survives reload.');
  await phone.getByRole('button', { name: 'Keluar akun', exact: true }).click();
  await phone.getByRole('button', { name: 'Ya, lanjutkan' }).click();
  await login(phone, fixture.accounts.unverified);
  await expect(phone.getByRole('button', { name: 'Saya sudah verifikasi' })).toBeVisible();
  await phone.getByRole('button', { name: 'Saya sudah verifikasi' }).click();
  await expect(phone.getByRole('alert')).toContainText('Email belum terverifikasi', timeouts);
  await expect(phone.getByRole('button', { name: 'Hubungkan buku ke akun ini' })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log('PASS: unverified login cannot bypass the email-verification gate.');
} finally {
  await browser.close();
}
