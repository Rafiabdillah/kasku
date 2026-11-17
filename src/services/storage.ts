import type { LedgerDatabase } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/defaultAccounts';
import { createSeedDatabase } from '../core/mapper';
import {
  buildBukuBesar,
  buildBukuKas,
  buildJurnalUmum,
  buildLabaRugi,
  buildNeraca,
  buildNeracaSaldo,
} from '../core/reports';
import { formatKolomAngka, formatTanggalID } from '../core/format';

const DB_NAME = 'bukuku_ledger_idb';
const STORE_NAME = 'snapshots';
const SNAPSHOT_KEY = 'primary_ledger_v1';
const LS_FALLBACK_KEY = 'bukuku_ledger_snapshot_v1';

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function normalizeDatabase(raw: Partial<LedgerDatabase>): LedgerDatabase {
  const rawSettings = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Partial<
    LedgerDatabase['settings']
  >;
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    journals: Array.isArray(raw.journals) ? raw.journals : [],
    journalLines: Array.isArray(raw.journalLines) ? raw.journalLines : [],
    settings: {
      ownerName:
        typeof rawSettings.ownerName === 'string' && rawSettings.ownerName.trim()
          ? rawSettings.ownerName.trim()
          : DEFAULT_SETTINGS.ownerName,
      businessName:
        typeof rawSettings.businessName === 'string' && rawSettings.businessName.trim()
          ? rawSettings.businessName.trim()
          : DEFAULT_SETTINGS.businessName,
      pinEnabled: Boolean(rawSettings.pinEnabled && rawSettings.pinHash),
      pinHash: typeof rawSettings.pinHash === 'string' ? rawSettings.pinHash : null,
      spreadsheetId: typeof rawSettings.spreadsheetId === 'string' ? rawSettings.spreadsheetId : '',
    },
    budgets: raw.budgets && typeof raw.budgets === 'object' ? raw.budgets : {},
    recurringRules: Array.isArray(raw.recurringRules) ? raw.recurringRules : [],
  };
}

export async function loadDatabase(): Promise<LedgerDatabase> {
  const idb = await openIdb();
  if (idb) {
    try {
      const data = await new Promise<LedgerDatabase | undefined>((resolve) => {
        const tx = idb.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(SNAPSHOT_KEY);
        getReq.onsuccess = () => resolve(getReq.result as LedgerDatabase | undefined);
        getReq.onerror = () => resolve(undefined);
      });
      idb.close();
      if (data && Array.isArray(data.accounts) && Array.isArray(data.journals)) {
        return normalizeDatabase(data);
      }
    } catch {
      // Fallback to localStorage below
    }
  }

  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LedgerDatabase;
      if (parsed && Array.isArray(parsed.accounts) && Array.isArray(parsed.journals)) {
        return normalizeDatabase(parsed);
      }
    }
  } catch {
    // Ignore storage error
  }

  const seeded = createSeedDatabase();
  await saveDatabase(seeded);
  return seeded;
}

