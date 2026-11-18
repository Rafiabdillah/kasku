import type { CloudLink, LedgerDatabase } from './types';
import { DEFAULT_SETTINGS } from './defaultAccounts';
import { isValidLocalDate } from './format';
import { validateJournalLines } from './ledger';

export const MAX_CLOUD_BYTES = 850_000;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function cloudPayload(db: LedgerDatabase): string {
  return JSON.stringify(canonical({
    version: 1,
    accounts: db.accounts,
    journals: db.journals,
    journalLines: db.journalLines,
    settings: { ownerName: db.settings.ownerName, businessName: db.settings.businessName },
    budgets: db.budgets ?? {},
    recurringRules: db.recurringRules ?? [],
  }));
}

export async function payloadHash(payload: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseCloudPayload(payload: string): LedgerDatabase {
  if (new TextEncoder().encode(payload).byteLength > MAX_CLOUD_BYTES) {
    throw new Error('Buku melebihi batas sinkronisasi 850 KB. Gunakan backup JSON.');
  }
  const raw = JSON.parse(payload);
  const fail = () => { throw new Error('Data cloud tidak valid. Buku perangkat tidak diubah.'); };
  if (!raw || raw.version !== 1 || !Array.isArray(raw.accounts) || !raw.accounts.length ||
      !Array.isArray(raw.journals) || !Array.isArray(raw.journalLines) ||
      !raw.settings || typeof raw.settings.ownerName !== 'string' ||
      typeof raw.settings.businessName !== 'string' || !Array.isArray(raw.recurringRules) ||
      !raw.budgets || typeof raw.budgets !== 'object' || Array.isArray(raw.budgets)) fail();
  const db = raw as LedgerDatabase;
  const unique = (items: Array<{ id: string }>) => {
    if (items.some((x) => !x || typeof x.id !== 'string' || !x.id) ||
        new Set(items.map((x) => x.id)).size !== items.length) fail();
  };
  unique(db.accounts); unique(db.journals); unique(db.journalLines); unique(db.recurringRules!);
  for (const a of db.accounts) {
    if (typeof a.code !== 'string' || typeof a.name !== 'string' || typeof a.is_active !== 'boolean' ||
        !['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].includes(a.type) ||
        !['DEBIT', 'CREDIT'].includes(a.normal_balance) ||
        (a.is_wallet !== undefined && typeof a.is_wallet !== 'boolean')) fail();
  }
  if (new Set(db.accounts.map((a) => a.code)).size !== db.accounts.length ||
      new Set(db.journals.map((j) => j.number)).size !== db.journals.length) fail();
  const accounts = new Map(db.accounts.map((a) => [a.id, a]));
  const journals = new Set(db.journals.map((j) => j.id));
  for (const line of db.journalLines) {
    if (!journals.has(line.journal_id) || typeof line.memo !== 'string') fail();
  }
  for (const j of db.journals) {
    if (!isValidLocalDate(j.date) || typeof j.description !== 'string' ||
        typeof j.number !== 'string' || typeof j.created_at !== 'string' ||
        !['biasa', 'saldo_awal', 'pembalik'].includes(j.kind) ||
        !(j.voided_at === null || typeof j.voided_at === 'string')) fail();
    for (const id of [j.void_of_id, j.reversal_journal_id]) {
      if (id !== undefined && id !== null && (typeof id !== 'string' || !journals.has(id))) fail();
    }
    if (j.tx_meta !== undefined) {
      const meta = j.tx_meta;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta) ||
          !['masuk', 'keluar', 'pindah', 'belanja_utang', 'bayar_utang', 'pinjamkan', 'dilunasi', 'saldo_awal'].includes(meta.actionType) ||
          !Number.isSafeInteger(meta.amount) || meta.amount <= 0 ||
          (meta.adminFee !== undefined && (!Number.isSafeInteger(meta.adminFee) || meta.adminFee < 0)) ||
          (meta.counterparty !== undefined && typeof meta.counterparty !== 'string')) fail();
      for (const id of [meta.walletId, meta.toWalletId, meta.categoryAccountId]) {
        if (id !== undefined && (typeof id !== 'string' || !accounts.has(id))) fail();
      }
    }
    validateJournalLines(db.journalLines.filter((l) => l.journal_id === j.id), accounts);
  }
  for (const [id, amount] of Object.entries(db.budgets!)) {
    if (!accounts.has(id) || !Number.isSafeInteger(amount) || amount < 0) fail();
  }
  for (const r of db.recurringRules!) {
    if (typeof r.description !== 'string' || !['masuk', 'keluar'].includes(r.actionType) ||
        !Number.isSafeInteger(r.amount) || r.amount <= 0 || !accounts.has(r.walletId) ||
        !accounts.has(r.categoryAccountId) || !Number.isInteger(r.dayOfMonth) ||
        r.dayOfMonth < 1 || r.dayOfMonth > 31 || typeof r.isActive !== 'boolean' ||
        !(r.lastGeneratedMonth === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(r.lastGeneratedMonth))) fail();
  }
  return {
    version: 1,
    accounts: db.accounts,
    journals: db.journals,
    journalLines: db.journalLines,
    settings: {
      ...DEFAULT_SETTINGS, ownerName: db.settings.ownerName, businessName: db.settings.businessName,
    },
    budgets: db.budgets,
    recurringRules: db.recurringRules,
  };
}

export type SyncDecision = 'push' | 'pull' | 'equal' | 'conflict';

export function syncDecision(link: CloudLink, localHash: string, remoteHash: string, remoteRevision: number): SyncDecision {
  if (localHash === remoteHash) return 'equal';
  if (localHash === link.baselineHash) return 'pull';
  if (remoteRevision === link.revision) return 'push';
  return 'conflict';
}

export function receiveCloud(local: LedgerDatabase, remote: LedgerDatabase, link: CloudLink): LedgerDatabase {
  return {
    ...remote,
    settings: { ...local.settings, ownerName: remote.settings.ownerName, businessName: remote.settings.businessName },
    cloudLink: link,
  };
}
