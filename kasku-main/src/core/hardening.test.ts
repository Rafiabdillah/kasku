import test from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerDatabase, RecurringRule } from './types';
import {
  applyDueRecurringRules,
  createEmptyDatabase,
  mergeRestoredSettings,
  recordTransaction,
} from './mapper';
import { isDangerousSpreadsheetText, sanitizeSpreadsheetText } from './safeText';
import { parseSpreadsheetId, tabRange } from './sheetsUtils';
import {
  exportJurnalUmumCSV,
  normalizeDatabase,
} from '../services/storage';

function withRule(rule: Partial<RecurringRule>): LedgerDatabase {
  const db = createEmptyDatabase('Budi', 'Buku Budi');
  const full: RecurringRule = {
    id: 'rec-1',
    description: 'Sewa kos',
    actionType: 'keluar',
    amount: 1_000_000,
    walletId: 'acc-1102',
    categoryAccountId: 'acc-5104',
    dayOfMonth: 5,
    isActive: true,
    lastGeneratedMonth: null,
    ...rule,
  };
  return { ...db, recurringRules: [full] };
}

test('parseSpreadsheetId menerima URL lengkap, URL dengan query, dan ID mentah', () => {
  const id = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}`), id);
  assert.equal(parseSpreadsheetId(`  ${id}  `), id);
  assert.equal(parseSpreadsheetId(''), '');
});

test('tabRange mengutip nama tab dan meng-escape tanda kutip tunggal', () => {
  assert.equal(tabRange('BukuKu · Ringkasan', 'A1'), "'BukuKu · Ringkasan'!A1");
  assert.equal(tabRange("Laporan Budi's", 'A:Z'), "'Laporan Budi''s'!A:Z");
});

test('sanitizeSpreadsheetText menetralkan rumus berbahaya tanpa mengubah teks biasa', () => {
  for (const dangerous of ['=SUM(A1:A9)', '+1234', '-1+2', '@user', '\tTAB', '\rCR']) {
    assert.equal(isDangerousSpreadsheetText(dangerous), true);
    assert.equal(sanitizeSpreadsheetText(dangerous), `'${dangerous}`);
  }
  assert.equal(sanitizeSpreadsheetText('Makan siang'), 'Makan siang');
  assert.equal(isDangerousSpreadsheetText('Makan siang'), false);
});

test('Ekspor CSV memakai BOM UTF-8, CRLF, dan menetralkan formula di keterangan', () => {
  const base = createEmptyDatabase('Budi', 'Buku Budi');
  const saved = recordTransaction(base, {
    actionType: 'keluar',
    amount: 25_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-5101',
    date: '2026-11-10',
    description: '=HYPERLINK("http://jahat.example")',
  });
  const csv = exportJurnalUmumCSV(saved.db, 'all');

  assert.ok(csv.startsWith('\uFEFF'), 'CSV harus diawali BOM UTF-8');
  assert.ok(csv.includes('\r\n'), 'Baris CSV harus memakai CRLF');
  assert.ok(csv.includes(`'=HYPERLINK`), 'Formula harus diberi prefiks teks');
  assert.ok(!csv.includes(`\r\n=HYPERLINK`), 'Tidak boleh ada sel yang diawali =');
});

test('createEmptyDatabase mempertahankan PIN dan ID spreadsheet saat buku dikosongkan', () => {
  const empty = createEmptyDatabase('Siti', 'Warung', {
    pinEnabled: true,
    pinHash: 'hash-abc',
    pinSalt: 'salt-abc',
    spreadsheetId: 'sheet-123',
  });
  assert.equal(empty.journals.length, 0);
  assert.equal(empty.journalLines.length, 0);
  assert.equal(empty.settings.pinEnabled, true);
  assert.equal(empty.settings.pinHash, 'hash-abc');
  assert.equal(empty.settings.pinSalt, 'salt-abc');
  assert.equal(empty.settings.spreadsheetId, 'sheet-123');

  const noHash = createEmptyDatabase('Siti', 'Warung', { pinEnabled: true, pinHash: null });
  assert.equal(noHash.settings.pinEnabled, false, 'PIN tidak boleh aktif tanpa hash');
});

test('Restore backup tidak dapat menimpa atau mematikan PIN perangkat', () => {
  const currentSettings = {
    ownerName: 'Budi',
    businessName: 'Buku Budi',
    pinEnabled: true,
    pinHash: 'hash-lokal',
    pinSalt: 'salt-lokal',
    spreadsheetId: 'sheet-lokal',
  };
  const restored = createEmptyDatabase('Penyerang', 'Buku Lain');
  restored.settings = {
    ...restored.settings,
    pinEnabled: false,
    pinHash: 'hash-palsu',
    pinSalt: null,
    spreadsheetId: 'sheet-palsu',
  };

  const merged = mergeRestoredSettings(restored, currentSettings);
  assert.equal(merged.settings.ownerName, 'Penyerang', 'Data akuntansi tetap dari backup');
  assert.equal(merged.settings.pinEnabled, true);
  assert.equal(merged.settings.pinHash, 'hash-lokal');
  assert.equal(merged.settings.pinSalt, 'salt-lokal');
  assert.equal(merged.settings.spreadsheetId, 'sheet-lokal');

  const tanpaSheetLokal = mergeRestoredSettings(restored, {
    ...currentSettings,
    spreadsheetId: '',
  });
  assert.equal(tanpaSheetLokal.settings.spreadsheetId, 'sheet-palsu');
});

test('normalizeDatabase menolak status PIN aktif tanpa hash', () => {
  const normalized = normalizeDatabase({
    accounts: [],
    journals: [],
    journalLines: [],
    settings: {
      ownerName: 'A',
      businessName: 'B',
      pinEnabled: true,
      pinHash: null,
      pinSalt: null,
      spreadsheetId: '',
    },
  });
  assert.equal(normalized.settings.pinEnabled, false);
});

test('Transaksi berulang mengisi bulan yang terlewat lalu tidak menggandakan', () => {
  const db = withRule({ lastGeneratedMonth: '2026-09' });
  const first = applyDueRecurringRules(db, new Date(2026, 10, 20));

  assert.equal(first.generatedCount, 2, 'Harus membuat Oktober dan November');
  assert.deepEqual(
    first.db.journals.map((j) => j.date).sort(),
    ['2026-10-05', '2026-11-05'],
  );
  assert.equal(first.db.recurringRules?.[0].lastGeneratedMonth, '2026-11');

  const second = applyDueRecurringRules(first.db, new Date(2026, 10, 20));
  assert.equal(second.generatedCount, 0, 'Menjalankan ulang tidak boleh menggandakan');
  assert.equal(second.db.journals.length, 2);
});

test('Transaksi berulang tidak dibuat sebelum tanggal jatuh tempo bulan berjalan', () => {
  const db = withRule({ lastGeneratedMonth: '2026-10' });
  const result = applyDueRecurringRules(db, new Date(2026, 10, 3));
  assert.equal(result.generatedCount, 0);
});

test('Tanggal 31 pada bulan pendek dipotong ke hari terakhir bulan tersebut', () => {
  const db = withRule({ dayOfMonth: 31, lastGeneratedMonth: '2027-01' });
  const result = applyDueRecurringRules(db, new Date(2027, 2, 1));
  assert.equal(result.generatedCount, 1);
  assert.equal(result.db.journals[0].date, '2027-02-28');
});
