import type {
  Account,
  BudgetProgressItem,
  BukuBesarRow,
  CounterpartyLedgerItem,
  Journal,
  JournalLine,
  JurnalUmumEntry,
  LabaRugiReport,
  LedgerDatabase,
  NeracaReport,
  NeracaSaldoRow,
} from './types';
import { computeAccountBalances } from './ledger';
import {
  formatRibuan,
  formatRupiahTitle,
  formatTanggalID,
  formatTanggalPanjangID,
  todayLocalDate,
} from './format';

function sortJournalsChronological(journals: Journal[]): Journal[] {
  return [...journals].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.number.localeCompare(b.number);
  });
}

export function buildJurnalUmum(
  db: LedgerDatabase,
  options?: {
    month?: string; // YYYY-MM or 'all'
    includeReversals?: boolean;
  },
): JurnalUmumEntry[] {
  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  const includeReversals = options?.includeReversals ?? true;

  const filtered = sortJournalsChronological(db.journals).filter((j) => {
    if (options?.month && options.month !== 'all' && !j.date.startsWith(options.month)) {
      return false;
    }
    if (!includeReversals && (j.voided_at !== null || j.kind === 'pembalik')) {
      return false;
    }
    return true;
  });

  return filtered.map((journal) => {
    const rawLines = db.journalLines.filter((l) => l.journal_id === journal.id);
    // Standard accounting order: Debit lines first, then Credit lines
    const sortedLines = [...rawLines].sort((a, b) => {
      if (a.debit > 0 && b.debit === 0) return -1;
      if (a.debit === 0 && b.debit > 0) return 1;
      return 0;
    });

    const lines = sortedLines
      .map((line) => {
        const account = accountsMap.get(line.account_id);
        return account ? { line, account } : null;
      })
      .filter((x): x is { line: JournalLine; account: Account } => x !== null);

    const totalDebit = lines.reduce((acc, item) => acc + item.line.debit, 0);
    const totalCredit = lines.reduce((acc, item) => acc + item.line.credit, 0);

    return { journal, lines, totalDebit, totalCredit };
  });
}

export function buildBukuBesar(
  db: LedgerDatabase,
  accountId: string,
  options?: { month?: string },
): { account: Account; openingBalance: number; rows: BukuBesarRow[]; closingBalance: number } | null {
  const account = db.accounts.find((a) => a.id === accountId);
  if (!account) return null;

  const chronological = sortJournalsChronological(db.journals);
  const journalMap = new Map(chronological.map((j) => [j.id, j]));

  let running = 0;
  let openingBalance = 0;
  const rows: BukuBesarRow[] = [];

  for (const journal of chronological) {
    const lines = db.journalLines.filter(
      (l) => l.journal_id === journal.id && l.account_id === accountId,
    );
    for (const line of lines) {
      const delta =
        account.normal_balance === 'DEBIT'
          ? line.debit - line.credit
          : line.credit - line.debit;

      if (options?.month && options.month !== 'all' && journal.date < `${options.month}-01`) {
        running += delta;
        openingBalance = running;
        continue;
      }
      if (options?.month && options.month !== 'all' && !journal.date.startsWith(options.month)) {
        continue;
      }

      running += delta;
      const refJournal = journalMap.get(line.journal_id);
      rows.push({
        journalId: journal.id,
        journalNumber: journal.number,
        date: journal.date,
        description: journal.description,
        memo: line.memo,
        ref: refJournal?.number ?? journal.number,
        debit: line.debit,
        credit: line.credit,
        runningBalance: running,
        isVoided: journal.voided_at !== null || journal.kind === 'pembalik',
        kind: journal.kind,
      });
    }
  }

  return {
    account,
    openingBalance,
    rows,
    closingBalance: running,
  };
}

/**
 * Buku Kas: combined cash/bank/e-wallet ledger (all active wallet accounts or a specific wallet).
 */
