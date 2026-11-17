import type {
  Account,
  Journal,
  JournalLine,
  LedgerDatabase,
  TransactionInput,
} from './types';
import { DEFAULT_ACCOUNTS, DEFAULT_SETTINGS } from './defaultAccounts';
import { formatRupiahTitle, todayLocalDate } from './format';
import { DraftJournalLine, saveJournalAtomic, updateJournalAtomic } from './ledger';

function findAccountOrThrow(
  accounts: Account[],
  idOrCode: string | undefined,
  fallbackMessage: string,
): Account {
  if (!idOrCode) {
    throw new Error(fallbackMessage);
  }
  const found = accounts.find((a) => a.id === idOrCode || a.code === idOrCode);
  if (!found) {
    throw new Error(fallbackMessage);
  }
  return found;
}

/**
 * Map a simple user-facing money entry into a balanced double-entry journal payload.
 * The user NEVER has to choose Debit or Credit manually.
 */
export function buildJournalFromTransaction(
  accounts: Account[],
  input: TransactionInput,
): {
  date: string;
  description: string;
  kind: 'biasa' | 'saldo_awal';
  lines: DraftJournalLine[];
  tx_meta: Journal['tx_meta'];
} {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('Nominal harus berupa bilangan bulat rupiah lebih dari 0.');
  }
  const adminFee = input.adminFee ?? 0;
  if (!Number.isSafeInteger(adminFee) || adminFee < 0) {
    throw new Error('Biaya admin harus berupa bilangan bulat rupiah (>= 0).');
  }

  const desc = input.description.trim();

  switch (input.actionType) {
    case 'masuk': {
      const wallet = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih dompet tujuan (Kas/Bank/E-Wallet).',
      );
      const category = findAccountOrThrow(
        accounts,
        input.categoryAccountId,
        'Pilih kategori pemasukan.',
      );
      return {
        date: input.date,
        description: desc || `${category.name} masuk ke ${wallet.name}`,
        kind: 'biasa',
        lines: [
          { account_id: wallet.id, debit: input.amount, credit: 0, memo: desc || wallet.name },
          { account_id: category.id, debit: 0, credit: input.amount, memo: desc || category.name },
        ],
        tx_meta: {
          actionType: 'masuk',
          amount: input.amount,
          walletId: wallet.id,
          categoryAccountId: category.id,
        },
      };
    }

    case 'keluar': {
      const wallet = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih dompet sumber pengeluaran.',
      );
      const category = findAccountOrThrow(
        accounts,
        input.categoryAccountId,
        'Pilih kategori pengeluaran.',
      );
      return {
        date: input.date,
        description: desc || `${category.name} via ${wallet.name}`,
        kind: 'biasa',
        lines: [
          { account_id: category.id, debit: input.amount, credit: 0, memo: desc || category.name },
          { account_id: wallet.id, debit: 0, credit: input.amount, memo: desc || wallet.name },
        ],
        tx_meta: {
          actionType: 'keluar',
          amount: input.amount,
          walletId: wallet.id,
          categoryAccountId: category.id,
        },
      };
    }

    case 'pindah': {
      const fromWallet = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih dompet asal.',
      );
      const toWallet = findAccountOrThrow(
        accounts,
        input.toWalletId,
        'Pilih dompet tujuan.',
      );
      if (fromWallet.id === toWallet.id) {
        throw new Error('Dompet asal dan dompet tujuan tidak boleh sama.');
      }
      const lines: DraftJournalLine[] = [
        {
          account_id: toWallet.id,
          debit: input.amount,
          credit: 0,
          memo: `Terima dari ${fromWallet.name}`,
        },
      ];
      if (adminFee > 0) {
        const adminAccount = findAccountOrThrow(
          accounts,
          'acc-5106',
          'Akun 5106 Admin Bank tidak ditemukan.',
        );
        lines.push({
          account_id: adminAccount.id,
          debit: adminFee,
          credit: 0,
          memo: `Biaya admin pindah saldo`,
        });
      }
      lines.push({
        account_id: fromWallet.id,
        debit: 0,
        credit: input.amount + adminFee,
        memo: `Transfer ke ${toWallet.name}`,
      });
      return {
        date: input.date,
        description: desc || `Pindah saldo ${fromWallet.name} ke ${toWallet.name}`,
        kind: 'biasa',
        lines,
        tx_meta: {
          actionType: 'pindah',
          amount: input.amount,
          adminFee,
          walletId: fromWallet.id,
          toWalletId: toWallet.id,
        },
      };
    }

    case 'belanja_utang': {
      const expenseAcc = findAccountOrThrow(
        accounts,
        input.categoryAccountId,
        'Pilih kategori beban belanja.',
      );
      const debtAcc = findAccountOrThrow(
        accounts,
        input.walletId ?? 'acc-2101',
        'Pilih akun utang (Utang / Paylater).',
      );
      return {
        date: input.date,
        description:
          desc ||
          `Belanja belum bayar: ${expenseAcc.name}${input.counterparty ? ` (${input.counterparty})` : ''}`,
        kind: 'biasa',
        lines: [
          { account_id: expenseAcc.id, debit: input.amount, credit: 0, memo: desc || expenseAcc.name },
          { account_id: debtAcc.id, debit: 0, credit: input.amount, memo: desc || debtAcc.name },
        ],
        tx_meta: {
          actionType: 'belanja_utang',
          amount: input.amount,
          walletId: debtAcc.id,
          categoryAccountId: expenseAcc.id,
          counterparty: input.counterparty,
        },
      };
    }

    case 'bayar_utang': {
      const wallet = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih dompet pembayar utang.',
      );
      const debtAcc = findAccountOrThrow(
        accounts,
        input.categoryAccountId ?? 'acc-2101',
        'Pilih akun utang yang dibayar.',
      );
      return {
        date: input.date,
        description:
          desc ||
          `Bayar ${debtAcc.name} dari ${wallet.name}${input.counterparty ? ` (${input.counterparty})` : ''}`,
        kind: 'biasa',
        lines: [
          { account_id: debtAcc.id, debit: input.amount, credit: 0, memo: desc || debtAcc.name },
          { account_id: wallet.id, debit: 0, credit: input.amount, memo: desc || wallet.name },
        ],
        tx_meta: {
          actionType: 'bayar_utang',
          amount: input.amount,
          walletId: wallet.id,
          categoryAccountId: debtAcc.id,
          counterparty: input.counterparty,
        },
      };
    }

    case 'pinjamkan': {
      const wallet = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih dompet sumber pinjaman.',
      );
      const piutangAcc = findAccountOrThrow(
        accounts,
        input.categoryAccountId ?? 'acc-1201',
        'Akun Piutang tidak ditemukan.',
      );
      return {
        date: input.date,
        description:
          desc ||
          `Pinjamkan uang${input.counterparty ? ` ke ${input.counterparty}` : ''} dari ${wallet.name}`,
        kind: 'biasa',
        lines: [
          { account_id: piutangAcc.id, debit: input.amount, credit: 0, memo: desc || piutangAcc.name },
          { account_id: wallet.id, debit: 0, credit: input.amount, memo: desc || wallet.name },
        ],
        tx_meta: {
          actionType: 'pinjamkan',
          amount: input.amount,
          walletId: wallet.id,
          categoryAccountId: piutangAcc.id,
          counterparty: input.counterparty,
        },
      };
    }

    case 'dilunasi': {
      const wallet = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih dompet penerima pelunasan piutang.',
      );
      const piutangAcc = findAccountOrThrow(
        accounts,
        input.categoryAccountId ?? 'acc-1201',
        'Akun Piutang tidak ditemukan.',
      );
      return {
        date: input.date,
        description:
          desc ||
          `Pelunasan piutang${input.counterparty ? ` dari ${input.counterparty}` : ''} ke ${wallet.name}`,
        kind: 'biasa',
        lines: [
          { account_id: wallet.id, debit: input.amount, credit: 0, memo: desc || wallet.name },
          { account_id: piutangAcc.id, debit: 0, credit: input.amount, memo: desc || piutangAcc.name },
        ],
        tx_meta: {
          actionType: 'dilunasi',
          amount: input.amount,
          walletId: wallet.id,
          categoryAccountId: piutangAcc.id,
          counterparty: input.counterparty,
        },
      };
    }

    case 'saldo_awal': {
      const assetAcc = findAccountOrThrow(
        accounts,
        input.walletId,
        'Pilih akun aset untuk saldo awal.',
      );
      const modalAcc = findAccountOrThrow(
        accounts,
        'acc-3101',
        'Akun 3101 Modal Awal tidak ditemukan.',
      );
      return {
        date: input.date,
        description: desc || `Saldo awal ${assetAcc.name}`,
        kind: 'saldo_awal',
        lines: [
          { account_id: assetAcc.id, debit: input.amount, credit: 0, memo: `Saldo awal ${assetAcc.name}` },
          { account_id: modalAcc.id, debit: 0, credit: input.amount, memo: 'Modal Awal' },
        ],
        tx_meta: {
          actionType: 'saldo_awal',
          amount: input.amount,
          walletId: assetAcc.id,
          categoryAccountId: modalAcc.id,
        },
      };
    }
  }
}

