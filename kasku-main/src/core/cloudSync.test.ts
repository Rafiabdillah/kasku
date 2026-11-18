import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDatabase, recordTransaction } from './mapper';
import { cloudPayload, MAX_CLOUD_BYTES, parseCloudPayload, payloadHash, receiveCloud, syncDecision } from './cloudSync';
import { normalizeDatabase } from '../services/storage';
import { computeAccountBalances, voidJournal } from './ledger';
import type { TransactionInput } from './types';

const empty = () => createEmptyDatabase('Pemilik', 'Buku');
const transaction = () => recordTransaction(empty(), {
  actionType: 'masuk', amount: 100_000, walletId: 'acc-1101', categoryAccountId: 'acc-4101',
  date: '2026-11-18', description: 'Pendapatan uji',
}).db;

test('Payload cloud tidak mengunggah PIN, salt, tautan Sheets atau metadata akun lokal', () => {
  const db = transaction();
  db.settings.pinEnabled = true;
  db.settings.pinHash = 'private-pin'; db.settings.pinSalt = 'private-salt';
  db.settings.spreadsheetId = 'private-sheet';
  db.cloudLink = { uid: 'private-uid', revision: 2, baselineHash: 'a'.repeat(64), lastSyncedAt: '2026-11-18' };
  const payload = cloudPayload(db);
  assert.doesNotMatch(payload, /private-|pinHash|pinSalt|spreadsheetId|cloudLink/);
  assert.equal(parseCloudPayload(payload).journals.length, 1);
});

test('Fingerprint stabil untuk urutan properti berbeda', async () => {
  const db = transaction();
  const other = { ...db, settings: { ...db.settings, ownerName: db.settings.ownerName } };
  other.budgets = { 'acc-5102': 20, 'acc-5101': 10 };
  db.budgets = { 'acc-5101': 10, 'acc-5102': 20 };
  assert.equal(await payloadHash(cloudPayload(db)), await payloadHash(cloudPayload(other)));
});

test('Fingerprint mengurutkan kunci secara ordinal, bukan menurut locale perangkat', () => {
  const db = empty();
  db.budgets = { 'acc-é': 4, 'acc-a': 3, 'acc-Z': 2, 'acc-A': 1 };
  assert.deepEqual(Object.keys(JSON.parse(cloudPayload(db)).budgets), ['acc-A', 'acc-Z', 'acc-a', 'acc-é']);
});

test('Konflik dua perangkat tidak boleh ditimpa otomatis', () => {
  const link = { uid: 'a', revision: 2, baselineHash: 'base', lastSyncedAt: '' };
  assert.equal(syncDecision(link, 'local-change', 'remote-change', 3), 'conflict');
  assert.equal(syncDecision(link, 'base', 'remote-change', 3), 'pull');
  assert.equal(syncDecision(link, 'local-change', 'base', 2), 'push');
  assert.equal(syncDecision(link, 'identical', 'identical', 3), 'equal');
});

test('Unduhan cloud mempertahankan PIN dan Sheets perangkat tujuan', () => {
  const local = empty();
  local.settings = { ...local.settings, pinEnabled: true, pinHash: 'local', pinSalt: 'salt', spreadsheetId: 'sheet' };
  const remote = transaction(); remote.settings.ownerName = 'Pemilik akun';
  const link = { uid: 'account', revision: 7, baselineHash: 'a'.repeat(64), lastSyncedAt: '2026-11-18' };
  const received = receiveCloud(local, parseCloudPayload(cloudPayload(remote)), link);
  assert.equal(received.settings.pinHash, 'local');
  assert.equal(received.settings.pinSalt, 'salt');
  assert.equal(received.settings.spreadsheetId, 'sheet');
  assert.equal(received.settings.ownerName, 'Pemilik akun');
  assert.equal(received.journals.length, 1);
  assert.deepEqual(normalizeDatabase(received).cloudLink, link);
});

