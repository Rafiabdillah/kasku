import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BookOpen, Home, PlusCircle, Receipt, Scale, Settings } from 'lucide-react';
import type {
  Account,
  LedgerDatabase,
  RecurringRule,
  TransactionInput,
} from './core/types';
import { currentLocalMonth } from './core/format';
import {
  generateId,
  updateJournalDescriptionAndDate,
  voidJournal,
} from './core/ledger';
import {
  applyDueRecurringRules,
  createEmptyDatabase,
  createSeedDatabase,
  editFullTransaction,
  mergeRestoredSettings,
  recordTransaction,
} from './core/mapper';
import { buildHomeSummary } from './core/reports';
import {
  loadDatabase,
  normalizeDatabase,
  saveDatabase,
  subscribeToDatabaseChanges,
  triggerFileDownload,
} from './services/storage';
import { BerandaView } from './components/BerandaView';
import { CatatView } from './components/CatatView';
import { TransaksiView } from './components/TransaksiView';
import { BukuView } from './components/BukuView';
import { HutangPiutangView } from './components/HutangPiutangView';
import type { SettingsTab } from './components/PengaturanView';
import { LazyThreeBalanceScene } from './components/LazyThreeBalanceScene';
import { PinLockOverlay } from './components/PinLockOverlay';
import { OfflineIndicator } from './components/PWAStatusAndInstall';

const PengaturanView = lazy(() =>
  import('./components/PengaturanView').then((m) => ({ default: m.PengaturanView })),
);

type AppRoute = 'beranda' | 'catat' | 'transaksi' | 'buku' | 'hutang' | 'pengaturan';

