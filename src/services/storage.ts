import type { AppSettings, LedgerDatabase } from '../core/types';
import { DEFAULT_SETTINGS } from '../core/defaultAccounts';
import { createSeedDatabase } from '../core/mapper';
import { sanitizeSpreadsheetText } from '../core/safeText';
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
const SNAPSHOT_KEY = 'primary_ledger_v2';
const LS_KEY = 'bukuku_ledger_snapshot_v2';
const LS_LEGACY_KEY = 'bukuku_ledger_snapshot_v1';
const PIN_GUARD_KEY = 'bukuku_pin_guard_v1';
const CHANNEL_NAME = 'bukuku_ledger_v1';
const CSV_BOM = '\uFEFF';

interface StoredSnapshot {
  savedAt: string;
  db: LedgerDatabase;
}

export interface LoadDatabaseResult {
  db: LedgerDatabase;
  seeded: boolean;
  source: 'indexedDB' | 'localStorage' | 'seed';
  warning: string | null;
}

export interface SaveDatabaseResult {
  ok: boolean;
  error: string | null;
}

function hasCoreData(value: Partial<LedgerDatabase>): boolean {
  return (
    Array.isArray(value.accounts) &&
    Array.isArray(value.journals) &&
    Array.isArray(value.journalLines)
  );
}

function parseSnapshot(raw: unknown): StoredSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.db && typeof record.db === 'object' && hasCoreData(record.db as Partial<LedgerDatabase>)) {
    return {
      savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
      db: record.db as LedgerDatabase,
    };
  }
  if (hasCoreData(record as Partial<LedgerDatabase>)) {
    return { savedAt: '', db: record as unknown as LedgerDatabase };
  }
  return null;
}

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

async function readIndexedDbSnapshot(): Promise<StoredSnapshot | null> {
  const idb = await openIdb();
  if (!idb) return null;
  try {
    const raw = await new Promise<unknown>((resolve) => {
      const tx = idb.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(SNAPSHOT_KEY);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => resolve(undefined);
    });
    return parseSnapshot(raw);
  } catch {
    return null;
  } finally {
    idb.close();
  }
}

function readLocalSnapshot(): StoredSnapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const snapshot = parseSnapshot(parsed);
      if (snapshot) return snapshot;
    }
    const legacy = localStorage.getItem(LS_LEGACY_KEY);
    if (legacy) {
      return parseSnapshot(JSON.parse(legacy) as unknown);
    }
  } catch {
    // Corrupt or unavailable storage: fall through to the other source.
  }
  return null;
}

function pickNewest(
  idbSnapshot: StoredSnapshot | null,
  localSnapshot: StoredSnapshot | null,
): { snapshot: StoredSnapshot; source: 'indexedDB' | 'localStorage' } | null {
  if (!idbSnapshot && !localSnapshot) return null;
  if (!idbSnapshot) return { snapshot: localSnapshot!, source: 'localStorage' };
  if (!localSnapshot) return { snapshot: idbSnapshot, source: 'indexedDB' };

  const idbTime = idbSnapshot.savedAt || '';
  const localTime = localSnapshot.savedAt || '';
  if (localTime && (!idbTime || localTime > idbTime)) {
    return { snapshot: localSnapshot, source: 'localStorage' };
  }
  return { snapshot: idbSnapshot, source: 'indexedDB' };
}

export function normalizeDatabase(raw: Partial<LedgerDatabase>): LedgerDatabase {
  const rawSettings = (raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) as Partial<AppSettings>;
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
      pinSalt: typeof rawSettings.pinSalt === 'string' ? rawSettings.pinSalt : null,
      spreadsheetId: typeof rawSettings.spreadsheetId === 'string' ? rawSettings.spreadsheetId : '',
    },
    budgets: raw.budgets && typeof raw.budgets === 'object' ? raw.budgets : {},
    recurringRules: Array.isArray(raw.recurringRules) ? raw.recurringRules : [],
  };
}

export async function loadDatabase(): Promise<LoadDatabaseResult> {
  const [idbSnapshot, localSnapshot] = await Promise.all([
    readIndexedDbSnapshot(),
    Promise.resolve(readLocalSnapshot()),
  ]);

  const chosen = pickNewest(idbSnapshot, localSnapshot);
  if (chosen) {
    return {
      db: normalizeDatabase(chosen.snapshot.db),
      seeded: false,
      source: chosen.source,
      warning: null,
    };
  }

  const seeded = createSeedDatabase();
  // The first-run screen decides between empty and demo data; nothing is
  // persisted until the user confirms, so a reload never skips onboarding.
  return {
    db: seeded,
    seeded: true,
    source: 'seed',
    warning: null,
  };
}

