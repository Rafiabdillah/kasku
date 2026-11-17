import { useEffect, useState } from 'react';
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
  recordTransaction,
} from './core/mapper';
import { buildHomeSummary } from './core/reports';
import { loadDatabase, normalizeDatabase, saveDatabase } from './services/storage';
import { BerandaView } from './components/BerandaView';
import { CatatView } from './components/CatatView';
import { TransaksiView } from './components/TransaksiView';
import { BukuView } from './components/BukuView';
import { HutangPiutangView } from './components/HutangPiutangView';
import { PengaturanView, type SettingsTab } from './components/PengaturanView';
import { ThreeBalanceScene } from './components/ThreeBalanceScene';
import { PinLockOverlay } from './components/PinLockOverlay';
import { OfflineIndicator } from './components/PWAStatusAndInstall';

type AppRoute = 'beranda' | 'catat' | 'transaksi' | 'buku' | 'hutang' | 'pengaturan';

export default function App() {
  const [db, setDb] = useState<LedgerDatabase | null>(null);
  const [route, setRoute] = useState<AppRoute>('beranda');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('akun');
  const [full3D, setFull3D] = useState<boolean>(false);
  const [locked, setLocked] = useState<boolean>(false);
  const [recurringNotice, setRecurringNotice] = useState<string>('');

  const currentMonth = currentLocalMonth();

  useEffect(() => {
    let mounted = true;
    loadDatabase().then((loaded) => {
      if (!mounted) return;
      const recurringRes = applyDueRecurringRules(loaded);
      const readyDb = recurringRes.db;
      setDb(readyDb);
      if (recurringRes.generatedCount > 0) {
        void saveDatabase(readyDb);
        setRecurringNotice(
          `${recurringRes.generatedCount} transaksi berulang otomatis dicatat: ${recurringRes.generatedDescriptions.join(', ')}.`,
        );
      }
      if (readyDb.settings.pinEnabled && readyDb.settings.pinHash) {
        setLocked(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const commitDb = (nextDb: LedgerDatabase) => {
    setDb(nextDb);
    void saveDatabase(nextDb);
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
    commitDb(normalizeDatabase(nextDb));
  };

  const handleStartEmptyBook = () => {
    const empty = createEmptyDatabase(db?.settings.ownerName, db?.settings.businessName);
    commitDb(empty);
  };

  const handleResetSeed = () => {
    const fresh = createSeedDatabase();
    commitDb(fresh);
  };

  if (!db) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F7F4] text-[#57534E] text-sm">
        Memuat buku kas lokal...
      </div>
    );
  }

  if (locked && db.settings.pinEnabled && db.settings.pinHash) {
    return (
      <PinLockOverlay
        expectedHash={db.settings.pinHash}
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
          <ThreeBalanceScene
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
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-10">
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
          )}
        </main>
      )}

      {/* Mobile Bottom Navigation (<= 15% mobile height, >=44px touch targets) */}
      <nav
        className="no-print md:hidden fixed bottom-0 left-0 right-0 z-30 h-14 border-t border-[#E5E2DC] bg-white grid grid-cols-5"
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