export function recordTransaction(
  db: LedgerDatabase,
  input: TransactionInput,
): { db: LedgerDatabase; journal: Journal; lines: JournalLine[] } {
  const payload = buildJournalFromTransaction(db.accounts, input);
  return saveJournalAtomic(db, payload);
}

export function editFullTransaction(
  db: LedgerDatabase,
  journalId: string,
  input: TransactionInput,
): { db: LedgerDatabase; journal: Journal; lines: JournalLine[] } {
  const payload = buildJournalFromTransaction(db.accounts, input);
  return updateJournalAtomic(db, journalId, payload);
}

export function createEmptyDatabase(
  ownerName: string = DEFAULT_SETTINGS.ownerName,
  businessName: string = DEFAULT_SETTINGS.businessName,
): LedgerDatabase {
  return {
    version: 1,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    journals: [],
    journalLines: [],
    settings: {
      ...DEFAULT_SETTINGS,
      ownerName: ownerName.trim() || DEFAULT_SETTINGS.ownerName,
      businessName: businessName.trim() || DEFAULT_SETTINGS.businessName,
    },
    budgets: {},
    recurringRules: [],
  };
}

/**
 * Automatically record monthly recurring transactions that have reached their `dayOfMonth`
 * in the current local month and have not yet been generated (`lastGeneratedMonth !== YYYY-MM`).
 */