export async function saveDatabase(db: LedgerDatabase): Promise<SaveDatabaseResult> {
  const snapshot: StoredSnapshot = { savedAt: new Date().toISOString(), db };
  const errors: string[] = [];
  let localSaved = false;
  let idbSaved = false;

  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
    localStorage.removeItem(LS_LEGACY_KEY);
    localSaved = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'localStorage tidak tersedia');
  }

  const idb = await openIdb();
  if (idb) {
    try {
      await new Promise<void>((resolve) => {
        const tx = idb.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
      idbSaved = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'IndexedDB gagal menulis');
    } finally {
      idb.close();
    }
  } else {
    errors.push('IndexedDB tidak tersedia');
  }

  if (localSaved || idbSaved) {
    notifyOtherTabs();
    return { ok: true, error: null };
  }

  return {
    ok: false,
    error:
      'Data gagal disimpan di perangkat ini. Unduh backup JSON sekarang agar catatan tidak hilang.' +
      (errors.length ? ` (${errors[0]})` : ''),
  };
}

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function notifyOtherTabs() {
  getChannel()?.postMessage({ type: 'db-updated', at: Date.now() });
}

export function subscribeToDatabaseChanges(listener: (db: LedgerDatabase) => void): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reload = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void loadDatabase().then((result) => {
        if (!disposed) listener(result.db);
      });
    }, 50);
  };

  const ch = getChannel();
  ch?.addEventListener('message', reload);

  const onStorage = (event: StorageEvent) => {
    if (event.key === LS_KEY || event.key === LS_LEGACY_KEY) reload();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    ch?.removeEventListener('message', reload);
    window.removeEventListener('storage', onStorage);
  };
}

const PBKDF2_ITERATIONS = 150_000;
const LEGACY_SALT = 'bukuku_salt_2026';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toHex(bytes);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function fallbackPinHash(pin: string, salt: string): Promise<string> {
  let h = 2166136261;
  const data = `${salt}:${pin}`;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

async function pbkdf2Hash(pin: string, salt: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fallbackPinHash(pin, salt);
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromHex(salt).buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
  return toHex(new Uint8Array(bits));
}

async function legacyPinHash(pin: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    let h = 2166136261;
    const data = `${LEGACY_SALT}:${pin}`;
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }
  const data = new TextEncoder().encode(`${LEGACY_SALT}:${pin}`);
  const digest = await subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function createPinHash(pin: string): Promise<{ hash: string; salt: string }> {
  const salt = randomSalt();
  const hash = await pbkdf2Hash(pin, salt);
  return { hash, salt };
}

export async function verifyPin(
  pin: string,
  expectedHash: string,
  salt?: string | null,
): Promise<boolean> {
  if (!expectedHash) return false;
  const candidate = salt ? await pbkdf2Hash(pin, salt) : await legacyPinHash(pin);
  return constantTimeEqual(candidate, expectedHash);
}

export interface PinGuardResult {
  failures: number;
  remainingMs: number;
}

function readPinGuard(): { failures: number; until: number } {
  try {
    const raw = localStorage.getItem(PIN_GUARD_KEY);
    if (!raw) return { failures: 0, until: 0 };
    const parsed = JSON.parse(raw) as { failures?: unknown; until?: unknown };
    return {
      failures: typeof parsed.failures === 'number' && parsed.failures > 0 ? parsed.failures : 0,
      until: typeof parsed.until === 'number' && parsed.until > 0 ? parsed.until : 0,
    };
  } catch {
    return { failures: 0, until: 0 };
  }
}

function writePinGuard(value: { failures: number; until: number }) {
  try {
    localStorage.setItem(PIN_GUARD_KEY, JSON.stringify(value));
  } catch {
    // Throttling is best-effort if storage is unavailable.
  }
}

export function pinLockoutRemainingMs(now: number = Date.now()): number {
  const guard = readPinGuard();
  return Math.max(0, guard.until - now);
}

export function registerPinFailure(now: number = Date.now()): PinGuardResult {
  const guard = readPinGuard();
  const expired = guard.until > 0 && guard.until <= now;
  const failures = (expired ? 0 : guard.failures) + 1;
  let delay = 0;
  if (failures >= 5) {
    delay = Math.min(300_000, 15_000 * 2 ** (failures - 5));
  }
  const until = delay > 0 ? now + delay : 0;
  writePinGuard({ failures, until });
  return { failures, remainingMs: delay };
}

export function resetPinFailures(): void {
  writePinGuard({ failures: 0, until: 0 });
}

function formatLockout(ms: number): string {
  return `${Math.max(1, Math.ceil(ms / 1000))} detik`;
}

export function formatPinLockout(ms: number): string {
  return formatLockout(ms);
}

function escapeCsvCell(val: string | number): string {
  const s =
    typeof val === 'number' ? String(val) : sanitizeSpreadsheetText(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function finalizeCsv(rows: string[]): string {
  return `${CSV_BOM}${rows.join('\r\n')}`;
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
  return finalizeCsv(rows);
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
  return finalizeCsv(rows);
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
  return finalizeCsv(rows);
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
  return finalizeCsv(rows);
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
  return finalizeCsv(rows);
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
  return finalizeCsv(rows);
}
