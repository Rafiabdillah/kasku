import type {
  Account,
  Journal,
  JournalKind,
  JournalLine,
  LedgerDatabase,
  TransactionMeta,
} from './types';
import { isValidLocalDate } from './format';

export interface DraftJournalLine {
  account_id: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface SaveJournalPayload {
  date: string;
  description: string;
  kind: JournalKind;
  lines: DraftJournalLine[];
  tx_meta?: TransactionMeta;
  void_of_id?: string | null;
  created_at?: string;
}

export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nextJournalNumber(journals: Journal[]): string {
  let maxNum = 0;
  for (const j of journals) {
    const match = /^JU-(\d+)$/.exec(j.number);
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  return `JU-${String(maxNum + 1).padStart(4, '0')}`;
}

export function validateJournalLines(
  lines: DraftJournalLine[],
  accountsMap: Map<string, Account>,
): void {
  if (lines.length < 2) {
    throw new Error('Jurnal minimal harus memiliki 2 baris (debit dan kredit).');
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!accountsMap.has(line.account_id)) {
      throw new Error(`Akun pada baris ke-${i + 1} tidak ditemukan.`);
    }
    if (!Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit)) {
      throw new Error('Nominal rupiah harus berupa bilangan bulat (tanpa desimal).');
    }
    if (line.debit < 0 || line.credit < 0) {
      throw new Error('Nominal debit atau kredit tidak boleh negatif.');
    }
    if (line.debit > 0 && line.credit > 0) {
      throw new Error('Satu baris jurnal tidak boleh berisi debit dan kredit sekaligus.');
    }
    if (line.debit === 0 && line.credit === 0) {
      throw new Error('Baris jurnal tidak boleh bernilai nol di debit dan kredit sekaligus.');
    }
    totalDebit += line.debit;
    totalCredit += line.credit;
  }

  if (totalDebit <= 0 || totalDebit !== totalCredit) {
    throw new Error(
      `Total debit (${totalDebit}) dan total kredit (${totalCredit}) tidak seimbang.`,
    );
  }
}

/**
 * Atomically validate and append a balanced journal + lines to an immutable snapshot of LedgerDatabase.
 */
export function saveJournalAtomic(
  db: LedgerDatabase,
  payload: SaveJournalPayload,
): { db: LedgerDatabase; journal: Journal; lines: JournalLine[] } {
  if (!isValidLocalDate(payload.date)) {
    throw new Error('Tanggal transaksi tidak valid (harus format YYYY-MM-DD lokal).');
  }
  const desc = payload.description.trim();
  if (!desc) {
    throw new Error('Keterangan transaksi wajib diisi.');
  }

  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  validateJournalLines(payload.lines, accountsMap);

  const journalId = generateId('jrn');
  const journal: Journal = {
    id: journalId,
    date: payload.date,
    number: nextJournalNumber(db.journals),
    description: desc,
    created_at: payload.created_at ?? new Date().toISOString(),
    voided_at: null,
    void_of_id: payload.void_of_id ?? null,
    reversal_journal_id: null,
    kind: payload.kind,
    tx_meta: payload.tx_meta,
  };

  const createdLines: JournalLine[] = payload.lines.map((line, index) => ({
    id: `${journalId}-l${index + 1}`,
    journal_id: journalId,
    account_id: line.account_id,
    debit: line.debit,
    credit: line.credit,
    memo: (line.memo ?? desc).trim(),
  }));

  const nextDb: LedgerDatabase = {
    ...db,
    journals: [...db.journals, journal],
    journalLines: [...db.journalLines, ...createdLines],
  };

  return { db: nextDb, journal, lines: createdLines };
}

/**
 * Void a journal by setting `voided_at` AND creating a balanced reversing journal (`kind: 'pembalik'`).
 * Never deletes rows so the audit trail remains intact and net account impact becomes zero.
 */
export function voidJournal(
  db: LedgerDatabase,
  journalId: string,
  voidDate?: string,
  nowIso: string = new Date().toISOString(),
): { db: LedgerDatabase; reversalJournal: Journal } {
  const target = db.journals.find((j) => j.id === journalId);
  if (!target) {
    throw new Error('Jurnal yang akan dibatalkan tidak ditemukan.');
  }
  if (target.voided_at) {
    throw new Error('Jurnal ini sudah dibatalkan sebelumnya.');
  }
  if (target.kind === 'pembalik') {
    throw new Error('Jurnal pembalik tidak dapat dibatalkan.');
  }

  const targetLines = db.journalLines.filter((l) => l.journal_id === journalId);
  const reversalLines: DraftJournalLine[] = targetLines.map((l) => ({
    account_id: l.account_id,
    debit: l.credit,
    credit: l.debit,
    memo: `Pembalik ${target.number}: ${l.memo}`,
  }));

  const saved = saveJournalAtomic(db, {
    date: voidDate && isValidLocalDate(voidDate) ? voidDate : target.date,
    description: `Pembatalan ${target.number}: ${target.description}`,
    kind: 'pembalik',
    lines: reversalLines,
    void_of_id: target.id,
    created_at: nowIso,
  });

  const updatedJournals = saved.db.journals.map((j) =>
    j.id === target.id
      ? {
          ...j,
          voided_at: nowIso,
          reversal_journal_id: saved.journal.id,
        }
      : j,
  );

  return {
    db: {
      ...saved.db,
      journals: updatedJournals,
    },
    reversalJournal: saved.journal,
  };
}

