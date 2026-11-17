import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ACCOUNTS, DEFAULT_SETTINGS } from './defaultAccounts';
import type { LedgerDatabase } from './types';
import { saveJournalAtomic, voidJournal, computeAccountBalances } from './ledger';
import {
  applyDueRecurringRules,
  buildJournalFromTransaction,
  createEmptyDatabase,
  createSeedDatabase,
  editFullTransaction,
  recordTransaction,
} from './mapper';
import {
  buildBudgetProgress,
  buildBukuBesar,
  buildBukuKas,
  buildCounterpartyLedgers,
  buildLabaRugi,
  buildNeraca,
  buildNeracaSaldo,
  matchesTransactionQuery,
} from './reports';
import { formatKolomAngka, formatRupiahTitle, formatTanggalID, formatPeriodeBerakhir } from './format';
import { parseSpreadsheetRowsToInputs } from './sheetsImport';
import { normalizeDatabase } from '../services/storage';

function emptyDb(): LedgerDatabase {
  return {
    version: 1,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    journals: [],
    journalLines: [],
    settings: { ...DEFAULT_SETTINGS },
    budgets: {},
    recurringRules: [],
  };
}

test('Semua 8 skenario pemetaan input ke jurnal menghasilkan total debit === total kredit', () => {
  let db = emptyDb();
  const scenarios = [
    { actionType: 'saldo_awal' as const, amount: 2_000_000, walletId: 'acc-1101', date: '2026-11-01', description: 'Saldo awal Kas' },
    { actionType: 'masuk' as const, amount: 1_500_000, walletId: 'acc-1102', categoryAccountId: 'acc-4101', date: '2026-11-02', description: 'Pendapatan jasa' },
    { actionType: 'keluar' as const, amount: 55_000, walletId: 'acc-1101', categoryAccountId: 'acc-5101', date: '2026-11-03', description: 'Makan siang' },
    { actionType: 'pindah' as const, amount: 300_000, adminFee: 2_500, walletId: 'acc-1102', toWalletId: 'acc-1103', date: '2026-11-04', description: 'Top up e-wallet' },
    { actionType: 'belanja_utang' as const, amount: 250_000, walletId: 'acc-2102', categoryAccountId: 'acc-5103', date: '2026-11-05', description: 'Kuota paylater' },
    { actionType: 'bayar_utang' as const, amount: 150_000, walletId: 'acc-1102', categoryAccountId: 'acc-2102', date: '2026-11-06', description: 'Cicil paylater' },
    { actionType: 'pinjamkan' as const, amount: 200_000, walletId: 'acc-1101', categoryAccountId: 'acc-1201', date: '2026-11-07', description: 'Pinjamkan ke Budi' },
    { actionType: 'dilunasi' as const, amount: 200_000, walletId: 'acc-1102', categoryAccountId: 'acc-1201', date: '2026-11-08', description: 'Budi melunasi' },
  ];

  for (const s of scenarios) {
    const built = buildJournalFromTransaction(db.accounts, s);
    const sumD = built.lines.reduce((acc, l) => acc + l.debit, 0);
    const sumC = built.lines.reduce((acc, l) => acc + l.credit, 0);
    assert.equal(sumD, sumC, `Harus seimbang pada skenario ${s.actionType}`);
    assert.ok(sumD > 0);
    const saved = recordTransaction(db, s);
    db = saved.db;
  }

  const neraca = buildNeracaSaldo(db);
  assert.equal(neraca.isBalanced, true);
  assert.equal(neraca.totalDebit, neraca.totalCredit);
});

test('Aturan DB: menolak jurnal tidak seimbang, float, atau baris debit+kredit sekaligus', () => {
  const db = emptyDb();
  assert.throws(() => {
    saveJournalAtomic(db, {
      date: '2026-11-10',
      description: 'Tidak seimbang',
      kind: 'biasa',
      lines: [
        { account_id: 'acc-1101', debit: 10_000, credit: 0 },
        { account_id: 'acc-4101', debit: 0, credit: 5_000 },
      ],
    });
  }, /tidak seimbang/);

  assert.throws(() => {
    saveJournalAtomic(db, {
      date: '2026-11-10',
      description: 'Nominal float',
      kind: 'biasa',
      lines: [
        { account_id: 'acc-1101', debit: 100.5, credit: 0 },
        { account_id: 'acc-4101', debit: 0, credit: 100.5 },
      ],
    });
  }, /bilangan bulat/);

  assert.throws(() => {
    saveJournalAtomic(db, {
      date: '2026-11-10',
      description: 'Debit dan kredit di satu baris',
      kind: 'biasa',
      lines: [
        { account_id: 'acc-1101', debit: 10_000, credit: 10_000 },
        { account_id: 'acc-4101', debit: 0, credit: 0 },
      ],
    });
  }, /sekaligus/);
});