test('Cloud menolak data rusak, debit/kredit tidak seimbang, referensi hilang dan ID ganda', () => {
  const raw = JSON.parse(cloudPayload(transaction()));
  assert.throws(() => parseCloudPayload('{}'));
  const unbalanced = structuredClone(raw); unbalanced.journalLines[0].debit++;
  assert.throws(() => parseCloudPayload(JSON.stringify(unbalanced)), /tidak seimbang/);
  const orphan = structuredClone(raw); orphan.journalLines[0].journal_id = 'missing';
  assert.throws(() => parseCloudPayload(JSON.stringify(orphan)), /tidak valid/);
  const duplicate = structuredClone(raw); duplicate.accounts.push(duplicate.accounts[0]);
  assert.throws(() => parseCloudPayload(JSON.stringify(duplicate)), /tidak valid/);
  const invalidDate = structuredClone(raw); invalidDate.journals[0].date = '2026-02-31';
  assert.throws(() => parseCloudPayload(JSON.stringify(invalidDate)));
});

test('Cloud menolak tx_meta yang bukan objek transaksi', () => {
  for (const meta of [null, false, true, 0, 100, '', 'masuk', [], [{}], {}]) {
    const raw = JSON.parse(cloudPayload(transaction()));
    raw.journals[0].tx_meta = meta;
    assert.throws(() => parseCloudPayload(JSON.stringify(raw)), /tidak valid/, JSON.stringify(meta));
  }
});

