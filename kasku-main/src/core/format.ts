const NAMA_BULAN_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

/**
 * Format integer rupiah with dot thousand separators (e.g., 1234567 -> "1.234.567").
 */
export function formatRibuan(amount: number): string {
  const isNegative = amount < 0;
  const abs = Math.abs(Math.trunc(amount));
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Format integer rupiah for input fields / general display.
 */
export function formatRupiahInput(value: number | string): string {
  if (value === undefined || value === null) return '0';
  const num = typeof value === 'string' ? parseInt(value.replace(/[^0-9]/g, ''), 10) : value;
  if (isNaN(num)) return '0';
  return formatRibuan(num);
}

/**
 * Parse Rupiah input string back to number.
 */
export function parseRupiahInput(str: string): number {
  if (!str) return 0;
  const clean = str.toString().replace(/[^0-9]/g, '');
  return clean ? parseInt(clean, 10) : 0;
}

/**
 * Format integer rupiah for titles, summaries, and totals: "Rp1.234.567" or "-Rp1.234.567".
 */
export function formatRupiahTitle(amount: number): string {
  const rounded = Math.trunc(amount);
  if (rounded < 0) {
    return `-Rp${formatRibuan(Math.abs(rounded))}`;
  }
  return `Rp${formatRibuan(rounded)}`;
}

/**
 * Format integer rupiah for accounting table columns:
 * - Zero / empty -> "-"
 * - Positive -> "1.234.567"
 * - Negative -> "(1.234.567)"
 */
export function formatKolomAngka(amount: number): string {
  const rounded = Math.trunc(amount);
  if (rounded === 0) return '-';
  if (rounded < 0) return `(${formatRibuan(Math.abs(rounded))})`;
  return formatRibuan(rounded);
}

/**
 * Return local calendar date in YYYY-MM-DD (never UTC).
 */
export function todayLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function currentLocalMonth(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Convert YYYY-MM-DD to dd/mm/yyyy.
 */
export function formatTanggalID(isoLocalDate: string): string {
  const parts = isoLocalDate.split('-');
  if (parts.length !== 3) return isoLocalDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Convert YYYY-MM-DD to "17 November 2026".
 */
export function formatTanggalPanjangID(isoLocalDate: string): string {
  const [yStr, mStr, dStr] = isoLocalDate.split('-');
  const mIdx = Number(mStr) - 1;
  const day = Number(dStr);
  const monthName = NAMA_BULAN_ID[mIdx] ?? mStr;
  return `${day} ${monthName} ${yStr}`;
}

/**
 * Last day of YYYY-MM month, e.g., "2026-11" -> "2026-11-30".
 */
export function endOfMonthDate(yyyyMm: string): string {
  const [yStr, mStr] = yyyyMm.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const lastDay = new Date(year, month, 0).getDate();
  return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Format "Untuk Periode yang Berakhir 30 November 2026".
 */
export function formatPeriodeBerakhir(yyyyMm: string): string {
  return `Untuk Periode yang Berakhir ${formatTanggalPanjangID(endOfMonthDate(yyyyMm))}`;
}

/**
 * Format "Per 30 November 2026".
 */
export function formatPerTanggal(isoLocalDate: string): string {
  return `Per ${formatTanggalPanjangID(isoLocalDate)}`;
}

/**
 * Format "November 2026".
 */
export function formatBulanTahun(yyyyMm: string): string {
  const [yStr, mStr] = yyyyMm.split('-');
  const mIdx = Number(mStr) - 1;
  return `${NAMA_BULAN_ID[mIdx] ?? mStr} ${yStr}`;
}

export function isValidLocalDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}