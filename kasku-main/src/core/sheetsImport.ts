import type { Account, TransactionInput } from './types';
import { isValidLocalDate, todayLocalDate } from './format';

export interface ParsedSheetImportResult {
  inputs: TransactionInput[];
  skippedRows: number;
  warnings: string[];
}

function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/**
 * Parse DD/MM/YYYY or YYYY-MM-DD into YYYY-MM-DD local date.
 */
function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (isValidLocalDate(s)) return s;

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    const yyyy = dmy[3];
    const iso = `${yyyy}-${mm}-${dd}`;
    return isValidLocalDate(iso) ? iso : null;
  }
  return null;
}

/**
 * Parse Rupiah string like "Rp1.250.000", "1,250,000", or "1250000" into integer rupiah.
 */
function parseIntegerRupiah(raw: string | number | undefined): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw) : 0;
  }
  if (!raw) return 0;
  const cleaned = String(raw)
    .replace(/rp/gi, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(/[^0-9-]/g, '');
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : 0;
}

function matchAccountByNameOrCode(
  accounts: Account[],
  query: string,
  fallbackId: string,
): Account {
  const q = query.trim().toLowerCase();
  if (q) {
    const exactCode = accounts.find((a) => a.code.toLowerCase() === q);
    if (exactCode) return exactCode;
    const exactName = accounts.find((a) => a.name.toLowerCase() === q);
    if (exactName) return exactName;
    const partial = accounts.find(
      (a) => a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()),
    );
    if (partial) return partial;
  }
  return accounts.find((a) => a.id === fallbackId) ?? accounts[0];
}

/**
 * Parse rows fetched from Google Sheets into balanced BukuKu TransactionInputs.
 * Supports:
 * 1) Tabular transaction sheet with header columns such as:
 *    [Tanggal, Jenis (Masuk/Keluar/Pindah), Dompet, Kategori, Nominal, Keterangan]
 * 2) Simple 4-column sheet: [Tanggal, Keterangan, Kategori/Jenis, Nominal]
 */
export function parseSpreadsheetRowsToInputs(
  rows: string[][],
  accounts: Account[],
): ParsedSheetImportResult {
  if (!rows || rows.length < 2) {
    return {
      inputs: [],
      skippedRows: 0,
      warnings: ['Sheet kosong atau hanya berisi 1 baris header.'],
    };
  }

  // Find header row in first 5 rows
  let headerIdx = -1;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const norm = rows[i].map(normalizeHeader);
    if (
      norm.some((h) => h.includes('tanggal') || h === 'date') &&
      norm.some((h) => h.includes('nominal') || h.includes('jumlah') || h.includes('amount'))
    ) {
      headerIdx = i;
      headers = norm;
      break;
    }
  }

  if (headerIdx === -1) {
    return {
      inputs: [],
      skippedRows: rows.length,
      warnings: [
        'Header kolom tidak dikenali. Pastikan baris header memiliki minimal kolom "Tanggal" dan "Nominal" (opsional: Jenis, Dompet, Kategori, Keterangan).',
      ],
    };
  }

  const colIndex = (candidates: string[]): number =>
    headers.findIndex((h) => candidates.some((c) => h.includes(c)));

  const idxDate = colIndex(['tanggal', 'date']);
  const idxType = colIndex(['jenis', 'tipe', 'type', 'arus']);
  const idxWallet = colIndex(['dompet', 'wallet', 'akun_kas', 'sumber']);
  const idxCategory = colIndex(['kategori', 'category', 'akun']);
  const idxAmount = colIndex(['nominal', 'jumlah', 'amount', 'nilai']);
  const idxDesc = colIndex(['keterangan', 'catatan', 'deskripsi', 'note']);

  const inputs: TransactionInput[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !String(c ?? '').trim())) continue;

    const rawDate = row[idxDate] ?? '';
    const parsedDate = parseFlexibleDate(String(rawDate)) ?? todayLocalDate();
    const amount = parseIntegerRupiah(row[idxAmount]);
    if (amount <= 0) {
      skippedRows++;
      warnings.push(`Baris ${r + 1}: nominal tidak valid atau <= 0 dilewati.`);
      continue;
    }

    const rawType = idxType >= 0 ? String(row[idxType] ?? '').trim().toLowerCase() : '';
    const rawWallet = idxWallet >= 0 ? String(row[idxWallet] ?? '') : '';
    const rawCategory = idxCategory >= 0 ? String(row[idxCategory] ?? '') : '';
    const rawDesc = idxDesc >= 0 ? String(row[idxDesc] ?? '').trim() : '';

    const isMasuk =
      rawType.includes('masuk') ||
      rawType.includes('income') ||
      rawType.includes('terima') ||
      rawType.includes('pendapatan');

    const walletCandidates = accounts.filter(
      (a) => a.is_active && (a.is_wallet || a.type === 'ASSET'),
    );
    const wallet = matchAccountByNameOrCode(
      walletCandidates.length > 0 ? walletCandidates : accounts,
      rawWallet,
      'acc-1101',
    );

    if (isMasuk) {
      const cat = matchAccountByNameOrCode(
        accounts.filter((a) => a.type === 'REVENUE' || a.code === '3101'),
        rawCategory,
        'acc-4101',
      );
      inputs.push({
        actionType: 'masuk',
        amount,
        walletId: wallet.id,
        categoryAccountId: cat.id,
        date: parsedDate,
        description: rawDesc || `${cat.name} (Impor Sheets)`,
      });
    } else {
      const cat = matchAccountByNameOrCode(
        accounts.filter((a) => a.type === 'EXPENSE' || a.code === '1501' || a.code === '3102'),
        rawCategory,
        'acc-5109',
      );
      inputs.push({
        actionType: 'keluar',
        amount,
        walletId: wallet.id,
        categoryAccountId: cat.id,
        date: parsedDate,
        description: rawDesc || `${cat.name} (Impor Sheets)`,
      });
    }
  }

  return { inputs, skippedRows, warnings };
}