test('Cloud memvalidasi actionType dan nominal tx_meta tanpa koersi', () => {
  const invalidFields: Record<string, unknown[]> = {
    actionType: [undefined, null, '', 'unknown', 'MASUK', 1, true, [], {}],
    amount: [undefined, null, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '100000', true, [], {}],
    adminFee: [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '0', false, [], {}],
    counterparty: [null, 42, false, [], {}],
  };
  for (const [field, values] of Object.entries(invalidFields)) {
    for (const value of values) {
      const raw = JSON.parse(cloudPayload(transaction()));
      raw.journals[0].tx_meta[field] = value;
      assert.throws(() => parseCloudPayload(JSON.stringify(raw)), /tidak valid/, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('Referensi akun tx_meta harus string yang menunjuk akun yang ada', () => {
  for (const field of ['walletId', 'toWalletId', 'categoryAccountId']) {
    for (const value of [null, '', 'missing', 1101, false, ['acc-1101'], { id: 'acc-1101' }]) {
      const raw = JSON.parse(cloudPayload(transaction()));
      raw.journals[0].tx_meta[field] = value;
      assert.throws(() => parseCloudPayload(JSON.stringify(raw)), /tidak valid/, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('Semua aksi transaksi sah tetap dapat dipulihkan dari backup dan payload cloud', () => {
  const inputs: Array<Partial<TransactionInput> & Pick<TransactionInput, 'actionType'>> = [
    { actionType: 'masuk', categoryAccountId: 'acc-4101' },
    { actionType: 'keluar', categoryAccountId: 'acc-5101' },
    { actionType: 'pindah', toWalletId: 'acc-1102', adminFee: 0 },
    { actionType: 'pindah', toWalletId: 'acc-1102', adminFee: 2_500 },
    { actionType: 'belanja_utang', walletId: 'acc-2101', categoryAccountId: 'acc-5101', counterparty: 'Toko' },
    { actionType: 'bayar_utang', counterparty: 'Toko' },
    { actionType: 'pinjamkan', counterparty: 'Raka' },
    { actionType: 'dilunasi', counterparty: '' },
    { actionType: 'saldo_awal' },
  ];
  let db = empty();
  for (const input of inputs) {
    db = recordTransaction(db, {
      amount: 100_000, walletId: 'acc-1101', date: '2026-11-18', description: 'Transaksi uji', ...input,
    }).db;
  }
  for (const payload of [JSON.stringify(db), cloudPayload(db)]) {
    const parsed = parseCloudPayload(payload);
    assert.deepEqual(parsed.journals, JSON.parse(JSON.stringify(db.journals)));
    assert.deepEqual(parsed.journalLines, db.journalLines);
    assert.deepEqual(computeAccountBalances(parsed.accounts, parsed.journalLines), computeAccountBalances(db.accounts, db.journalLines));
  }
});

test('Metadata minimal dan jurnal tanpa metadata atau tautan opsional tetap diterima', () => {
  const raw = JSON.parse(cloudPayload(transaction()));
  delete raw.journals[0].void_of_id;
  delete raw.journals[0].reversal_journal_id;
  for (const meta of [undefined, { actionType: 'masuk', amount: 1 }, {
    actionType: 'masuk', amount: Number.MAX_SAFE_INTEGER, adminFee: Number.MAX_SAFE_INTEGER,
  }]) {
    raw.journals[0].tx_meta = meta;
    const parsed = parseCloudPayload(JSON.stringify(raw));
    assert.deepEqual(parsed.journals, JSON.parse(JSON.stringify(raw.journals)));
    assert.deepEqual(parsed.journalLines, raw.journalLines);
  }
});

test('Cloud menolak ID pembalik yang bukan string atau tidak ditemukan', () => {
  for (const field of ['void_of_id', 'reversal_journal_id']) {
    for (const value of ['', 'missing', 42, false, [], {}]) {
      const raw = JSON.parse(cloudPayload(transaction()));
      raw.journals[0][field] = value;
      assert.throws(() => parseCloudPayload(JSON.stringify(raw)), /tidak valid/, `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('Pembatalan sah mempertahankan tautan jurnal, audit trail dan saldo nol', () => {
  const original = transaction();
  const db = voidJournal(original, original.journals[0].id, '2026-11-19', '2026-11-19T00:00:00.000Z').db;
  const parsed = parseCloudPayload(cloudPayload(db));
  assert.deepEqual(parsed.journals, JSON.parse(JSON.stringify(db.journals)));
  assert.deepEqual(parsed.journalLines, db.journalLines);
  assert.equal(parsed.journals[0].reversal_journal_id, parsed.journals[1].id);
  assert.equal(parsed.journals[1].void_of_id, parsed.journals[0].id);
  assert.equal(parsed.journals[1].tx_meta, undefined);
  for (const totals of computeAccountBalances(parsed.accounts, parsed.journalLines).values()) {
    assert.equal(totals.balance, 0);
  }
});

test('Batas cloud dihitung dalam byte UTF-8', () => {
  const db = empty(); db.settings.ownerName = 'é'.repeat(MAX_CLOUD_BYTES / 2);
  assert.throws(() => parseCloudPayload(cloudPayload(db)), /850 KB/);
});

test('PIN atau metadata yang disisipkan dalam dokumen cloud diabaikan saat diterima', () => {
  const raw = JSON.parse(cloudPayload(empty()));
  const expectedSettings = parseCloudPayload(JSON.stringify(raw)).settings;
  raw.settings.pinEnabled = true; raw.settings.pinHash = 'remote-secret';
  raw.settings.pinSalt = 'remote-salt'; raw.settings.spreadsheetId = 'remote-sheet';
  raw.settings.extra = 'remote-settings';
  raw.cloudLink = { uid: 'intruder' };
  const parsed = parseCloudPayload(JSON.stringify(raw));
  assert.deepEqual(parsed.settings, expectedSettings);
  assert.equal(parsed.settings.pinEnabled, false);
  assert.equal(parsed.settings.pinHash, null);
  assert.equal(parsed.cloudLink, undefined);
  assert.doesNotMatch(JSON.stringify(parsed), /remote-|intruder/);
});

test('Hanya field tingkat atas LedgerDatabase yang diizinkan diteruskan ke penyimpanan', () => {
  const db = transaction();
  db.budgets = { 'acc-5101': 500_000 };
  db.recurringRules = [{
    id: 'rule-1', description: 'Sewa', actionType: 'keluar', amount: 100_000,
    walletId: 'acc-1101', categoryAccountId: 'acc-5101', dayOfMonth: 1,
    isActive: true, lastGeneratedMonth: null,
  }];
  const raw = {
    ...JSON.parse(cloudPayload(db)),
    ...JSON.parse('{"__proto__":{"untrusted":true},"constructor":{"untrusted":true}}'),
    extra: { untrusted: true }, pinHash: 'remote-pin', spreadsheetId: 'remote-sheet',
  };
  const parsed = parseCloudPayload(JSON.stringify(raw));
  assert.deepEqual(Object.keys(parsed).sort(), [
    'accounts', 'budgets', 'journalLines', 'journals', 'recurringRules', 'settings', 'version',
  ]);
  assert.deepEqual(parsed, parseCloudPayload(cloudPayload(db)));
  const link = { uid: 'account', revision: 1, baselineHash: 'a'.repeat(64), lastSyncedAt: '' };
  const received = receiveCloud(empty(), parsed, link);
  assert.doesNotMatch(JSON.stringify(normalizeDatabase(received)), /untrusted|remote-|__proto__|constructor/);
});