export async function saveDatabase(db: LedgerDatabase): Promise<void> {
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(db));
  } catch {
    // Ignore quota errors on fallback
  }

  const idb = await openIdb();
  if (idb) {
    try {
      await new Promise<void>((resolve) => {
        const tx = idb.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(db, SNAPSHOT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
      idb.close();
    } catch {
      // Fallback already saved
    }
  }
}

export async function hashPin(pin: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(`bukuku_salt_2026:${pin}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 2166136261;
  for (let i = 0; i < pin.length; i++) {
    h ^= pin.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function escapeCsvCell(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportJurnalUmumCSV(db: LedgerDatabase, month: string): string {
  const entries = buildJurnalUmum(db, { month, includeReversals: true });
  const rows: string[] = [
    ['Tanggal', 'No. Jurnal', 'Keterangan', 'Kode Akun', 'Nama Akun', 'Debit', 'Kredit', 'Status'].join(','),
  ];

  for (const entry of entries) {
    const status = entry.journal.voided_at
      ? 'VOID'
      : entry.journal.kind === 'pembalik'
        ? 'PEMBALIK'
        : 'AKTIF';
    for (const item of entry.lines) {
      rows.push(
        [
          escapeCsvCell(formatTanggalID(entry.journal.date)),
          escapeCsvCell(entry.journal.number),
          escapeCsvCell(entry.journal.description),
          escapeCsvCell(item.account.code),
          escapeCsvCell(item.account.name),
          item.line.debit,
          item.line.credit,
          status,
        ].join(','),
      );
    }
  }
  return rows.join('\n');
}

export function exportNeracaSaldoCSV(db: LedgerDatabase, upToDate?: string): string {
  const neraca = buildNeracaSaldo(db, upToDate);
  const rows: string[] = [
    ['No. Akun', 'Nama Akun', 'Tipe', 'Debit', 'Kredit'].join(','),
  ];
  for (const r of neraca.rows) {
    rows.push(
      [
        escapeCsvCell(r.account.code),
        escapeCsvCell(r.account.name),
        escapeCsvCell(r.account.type),
        r.debit,
        r.credit,
      ].join(','),
    );
  }
  rows.push(['TOTAL', '', '', neraca.totalDebit, neraca.totalCredit].join(','));
  return rows.join('\n');
}

export function exportBukuBesarCSV(db: LedgerDatabase, accountId: string, month: string): string {
  const report = buildBukuBesar(db, accountId, { month });
  if (!report) return '';
  const rows: string[] = [
    ['Tanggal', 'Ref', 'Keterangan', 'Debit', 'Kredit', 'Saldo'].join(','),
  ];
  if (report.openingBalance !== 0) {
    rows.push(['-', '-', 'Saldo Awal Periode', '-', '-', escapeCsvCell(formatKolomAngka(report.openingBalance))].join(','));
  }
  for (const r of report.rows) {
    rows.push(
      [
        escapeCsvCell(formatTanggalID(r.date)),
        escapeCsvCell(r.ref),
        escapeCsvCell(r.description),
        escapeCsvCell(formatKolomAngka(r.debit)),
        escapeCsvCell(formatKolomAngka(r.credit)),
        escapeCsvCell(formatKolomAngka(r.runningBalance)),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function exportBukuKasCSV(
  db: LedgerDatabase,
  month: string,
  walletAccountId?: string,
): string {
  const report = buildBukuKas(db, { month, walletAccountId });
  const rows: string[] = [
    ['Tanggal', 'Keterangan', 'Dompet', 'Ref', 'Masuk (D)', 'Keluar (K)', 'Saldo'].join(','),
  ];
  if (report.openingBalance !== 0) {
    rows.push(['-', 'Saldo Awal Periode', '-', '-', '-', '-', escapeCsvCell(formatKolomAngka(report.openingBalance))].join(','));
  }
  for (const r of report.rows) {
    rows.push(
      [
        escapeCsvCell(formatTanggalID(r.date)),
        escapeCsvCell(r.description),
        escapeCsvCell(`${r.walletCode} ${r.walletName}`),
        escapeCsvCell(r.ref),
        escapeCsvCell(formatKolomAngka(r.debit)),
        escapeCsvCell(formatKolomAngka(r.credit)),
        escapeCsvCell(formatKolomAngka(r.runningBalance)),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function exportNeracaCSV(db: LedgerDatabase, upToDate?: string): string {
  const report = buildNeraca(db, upToDate);
  const rows: string[] = [
    ['Kelompok', 'Kode', 'Nama Akun', 'Saldo'].join(','),
  ];
  for (const a of report.assets) {
    rows.push(['ASET', escapeCsvCell(a.account.code), escapeCsvCell(a.account.name), a.amount].join(','));
  }
  rows.push(['ASET', '', 'TOTAL ASET', report.totalAssets].join(','));
  for (const l of report.liabilities) {
    rows.push(['KEWAJIBAN', escapeCsvCell(l.account.code), escapeCsvCell(l.account.name), l.amount].join(','));
  }
  rows.push(['KEWAJIBAN', '', 'Total Kewajiban', report.totalLiabilities].join(','));
  for (const e of report.equities) {
    rows.push(['EKUITAS', escapeCsvCell(e.account.code), escapeCsvCell(e.account.name), e.amount].join(','));
  }
  rows.push(['EKUITAS', '', 'Laba / (Rugi) Periode Berjalan', report.currentNetProfit].join(','));
  rows.push(['EKUITAS', '', 'Total Ekuitas', report.totalEquityWithProfit].join(','));
  rows.push(['TOTAL', '', 'TOTAL KEWAJIBAN + EKUITAS', report.totalLiabilitiesAndEquity].join(','));
  return rows.join('\n');
}

export function exportLabaRugiCSV(db: LedgerDatabase, month: string): string {
  const report = buildLabaRugi(db, month);
  const rows: string[] = [
    ['Kelompok', 'Kode', 'Nama Akun', 'Jumlah'].join(','),
  ];
  for (const r of report.revenues) {
    rows.push(['PENDAPATAN', escapeCsvCell(r.account.code), escapeCsvCell(r.account.name), r.amount].join(','));
  }
  rows.push(['PENDAPATAN', '', 'Total Pendapatan', report.totalRevenue].join(','));
  for (const e of report.expenses) {
    rows.push(['BEBAN', escapeCsvCell(e.account.code), escapeCsvCell(e.account.name), e.amount].join(','));
  }
  rows.push(['BEBAN', '', 'Total Beban', report.totalExpense].join(','));
  rows.push(['HASIL', '', report.netProfit >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH', report.netProfit].join(','));
  return rows.join('\n');
}