export function buildBukuKas(
  db: LedgerDatabase,
  options?: { month?: string; walletAccountId?: string },
): {
  openingBalance: number;
  rows: Array<BukuBesarRow & { walletName: string; walletCode: string }>;
  totalMasuk: number;
  totalKeluar: number;
  closingBalance: number;
} {
  const walletIds = new Set(
    db.accounts
      .filter((a) => (options?.walletAccountId ? a.id === options.walletAccountId : a.is_wallet || ['1101', '1102', '1103'].includes(a.code)))
      .map((a) => a.id),
  );
  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  const chronological = sortJournalsChronological(db.journals);

  let running = 0;
  let openingBalance = 0;
  let totalMasuk = 0;
  let totalKeluar = 0;
  const rows: Array<BukuBesarRow & { walletName: string; walletCode: string }> = [];

  for (const journal of chronological) {
    const lines = db.journalLines.filter(
      (l) => l.journal_id === journal.id && walletIds.has(l.account_id),
    );
    for (const line of lines) {
      const acc = accountsMap.get(line.account_id);
      if (!acc) continue;
      const delta = line.debit - line.credit;
      if (options?.month && options.month !== 'all' && journal.date < `${options.month}-01`) {
        running += delta;
        openingBalance = running;
        continue;
      }
      if (options?.month && options.month !== 'all' && !journal.date.startsWith(options.month)) {
        continue;
      }
      running += delta;
      const isVoidOrReversal = journal.voided_at !== null || journal.kind === 'pembalik';
      if (!isVoidOrReversal) {
        totalMasuk += line.debit;
        totalKeluar += line.credit;
      }
      rows.push({
        journalId: journal.id,
        journalNumber: journal.number,
        date: journal.date,
        description: journal.description,
        memo: line.memo,
        ref: journal.number,
        debit: line.debit,
        credit: line.credit,
        runningBalance: running,
        isVoided: journal.voided_at !== null || journal.kind === 'pembalik',
        kind: journal.kind,
        walletName: acc.name,
        walletCode: acc.code,
      });
    }
  }

  return { openingBalance, rows, totalMasuk, totalKeluar, closingBalance: running };
}

export function buildNeracaSaldo(
  db: LedgerDatabase,
  upToDate?: string,
): { rows: NeracaSaldoRow[]; totalDebit: number; totalCredit: number; isBalanced: boolean } {
  const balances = computeAccountBalances(
    db.accounts,
    db.journalLines,
    db.journals,
    upToDate,
  );

  const sortedAccounts = [...db.accounts].sort((a, b) => a.code.localeCompare(b.code));
  const rows: NeracaSaldoRow[] = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const account of sortedAccounts) {
    const entry = balances.get(account.id);
    if (!entry) continue;
    if (entry.debitTotal === 0 && entry.creditTotal === 0) continue;

    // Net signed balance on normal side
    const netSigned =
      account.normal_balance === 'DEBIT'
        ? entry.debitTotal - entry.creditTotal
        : entry.creditTotal - entry.debitTotal;

    if (netSigned === 0) continue;

    let debitCol = 0;
    let creditCol = 0;

    if (account.normal_balance === 'DEBIT') {
      if (netSigned >= 0) debitCol = netSigned;
      else creditCol = Math.abs(netSigned);
    } else {
      if (netSigned >= 0) creditCol = netSigned;
      else debitCol = Math.abs(netSigned);
    }

    totalDebit += debitCol;
    totalCredit += creditCol;
    rows.push({
      account,
      debit: debitCol,
      credit: creditCol,
      netBalance: netSigned,
    });
  }

  return {
    rows,
    totalDebit,
    totalCredit,
    isBalanced: totalDebit === totalCredit,
  };
}

export function buildLabaRugi(db: LedgerDatabase, month: string): LabaRugiReport {
  const monthJournals = new Set(
    (month === 'all'
      ? db.journals
      : db.journals.filter((j) => j.date.startsWith(month))
    ).map((j) => j.id),
  );
  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  const sums = new Map<string, number>();

  for (const line of db.journalLines) {
    if (!monthJournals.has(line.journal_id)) continue;
    const acc = accountsMap.get(line.account_id);
    if (!acc) continue;
    if (acc.type !== 'REVENUE' && acc.type !== 'EXPENSE') continue;
    const delta =
      acc.type === 'REVENUE'
        ? line.credit - line.debit
        : line.debit - line.credit;
    sums.set(acc.id, (sums.get(acc.id) ?? 0) + delta);
  }

  const revenues: Array<{ account: Account; amount: number }> = [];
  const expenses: Array<{ account: Account; amount: number }> = [];

  for (const acc of [...db.accounts].sort((a, b) => a.code.localeCompare(b.code))) {
    const val = sums.get(acc.id) ?? 0;
    if (val === 0) continue;
    if (acc.type === 'REVENUE') revenues.push({ account: acc, amount: val });
    if (acc.type === 'EXPENSE') expenses.push({ account: acc, amount: val });
  }

  const totalRevenue = revenues.reduce((s, r) => s + r.amount, 0);
  const totalExpense = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    month,
    revenues,
    expenses,
    totalRevenue,
    totalExpense,
    netProfit: totalRevenue - totalExpense,
  };
}