export function applyDueRecurringRules(
  db: LedgerDatabase,
  now: Date = new Date(),
): { db: LedgerDatabase; generatedCount: number; generatedDescriptions: string[] } {
  const rules = db.recurringRules ?? [];
  if (rules.length === 0) {
    return { db, generatedCount: 0, generatedDescriptions: [] };
  }

  const year = now.getFullYear();
  const monthNum = now.getMonth() + 1;
  const currentMonth = `${year}-${String(monthNum).padStart(2, '0')}`;
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const todayDay = now.getDate();

  let nextDb = db;
  const generatedDescriptions: string[] = [];
  const updatedRules = rules.map((rule) => {
    if (!rule.isActive) return rule;
    if (rule.lastGeneratedMonth === currentMonth) return rule;

    const effectiveDay = Math.min(Math.max(1, Math.trunc(rule.dayOfMonth)), daysInMonth);
    if (todayDay < effectiveDay) return rule;

    const scheduledDate = `${currentMonth}-${String(effectiveDay).padStart(2, '0')}`;
    try {
      const saved = recordTransaction(nextDb, {
        actionType: rule.actionType,
        amount: rule.amount,
        walletId: rule.walletId,
        categoryAccountId: rule.categoryAccountId,
        date: scheduledDate,
        description: `${rule.description} (Otomatis Bulanan)`,
      });
      nextDb = saved.db;
      generatedDescriptions.push(rule.description);
      return { ...rule, lastGeneratedMonth: currentMonth };
    } catch {
      return rule;
    }
  });

  if (generatedDescriptions.length === 0) {
    return { db, generatedCount: 0, generatedDescriptions: [] };
  }

  return {
    db: {
      ...nextDb,
      recurringRules: updatedRules,
    },
    generatedCount: generatedDescriptions.length,
    generatedDescriptions,
  };
}

/**
 * Generate a plain-language Indonesian accounting explanation for any journal entry.
 * Example: "Beban Makan bertambah Rp45.000, Kas berkurang Rp45.000"
 */
