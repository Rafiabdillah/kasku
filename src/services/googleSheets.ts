import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { LedgerDatabase } from '../core/types';
import { formatBulanTahun, formatTanggalID, todayLocalDate } from '../core/format';
import { sanitizeSpreadsheetText } from '../core/safeText';
import { REPORT_TABS, REPORT_TAB_TITLES, parseSpreadsheetId, tabRange } from '../core/sheetsUtils';
import {
  buildHomeSummary,
  buildJurnalUmum,
  buildLabaRugi,
  buildNeracaSaldo,
} from '../core/reports';
export { parseSpreadsheetRowsToInputs, type ParsedSheetImportResult } from '../core/sheetsImport';
export { REPORT_TABS, parseSpreadsheetId } from '../core/sheetsUtils';

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

const AUTH_EXPIRED_MESSAGE =
  'Sesi Google berakhir. Silakan masuk kembali dengan akun Google Anda.';

function handleUnauthorized(status: number): void {
  if (status === 401) {
    cachedAccessToken = null;
  }
}

function authErrorForStatus(status: number, fallback: string): string {
  return status === 401 ? AUTH_EXPIRED_MESSAGE : fallback;
}

export function initGoogleSheetsAuth(
  onAuthenticated: (user: User, token: string) => void,
  onNeedsAuth: (user: User | null) => void,
) {
  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      onAuthenticated(user, cachedAccessToken);
    } else if (!isSigningIn) {
      cachedAccessToken = null;
      onNeedsAuth(user);
    }
  });
}

export async function signInWithGoogleForSheets(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Token akses Google Sheets tidak diperoleh.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getCachedSheetsToken(): string | null {
  return cachedAccessToken;
}

export function clearCachedSheetsToken(): void {
  cachedAccessToken = null;
}

export async function signOutGoogleSheets(): Promise<void> {
  cachedAccessToken = null;
  await auth.signOut();
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: Array<{ sheetId: number; title: string }>;
}

export async function fetchSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string,
): Promise<SpreadsheetMeta> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    handleUnauthorized(res.status);
    const err = await res.json().catch(() => ({}));
    throw new Error(
      authErrorForStatus(res.status, err?.error?.message || `Gagal membaca spreadsheet (${res.status}).`),
    );
  }
  const data = await res.json();
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'Spreadsheet',
    spreadsheetUrl:
      data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
    sheets: (data.sheets || []).map((s: any) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? 'Tab',
    })),
  };
}

export async function readSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
): Promise<string[][]> {
  const safeRange = `'${sheetTitle.replace(/'/g, "''")}'!A1:Z1000`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(safeRange)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) {
    handleUnauthorized(res.status);
    const err = await res.json().catch(() => ({}));
    throw new Error(
      authErrorForStatus(res.status, err?.error?.message || `Gagal membaca isi tab (${res.status}).`),
    );
  }
  const data = await res.json();
  return (data.values as string[][]) || [];
}

