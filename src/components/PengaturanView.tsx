import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  Account,
  AccountType,
  LedgerDatabase,
  NormalBalance,
  RecurringRule,
  TransactionInput,
} from '../core/types';
import { currentLocalMonth, formatRupiahTitle } from '../core/format';
import { generateId } from '../core/ledger';
import {
  createPinHash,
  exportJurnalUmumCSV,
  exportNeracaSaldoCSV,
  normalizeDatabase,
  triggerFileDownload,
  verifyPin,
} from '../services/storage';
import {
  createBukuKuSpreadsheet,
  fetchSpreadsheetMetadata,
  getCachedSheetsToken,
  initGoogleSheetsAuth,
  parseSpreadsheetId,
  parseSpreadsheetRowsToInputs,
  readSheetValues,
  signInWithGoogleForSheets,
  signOutGoogleSheets,
  syncToExistingSpreadsheet,
  type ParsedSheetImportResult,
  type SpreadsheetMeta,
} from '../services/googleSheets';
import { PWAInstallCard } from './PWAStatusAndInstall';

export type SettingsTab = 'akun' | 'anggaran' | 'sheets' | 'backup' | 'pin' | 'kamus';

interface PengaturanViewProps {
  db: LedgerDatabase;
  initialTab?: SettingsTab;
  onUpdateSettings: (partial: Partial<LedgerDatabase['settings']>) => void;
  onAddAccount: (acc: Omit<Account, 'id'>) => void;
  onUpdateAccount: (id: string, updates: Partial<Account>) => void;
  onUpdateBudgets: (budgets: Record<string, number>) => void;
  onUpdateRecurringRules: (rules: RecurringRule[]) => void;
  onRunRecurringNow: () => number;
  onImportTransactions: (inputs: TransactionInput[]) => void;
  onImportBackup: (nextDb: LedgerDatabase) => void;
  onStartEmptyBook: () => void;
  onResetSeed: () => void;
  onLockNow: () => void;
}

const NORMAL_BY_TYPE: Record<AccountType, NormalBalance> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
};