export function explainJournal(
  lines: JournalLine[],
  accountsMap: Map<string, Account>,
): string {
  const parts: string[] = [];

  for (const line of lines) {
    const acc = accountsMap.get(line.account_id);
    if (!acc) continue;
    const prefix =
      acc.type === 'EXPENSE'
        ? 'Beban '
        : acc.type === 'REVENUE'
          ? 'Pendapatan '
          : '';
    const label = acc.name.startsWith(prefix.trim()) ? acc.name : `${prefix}${acc.name}`;

    if (line.debit > 0) {
      const verb = acc.normal_balance === 'DEBIT' ? 'bertambah' : 'berkurang';
      parts.push(`${label} ${verb} ${formatRupiahTitle(line.debit)}`);
    } else if (line.credit > 0) {
      const verb = acc.normal_balance === 'CREDIT' ? 'bertambah' : 'berkurang';
      parts.push(`${label} ${verb} ${formatRupiahTitle(line.credit)}`);
    }
  }

  return parts.join(', ');
}

/**
 * Create a realistic, balanced Indonesian seed database for immediate usability.
 */
export function createSeedDatabase(referenceDate: Date = new Date()): LedgerDatabase {
  const y = referenceDate.getFullYear();
  const m = String(referenceDate.getMonth() + 1).padStart(2, '0');
  const today = todayLocalDate(referenceDate);
  const d01 = `${y}-${m}-01`;
  const d03 = `${y}-${m}-03`;
  const d05 = `${y}-${m}-05`;
  const d08 = `${y}-${m}-08`;
  const d10 = `${y}-${m}-10`;
  const d12 = `${y}-${m}-12`;

  let db: LedgerDatabase = {
    version: 1,
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    journals: [],
    journalLines: [],
    settings: { ...DEFAULT_SETTINGS },
    budgets: {
      'acc-5101': 1_500_000,
      'acc-5102': 500_000,
      'acc-5103': 500_000,
      'acc-5104': 1_500_000,
    },
    recurringRules: [],
  };

  const seeds: TransactionInput[] = [
    {
      actionType: 'saldo_awal',
      amount: 1_500_000,
      walletId: 'acc-1101',
      date: d01,
      description: 'Saldo awal Kas Tunai',
    },
    {
      actionType: 'saldo_awal',
      amount: 6_250_000,
      walletId: 'acc-1102',
      date: d01,
      description: 'Saldo awal Rekening Bank BCA',
    },
    {
      actionType: 'saldo_awal',
      amount: 850_000,
      walletId: 'acc-1103',
      date: d01,
      description: 'Saldo awal E-Wallet QRIS',
    },
    {
      actionType: 'masuk',
      amount: 4_200_000,
      walletId: 'acc-1102',
      categoryAccountId: 'acc-4101',
      date: d03,
      description: 'Pembayaran proyek desain & jasa usaha',
    },
    {
      actionType: 'keluar',
      amount: 1_200_000,
      walletId: 'acc-1102',
      categoryAccountId: 'acc-5104',
      date: d05,
      description: 'Bayar sewa kos bulan ini',
    },
    {
      actionType: 'pindah',
      amount: 500_000,
      adminFee: 2_500,
      walletId: 'acc-1102',
      toWalletId: 'acc-1103',
      date: d08,
      description: 'Top up E-Wallet dari Bank',
    },
    {
      actionType: 'keluar',
      amount: 65_000,
      walletId: 'acc-1101',
      categoryAccountId: 'acc-5101',
      date: d10,
      description: 'Makan siang & kopi',
    },
    {
      actionType: 'pinjamkan',
      amount: 300_000,
      walletId: 'acc-1103',
      categoryAccountId: 'acc-1201',
      date: d12,
      description: 'Pinjamkan ke Raka untuk bayar ongkir',
      counterparty: 'Raka',
    },
    {
      actionType: 'belanja_utang',
      amount: 450_000,
      walletId: 'acc-2102',
      categoryAccountId: 'acc-5103',
      date: today,
      description: 'Paket internet & perangkat kerja (Paylater)',
      counterparty: 'Paylater',
    },
  ];

  for (const s of seeds) {
    db = recordTransaction(db, s).db;
  }

  return db;
}