test('Pindah saldo dengan biaya admin menghitung Debit W2, Debit 5106, Kredit W1 dengan tepat', () => {
  const db = emptyDb();
  const res = recordTransaction(db, {
    actionType: 'pindah',
    amount: 500_000,
    adminFee: 6_500,
    walletId: 'acc-1102',
    toWalletId: 'acc-1103',
    date: '2026-11-10',
    description: 'Transfer ke e-wallet',
  });

  const kasLines = res.lines;
  const lineW2 = kasLines.find((l) => l.account_id === 'acc-1103');
  const lineAdmin = kasLines.find((l) => l.account_id === 'acc-5106');
  const lineW1 = kasLines.find((l) => l.account_id === 'acc-1102');

  assert.equal(lineW2?.debit, 500_000);
  assert.equal(lineAdmin?.debit, 6_500);
  assert.equal(lineW1?.credit, 506_500);
});

test('Buku Besar menghitung saldo berjalan dengan benar sesuai normal_balance', () => {
  let db = emptyDb();
  db = recordTransaction(db, {
    actionType: 'saldo_awal',
    amount: 1_000_000,
    walletId: 'acc-1101',
    date: '2026-11-01',
    description: 'Modal awal',
  }).db;
  db = recordTransaction(db, {
    actionType: 'keluar',
    amount: 75_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-5101',
    date: '2026-11-02',
    description: 'Beli makan',
  }).db;
  db = recordTransaction(db, {
    actionType: 'masuk',
    amount: 250_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-4101',
    date: '2026-11-03',
    description: 'Pendapatan tunai',
  }).db;

  const bukuBesarKas = buildBukuBesar(db, 'acc-1101');
  assert.ok(bukuBesarKas);
  assert.equal(bukuBesarKas.rows.length, 3);
  assert.equal(bukuBesarKas.rows[0].runningBalance, 1_000_000);
  assert.equal(bukuBesarKas.rows[1].runningBalance, 925_000);
  assert.equal(bukuBesarKas.rows[2].runningBalance, 1_175_000);
  assert.equal(bukuBesarKas.closingBalance, 1_175_000);
});

test('Batalkan (Void) membuat jurnal pembalik dan mengembalikan saldo menjadi nol tanpa menghapus histori', () => {
  let db = emptyDb();
  const t1 = recordTransaction(db, {
    actionType: 'masuk',
    amount: 400_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-4101',
    date: '2026-11-11',
    description: 'Salah input penjualan',
  });
  db = t1.db;

  const voided = voidJournal(db, t1.journal.id);
  db = voided.db;

  assert.equal(db.journals.length, 2);
  const original = db.journals.find((j) => j.id === t1.journal.id);
  assert.ok(original?.voided_at);
  assert.equal(voided.reversalJournal.kind, 'pembalik');

  const balances = computeAccountBalances(db.accounts, db.journalLines);
  assert.equal(balances.get('acc-1101')?.balance, 0);
  assert.equal(balances.get('acc-4101')?.balance, 0);

  const neraca = buildNeracaSaldo(db);
  assert.equal(neraca.isBalanced, true);
  assert.equal(neraca.totalDebit, 0);
});

test('Seed database seimbang dan Laba Rugi serta Neraca (Aset = Kewajiban + Ekuitas) seimbang tepat', () => {
  const db = createSeedDatabase(new Date(2026, 10, 17));
  const neracaSaldo = buildNeracaSaldo(db);
  assert.equal(neracaSaldo.isBalanced, true);
  assert.ok(neracaSaldo.totalDebit > 0);

  const lr = buildLabaRugi(db, '2026-11');
  assert.equal(lr.totalRevenue, 4_200_000);
  assert.equal(lr.totalExpense, 1_200_000 + 2_500 + 65_000 + 450_000);
  assert.equal(lr.netProfit, 4_200_000 - 1_717_500);

  const neraca = buildNeraca(db);
  assert.equal(neraca.isBalanced, true);
  assert.equal(neraca.totalAssets, neraca.totalLiabilitiesAndEquity);
  assert.equal(neraca.currentNetProfit, lr.netProfit);
});

