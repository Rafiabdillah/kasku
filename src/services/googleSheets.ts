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
import {
  buildHomeSummary,
  buildJurnalUmum,
  buildLabaRugi,
  buildNeracaSaldo,
} from '../core/reports';
export { parseSpreadsheetRowsToInputs, type ParsedSheetImportResult } from '../core/sheetsImport';

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let cachedAccessToken: string | null = null;

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
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gagal membaca spreadsheet (${res.status}).`);
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
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gagal membaca isi tab (${res.status}).`);
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
    ['BukuKu — Ringkasan Keuangan', db.settings.ownerName, `Tanggal: ${formatTanggalID(todayLocalDate())}`],
    [],
    ['Dompet', 'Kode Akun', 'Saldo (Rp)'],
    ...summary.wallets.map((w) => [w.account.name, w.account.code, w.balance]),
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
        entry.journal.number,
        entry.journal.description,
        item.account.code,
        item.account.name,
        item.line.debit,
        item.line.credit,
        entry.journal.voided_at ? 'VOID' : entry.journal.kind === 'pembalik' ? 'PEMBALIK' : 'AKTIF',
      ]);
    }
  }

  const neracaRows: Array<Array<string | number>> = [
    ['No. Akun', 'Nama Akun', 'Tipe', 'Debit (Rp)', 'Kredit (Rp)'],
    ...neraca.rows.map((r) => [
      r.account.code,
      r.account.name,
      r.account.type,
      r.debit,
      r.credit,
    ]),
    ['TOTAL', '', '', neraca.totalDebit, neraca.totalCredit],
  ];

  const labaRugiRows: Array<Array<string | number>> = [
    [`Laporan Laba Rugi — ${formatBulanTahun(month)}`, db.settings.ownerName],
    [],
    ['Kode', 'Nama Akun', 'Kategori', 'Nominal (Rp)'],
    ...labaRugi.revenues.map((r) => [r.account.code, r.account.name, 'Pendapatan', r.amount]),
    ['', 'Total Pendapatan', '', labaRugi.totalRevenue],
    ...labaRugi.expenses.map((e) => [e.account.code, e.account.name, 'Beban', e.amount]),
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
        { properties: { title: 'Ringkasan' } },
        { properties: { title: 'Jurnal Umum' } },
        { properties: { title: 'Neraca Saldo' } },
        { properties: { title: 'Laba Rugi' } },
      ],
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gagal membuat Google Spreadsheet (${createRes.status}).`);
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
  const targetTabs = ['Ringkasan', 'Jurnal Umum', 'Neraca Saldo', 'Laba Rugi'];
  const missingTabs = targetTabs.filter((t) => !existingTitles.has(t));

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
      const err = await batchRes.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Gagal menyiapkan tab laporan di spreadsheet.');
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
        ranges: ['Ringkasan!A:Z', "'Jurnal Umum'!A:Z", "'Neraca Saldo'!A:Z", "'Laba Rugi'!A:Z"],
      }),
    },
  );
  if (!clearRes.ok) {
    throw new Error('Gagal membersihkan data lama sebelum sinkronisasi.');
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
          { range: 'Ringkasan!A1', values: ringkasanRows },
          { range: "'Jurnal Umum'!A1", values: jurnalRows },
          { range: "'Neraca Saldo'!A1", values: neracaRows },
          { range: "'Laba Rugi'!A1", values: labaRugiRows },
        ],
      }),
    },
  );

  if (!updateRes.ok) {
    const err = await updateRes.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Gagal menulis laporan ke Google Sheets.');
  }
}