export function buildHomeSummary(db: LedgerDatabase, month: string) {
  const balances = computeAccountBalances(db.accounts, db.journalLines);
  const wallets = db.accounts
    .filter((a) => a.is_active && (a.is_wallet || ['1101', '1102', '1103'].includes(a.code)))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => ({
      account,
      balance: balances.get(account.id)?.balance ?? 0,
    }));

  const totalWalletBalance = wallets.reduce((s, w) => s + w.balance, 0);
  const labaRugi = buildLabaRugi(db, month);

  const totalReceivable = db.accounts
    .filter((a) => a.code.startsWith('12') && a.type === 'ASSET')
    .reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0);

  const totalDebt = db.accounts
    .filter((a) => a.type === 'LIABILITY')
    .reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0);

  const totalAssets = db.accounts
    .filter((a) => a.type === 'ASSET')
    .reduce((s, a) => s + (balances.get(a.id)?.balance ?? 0), 0);

  const totalEquity = db.accounts
    .filter((a) => a.type === 'EQUITY')
    .reduce((s, a) => {
      const bal = balances.get(a.id)?.balance ?? 0;
      return a.normal_balance === 'CREDIT' ? s + bal : s - bal;
    }, 0);

  return {
    wallets,
    totalWalletBalance,
    monthlyIncome: labaRugi.totalRevenue,
    monthlyExpense: labaRugi.totalExpense,
    monthlyNet: labaRugi.netProfit,
    totalReceivable,
    totalDebt,
    totalAssets,
    totalEquity,
  };
}

/**
 * Laporan Neraca (Posisi Keuangan):
 * Aset = Kewajiban + Ekuitas + Laba/Rugi Periode Berjalan.
 */
export function buildNeraca(db: LedgerDatabase, upToDate?: string): NeracaReport {
  const effectiveDate = upToDate ?? todayLocalDate();
  const balances = computeAccountBalances(
    db.accounts,
    db.journalLines,
    db.journals,
    upToDate,
  );
  const sorted = [...db.accounts].sort((a, b) => a.code.localeCompare(b.code));

  const assets: Array<{ account: Account; amount: number }> = [];
  const liabilities: Array<{ account: Account; amount: number }> = [];
  const equities: Array<{ account: Account; amount: number }> = [];

  let totalRevenue = 0;
  let totalExpense = 0;

  for (const acc of sorted) {
    const entry = balances.get(acc.id);
    if (!entry) continue;
    const raw = entry.balance;
    if (acc.type === 'ASSET') {
      if (raw !== 0) assets.push({ account: acc, amount: raw });
    } else if (acc.type === 'LIABILITY') {
      if (raw !== 0) liabilities.push({ account: acc, amount: raw });
    } else if (acc.type === 'EQUITY') {
      if (raw !== 0) {
        const signed = acc.normal_balance === 'CREDIT' ? raw : -raw;
        equities.push({ account: acc, amount: signed });
      }
    } else if (acc.type === 'REVENUE') {
      totalRevenue += raw;
    } else if (acc.type === 'EXPENSE') {
      totalExpense += raw;
    }
  }

  const currentNetProfit = totalRevenue - totalExpense;
  const totalAssets = assets.reduce((s, a) => s + a.amount, 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + l.amount, 0);
  const totalEquityAccounts = equities.reduce((s, e) => s + e.amount, 0);
  const totalEquityWithProfit = totalEquityAccounts + currentNetProfit;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquityWithProfit;

  return {
    upToDate: effectiveDate,
    assets,
    liabilities,
    equities,
    currentNetProfit,
    totalAssets,
    totalLiabilities,
    totalEquityWithProfit,
    totalLiabilitiesAndEquity,
    isBalanced: totalAssets === totalLiabilitiesAndEquity,
  };
}

/**
 * Aggregate active Piutang (12xx) and Utang (2xxx) per counterparty name across non-voided journals.
 */