test('Edit transaksi penuh mengubah nominal, akun, tanggal, dan tetap menjaga Neraca seimbang', () => {
  let db = emptyDb();
  const t1 = recordTransaction(db, {
    actionType: 'keluar',
    amount: 50_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-5101',
    date: '2026-11-10',
    description: 'Beli makan salah nominal',
  });
  db = t1.db;

  const edited = editFullTransaction(db, t1.journal.id, {
    actionType: 'keluar',
    amount: 85_000,
    walletId: 'acc-1102',
    categoryAccountId: 'acc-5102',
    date: '2026-11-12',
    description: 'Beli tiket transport (dikoreksi)',
  });
  db = edited.db;

  assert.equal(db.journals.length, 1);
  assert.equal(edited.journal.number, t1.journal.number);
  const balances = computeAccountBalances(db.accounts, db.journalLines);
  assert.equal(balances.get('acc-1101')?.balance, 0);
  assert.equal(balances.get('acc-5101')?.balance, 0);
  assert.equal(balances.get('acc-1102')?.balance, -85_000);
  assert.equal(balances.get('acc-5102')?.balance, 85_000);
  assert.equal(buildNeracaSaldo(db).isBalanced, true);
  assert.equal(buildNeraca(db).isBalanced, true);
});

test('Rincian Hutang & Piutang per nama pihak menghitung sisa cicilan dengan akurat', () => {
  let db = emptyDb();
  db = recordTransaction(db, {
    actionType: 'pinjamkan',
    amount: 500_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-1201',
    date: '2026-11-05',
    description: 'Pinjamkan ke Raka',
    counterparty: 'Raka',
  }).db;
  db = recordTransaction(db, {
    actionType: 'dilunasi',
    amount: 200_000,
    walletId: 'acc-1102',
    categoryAccountId: 'acc-1201',
    date: '2026-11-10',
    description: 'Cicilan Raka',
    counterparty: 'Raka',
  }).db;

  const items = buildCounterpartyLedgers(db);
  assert.equal(items.length, 1);
  assert.equal(items[0].counterparty, 'Raka');
  assert.equal(items[0].kind, 'piutang');
  assert.equal(items[0].remaining, 300_000);
});

test('Aturan Berulang Bulanan otomatis berjalan sekali per bulan dan idempoten', () => {
  let db = createEmptyDatabase('Budi', 'Buku Budi');
  assert.equal(db.journals.length, 0);
  db = {
    ...db,
    recurringRules: [
      {
        id: 'rec-1',
        description: 'Sewa Kos',
        actionType: 'keluar',
        amount: 1_200_000,
        walletId: 'acc-1102',
        categoryAccountId: 'acc-5104',
        dayOfMonth: 5,
        isActive: true,
        lastGeneratedMonth: null,
      },
    ],
  };

  const firstRun = applyDueRecurringRules(db, new Date(2026, 10, 17));
  assert.equal(firstRun.generatedCount, 1);
  assert.equal(firstRun.db.journals.length, 1);
  assert.equal(firstRun.db.journals[0].date, '2026-11-05');

  const secondRun = applyDueRecurringRules(firstRun.db, new Date(2026, 10, 18));
  assert.equal(secondRun.generatedCount, 0);
  assert.equal(secondRun.db.journals.length, 1);

  const budgetsDb = { ...firstRun.db, budgets: { 'acc-5104': 1_000_000 } };
  const progress = buildBudgetProgress(budgetsDb, '2026-11');
  assert.equal(progress[0].status, 'melebihi');
  assert.equal(progress[0].percentUsed, 120);
});