function buildWorkbookPayloads(db: LedgerDatabase, month: string) {
  const summary = buildHomeSummary(db, month);
  const jurnal = buildJurnalUmum(db, { month: 'all', includeReversals: true });
  const neraca = buildNeracaSaldo(db);
  const labaRugi = buildLabaRugi(db, month);

  const ringkasanRows: Array<Array<string | number>> = [
    [
      'BukuKu — Ringkasan Keuangan',
      sanitizeSpreadsheetText(db.settings.ownerName),
      `Tanggal: ${formatTanggalID(todayLocalDate())}`,
    ],
    [],
    ['Dompet', 'Kode Akun', 'Saldo (Rp)'],
    ...summary.wallets.map((w) => [
      sanitizeSpreadsheetText(w.account.name),
      sanitizeSpreadsheetText(w.account.code),
      w.balance,
    ]),
    ['TOTAL SALDO DOMPET', '', summary.totalWalletBalance],
    [],
    [`Ringkasan ${formatBulanTahun(month)}`, 'Nominal (Rp)'],
    ['Pemasukan Bulan Ini', summary.monthlyIncome],
    ['Pengeluaran Bulan Ini', summary.monthlyExpense],
    ['Selisih / Laba Bersih', summary.monthlyNet],
    ['Total Piutang', summary.totalReceivable],
    ['Total Utang', summary.totalDebt],
  ];

  const jurnalRows: Array<Array<string | number>> = [
    ['Tanggal', 'No. Jurnal', 'Keterangan', 'Kode Akun', 'Nama Akun', 'Debit (Rp)', 'Kredit (Rp)', 'Status'],
  ];
  for (const entry of jurnal) {
    for (const item of entry.lines) {
      jurnalRows.push([
        formatTanggalID(entry.journal.date),
        sanitizeSpreadsheetText(entry.journal.number),
        sanitizeSpreadsheetText(entry.journal.description),
        sanitizeSpreadsheetText(item.account.code),
        sanitizeSpreadsheetText(item.account.name),
        item.line.debit,
        item.line.credit,
        entry.journal.voided_at ? 'VOID' : entry.journal.kind === 'pembalik' ? 'PEMBALIK' : 'AKTIF',
      ]);
    }
  }

  const neracaRows: Array<Array<string | number>> = [
    ['No. Akun', 'Nama Akun', 'Tipe', 'Debit (Rp)', 'Kredit (Rp)'],
    ...neraca.rows.map((r) => [
      sanitizeSpreadsheetText(r.account.code),
      sanitizeSpreadsheetText(r.account.name),
      r.account.type,
      r.debit,
      r.credit,
    ]),
    ['TOTAL', '', '', neraca.totalDebit, neraca.totalCredit],
  ];

  const labaRugiRows: Array<Array<string | number>> = [
    [`Laporan Laba Rugi — ${formatBulanTahun(month)}`, sanitizeSpreadsheetText(db.settings.ownerName)],
    [],
    ['Kode', 'Nama Akun', 'Kategori', 'Nominal (Rp)'],
    ...labaRugi.revenues.map((r) => [
      sanitizeSpreadsheetText(r.account.code),
      sanitizeSpreadsheetText(r.account.name),
      'Pendapatan',
      r.amount,
    ]),
    ['', 'Total Pendapatan', '', labaRugi.totalRevenue],
    ...labaRugi.expenses.map((e) => [
      sanitizeSpreadsheetText(e.account.code),
      sanitizeSpreadsheetText(e.account.name),
      'Beban',
      e.amount,
    ]),
    ['', 'Total Beban', '', labaRugi.totalExpense],
    ['', labaRugi.netProfit >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH', '', labaRugi.netProfit],
  ];

  return { ringkasanRows, jurnalRows, neracaRows, labaRugiRows };
}

export async function createBukuKuSpreadsheet(
  accessToken: string,
  db: LedgerDatabase,
  month: string,
): Promise<SpreadsheetMeta> {
  const title = `BukuKu — ${db.settings.ownerName} (${formatBulanTahun(month)})`;
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: REPORT_TABS.ringkasan } },
        { properties: { title: REPORT_TABS.jurnal } },
        { properties: { title: REPORT_TABS.neraca } },
        { properties: { title: REPORT_TABS.labaRugi } },
      ],
    }),
  });

  if (!createRes.ok) {
    handleUnauthorized(createRes.status);
    const err = await createRes.json().catch(() => ({}));
    throw new Error(
      authErrorForStatus(
        createRes.status,
        err?.error?.message || `Gagal membuat Google Spreadsheet (${createRes.status}).`,
      ),
    );
  }

  const created = await createRes.json();
  const spreadsheetId = created.spreadsheetId as string;

  await writeWorkbookData(accessToken, spreadsheetId, db, month);

  return {
    spreadsheetId,
    title,
    spreadsheetUrl: created.spreadsheetUrl,
    sheets: (created.sheets || []).map((s: any) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
    })),
  };
}

export async function syncToExistingSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  db: LedgerDatabase,
  month: string,
): Promise<SpreadsheetMeta> {
  const meta = await fetchSpreadsheetMetadata(accessToken, spreadsheetId);
  const existingTitles = new Set(meta.sheets.map((s) => s.title));
  const missingTabs = REPORT_TAB_TITLES.filter((t) => !existingTitles.has(t));

  if (missingTabs.length > 0) {
    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingTabs.map((t) => ({
            addSheet: { properties: { title: t } },
          })),
        }),
      },
    );
    if (!batchRes.ok) {
      handleUnauthorized(batchRes.status);
      const err = await batchRes.json().catch(() => ({}));
      throw new Error(
        authErrorForStatus(
          batchRes.status,
          err?.error?.message || 'Gagal menyiapkan tab laporan di spreadsheet.',
        ),
      );
    }
  }

  await writeWorkbookData(accessToken, spreadsheetId, db, month);
  return fetchSpreadsheetMetadata(accessToken, spreadsheetId);
}

async function writeWorkbookData(
  accessToken: string,
  spreadsheetId: string,
  db: LedgerDatabase,
  month: string,
) {
  const { ringkasanRows, jurnalRows, neracaRows, labaRugiRows } = buildWorkbookPayloads(db, month);

  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ranges: REPORT_TAB_TITLES.map((t) => tabRange(t, 'A:Z')),
      }),
    },
  );
  if (!clearRes.ok) {
    handleUnauthorized(clearRes.status);
    const err = await clearRes.json().catch(() => ({}));
    throw new Error(
      authErrorForStatus(
        clearRes.status,
        err?.error?.message || 'Gagal membersihkan data lama sebelum sinkronisasi.',
      ),
    );
  }

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: tabRange(REPORT_TABS.ringkasan, 'A1'), values: ringkasanRows },
          { range: tabRange(REPORT_TABS.jurnal, 'A1'), values: jurnalRows },
          { range: tabRange(REPORT_TABS.neraca, 'A1'), values: neracaRows },
          { range: tabRange(REPORT_TABS.labaRugi, 'A1'), values: labaRugiRows },
        ],
      }),
    },
  );

  if (!updateRes.ok) {
    handleUnauthorized(updateRes.status);
    const err = await updateRes.json().catch(() => ({}));
    throw new Error(
      authErrorForStatus(
        updateRes.status,
        err?.error?.message || 'Gagal menulis laporan ke Google Sheets.',
      ),
    );
  }
}