export function buildCounterpartyLedgers(db: LedgerDatabase): CounterpartyLedgerItem[] {
  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  const map = new Map<string, CounterpartyLedgerItem>();

  const chronological = sortJournalsChronological(db.journals);
  for (const j of chronological) {
    if (j.voided_at || j.kind === 'pembalik') continue;
    const lines = db.journalLines.filter((l) => l.journal_id === j.id);

    for (const line of lines) {
      const acc = accountsMap.get(line.account_id);
      if (!acc) continue;
      const isPiutang = acc.type === 'ASSET' && acc.code.startsWith('12');
      const isUtang = acc.type === 'LIABILITY';
      if (!isPiutang && !isUtang) continue;

      const kind: 'piutang' | 'utang' = isPiutang ? 'piutang' : 'utang';
      const party = j.tx_meta?.counterparty?.trim() || 'Umum / Tanpa Nama';
      const key = `${kind}:${acc.id}:${party.toLowerCase()}`;

      const existing = map.get(key) ?? {
        key,
        counterparty: party,
        kind,
        accountId: acc.id,
        accountCode: acc.code,
        accountName: acc.name,
        totalAdded: 0,
        totalSettled: 0,
        remaining: 0,
        lastDate: j.date,
      };

      if (kind === 'piutang') {
        existing.totalAdded += line.debit;
        existing.totalSettled += line.credit;
      } else {
        existing.totalAdded += line.credit;
        existing.totalSettled += line.debit;
      }
      existing.remaining = existing.totalAdded - existing.totalSettled;
      if (j.date > existing.lastDate) existing.lastDate = j.date;

      map.set(key, existing);
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.remaining !== a.remaining) return b.remaining - a.remaining;
    return b.lastDate.localeCompare(a.lastDate);
  });
}

/**
 * Compute monthly expense spending against configured budgets per category.
 */
export function buildBudgetProgress(
  db: LedgerDatabase,
  month: string,
): BudgetProgressItem[] {
  const budgets = db.budgets ?? {};
  const labaRugi = buildLabaRugi(db, month);
  const spentByAcc = new Map(labaRugi.expenses.map((e) => [e.account.id, e.amount]));
  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));

  const items: BudgetProgressItem[] = [];
  for (const [accountId, budget] of Object.entries(budgets)) {
    if (!Number.isFinite(budget) || budget <= 0) continue;
    const account = accountsMap.get(accountId);
    if (!account || !account.is_active) continue;

    const spent = spentByAcc.get(accountId) ?? 0;
    const remaining = budget - spent;
    const percentUsed = Math.round((spent / budget) * 100);
    const status: BudgetProgressItem['status'] =
      spent > budget ? 'melebihi' : percentUsed >= 80 ? 'mendekati' : 'aman';

    items.push({
      account,
      budget,
      spent,
      remaining,
      percentUsed,
      status,
    });
  }

  return items.sort((a, b) => b.percentUsed - a.percentUsed || a.account.code.localeCompare(b.account.code));
}

/**
 * Pure search matcher for TransaksiView supporting description, journal number,
 * counterparty, account names/codes, local dates (dd/mm/yyyy, yyyy-mm-dd, "17 November 2026"),
 * and nominal rupiah amounts (raw digits, dot-formatted, or "Rp...").
 */
export function matchesTransactionQuery(
  journal: Journal,
  lines: JournalLine[],
  accountsMap: Map<string, Account>,
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  if (journal.description.toLowerCase().includes(q)) return true;
  if (journal.number.toLowerCase().includes(q)) return true;
  if (journal.tx_meta?.counterparty?.toLowerCase().includes(q)) return true;

  const dateShort = formatTanggalID(journal.date).toLowerCase();
  const dateLong = formatTanggalPanjangID(journal.date).toLowerCase();
  if (
    dateShort.includes(q) ||
    journal.date.toLowerCase().includes(q) ||
    dateLong.includes(q)
  ) {
    return true;
  }

  for (const line of lines) {
    const acc = accountsMap.get(line.account_id);
    if (acc && (acc.name.toLowerCase().includes(q) || acc.code.toLowerCase().includes(q))) {
      return true;
    }
  }

  const totalAmount = lines.reduce((s, l) => s + l.debit, 0);
  const candidateAmounts = [
    totalAmount,
    ...(journal.tx_meta?.amount ? [journal.tx_meta.amount] : []),
    ...lines.map((l) => (l.debit > 0 ? l.debit : l.credit)),
  ];

  for (const amt of candidateAmounts) {
    if (amt <= 0) continue;
    const rawStr = String(amt);
    const formatted = formatRibuan(amt).toLowerCase();
    const rupiah = formatRupiahTitle(amt).toLowerCase();
    if (rawStr.includes(q) || formatted.includes(q) || rupiah.includes(q)) {
      return true;
    }
  }

  // Handle currency/formatted numeric input like "rp 65.000" or "65,000"
  if (/^(rp\s*)?[\d.,\s]+$/i.test(q)) {
    const digitsOnly = q.replace(/[^0-9]/g, '');
    if (digitsOnly.length > 0) {
      for (const amt of candidateAmounts) {
        if (amt > 0 && String(amt).includes(digitsOnly)) {
          return true;
        }
      }
    }
  }

  return false;
}