test('Parser Impor Google Sheets memetakan baris tabel menjadi TransactionInput valid', () => {
  const rows = [
    ['Tanggal', 'Jenis', 'Dompet', 'Kategori', 'Nominal', 'Keterangan'],
    ['17/11/2026', 'Keluar', 'Kas', 'Makan', 'Rp45.000', 'Bakso siang'],
    ['2026-11-18', 'Masuk', 'Bank', 'Pendapatan Usaha', '1500000', 'Klien A'],
  ];
  const parsed = parseSpreadsheetRowsToInputs(rows, DEFAULT_ACCOUNTS);
  assert.equal(parsed.inputs.length, 2);
  assert.equal(parsed.inputs[0].actionType, 'keluar');
  assert.equal(parsed.inputs[0].amount, 45_000);
  assert.equal(parsed.inputs[0].date, '2026-11-17');
  assert.equal(parsed.inputs[1].actionType, 'masuk');
  assert.equal(parsed.inputs[1].walletId, 'acc-1102');
});

test('Formatter angka dan tanggal Indonesia bekerja sesuai spesifikasi', () => {
  assert.equal(formatRupiahTitle(1234567), 'Rp1.234.567');
  assert.equal(formatKolomAngka(1234567), '1.234.567');
  assert.equal(formatKolomAngka(0), '-');
  assert.equal(formatKolomAngka(-50000), '(50.000)');
  assert.equal(formatTanggalID('2026-11-17'), '17/11/2026');
  assert.equal(formatPeriodeBerakhir('2026-11'), 'Untuk Periode yang Berakhir 30 November 2026');
});

test('Pencarian transaksi mendukung deskripsi, tanggal, dan nominal (angka maupun format Rp)', () => {
  const db = createSeedDatabase(new Date(2026, 10, 17));
  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  const makanJournal = db.journals.find((j) => j.description.includes('Makan siang'))!;
  const makanLines = db.journalLines.filter((l) => l.journal_id === makanJournal.id);

  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, 'kopi'), true);
  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, '10/11/2026'), true);
  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, '10 november'), true);
  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, '65000'), true);
  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, '65.000'), true);
  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, 'Rp65.000'), true);
  assert.equal(matchesTransactionQuery(makanJournal, makanLines, accountsMap, '999999'), false);
});

test('Laba Rugi "all" menjumlahkan lintas bulan dan Buku Kas menghitung saldo awal periode', () => {
  let db = emptyDb();
  db = recordTransaction(db, {
    actionType: 'masuk',
    amount: 2_000_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-4101',
    date: '2026-10-15',
    description: 'Proyek Oktober',
  }).db;
  db = recordTransaction(db, {
    actionType: 'keluar',
    amount: 500_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-5101',
    date: '2026-10-20',
    description: 'Makan Oktober',
  }).db;
  db = recordTransaction(db, {
    actionType: 'masuk',
    amount: 1_000_000,
    walletId: 'acc-1102',
    categoryAccountId: 'acc-4101',
    date: '2026-11-05',
    description: 'Proyek November',
  }).db;

  const lrAll = buildLabaRugi(db, 'all');
  assert.equal(lrAll.totalRevenue, 3_000_000);
  assert.equal(lrAll.totalExpense, 500_000);
  assert.equal(lrAll.netProfit, 2_500_000);

  const bukuKasNov = buildBukuKas(db, { month: '2026-11' });
  assert.equal(bukuKasNov.openingBalance, 1_500_000);
  assert.equal(bukuKasNov.totalMasuk, 1_000_000);
  assert.equal(bukuKasNov.closingBalance, 2_500_000);
});

test('Kelebihan bayar utang tercatat negatif dan normalizeDatabase melengkapi backup parsial', () => {
  let db = emptyDb();
  db = recordTransaction(db, {
    actionType: 'belanja_utang',
    amount: 100_000,
    walletId: 'acc-2101',
    categoryAccountId: 'acc-5101',
    date: '2026-11-05',
    description: 'Beli makan utang',
    counterparty: 'Warung Mba',
  }).db;
  db = recordTransaction(db, {
    actionType: 'bayar_utang',
    amount: 120_000,
    walletId: 'acc-1101',
    categoryAccountId: 'acc-2101',
    date: '2026-11-06',
    description: 'Bayar lebih',
    counterparty: 'Warung Mba',
  }).db;

  const ledgers = buildCounterpartyLedgers(db);
  assert.equal(ledgers[0].remaining, -20_000);

  const normalized = normalizeDatabase({
    accounts: DEFAULT_ACCOUNTS,
    journals: [],
    journalLines: [],
  });
  assert.equal(normalized.settings.ownerName, DEFAULT_SETTINGS.ownerName);
  assert.deepEqual(normalized.budgets, {});
  assert.deepEqual(normalized.recurringRules, []);
});
