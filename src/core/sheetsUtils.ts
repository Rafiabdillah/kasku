export const REPORT_TABS = {
  ringkasan: 'BukuKu · Ringkasan',
  jurnal: 'BukuKu · Jurnal Umum',
  neraca: 'BukuKu · Neraca Saldo',
  labaRugi: 'BukuKu · Laba Rugi',
} as const;

export const REPORT_TAB_TITLES: string[] = Object.values(REPORT_TABS);

const SHEET_URL_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const RAW_ID_PATTERN = /^([a-zA-Z0-9_-]{20,})$/;

/**
 * Accept a raw Spreadsheet ID, a full Google Sheets URL, or a URL with extra query/hash.
 */
export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const urlMatch = SHEET_URL_PATTERN.exec(trimmed);
  if (urlMatch) return urlMatch[1];
  const idMatch = RAW_ID_PATTERN.exec(trimmed);
  return idMatch ? idMatch[1] : trimmed;
}

/**
 * Build an A1 range for a tab title, escaping single quotes in the title.
 */
export function tabRange(tab: string, range: string): string {
  return `'${tab.replace(/'/g, "''")}'!${range}`;
}