export function PengaturanView({
  db,
  initialTab = 'akun',
  onUpdateSettings,
  onAddAccount,
  onUpdateAccount,
  onUpdateBudgets,
  onUpdateRecurringRules,
  onRunRecurringNow,
  onImportTransactions,
  onImportBackup,
  onStartEmptyBook,
  onResetSeed,
  onLockNow,
}: PengaturanViewProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [ownerName, setOwnerName] = useState(db.settings.ownerName);
  const [businessName, setBusinessName] = useState(db.settings.businessName);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // Account creation form
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('EXPENSE');
  const [newIsWallet, setNewIsWallet] = useState(false);

  // Edit existing account inline
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [editingAccName, setEditingAccName] = useState('');

  // Budgets & Recurring form
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(db.budgets ?? {})) {
      initial[k] = v > 0 ? String(v) : '';
    }
    return initial;
  });
  const [recDesc, setRecDesc] = useState('');
  const [recType, setRecType] = useState<'keluar' | 'masuk'>('keluar');
  const [recAmount, setRecAmount] = useState('');
  const [recDay, setRecDay] = useState('1');
  const [recWalletId, setRecWalletId] = useState('acc-1102');
  const [recCategoryId, setRecCategoryId] = useState('acc-5104');

  // PIN management
  const [oldPinInput, setOldPinInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');

  // Google Sheets state
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [needsGoogleAuth, setNeedsGoogleAuth] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [spreadsheetIdInput, setSpreadsheetIdInput] = useState<string>(db.settings.spreadsheetId || '');
  const [sheetMeta, setSheetMeta] = useState<SpreadsheetMeta | null>(null);
  const [selectedTabTitle, setSelectedTabTitle] = useState<string>('');
  const [previewRows, setPreviewRows] = useState<string[][]>([]);
  const [fullTabRows, setFullTabRows] = useState<string[][]>([]);
  const [pendingSheetsImport, setPendingSheetsImport] = useState<ParsedSheetImportResult | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState<boolean>(false);
  const [confirmRestoreData, setConfirmRestoreData] = useState<LedgerDatabase | null>(null);
  const [confirmEmptyBookOpen, setConfirmEmptyBookOpen] = useState<boolean>(false);
  const [confirmResetSeedOpen, setConfirmResetSeedOpen] = useState<boolean>(false);

  useEffect(() => {
    const unsub = initGoogleSheetsAuth(
      (user) => {
        setGoogleUser(user);
        setNeedsGoogleAuth(false);
      },
      (user) => {
        setGoogleUser(user);
        setNeedsGoogleAuth(true);
      },
    );
    return () => unsub();
  }, []);

  // Keep the profile and backup drafts in sync after restore/new-book actions.
  useEffect(() => {
    setOwnerName(db.settings.ownerName);
  }, [db.settings.ownerName]);

  useEffect(() => {
    setBusinessName(db.settings.businessName);
  }, [db.settings.businessName]);

  useEffect(() => {
    setSpreadsheetIdInput(db.settings.spreadsheetId || '');
  }, [db.settings.spreadsheetId]);

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(db.budgets ?? {})) {
      next[k] = v > 0 ? String(v) : '';
    }
    setBudgetDrafts(next);
  }, [db.budgets]);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('');
    setErrorMsg('');
    if (!ownerName.trim()) {
      setErrorMsg('Nama pemilik wajib diisi.');
      return;
    }
    onUpdateSettings({
      ownerName: ownerName.trim(),
      businessName: businessName.trim() || 'BukuKu',
    });
    setStatusMsg('Identitas pemilik dan laporan berhasil diperbarui.');
  };

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMsg('');
    setErrorMsg('');
    const code = newCode.trim();
    const name = newName.trim();
    if (!code || !name) {
      setErrorMsg('Kode akun dan nama akun wajib diisi.');
      return;
    }
    if (db.accounts.some((a) => a.code === code)) {
      setErrorMsg(`Kode akun ${code} sudah ada.`);
      return;
    }
    onAddAccount({
      code,
      name,
      type: newType,
      normal_balance: NORMAL_BY_TYPE[newType],
      is_active: true,
      is_wallet: newType === 'ASSET' ? newIsWallet : false,
    });
    setNewCode('');
    setNewName('');
    setNewIsWallet(false);
    setStatusMsg(`Akun ${code} ${name} ditambahkan.`);
  };

  const handleEnablePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    if (db.settings.pinEnabled && db.settings.pinHash) {
      if (!/^\d{4,6}$/.test(oldPinInput)) {
        setErrorMsg('Masukkan PIN saat ini terlebih dahulu sebelum mengganti PIN.');
        return;
      }
      const oldValid = await verifyPin(
        oldPinInput,
        db.settings.pinHash,
        db.settings.pinSalt,
      );
      if (!oldValid) {
        setErrorMsg('PIN saat ini salah.');
        return;
      }
    }
    if (!/^\d{4,6}$/.test(pinInput)) {
      setErrorMsg('PIN baru harus terdiri dari 4 sampai 6 angka.');
      return;
    }
    if (pinInput !== pinConfirm) {
      setErrorMsg('Konfirmasi PIN tidak sama.');
      return;
    }
    const { hash, salt } = await createPinHash(pinInput);
    onUpdateSettings({ pinEnabled: true, pinHash: hash, pinSalt: salt });
    setOldPinInput('');
    setPinInput('');
    setPinConfirm('');
    setStatusMsg(db.settings.pinEnabled ? 'PIN berhasil diperbarui.' : 'Kunci PIN berhasil diaktifkan.');
  };

  const handleDisablePin = async () => {
    setErrorMsg('');
    setStatusMsg('');
    if (db.settings.pinEnabled && db.settings.pinHash) {
      if (!/^\d{4,6}$/.test(oldPinInput)) {
        setErrorMsg('Masukkan PIN saat ini terlebih dahulu untuk menonaktifkan kunci PIN.');
        return;
      }
      const oldValid = await verifyPin(
        oldPinInput,
        db.settings.pinHash,
        db.settings.pinSalt,
      );
      if (!oldValid) {
        setErrorMsg('PIN saat ini salah. Tidak dapat menonaktifkan kunci PIN.');
        return;
      }
    }
    onUpdateSettings({ pinEnabled: false, pinHash: null, pinSalt: null });
    setOldPinInput('');
    setPinInput('');
    setPinConfirm('');
    setStatusMsg('Kunci PIN dinonaktifkan.');
  };

  const handleExportJsonBackup = () => {
    const filename = `BukuKu-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    triggerFileDownload(filename, JSON.stringify(db, null, 2), 'application/json');
    setStatusMsg('File backup JSON berhasil diunduh.');
  };

  const handleBackupFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<LedgerDatabase>;
      if (
        !parsed ||
        !Array.isArray(parsed.accounts) ||
        parsed.accounts.length === 0 ||
        !Array.isArray(parsed.journals) ||
        !Array.isArray(parsed.journalLines)
      ) {
        throw new Error('Format file backup BukuKu tidak valid atau daftar akun kosong.');
      }
      setConfirmRestoreData(normalizeDatabase(parsed));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca file backup.');
    }
    e.target.value = '';
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    setErrorMsg('');
    try {
      const res = await signInWithGoogleForSheets();
      setGoogleUser(res.user);
      setNeedsGoogleAuth(false);
      setStatusMsg(`Terhubung dengan Google (${res.user.email ?? 'Akun Google'}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal masuk dengan Google.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCreateSpreadsheet = async () => {
    setErrorMsg('');
    setStatusMsg('');
    const token = getCachedSheetsToken();
    if (!token) {
      setNeedsGoogleAuth(true);
      setErrorMsg('Silakan klik "Sign in with Google" terlebih dahulu.');
      return;
    }
    setIsSyncing(true);
    try {
      const meta = await createBukuKuSpreadsheet(token, db, currentLocalMonth());
      setSheetMeta(meta);
      setSpreadsheetIdInput(meta.spreadsheetId);
      setSelectedTabTitle(meta.sheets[0]?.title ?? '');
      setPreviewRows([]);
      setFullTabRows([]);
      onUpdateSettings({ spreadsheetId: meta.spreadsheetId });
      setStatusMsg(`Spreadsheet "${meta.title}" berhasil dibuat dan diisi laporan BukuKu.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membuat Google Spreadsheet.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConfirmedSyncExisting = async () => {
    setConfirmOverwriteOpen(false);
    setErrorMsg('');
    setStatusMsg('');
    const token = getCachedSheetsToken();
    if (!token) {
      setNeedsGoogleAuth(true);
      setErrorMsg('Sesi Google berakhir. Silakan Sign in kembali.');
      return;
    }
    if (!spreadsheetIdInput.trim()) {
      setErrorMsg('Masukkan Spreadsheet ID atau tautan Google Sheets terlebih dahulu.');
      return;
    }
    const spreadsheetId = parseSpreadsheetId(spreadsheetIdInput);
    if (!spreadsheetId) {
      setErrorMsg('Spreadsheet ID tidak valid.');
      return;
    }
    setIsSyncing(true);
    try {
      const meta = await syncToExistingSpreadsheet(
        token,
        spreadsheetId,
        db,
        currentLocalMonth(),
      );
      setSheetMeta(meta);
      setSpreadsheetIdInput(meta.spreadsheetId);
      setSelectedTabTitle(meta.sheets[0]?.title ?? '');
      setPreviewRows([]);
      setFullTabRows([]);
      onUpdateSettings({ spreadsheetId: meta.spreadsheetId });
      setStatusMsg(`Spreadsheet "${meta.title}" berhasil disinkronkan.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyinkronkan ke Google Sheets.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleInspectSpreadsheet = async () => {
    setErrorMsg('');
    setStatusMsg('');
    const token = getCachedSheetsToken();
    if (!token) {
      setNeedsGoogleAuth(true);
      setErrorMsg('Silakan Sign in with Google terlebih dahulu.');
      return;
    }
    if (!spreadsheetIdInput.trim()) {
      setErrorMsg('Masukkan Spreadsheet ID atau tautan Google Sheets yang ingin dibaca.');
      return;
    }
    const spreadsheetId = parseSpreadsheetId(spreadsheetIdInput);
    if (!spreadsheetId) {
      setErrorMsg('Spreadsheet ID tidak valid.');
      return;
    }
    setIsSyncing(true);
    try {
      const meta = await fetchSpreadsheetMetadata(token, spreadsheetId);
      setSheetMeta(meta);
      setSpreadsheetIdInput(meta.spreadsheetId);
      const firstTab = meta.sheets[0]?.title ?? '';
      setSelectedTabTitle(firstTab);
      if (firstTab) {
        const rows = await readSheetValues(token, meta.spreadsheetId, firstTab);
        setFullTabRows(rows);
        setPreviewRows(rows.slice(0, 12));
      } else {
        setFullTabRows([]);
        setPreviewRows([]);
      }
      setStatusMsg(`Berhasil membaca metadata "${meta.title}" (${meta.sheets.length} tab).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca metadata spreadsheet.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReadSelectedTab = async (tabName: string) => {
    setSelectedTabTitle(tabName);
    const token = getCachedSheetsToken();
    if (!token || !sheetMeta) return;
    setIsSyncing(true);
    try {
      const rows = await readSheetValues(token, sheetMeta.spreadsheetId, tabName);
      setFullTabRows(rows);
      setPreviewRows(rows.slice(0, 12));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal membaca tab.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handlePrepareSheetsImport = () => {
    setErrorMsg('');
    setStatusMsg('');
    const parsed = parseSpreadsheetRowsToInputs(fullTabRows, db.accounts);
    if (parsed.inputs.length === 0) {
      setErrorMsg(parsed.warnings[0] || 'Tidak ada baris transaksi valid yang ditemukan pada tab ini.');
      return;
    }
    setPendingSheetsImport(parsed);
  };

  const handleSaveBudgets = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    const next: Record<string, number> = {};
    const invalid: string[] = [];
    for (const [accId, raw] of Object.entries(budgetDrafts)) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const val = Number(trimmed.replace(/\./g, ''));
      if (Number.isSafeInteger(val) && val > 0) {
        next[accId] = val;
      } else {
        const acc = db.accounts.find((a) => a.id === accId);
        invalid.push(acc ? `${acc.code} ${acc.name}` : accId);
      }
    }
    if (invalid.length > 0) {
      setErrorMsg(
        `Nilai anggaran tidak valid untuk: ${invalid.join(', ')}. Isi angka rupiah tanpa desimal, atau kosongkan untuk menghapus target.`,
      );
      return;
    }
    onUpdateBudgets(next);
    setStatusMsg('Target anggaran bulanan berhasil disimpan.');
  };

  const handleCreateRecurring = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');
    const amt = Number(recAmount);
    const day = Number(recDay);
    if (!recDesc.trim()) {
      setErrorMsg('Keterangan transaksi berulang wajib diisi.');
      return;
    }
    if (!Number.isSafeInteger(amt) || amt <= 0) {
      setErrorMsg('Nominal harus bilangan bulat > 0.');
      return;
    }
    if (!Number.isSafeInteger(day) || day < 1 || day > 31) {
      setErrorMsg('Tanggal jatuh tempo harus antara 1 sampai 31.');
      return;
    }
    const newRule: RecurringRule = {
      id: generateId('rec'),
      description: recDesc.trim(),
      actionType: recType,
      amount: amt,
      walletId: recWalletId,
      categoryAccountId: recCategoryId,
      dayOfMonth: day,
      isActive: true,
      lastGeneratedMonth: null,
    };
    onUpdateRecurringRules([...(db.recurringRules ?? []), newRule]);
    setRecDesc('');
    setRecAmount('');
    setStatusMsg(`Aturan bulanan "${newRule.description}" ditambahkan.`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-[#18181B]">Pengaturan &amp; Kamus</h1>
        <p className="text-sm text-[#57534E]">
          Kelola Bagan Akun, sinkronisasi Google Sheets, kunci PIN, backup manual, dan panduan Debit/Kredit.
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E5E2DC] pb-3">
        {[
          { id: 'akun', label: 'Bagan Akun & Profil' },
          { id: 'anggaran', label: 'Anggaran & Berulang' },
          { id: 'sheets', label: 'Google Sheets' },
          { id: 'backup', label: 'CSV, Backup & PWA' },
          { id: 'pin', label: 'Keamanan PIN' },
          { id: 'kamus', label: 'Kamus Debit/Kredit' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => {
              setTab(item.id as SettingsTab);
              setStatusMsg('');
              setErrorMsg('');
            }}
            className={`min-h-[40px] px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
              tab === item.id
                ? 'bg-[#14532D] text-white'
                : 'bg-white border border-[#E5E2DC] text-[#57534E] hover:text-[#18181B]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {statusMsg && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm font-medium text-[#14532D]"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm font-medium text-[#B91C1C]"
        >
          {errorMsg}
        </div>
      )}

      {/* TAB 1: BAGAN AKUN & PROFIL */}
      {tab === 'akun' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-4 space-y-6">
            <form
              onSubmit={handleSaveProfile}
              className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4"
            >
              <h2 className="font-serif text-lg font-bold text-[#18181B]">Identitas Laporan</h2>
              <div>
                <label htmlFor="owner-name" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Nama Pemilik (Header PDF/Laporan)
                </label>
                <input
                  id="owner-name"
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="biz-name" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Nama Usaha / Buku
                </label>
                <input
                  id="biz-name"
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534]"
              >
                Simpan Identitas
              </button>
            </form>

            <form
              onSubmit={handleCreateAccount}
              className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4"
            >
              <h2 className="font-serif text-lg font-bold text-[#18181B]">Tambah Akun Baru</h2>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="acc-code" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Kode
                  </label>
                  <input
                    id="acc-code"
                    type="text"
                    placeholder="5110"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="acc-name" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Nama Akun
                  </label>
                  <input
                    id="acc-name"
                    type="text"
                    placeholder="Misal: Listrik & Air"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="acc-type" className="block text-xs font-semibold text-[#57534E] mb-1">
                  Kelompok Akun
                </label>
                <select
                  id="acc-type"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as AccountType)}
                  className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
                >
                  <option value="ASSET">ASSET (Harta — Saldo Normal Debit)</option>
                  <option value="LIABILITY">LIABILITY (Utang — Saldo Normal Kredit)</option>
                  <option value="EQUITY">EQUITY (Modal — Saldo Normal Kredit)</option>
                  <option value="REVENUE">REVENUE (Pendapatan — Saldo Normal Kredit)</option>
                  <option value="EXPENSE">EXPENSE (Beban — Saldo Normal Debit)</option>
                </select>
              </div>

              {newType === 'ASSET' && (
                <label className="flex items-center gap-2 text-xs font-medium text-[#18181B]">
                  <input
                    type="checkbox"
                    checked={newIsWallet}
                    onChange={(e) => setNewIsWallet(e.target.checked)}
                    className="accent-[#14532D]"
                  />
                  <span>Tampilkan sebagai dompet di menu Catat</span>
                </label>
              )}

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534]"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah ke Bagan Akun</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-8 rounded-xl border border-[#E5E2DC] bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E5E2DC] flex items-center justify-between">
              <h2 className="font-serif text-lg font-bold text-[#18181B]">
                Daftar Bagan Akun ({db.accounts.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-[#F8F7F4] border-b border-[#E5E2DC] text-xs font-semibold text-[#57534E]">
                    <th className="px-4 py-2.5 text-left">Kode</th>
                    <th className="px-4 py-2.5 text-left">Nama Akun</th>
                    <th className="px-4 py-2.5 text-left">Tipe</th>
                    <th className="px-4 py-2.5 text-left">Normal</th>
                    <th className="px-4 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0EDE6]">
                  {[...db.accounts]
                    .sort((a, b) => a.code.localeCompare(b.code))
                    .map((acc) => (
                      <tr key={acc.id} className={!acc.is_active ? 'opacity-50' : ''}>
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold">{acc.code}</td>
                        <td className="px-4 py-2.5">
                          {editingAccId === acc.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingAccName}
                                onChange={(e) => setEditingAccName(e.target.value)}
                                className="rounded border border-[#D6D3CB] px-2 py-1 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (editingAccName.trim()) {
                                    onUpdateAccount(acc.id, { name: editingAccName.trim() });
                                  }
                                  setEditingAccId(null);
                                }}
                                className="text-xs font-semibold text-[#14532D]"
                              >
                                Simpan
                              </button>
                            </div>
                          ) : (
                            <span className="font-medium text-[#18181B]">{acc.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-[#57534E]">{acc.type}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{acc.normal_balance}</td>
                        <td className="px-4 py-2.5 text-right space-x-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAccId(acc.id);
                              setEditingAccName(acc.name);
                            }}
                            className="text-xs font-semibold text-[#14532D] hover:underline"
                          >
                            Ubah Nama
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateAccount(acc.id, { is_active: !acc.is_active })}
                            className="text-xs font-semibold text-[#57534E] hover:text-[#18181B]"
                          >
                            {acc.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1B: ANGGARAN & TRANSAKSI BERULANG */}
      {tab === 'anggaran' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Budgets */}
          <form
            onSubmit={handleSaveBudgets}
            className="lg:col-span-6 rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4"
          >
            <div>
              <h2 className="font-serif text-lg font-bold text-[#18181B]">
                Anggaran Bulanan per Kategori
              </h2>
              <p className="text-xs text-[#57534E] mt-1">
                Isi nominal batas pengeluaran bulanan (kosongkan atau isi 0 untuk menonaktifkan batas).
              </p>
            </div>

            <div className="divide-y divide-[#F0EDE6]">
              {db.accounts
                .filter((a) => a.is_active && a.type === 'EXPENSE')
                .sort((a, b) => a.code.localeCompare(b.code))
                .map((acc) => (
                  <div key={acc.id} className="py-2.5 flex items-center justify-between gap-4">
                    <label htmlFor={`budget-${acc.id}`} className="text-xs font-medium text-[#18181B]">
                      <span className="font-mono text-[#57534E] mr-2">{acc.code}</span>
                      {acc.name}
                    </label>
                    <input
                      id={`budget-${acc.id}`}
                      type="number"
                      min={0}
                      step={50000}
                      placeholder="0"
                      value={budgetDrafts[acc.id] ?? ''}
                      onChange={(e) =>
                        setBudgetDrafts((prev) => ({ ...prev, [acc.id]: e.target.value }))
                      }
                      className="w-40 rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-1.5 text-right font-mono text-xs"
                    />
                  </div>
                ))}
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-[#14532D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#166534]"
            >
              Simpan Target Anggaran
            </button>
          </form>

          {/* Recurring Rules */}
          <div className="lg:col-span-6 space-y-5">
            <form
              onSubmit={handleCreateRecurring}
              className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-serif text-lg font-bold text-[#18181B]">
                    Transaksi Berulang Otomatis
                  </h2>
                  <p className="text-xs text-[#57534E] mt-1">
                    Dicatat otomatis 1 kali setiap bulan saat tanggal jatuh tempo tercapai.
                  </p>
                </div>
                <CalendarClock className="w-5 h-5 text-[#14532D] shrink-0" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rec-type" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Jenis
                  </label>
                  <select
                    id="rec-type"
                    value={recType}
                    onChange={(e) => {
                      const nextType = e.target.value as 'keluar' | 'masuk';
                      setRecType(nextType);
                      setRecCategoryId(nextType === 'masuk' ? 'acc-4101' : 'acc-5104');
                    }}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-xs"
                  >
                    <option value="keluar">Pengeluaran Rutin</option>
                    <option value="masuk">Pemasukan Rutin</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="rec-day" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Setiap Tanggal (1-31)
                  </label>
                  <input
                    id="rec-day"
                    type="number"
                    min={1}
                    max={31}
                    value={recDay}
                    onChange={(e) => setRecDay(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rec-wallet" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Dompet
                  </label>
                  <select
                    id="rec-wallet"
                    value={recWalletId}
                    onChange={(e) => setRecWalletId(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-xs"
                  >
                    {db.accounts
                      .filter((a) => a.is_active && (a.is_wallet || ['1101', '1102', '1103'].includes(a.code)))
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} — {w.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="rec-cat" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Kategori
                  </label>
                  <select
                    id="rec-cat"
                    value={recCategoryId}
                    onChange={(e) => setRecCategoryId(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-xs"
                  >
                    {db.accounts
                      .filter((a) =>
                        a.is_active &&
                        (recType === 'masuk' ? a.type === 'REVENUE' : a.type === 'EXPENSE'),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rec-amount" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Nominal (Rp)
                  </label>
                  <input
                    id="rec-amount"
                    type="number"
                    min={1}
                    placeholder="Contoh: 1200000"
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="rec-desc" className="block text-xs font-semibold text-[#57534E] mb-1">
                    Keterangan
                  </label>
                  <input
                    id="rec-desc"
                    type="text"
                    placeholder="Misal: Sewa Kos Bulanan"
                    value={recDesc}
                    onChange={(e) => setRecDesc(e.target.value)}
                    className="w-full rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534]"
              >
                <Plus className="w-4 h-4" />
                <span>Tambah Jadwal Berulang</span>
              </button>
            </form>

            <div className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-serif text-base font-bold text-[#18181B]">
                  Daftar Jadwal Aktif ({(db.recurringRules ?? []).length})
                </h3>
                {(db.recurringRules ?? []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const count = onRunRecurringNow();
                      setStatusMsg(
                        count > 0
                          ? `${count} transaksi berulang yang jatuh tempo bulan ini berhasil dicatat.`
                          : 'Semua jadwal jatuh tempo bulan ini sudah tercatat sebelumnya.',
                      );
                    }}
                    className="rounded-lg border border-[#14532D] px-3 py-1.5 text-xs font-semibold text-[#14532D] hover:bg-[#14532D]/5"
                  >
                    Jalankan Jatuh Tempo Sekarang
                  </button>
                )}
              </div>

              {(db.recurringRules ?? []).length === 0 ? (
                <p className="text-xs text-[#57534E]">
                  Belum ada jadwal transaksi berulang bulanan.
                </p>
              ) : (
                <ul className="divide-y divide-[#F0EDE6]">
                  {(db.recurringRules ?? []).map((rule) => (
                    <li key={rule.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`text-xs font-semibold text-[#18181B] ${!rule.isActive ? 'opacity-50' : ''}`}>
                          {rule.description} ({rule.actionType === 'masuk' ? 'Masuk' : 'Keluar'})
                        </p>
                        <p className="text-[11px] text-[#57534E] font-mono mt-0.5">
                          {formatRupiahTitle(rule.amount)} · Tgl {rule.dayOfMonth} tiap bulan
                          {rule.lastGeneratedMonth ? ` · Terakhir: ${rule.lastGeneratedMonth}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateRecurringRules(
                              (db.recurringRules ?? []).map((r) =>
                                r.id === rule.id ? { ...r, isActive: !r.isActive } : r,
                              ),
                            )
                          }
                          className="text-xs font-semibold text-[#14532D] hover:underline"
                        >
                          {rule.isActive ? 'Jeda' : 'Aktifkan'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateRecurringRules(
                              (db.recurringRules ?? []).filter((r) => r.id !== rule.id),
                            )
                          }
                          aria-label={`Hapus ${rule.description}`}
                          className="p-1 text-[#B91C1C] hover:bg-[#FEF2F2] rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: GOOGLE SHEETS INTEGRATION */}
      {tab === 'sheets' && (
        <div className="max-w-3xl space-y-6">
          <div className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-serif text-lg font-bold text-[#18181B]">
                  Sinkronisasi Google Sheets
                </h2>
                <p className="text-xs text-[#57534E] mt-1">
                  Ekspor Ringkasan, Jurnal Umum, Neraca Saldo, dan Laba Rugi langsung ke Google Sheets Anda.
                </p>
              </div>

              {needsGoogleAuth ? (
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={isLoggingIn}
                  className="gsi-material-button shrink-0"
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">
                      {isLoggingIn ? 'Menghubungkan...' : 'Sign in with Google'}
                    </span>
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[#14532D]">
                    {googleUser?.email ?? 'Terhubung'}
                  </span>
                  <button
                    type="button"
                    onClick={() => signOutGoogleSheets()}
                    className="rounded-lg border border-[#D6D3CB] px-3 py-1.5 text-xs font-semibold text-[#57534E] hover:text-[#18181B]"
                  >
                    Keluar
                  </button>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-[#F0EDE6] space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleCreateSpreadsheet}
                  disabled={isSyncing}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#14532D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#166534] disabled:opacity-50"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>{isSyncing ? 'Memproses...' : 'Buat Spreadsheet BukuKu Baru'}</span>
                </button>
              </div>

              <div>
                <label htmlFor="sheets-id" className="block text-xs font-semibold text-[#57534E] mb-1.5">
                  Atau Gunakan Spreadsheet ID / Tautan yang Sudah Ada
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    id="sheets-id"
                    type="text"
                    placeholder="Tempel tautan https://docs.google.com/spreadsheets/d/... atau ID-nya"
                    value={spreadsheetIdInput}
                    onChange={(e) => {
                      setSpreadsheetIdInput(e.target.value);
                      setPreviewRows([]);
                      setFullTabRows([]);
                    }}
                    className="flex-1 rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleInspectSpreadsheet}
                    disabled={isSyncing}
                    className="rounded-lg border border-[#D6D3CB] bg-white px-3.5 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F3F1EB] whitespace-nowrap"
                  >
                    Baca Tab
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!spreadsheetIdInput.trim()) {
                        setErrorMsg('Masukkan Spreadsheet ID terlebih dahulu.');
                        return;
                      }
                      setConfirmOverwriteOpen(true);
                    }}
                    disabled={isSyncing}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#14532D] bg-[#14532D]/5 px-3.5 py-2 text-xs font-semibold text-[#14532D] hover:bg-[#14532D]/10 whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Sinkronkan</span>
                  </button>
                </div>
              </div>

              {sheetMeta && (
                <div className="rounded-lg border border-[#E5E2DC] bg-[#F8F7F4] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#18181B]">{sheetMeta.title}</p>
                    <a
                      href={sheetMeta.spreadsheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#14532D] hover:underline"
                    >
                      <span>Buka di Google Sheets</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {sheetMeta.sheets.map((s) => (
                      <button
                        key={s.sheetId}
                        type="button"
                        onClick={() => handleReadSelectedTab(s.title)}
                        className={`px-2.5 py-1 rounded text-xs font-semibold border ${
                          selectedTabTitle === s.title
                            ? 'bg-[#14532D] text-white border-[#14532D]'
                            : 'bg-white text-[#57534E] border-[#D6D3CB]'
                        }`}
                      >
                        {s.title}
                      </button>
                    ))}
                  </div>

                  {previewRows.length > 0 && (
                    <div className="space-y-3">
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-[#D6D3CB] bg-white text-xs">
                          <tbody>
                            {previewRows.map((row, rIdx) => (
                              <tr key={rIdx} className={rIdx === 0 ? 'bg-[#F3F1EB] font-semibold' : ''}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="border border-[#D6D3CB] px-2 py-1">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {fullTabRows.length >= 1000 && (
                        <p className="text-xs font-medium text-[#B45309]">
                          Catatan: Pembacaan Google Sheets dibatasi hingga 1.000 baris pertama (A1:Z1000).
                        </p>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <span className="text-xs text-[#57534E]">
                          Format impor didukung: kolom Tanggal, Jenis (Masuk/Keluar), Dompet, Kategori, Nominal, Keterangan.
                        </span>
                        <button
                          type="button"
                          onClick={handlePrepareSheetsImport}
                          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#14532D] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#166534] whitespace-nowrap"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Impor Tab Ini ke BukuKu</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CSV, BACKUP MANUAL & PWA */}
      {tab === 'backup' && (
        <div className="space-y-6">
          <PWAInstallCard />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4">
              <h2 className="font-serif text-lg font-bold text-[#18181B]">Ekspor Data CSV</h2>
              <p className="text-xs text-[#57534E]">
                Unduh data akuntansi terstruktur dalam format CSV untuk dibuka di Excel atau Calc.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    triggerFileDownload(
                      'BukuKu-Jurnal-Umum-Semua.csv',
                      exportJurnalUmumCSV(db, 'all'),
                      'text/csv;charset=utf-8;',
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-4 py-2.5 text-xs font-semibold text-[#18181B] hover:bg-[#EFECE5]"
                >
                  <Download className="w-4 h-4" />
                  <span>Ekspor CSV Jurnal Umum</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerFileDownload(
                      'BukuKu-Neraca-Saldo.csv',
                      exportNeracaSaldoCSV(db),
                      'text/csv;charset=utf-8;',
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-4 py-2.5 text-xs font-semibold text-[#18181B] hover:bg-[#EFECE5]"
                >
                  <Download className="w-4 h-4" />
                  <span>Ekspor CSV Neraca Saldo</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-4">
              <h2 className="font-serif text-lg font-bold text-[#18181B]">Backup &amp; Buku Baru</h2>
              <p className="text-xs text-[#57534E]">
                Simpan cadangan JSON offline, pulihkan backup, atau mulai buku baru yang benar-benar kosong (Rp0).
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportJsonBackup}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#14532D] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#166534]"
                >
                  <Download className="w-4 h-4" />
                  <span>Unduh Backup (.json)</span>
                </button>

                <label className="inline-flex items-center gap-2 rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-4 py-2.5 text-xs font-semibold text-[#18181B] hover:bg-[#EFECE5] cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>Pulihkan Backup</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={handleBackupFileSelected}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="pt-3 border-t border-[#F0EDE6] flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setConfirmEmptyBookOpen(true)}
                  className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2 text-xs font-semibold text-[#B91C1C] hover:bg-[#FEE2E2]"
                >
                  Mulai Buku Kosong (Rp0)
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResetSeedOpen(true)}
                  className="text-xs font-semibold text-[#57534E] hover:text-[#18181B]"
                >
                  Reset ke Data Contoh
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: KEAMANAN PIN */}
      {tab === 'pin' && (
        <div className="max-w-lg rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg font-bold text-[#18181B]">Kunci PIN Aplikasi</h2>
              <p className="text-xs text-[#57534E]">
                Status saat ini: {db.settings.pinEnabled ? 'Aktif' : 'Tidak Aktif'}
              </p>
            </div>
            {db.settings.pinEnabled && (
              <button
                type="button"
                onClick={onLockNow}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#D6D3CB] px-3 py-1.5 text-xs font-semibold text-[#18181B] hover:bg-[#F3F1EB]"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Kunci Sekarang</span>
              </button>
            )}
          </div>

          <form onSubmit={handleEnablePin} className="space-y-3 pt-2 border-t border-[#F0EDE6]">
            {db.settings.pinEnabled && (
              <div>
                <label htmlFor="pin-old" className="block text-xs font-semibold text-[#57534E] mb-1">
                  PIN Saat Ini (Wajib diisi untuk ubah/nonaktifkan)
                </label>
                <input
                  id="pin-old"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={oldPinInput}
                  onChange={(e) => setOldPinInput(e.target.value)}
                  className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm"
                />
              </div>
            )}
            <div>
              <label htmlFor="pin-new" className="block text-xs font-semibold text-[#57534E] mb-1">
                {db.settings.pinEnabled ? 'Ganti PIN Baru (4-6 angka)' : 'Buat PIN (4-6 angka)'}
              </label>
              <input
                id="pin-new"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm"
              />
            </div>
            <div>
              <label htmlFor="pin-confirm" className="block text-xs font-semibold text-[#57534E] mb-1">
                Ulangi PIN
              </label>
              <input
                id="pin-confirm"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinConfirm}
                onChange={(e) => setPinConfirm(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="submit"
                className="min-h-[44px] rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white hover:bg-[#166534]"
              >
                {db.settings.pinEnabled ? 'Perbarui PIN' : 'Aktifkan PIN'}
              </button>
              {db.settings.pinEnabled && (
                <button
                  type="button"
                  onClick={handleDisablePin}
                  className="min-h-[44px] rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2 text-xs font-semibold text-[#B91C1C]"
                >
                  Nonaktifkan PIN
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* TAB 5: KAMUS AKUNTANSI */}
      {tab === 'kamus' && (
        <div className="rounded-xl border border-[#E5E2DC] bg-white p-6 space-y-6">
          <div className="flex items-start gap-3">
            <BookOpen className="w-5 h-5 text-[#14532D] mt-0.5 shrink-0" />
            <div>
              <h2 className="font-serif text-lg font-bold text-[#18181B]">
                Kamus Debit &amp; Kredit Akuntansi Indonesia
              </h2>
              <p className="text-sm text-[#57534E] mt-1">
                Di BukuKu, Anda cukup memilih Masuk, Keluar, atau Pindah. Sistem otomatis menerjemahkannya ke aturan pembukuan berpasangan (double-entry) berikut:
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-[#C8C3B8] text-sm">
              <thead>
                <tr className="bg-[#14532D] text-white text-xs font-semibold">
                  <th className="border border-[#1E6B3D] px-3 py-2 text-left">Kelompok Akun</th>
                  <th className="border border-[#1E6B3D] px-3 py-2 text-left">Contoh di BukuKu</th>
                  <th className="border border-[#1E6B3D] px-3 py-2 text-left">Bertambah di</th>
                  <th className="border border-[#1E6B3D] px-3 py-2 text-left">Berkurang di</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-semibold">Aset (Harta)</td>
                  <td className="border border-[#C8C3B8] px-3 py-2">1101 Kas, 1102 Bank, 1201 Piutang</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#14532D]">DEBIT</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#B91C1C]">KREDIT</td>
                </tr>
                <tr>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-semibold">Utang (Kewajiban)</td>
                  <td className="border border-[#C8C3B8] px-3 py-2">2101 Utang, 2102 Paylater</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#14532D]">KREDIT</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#B91C1C]">DEBIT</td>
                </tr>
                <tr>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-semibold">Modal (Ekuitas)</td>
                  <td className="border border-[#C8C3B8] px-3 py-2">3101 Modal Awal</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#14532D]">KREDIT</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#B91C1C]">DEBIT</td>
                </tr>
                <tr>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-semibold">Pendapatan</td>
                  <td className="border border-[#C8C3B8] px-3 py-2">4101 Pendapatan Usaha, 4102 Uang Saku</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#14532D]">KREDIT</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#B91C1C]">DEBIT</td>
                </tr>
                <tr>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-semibold">Beban (Biaya)</td>
                  <td className="border border-[#C8C3B8] px-3 py-2">5101 Makan, 5102 Transport, 5104 Kos</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#14532D]">DEBIT</td>
                  <td className="border border-[#C8C3B8] px-3 py-2 font-mono text-[#B91C1C]">KREDIT</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Overwrite/Sync Existing Google Spreadsheet */}
      {confirmOverwriteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-[#D6D3CB] bg-white p-6 space-y-4 shadow-xl">
            <h3 className="font-serif text-lg font-bold text-[#18181B]">
              Perbarui Isi Google Spreadsheet?
            </h3>
            <p className="text-sm text-[#57534E]">
              BukuKu akan memperbarui tab <strong>BukuKu · Ringkasan</strong>, <strong>BukuKu · Jurnal Umum</strong>, <strong>BukuKu · Neraca Saldo</strong>, dan <strong>BukuKu · Laba Rugi</strong> pada spreadsheet <span className="font-mono text-xs">{spreadsheetIdInput}</span> dengan data pembukuan terbaru.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOverwriteOpen(false)}
                className="rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmedSyncExisting}
                className="rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white"
              >
                Ya, Sinkronkan Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Restore JSON Backup */}
      {confirmRestoreData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-[#D6D3CB] bg-white p-6 space-y-4 shadow-xl">
            <h3 className="font-serif text-lg font-bold text-[#18181B]">
              Pulihkan Data dari Backup?
            </h3>
            <p className="text-sm text-[#57534E]">
              Data pembukuan saat ini akan digantikan oleh file backup berisi {confirmRestoreData.journals.length} jurnal dan {confirmRestoreData.accounts.length} akun. PIN dan ID Google Sheets yang tersimpan di perangkat ini tetap dipertahankan.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmRestoreData(null)}
                className="rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onImportBackup(confirmRestoreData);
                  setConfirmRestoreData(null);
                  setStatusMsg('Database berhasil dipulihkan dari file backup.');
                }}
                className="rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white"
              >
                Pulihkan Data
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Confirmation Dialog: Start Empty Book (Rp0) */}
      {confirmEmptyBookOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-[#D6D3CB] bg-white p-6 space-y-4 shadow-xl">
            <h3 className="font-serif text-lg font-bold text-[#18181B]">
              Mulai Buku Baru Kosong (Rp0)?
            </h3>
            <p className="text-sm text-[#57534E]">
              Seluruh jurnal transaksi dan contoh saldo awal saat ini akan dikosongkan menjadi Rp0 sambil mempertahankan bagan akun, nama pemilik, pengaturan PIN, dan ID Google Sheets Anda. Pastikan sudah mengunduh backup jika data masih diperlukan.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmEmptyBookOpen(false)}
                className="rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onStartEmptyBook();
                  setConfirmEmptyBookOpen(false);
                  setStatusMsg('Buku baru kosong (Rp0) siap digunakan. Silakan catat Saldo Awal Anda.');
                }}
                className="rounded-lg bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#991B1B]"
              >
                Ya, Kosongkan Buku
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Reset to Demo Data */}
      {confirmResetSeedOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-[#D6D3CB] bg-white p-6 space-y-4 shadow-xl">
            <h3 className="font-serif text-lg font-bold text-[#18181B]">
              Ganti Seluruh Data dengan Data Contoh?
            </h3>
            <p className="text-sm text-[#57534E]">
              Semua jurnal, saldo, dan aturan berulang Anda saat ini akan <strong>dihapus</strong> dan diganti data contoh BukuKu. Nama pemilik, PIN, dan ID Google Sheets tetap dipertahankan. Unduh backup terlebih dahulu jika data ini masih diperlukan.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmResetSeedOpen(false)}
                className="rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  onResetSeed();
                  setConfirmResetSeedOpen(false);
                  setStatusMsg('Data contoh BukuKu berhasil dimuat ulang.');
                }}
                className="rounded-lg bg-[#B91C1C] px-4 py-2 text-xs font-semibold text-white hover:bg-[#991B1B]"
              >
                Ya, Ganti dengan Data Contoh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Import Transactions from Google Sheets */}
      {pendingSheetsImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-[#D6D3CB] bg-white p-6 space-y-4 shadow-xl">
            <h3 className="font-serif text-lg font-bold text-[#18181B]">
              Impor {pendingSheetsImport.inputs.length} Transaksi dari Sheets?
            </h3>
            <p className="text-sm text-[#57534E]">
              BukuKu akan membuat <strong>{pendingSheetsImport.inputs.length}</strong> jurnal debit-kredit baru dari tab <strong>{selectedTabTitle}</strong>.
              {pendingSheetsImport.skippedRows > 0 && (
                <span> ({pendingSheetsImport.skippedRows} baris dilewati karena nominal tidak valid.)</span>
              )}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPendingSheetsImport(null)}
                className="rounded-lg border border-[#D6D3CB] px-4 py-2 text-xs font-semibold text-[#18181B]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  const count = pendingSheetsImport.inputs.length;
                  onImportTransactions(pendingSheetsImport.inputs);
                  setPendingSheetsImport(null);
                  setStatusMsg(`Berhasil mengimpor ${count} transaksi ke jurnal BukuKu.`);
                }}
                className="rounded-lg bg-[#14532D] px-4 py-2 text-xs font-semibold text-white"
              >
                Ya, Impor Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