/**
 * Edit an existing active journal safely (validates balanced lines, date, description).
 */
export function updateJournalDescriptionAndDate(
  db: LedgerDatabase,
  journalId: string,
  updates: { date: string; description: string },
): LedgerDatabase {
  const target = db.journals.find((j) => j.id === journalId);
  if (!target) {
    throw new Error('Jurnal tidak ditemukan.');
  }
  if (target.voided_at || target.kind === 'pembalik') {
    throw new Error('Jurnal yang sudah dibatalkan tidak dapat diubah.');
  }
  if (!isValidLocalDate(updates.date)) {
    throw new Error('Tanggal tidak valid.');
  }
  const cleanDesc = updates.description.trim();
  if (!cleanDesc) {
    throw new Error('Keterangan wajib diisi.');
  }

  return {
    ...db,
    journals: db.journals.map((j) =>
      j.id === journalId ? { ...j, date: updates.date, description: cleanDesc } : j,
    ),
  };
}

/**
 * Atomically update a full active journal entry (date, description, kind, tx_meta, and balanced lines)
 * while preserving the original journal ID, number, and created_at timestamp.
 */
export function updateJournalAtomic(
  db: LedgerDatabase,
  journalId: string,
  payload: SaveJournalPayload,
): { db: LedgerDatabase; journal: Journal; lines: JournalLine[] } {
  const target = db.journals.find((j) => j.id === journalId);
  if (!target) {
    throw new Error('Jurnal tidak ditemukan.');
  }
  if (target.voided_at || target.kind === 'pembalik') {
    throw new Error('Jurnal yang sudah dibatalkan tidak dapat diubah.');
  }
  if (!isValidLocalDate(payload.date)) {
    throw new Error('Tanggal transaksi tidak valid (harus format YYYY-MM-DD lokal).');
  }
  const desc = payload.description.trim();
  if (!desc) {
    throw new Error('Keterangan transaksi wajib diisi.');
  }

  const accountsMap = new Map(db.accounts.map((a) => [a.id, a]));
  validateJournalLines(payload.lines, accountsMap);

  const updatedJournal: Journal = {
    ...target,
    date: payload.date,
    description: desc,
    kind: payload.kind,
    tx_meta: payload.tx_meta,
  };

  const replacedLines: JournalLine[] = payload.lines.map((line, index) => ({
    id: `${journalId}-l${index + 1}`,
    journal_id: journalId,
    account_id: line.account_id,
    debit: line.debit,
    credit: line.credit,
    memo: (line.memo ?? desc).trim(),
  }));

  const otherLines = db.journalLines.filter((l) => l.journal_id !== journalId);

  return {
    db: {
      ...db,
      journals: db.journals.map((j) => (j.id === journalId ? updatedJournal : j)),
      journalLines: [...otherLines, ...replacedLines],
    },
    journal: updatedJournal,
    lines: replacedLines,
  };
}

/**
 * Compute every account's current balance strictly from `journal_lines`.
 * Positive value means balance on the account's `normal_balance` side.
 */
export function computeAccountBalances(
  accounts: Account[],
  journalLines: JournalLine[],
  journals?: Journal[],
  upToDate?: string,
): Map<string, { debitTotal: number; creditTotal: number; balance: number }> {
  let allowedJournalIds: Set<string> | null = null;
  if (journals && upToDate) {
    allowedJournalIds = new Set(
      journals.filter((j) => j.date <= upToDate).map((j) => j.id),
    );
  }

  const totals = new Map<string, { debitTotal: number; creditTotal: number; balance: number }>();
  for (const acc of accounts) {
    totals.set(acc.id, { debitTotal: 0, creditTotal: 0, balance: 0 });
  }

  for (const line of journalLines) {
    if (allowedJournalIds && !allowedJournalIds.has(line.journal_id)) {
      continue;
    }
    const entry = totals.get(line.account_id);
    if (!entry) continue;
    entry.debitTotal += line.debit;
    entry.creditTotal += line.credit;
  }

  for (const acc of accounts) {
    const entry = totals.get(acc.id)!;
    entry.balance =
      acc.normal_balance === 'DEBIT'
        ? entry.debitTotal - entry.creditTotal
        : entry.creditTotal - entry.debitTotal;
  }

  return totals;
}