export default function App() {
  const [db, setDb] = useState<LedgerDatabase | null>(null);
  const [route, setRoute] = useState<AppRoute>('beranda');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('akun');
  const [full3D, setFull3D] = useState<boolean>(false);
  const [locked, setLocked] = useState<boolean>(false);
  const [recurringNotice, setRecurringNotice] = useState<string>('');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean>(false);
  const dbRef = useRef<LedgerDatabase | null>(null);
  dbRef.current = db;
  const hiddenAtRef = useRef<number | null>(null);

  const currentMonth = currentLocalMonth();

  useEffect(() => {
    let mounted = true;
    loadDatabase().then((loaded) => {
      if (!mounted) return;
      setStorageError(loaded.warning);
      const recurringRes = applyDueRecurringRules(loaded.db);
      const readyDb = recurringRes.db;
      setDb(readyDb);
      if (recurringRes.generatedCount > 0) {
        void saveDatabase(readyDb);
        setRecurringNotice(
          `${recurringRes.generatedCount} transaksi berulang otomatis dicatat: ${recurringRes.generatedDescriptions.join(', ')}.`,
        );
      }
      if (loaded.seeded) {
        setNeedsOnboarding(true);
      }
      if (readyDb.settings.pinEnabled && readyDb.settings.pinHash) {
        setLocked(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Keep every open tab in sync when another tab saves a change.
  useEffect(() => {
    return subscribeToDatabaseChanges((incoming) => {
      setDb((prev) => (prev ? incoming : prev));
    });
  }, []);

  // Re-lock the PIN after the app sits in the background, and record recurring
  // transactions that became due while the tab was hidden.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;

      const current = dbRef.current;
      if (!current) return;
      if (
        hiddenFor >= 60_000 &&
        current.settings.pinEnabled &&
        current.settings.pinHash
      ) {
        setLocked(true);
      }

      const res = applyDueRecurringRules(current);
      if (res.generatedCount === 0) return;
      commitDb(res.db);
      setRecurringNotice(
        `${res.generatedCount} transaksi berulang otomatis dicatat: ${res.generatedDescriptions.join(', ')}.`,
      );
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const commitDb = (nextDb: LedgerDatabase) => {
    setDb(nextDb);
    void saveDatabase(nextDb).then((result) => {
      setStorageError(result.ok ? null : result.error);
    });
  };

  const completeOnboarding = (
    ownerName: string,
    businessName: string,
    mode: 'empty' | 'demo',
  ) => {
    const current = dbRef.current;
    const trimmedOwner = ownerName.trim();
    const trimmedBusiness = businessName.trim();
    if (mode === 'empty') {
      commitDb(createEmptyDatabase(trimmedOwner, trimmedBusiness));
    } else if (current) {
      commitDb({
        ...current,
        settings: {
          ...current.settings,
          ownerName: trimmedOwner || current.settings.ownerName,
          businessName: trimmedBusiness || current.settings.businessName,
        },
      });
    }
    setNeedsOnboarding(false);
  };

  const handleSaveTransaction = (input: TransactionInput) => {
    if (!db) return;
    const result = recordTransaction(db, input);
    commitDb(result.db);
  };

  const handleImportTransactions = (inputs: TransactionInput[]) => {
    if (!db) return;
    let next = db;
    for (const inp of inputs) {
      next = recordTransaction(next, inp).db;
    }
    commitDb(next);
  };

  const handleEditJournal = (
    journalId: string,
    updates: { date: string; description: string },
  ) => {
    if (!db) return;
    const nextDb = updateJournalDescriptionAndDate(db, journalId, updates);
    commitDb(nextDb);
  };

  const handleEditFullTransaction = (journalId: string, input: TransactionInput) => {
    if (!db) return;
    const res = editFullTransaction(db, journalId, input);
    commitDb(res.db);
  };

  const handleVoidJournal = (journalId: string) => {
    if (!db) return;
    const res = voidJournal(db, journalId);
    commitDb(res.db);
  };

  const handleUpdateSettings = (partial: Partial<LedgerDatabase['settings']>) => {
    if (!db) return;
    commitDb({
      ...db,
      settings: { ...db.settings, ...partial },
    });
  };

  const handleAddAccount = (acc: Omit<Account, 'id'>) => {
    if (!db) return;
    const created: Account = { ...acc, id: generateId('acc') };
    commitDb({
      ...db,
      accounts: [...db.accounts, created],
    });
  };

  const handleUpdateAccount = (id: string, updates: Partial<Account>) => {
    if (!db) return;
    commitDb({
      ...db,
      accounts: db.accounts.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    });
  };

  const handleUpdateBudgets = (budgets: Record<string, number>) => {
    if (!db) return;
    commitDb({
      ...db,
      budgets,
    });
  };

  const handleUpdateRecurringRules = (recurringRules: RecurringRule[]) => {
    if (!db) return;
    commitDb({
      ...db,
      recurringRules,
    });
  };

  const handleRunRecurringNow = (): number => {
    if (!db) return 0;
    const res = applyDueRecurringRules(db);
    if (res.generatedCount > 0) {
      commitDb(res.db);
    }
    return res.generatedCount;
  };

  const handleImportBackup = (nextDb: LedgerDatabase) => {
    if (!db) return;
    commitDb(mergeRestoredSettings(normalizeDatabase(nextDb), db.settings));
  };

  const handleStartEmptyBook = () => {
    if (!db) return;
    const empty = createEmptyDatabase(db.settings.ownerName, db.settings.businessName, {
      pinEnabled: db.settings.pinEnabled,
      pinHash: db.settings.pinHash,
      pinSalt: db.settings.pinSalt,
      spreadsheetId: db.settings.spreadsheetId,
    });
    commitDb(empty);
  };

  const handleResetSeed = () => {
    if (!db) return;
    const fresh = createSeedDatabase();
    fresh.settings = {
      ...fresh.settings,
      ownerName: db.settings.ownerName,
      businessName: db.settings.businessName,
      pinEnabled: Boolean(db.settings.pinEnabled && db.settings.pinHash),
      pinHash: db.settings.pinHash ?? null,
      pinSalt: db.settings.pinSalt ?? null,
      spreadsheetId: db.settings.spreadsheetId,
    };
    commitDb(fresh);
  };

  if (!db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F7F4] text-[#57534E] text-sm">
        Memuat buku kas lokal...
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <FirstRunOnboarding
        onComplete={completeOnboarding}
      />
    );
  }

  if (locked && db.settings.pinEnabled && db.settings.pinHash) {
    return (
      <PinLockOverlay
        expectedHash={db.settings.pinHash}
        pinSalt={db.settings.pinSalt}
        onUnlock={() => setLocked(false)}
      />
    );
  }

  const summary = buildHomeSummary(db, currentMonth);
  const kasBalance = summary.wallets.find((w) => w.account.code === '1101')?.balance ?? 0;
  const bankBalance = summary.wallets.find((w) => w.account.code === '1102')?.balance ?? 0;
  const ewalletBalance = summary.wallets.find((w) => w.account.code === '1103')?.balance ?? 0;

  const navItems: Array<{ id: AppRoute; label: string }> = [
    { id: 'beranda', label: 'Beranda' },
    { id: 'transaksi', label: 'Transaksi' },
    { id: 'buku', label: 'Buku' },
    { id: 'hutang', label: 'Hutang' },
    { id: 'pengaturan', label: 'Pengaturan' },
  ];

  const navigate = (next: AppRoute, subTab?: SettingsTab) => {
    setFull3D(false);
    if (next === 'pengaturan' && subTab) {
      setSettingsTab(subTab);
    } else if (next === 'pengaturan' && route !== 'pengaturan') {
      setSettingsTab('akun');
    }
    setRoute(next);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8F7F4] text-[#18181B]">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="no-print sticky top-0 z-30 border-b border-[#E5E2DC] bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between gap-4 md:gap-8">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={() => navigate('beranda')}
            className="font-serif text-xl font-bold tracking-tight text-[#14532D] whitespace-nowrap shrink-0 min-h-[40px] flex items-center"
          >
            BukuKu
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6" aria-label="Navigasi utama">
            {navItems.map((item) => {
              const active = !full3D && route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id)}
                  className={`text-sm font-medium whitespace-nowrap shrink-0 py-1 border-b-2 ${
                    active
                      ? 'border-[#14532D] text-[#14532D] font-semibold'
                      : 'border-transparent text-[#57534E] hover:text-[#18181B]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => navigate('catat')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#14532D] px-4 py-2 min-h-[40px] text-xs font-semibold text-white hover:bg-[#166534] whitespace-nowrap shrink-0"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Catat</span>
            </button>
          </div>
        </div>
      </header>

      <OfflineIndicator />

      {storageError && (
        <div
          role="alert"
          className="no-print bg-[#FEF2F2] border-b border-[#FECACA] px-4 py-2 text-xs font-medium text-[#B91C1C]"
        >
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <span className="flex-1 min-w-[220px]">{storageError}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  triggerFileDownload(
                    `BukuKu-Backup-Darurat-${new Date().toISOString().slice(0, 10)}.json`,
                    JSON.stringify(db, null, 2),
                    'application/json',
                  )
                }
                className="rounded-md bg-[#B91C1C] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#991B1B]"
              >
                Unduh Backup
              </button>
              <button
                type="button"
                onClick={() => setStorageError(null)}
                className="text-[#B91C1C] hover:underline"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {recurringNotice && (
        <div
          role="status"
          className="no-print bg-[#F0FDF4] border-b border-[#BBF7D0] px-4 py-2 text-xs font-medium text-[#14532D]"
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <span>{recurringNotice}</span>
            <button
              type="button"
              onClick={() => setRecurringNotice('')}
              className="font-semibold hover:underline shrink-0"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      {full3D ? (
        <main className="flex-1 w-full">
          <LazyThreeBalanceScene
            metrics={{
              kasBalance,
              bankBalance,
              ewalletBalance,
              totalAssets: summary.totalAssets,
              totalDebt: summary.totalDebt,
              totalEquity: summary.totalEquity,
              monthlyNet: summary.monthlyNet,
            }}
            fullScreen
            onToggleFullScreen={() => setFull3D(false)}
          />
        </main>
      ) : (
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28 md:pb-10">
          {route === 'beranda' && (
            <BerandaView
              db={db}
              currentMonth={currentMonth}
              onNavigateCatat={() => navigate('catat')}
              onNavigateBuku={() => navigate('buku')}
              onNavigateTransaksi={() => navigate('transaksi')}
              onNavigateHutang={() => navigate('hutang')}
              onNavigateBudgets={() => navigate('pengaturan', 'anggaran')}
              onOpenFull3D={() => setFull3D(true)}
            />
          )}

          {route === 'catat' && (
            <CatatView
              accounts={db.accounts}
              onSaveTransaction={handleSaveTransaction}
              onGoToTransactions={() => navigate('transaksi')}
            />
          )}

          {route === 'transaksi' && (
            <TransaksiView
              db={db}
              onEditJournal={handleEditJournal}
              onEditFullTransaction={handleEditFullTransaction}
              onVoidJournal={handleVoidJournal}
            />
          )}

          {route === 'buku' && <BukuView db={db} />}

          {route === 'hutang' && (
            <HutangPiutangView
              db={db}
              onSaveTransaction={handleSaveTransaction}
            />
          )}

          {route === 'pengaturan' && (
            <Suspense
              fallback={
                <p className="text-sm text-[#57534E]">Memuat halaman pengaturan...</p>
              }
            >
              <PengaturanView
                db={db}
                initialTab={settingsTab}
                onUpdateSettings={handleUpdateSettings}
                onAddAccount={handleAddAccount}
                onUpdateAccount={handleUpdateAccount}
                onUpdateBudgets={handleUpdateBudgets}
                onUpdateRecurringRules={handleUpdateRecurringRules}
                onRunRecurringNow={handleRunRecurringNow}
                onImportTransactions={handleImportTransactions}
                onImportBackup={handleImportBackup}
                onStartEmptyBook={handleStartEmptyBook}
                onResetSeed={handleResetSeed}
                onLockNow={() => setLocked(true)}
              />
            </Suspense>
          )}
        </main>
      )}

      {/* Mobile Bottom Navigation (<= 15% mobile height, >=44px touch targets) */}
      <nav
        className="no-print md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[#E5E2DC] bg-white grid grid-cols-5 h-[calc(3.5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)]"
        aria-label="Navigasi seluler"
      >
        {[
          { id: 'beranda', label: 'Beranda', Icon: Home },
          { id: 'transaksi', label: 'Transaksi', Icon: Receipt },
          { id: 'buku', label: 'Buku', Icon: BookOpen },
          { id: 'hutang', label: 'Hutang', Icon: Scale },
          { id: 'pengaturan', label: 'Atur', Icon: Settings },
        ].map(({ id, label, Icon }) => {
          const active = route === id && !full3D;
          return (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id as AppRoute)}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                active ? 'text-[#14532D] font-semibold' : 'text-[#57534E]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

interface FirstRunOnboardingProps {
  onComplete: (ownerName: string, businessName: string, mode: 'empty' | 'demo') => void;
}

function FirstRunOnboarding({ onComplete }: FirstRunOnboardingProps) {
  const [ownerName, setOwnerName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState('');

  const submit = (mode: 'empty' | 'demo') => {
    if (!ownerName.trim()) {
      setError('Isi nama Anda terlebih dahulu agar laporan memiliki identitas.');
      return;
    }
    onComplete(ownerName, businessName, mode);
  };

  return (
    <div className="min-h-screen bg-[#F8F7F4] text-[#18181B] flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#E5E2DC] bg-white p-6 sm:p-8 space-y-5 shadow-sm">
        <div className="space-y-1">
          <p className="font-serif text-2xl font-bold text-[#14532D]">Selamat datang di BukuKu</p>
          <p className="text-sm text-[#57534E]">
            Pembukuan double-entry yang otomatis menyusun jurnal Debit/Kredit untuk Anda. Semua
            data disimpan lokal di perangkat ini.
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit('empty');
          }}
        >
          <div>
            <label htmlFor="onboarding-owner" className="block text-xs font-semibold text-[#57534E] mb-1">
              Nama Anda (tercetak di header laporan)
            </label>
            <input
              id="onboarding-owner"
              type="text"
              value={ownerName}
              onChange={(e) => {
                setOwnerName(e.target.value);
                setError('');
              }}
              placeholder="Contoh: Siti Rahma"
              autoFocus
              className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="onboarding-business" className="block text-xs font-semibold text-[#57534E] mb-1">
              Nama Usaha / Buku (opsional)
            </label>
            <input
              id="onboarding-business"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Contoh: Warung Bu Siti"
              className="w-full min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-[#B91C1C]">
              {error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-1">
            <button
              type="submit"
              className="flex-1 min-h-[44px] rounded-lg bg-[#14532D] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#166534]"
            >
              Mulai Buku Kosong (Rp0)
            </button>
            <button
              type="button"
              onClick={() => submit('demo')}
              className="flex-1 min-h-[44px] rounded-lg border border-[#D6D3CB] bg-[#F8F7F4] px-4 py-2.5 text-sm font-semibold text-[#18181B] hover:bg-[#EFECE5]"
            >
              Lihat Data Contoh
            </button>
          </div>
        </form>

        <p className="text-xs text-[#57534E] border-t border-[#F0EDE6] pt-3">
          Data contoh berisi transaksi ilustrasi yang bisa dihapus kapan saja dari Pengaturan.
          Anda dapat mengunduh backup JSON dan memasang aplikasi ini sebagai PWA offline.
        </p>
      </div>
    </div>
  );
}
